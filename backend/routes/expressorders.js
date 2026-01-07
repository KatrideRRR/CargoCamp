const express = require("express");
const router = express.Router();
const { Op } = require("sequelize");
const authenticateToken = require("../middlewares/userAuth");
const { sequelize, ExpressOrder, ExpressSavedAddress } = require("../models");

/* ================= helpers ================= */

function toNum(v) {
    const n = typeof v === "string" ? Number(v) : v;
    return Number.isFinite(n) ? n : null;
}

function isFiniteNumberish(v) {
    const n = typeof v === "string" ? Number(v) : v;
    return Number.isFinite(n);
}

function isParticipant(order, userId) {
    return order.creatorId === userId || order.executorId === userId;
}

function buildYandexNaviUrl(fromLat, fromLng, toLat, toLng) {
    const fLat = Number(fromLat);
    const fLng = Number(fromLng);
    const tLat = Number(toLat);
    const tLng = Number(toLng);
    return `https://yandex.ru/navi/?rtext=${fLat},${fLng}~${tLat},${tLng}&rtt=auto`;
}

function canViewAvailableExpress(order, userId) {
    // можно ограничить: запретить создателю, чтобы он не открывал маршруты к своему же заказу
    if (order.creatorId === userId) return false;
    return order.status === "created" && !order.executorId;
}

function canAccessExpressOrder(order, userId) {
    return isParticipant(order, userId) || canViewAvailableExpress(order, userId);
}

async function bumpSavedAddressUsage({ userId, id, transaction }) {
    if (!id) return;
    const addr = await ExpressSavedAddress.findOne({ where: { id, userId }, transaction });
    if (!addr) return;
    addr.useCount = (addr.useCount || 0) + 1;
    addr.lastUsedAt = new Date();
    await addr.save({ transaction });
}

/* ================= orders ================= */

router.get("/express-orders/available", authenticateToken, async (req, res) => {
    try {
        const type = req.query.type ? String(req.query.type) : null;

        const where = {
            status: "created",
            executorId: null,
            ...(type ? { type } : {}),
        };

        const orders = await ExpressOrder.findAll({
            where,
            order: [["id", "DESC"]],
            limit: 100,
        });

        res.json({ success: true, orders });
    } catch (e) {
        console.error("express-orders/available error:", e);
        res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

router.get("/express-orders/me", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const mode = String(req.query.mode || "active");

        const whereBase = {
            [Op.or]: [{ creatorId: userId }, { executorId: userId }],
        };

        const where =
            mode === "history"
                ? { ...whereBase, status: { [Op.in]: ["completed", "cancelled"] } }
                : { ...whereBase, status: { [Op.notIn]: ["completed", "cancelled"] } };

        const orders = await ExpressOrder.findAll({
            where,
            order: [["id", "DESC"]],
            limit: 200,
        });

        res.json({ success: true, orders });
    } catch (e) {
        console.error("express-orders/me error:", e);
        res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

router.post("/express-orders", authenticateToken, async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const creatorId = req.user.id;

        const {
            type,
            fromAddress,
            fromLat,
            fromLng,
            toAddress,
            toLat,
            toLng,
            paymentType,
            subcategory = null,
            description = null,
            basePrice,
            pricePerKm,
            totalPrice,

            // ✅ optional: если выбрали из сохранённых
            fromSavedAddressId = null,
            toSavedAddressId = null,
        } = req.body;

        if (!type || !fromAddress || !toAddress || !paymentType) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: "type/fromAddress/toAddress/paymentType обязательны",
            });
        }

        if (!["taxi", "courier"].includes(type)) {
            await t.rollback();
            return res.status(400).json({ success: false, message: "type должен быть taxi|courier" });
        }

        if (!["cash", "guarantee"].includes(paymentType)) {
            await t.rollback();
            return res.status(400).json({ success: false, message: "paymentType должен быть cash|guarantee" });
        }

        const fLat = toNum(fromLat);
        const fLng = toNum(fromLng);
        const tLat = toNum(toLat);
        const tLng = toNum(toLng);

        const coordsOk =
            Number.isFinite(fLat) &&
            Number.isFinite(fLng) &&
            Number.isFinite(tLat) &&
            Number.isFinite(tLng);

        if (!coordsOk) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: "Нужны корректные координаты fromLat/fromLng/toLat/toLng",
            });
        }

        const bp = Number.isFinite(Number(basePrice)) ? Number(basePrice) : 0;
        const ppk = Number.isFinite(Number(pricePerKm)) ? Number(pricePerKm) : 0;
        const tp = Number.isFinite(Number(totalPrice)) ? Number(totalPrice) : 0;

        const order = await ExpressOrder.create(
            {
                creatorId,
                executorId: null,
                type,
                fromAddress,
                fromLat: fLat,
                fromLng: fLng,
                toAddress,
                toLat: tLat,
                toLng: tLng,
                distanceKm: null,
                estimatedTimeMin: null,
                basePrice: bp,
                pricePerKm: ppk,
                totalPrice: tp,
                paymentType,
                dealStatus: "none",
                status: "created",
                subcategory,
                description,
            },
            { transaction: t }
        );

        // ✅ Авто-учёт использования сохранённых адресов
        await bumpSavedAddressUsage({ userId: creatorId, id: Number(fromSavedAddressId) || null, transaction: t });
        await bumpSavedAddressUsage({ userId: creatorId, id: Number(toSavedAddressId) || null, transaction: t });

        await t.commit();
        res.status(201).json({ success: true, order });
    } catch (e) {
        await t.rollback();
        console.error("express-orders POST error:", e);
        res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

router.get("/express-orders/:id", authenticateToken, async (req, res) => {
    try {
        const raw = req.params.id;
        const id = Number(raw);
        const userId = req.user.id;

        // ✅ FIX: защита от NaN/пустого/мусора типа "e-12"
        if (!Number.isFinite(id) || id <= 0) {
            return res.status(400).json({
                success: false,
                message: "Некорректный id express-заказа",
            });
        }

        const order = await ExpressOrder.findByPk(id);
        if (!order) {
            return res.status(404).json({ success: false, message: "Заказ не найден" });
        }

        if (!isParticipant(order, userId)) {
            return res.status(403).json({ success: false, message: "Нет доступа" });
        }

        return res.json({ success: true, order });
    } catch (e) {
        console.error("express-orders/:id GET error:", e);
        return res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

router.post("/express-orders/:id/accept", authenticateToken, async (req, res) => {
    const t = await sequelize.transaction();
    try {
        const executorId = req.user.id;
        const id = Number(req.params.id);

        if (!Number.isFinite(id) || id <= 0) {
            await t.rollback();
            return res.status(400).json({ success:false, message:"Некорректный id" });
        }

        const order = await ExpressOrder.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!order) { await t.rollback(); return res.status(404).json({ success:false, message:"Заказ не найден" }); }

        if (order.creatorId === executorId) {
            await t.rollback();
            return res.status(409).json({ success:false, message:"Нельзя принять свой заказ" });
        }

        if (order.status !== "created" || order.executorId) {
            await t.rollback();
            return res.status(409).json({ success:false, message:"Заказ уже принят" });
        }

        order.executorId = executorId;
        order.status = "accepted";
        await order.save({ transaction: t });

        await t.commit();
        return res.json({ success:true, order });
    } catch (e) {
        await t.rollback();
        console.error("express-orders accept error:", e);
        return res.status(500).json({ success:false, message:"Ошибка сервера" });
    }
});

router.post("/express-orders/:id/on-the-way", authenticateToken, async (req, res) => {
    try {
        const executorId = req.user.id;
        const id = Number(req.params.id);

        const order = await ExpressOrder.findByPk(id);
        if (!order) return res.status(404).json({ success: false, message: "Заказ не найден" });

        if (order.executorId !== executorId) {
            return res.status(403).json({ success: false, message: "Только исполнитель" });
        }

        if (order.status !== "accepted") {
            return res.status(409).json({ success: false, message: `Нельзя из статуса ${order.status}` });
        }

        order.status = "on_the_way_to_A";
        await order.save();
        res.json({ success: true, order });
    } catch (e) {
        console.error("express-orders on-the-way error:", e);
        res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

router.post("/express-orders/:id/arrived", authenticateToken, async (req, res) => {
    try {
        const executorId = req.user.id;
        const id = Number(req.params.id);

        const order = await ExpressOrder.findByPk(id);
        if (!order) return res.status(404).json({ success: false, message: "Заказ не найден" });

        if (order.executorId !== executorId) {
            return res.status(403).json({ success: false, message: "Только исполнитель" });
        }

        if (!["accepted", "on_the_way_to_A"].includes(order.status)) {
            return res.status(409).json({
                success: false,
                message: `Нельзя подтвердить прибытие из статуса ${order.status}`,
            });
        }

        order.status = "arrived_at_A";
        order.arrivedAt = new Date();
        await order.save();

        res.json({ success: true, order });
    } catch (e) {
        console.error("express-orders arrived error:", e);
        res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

router.post("/express-orders/:id/start", authenticateToken, async (req, res) => {
    try {
        const executorId = req.user.id;
        const id = Number(req.params.id);

        const order = await ExpressOrder.findByPk(id);
        if (!order) return res.status(404).json({ success: false, message: "Заказ не найден" });

        if (order.executorId !== executorId) {
            return res.status(403).json({ success: false, message: "Только исполнитель" });
        }

        if (order.status !== "arrived_at_A") {
            return res.status(409).json({ success: false, message: "Сначала подтвердите прибытие" });
        }

        order.status = "in_progress";
        order.startedAt = new Date();
        await order.save();

        res.json({ success: true, order });
    } catch (e) {
        console.error("express-orders start error:", e);
        res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

router.post("/express-orders/:id/complete", authenticateToken, async (req, res) => {
    try {
        const executorId = req.user.id;
        const id = Number(req.params.id);

        const order = await ExpressOrder.findByPk(id);
        if (!order) return res.status(404).json({ success: false, message: "Заказ не найден" });

        if (order.executorId !== executorId) {
            return res.status(403).json({ success: false, message: "Только исполнитель" });
        }

        if (order.status !== "in_progress") {
            return res.status(409).json({ success: false, message: "Заказ ещё не в процессе" });
        }

        order.status = "completed";
        order.completedAt = new Date();
        await order.save();

        res.json({ success: true, order });
    } catch (e) {
        console.error("express-orders complete error:", e);
        res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

router.post("/express-orders/:id/cancel", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const id = Number(req.params.id);

        const order = await ExpressOrder.findByPk(id);
        if (!order) return res.status(404).json({ success: false, message: "Заказ не найден" });

        if (!isParticipant(order, userId)) {
            return res.status(403).json({ success: false, message: "Нет доступа" });
        }

        const byCreator = order.creatorId === userId;
        const byExecutor = order.executorId === userId;

        const creatorAllowed = ["created", "accepted", "on_the_way_to_A", "arrived_at_A"].includes(order.status);
        const execAllowed = ["accepted", "on_the_way_to_A", "arrived_at_A"].includes(order.status);

        if ((byCreator && !creatorAllowed) || (byExecutor && !execAllowed)) {
            return res.status(409).json({ success: false, message: `Нельзя отменить из статуса ${order.status}` });
        }

        order.status = "cancelled";
        order.dealStatus = "cancelled";
        await order.save();

        res.json({ success: true, order });
    } catch (e) {
        console.error("express-orders cancel error:", e);
        res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

router.get("/express-orders/:id/points", authenticateToken, async (req, res) => {
    try {
        const id = Number(req.params.id);
        const userId = req.user.id;

        const order = await ExpressOrder.findByPk(id);
        if (!order) return res.status(404).json({ success: false, message: "Заказ не найден" });

        if (!canAccessExpressOrder(order, userId)) {
            return res.status(403).json({ success:false, message:"Нет доступа" });
        }

        res.json({
            success: true,
            pointA: { lat: Number(order.fromLat), lng: Number(order.fromLng), address: order.fromAddress },
            pointB: { lat: Number(order.toLat), lng: Number(order.toLng), address: order.toAddress },
            status: order.status,
        });
    } catch (e) {
        console.error("express-orders points error:", e);
        res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

router.get("/express-orders/:id/route/A-to-B", authenticateToken, async (req, res) => {
    try {
        const id = Number(req.params.id);
        const userId = req.user.id;

        const order = await ExpressOrder.findByPk(id);
        if (!order) return res.status(404).json({ success: false, message: "Заказ не найден" });

        if (!canAccessExpressOrder(order, userId)) {
            return res.status(403).json({ success:false, message:"Нет доступа" });
        }

        const url = buildYandexNaviUrl(order.fromLat, order.fromLng, order.toLat, order.toLng);
        res.json({ success: true, url });
    } catch (e) {
        console.error("express-orders route A-to-B error:", e);
        res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

router.get("/express-orders/:id/route/to-A", authenticateToken, async (req, res) => {
    try {
        const id = Number(req.params.id);
        const userId = req.user.id;

        const myLat = toNum(req.query.myLat);
        const myLng = toNum(req.query.myLng);

        if (!Number.isFinite(myLat) || !Number.isFinite(myLng)) {
            return res.status(400).json({ success: false, message: "Нужны myLat и myLng" });
        }

        const order = await ExpressOrder.findByPk(id);
        if (!order) return res.status(404).json({ success: false, message: "Заказ не найден" });

        if (!canAccessExpressOrder(order, userId)) {
            return res.status(403).json({ success:false, message:"Нет доступа" });
        }

        const url = buildYandexNaviUrl(myLat, myLng, order.fromLat, order.fromLng);
        res.json({ success: true, url });
    } catch (e) {
        console.error("express-orders route to-A error:", e);
        res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

/* ================= saved addresses ================= */

router.get("/express-addresses/me", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const items = await ExpressSavedAddress.findAll({
            where: { userId },
            order: [
                [sequelize.literal(`CASE label WHEN 'home' THEN 0 WHEN 'work' THEN 1 ELSE 2 END`), "ASC"],
                ["useCount", "DESC"],
                ["lastUsedAt", "DESC"],
                ["id", "DESC"],
            ],
            limit: 50,
        });

        res.json({ success: true, items });
    } catch (e) {
        console.error("express-addresses/me error:", e);
        res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

router.post("/express-addresses/me", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { label = "other", title = null, address, lat, lng } = req.body;

        if (!address || !isFiniteNumberish(lat) || !isFiniteNumberish(lng)) {
            return res.status(400).json({
                success: false,
                message: "address/lat/lng обязательны (lat/lng могут быть строкой или числом)",
            });
        }

        const nLat = Number(lat);
        const nLng = Number(lng);

        // Upsert по (userId, address)
        const [row, created] = await ExpressSavedAddress.findOrCreate({
            where: { userId, address },
            defaults: { userId, label, title, address, lat: nLat, lng: nLng, useCount: 0 },
        });

        if (!created) {
            row.label = label;
            row.title = title;
            row.lat = nLat;
            row.lng = nLng;
            await row.save();
        }

        res.json({ success: true, item: row });
    } catch (e) {
        console.error("express-addresses/me POST error:", e);
        res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

router.post("/express-addresses/me/:id/use", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const id = Number(req.params.id);

        const row = await ExpressSavedAddress.findOne({ where: { id, userId } });
        if (!row) return res.status(404).json({ success: false, message: "Не найдено" });

        row.useCount = (row.useCount || 0) + 1;
        row.lastUsedAt = new Date();
        await row.save();

        res.json({ success: true, item: row });
    } catch (e) {
        console.error("express-addresses use error:", e);
        res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

router.delete("/express-addresses/me/:id", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const id = Number(req.params.id);

        const row = await ExpressSavedAddress.findOne({ where: { id, userId } });
        if (!row) return res.status(404).json({ success: false, message: "Не найдено" });

        await row.destroy();
        res.json({ success: true });
    } catch (e) {
        console.error("express-addresses delete error:", e);
        res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

module.exports = router;