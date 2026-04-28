const express = require("express");
const router = express.Router();
const { Op } = require("sequelize");
const authenticateToken = require("../middlewares/userAuth");
const { v4: uuidv4 } = require("uuid");
const yooKassa = require("../config/yookassaClient");
const { sequelize, ExpressOrder, ExpressSavedAddress, User, Order } = require("../models");

/* ================= helpers ================= */

async function hasBusyRegularOrder(Order, executorId) {
    const busyOrder = await Order.findOne({
        where: {
            executorId,
            status: {
                [Op.notIn]: ["completed", "cancelled", "expired"],
            },
        },
    });

    return !!busyOrder;
}

async function hasBusyExpressOrder(ExpressOrder, executorId, excludeExpressOrderId = null) {
    const where = {
        executorId,
        status: {
            [Op.notIn]: ["completed", "cancelled"],
        },
    };

    if (excludeExpressOrderId) {
        where.id = { [Op.ne]: excludeExpressOrderId };
    }

    const busyOrder = await ExpressOrder.findOne({ where });
    return !!busyOrder;
}

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

function emitExpressOrderUpdate(io, order) {
    if (!io || !order) return;

    if (order.creatorId) {
        io.to(`user_${String(order.creatorId)}`).emit("activeOrdersUpdated");
    }

    if (order.executorId) {
        io.to(`user_${String(order.executorId)}`).emit("activeOrdersUpdated");
    }
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

        await req.logAction({
            req,
            actorUserId: creatorId,
            actorRole: "user",
            actionType: "express_order_create",
            entityType: "express_order",
            entityId: order.id,
            expressOrderId: order.id,
            meta: {
                type: order.type,
                paymentType: order.paymentType,
                totalPrice: order.totalPrice,
                basePrice: order.basePrice,
                pricePerKm: order.pricePerKm,
                from: { address: order.fromAddress, lat: order.fromLat, lng: order.fromLng },
                to: { address: order.toAddress, lat: order.toLat, lng: order.toLng },
            },
        });

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
            return res.status(400).json({ success: false, message: "Некорректный id" });
        }

        // ✅ 1) блокируем, если есть долг
        const executor = await User.findByPk(executorId, { transaction: t, lock: t.LOCK.UPDATE });
        if (!executor) {
            await t.rollback();
            return res.status(404).json({ success: false, message: "Пользователь не найден" });
        }

        const busyRegular = await hasBusyRegularOrder(Order, executorId);
        if (busyRegular) {
            await t.rollback();
            return res.status(409).json({
                success: false,
                message: "У вас уже есть активный обычный заказ. Завершите его, чтобы взять такси.",
            });
        }

        const busyTaxi = await hasBusyExpressOrder(ExpressOrder, executorId);
        if (busyTaxi) {
            await t.rollback();
            return res.status(409).json({
                success: false,
                message: "У вас уже есть активный экспресс заказ. Завершите его, чтобы взять новый.",
            });
        }

        const debtKopecks = Number(executor.debt || 0);
        if (debtKopecks > 0) {
            await t.rollback();
            return res.status(403).json({
                success: false,
                message: "У вас есть задолженность по комиссии. Погасите её, чтобы брать экспресс-заказы.",
            });
        }

        const order = await ExpressOrder.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!order) {
            await t.rollback();
            return res.status(404).json({ success: false, message: "Заказ не найден" });
        }

        if (order.creatorId === executorId) {
            await t.rollback();
            return res.status(409).json({ success: false, message: "Нельзя принять свой заказ" });
        }

        if (order.status !== "created" || order.executorId) {
            await t.rollback();
            return res.status(409).json({ success: false, message: "Заказ уже принят" });
        }

        // ✅ 2) считаем комиссию (premium — 0)
        const now = new Date();
        const premiumActive =
            executor.subscription_type === "premium" &&
            (!executor.subscription_expires_at || new Date(executor.subscription_expires_at) > now);

        const raw = Number(order.totalPrice || 0);

        // Приводим к копейкам (умно, чтобы не словить 100%)
        const totalKopecks = raw >= 10000 ? raw : Math.round(raw * 100);

        // 10% комиссии
        const feeKopecks = premiumActive ? 0 : Math.round(totalKopecks * 0.10);

        // ✅ 3) назначаем исполнителя
        order.executorId = executorId;
        order.status = "accepted";
        await order.save({ transaction: t });

        const io = req.app.locals.io;
        emitExpressOrderUpdate(io, order);

        // ✅ 4) пробуем сразу списать комиссию (если есть привязанная карта), иначе — в долг
        let paidBySavedCard = false;
        let debtAdded = false;

        await req.logAction({
            req,
            actorUserId: executorId,
            actorRole: "user",
            actionType: "express_order_accept",
            entityType: "express_order",
            entityId: order.id,
            expressOrderId: order.id,
            meta: {
                status: order.status,
                premiumActive,
                totalKopecks,
                feeKopecks,
                paidBySavedCard,
                debtAdded,
            },
        });

        if (feeKopecks > 0) {
            if (executor.yookassa_payment_method_id) {
                try {
                    const amountValue = (feeKopecks / 100).toFixed(2);
                    const idempotenceKey = uuidv4();

                    const payment = await yooKassa.createPayment(
                        {
                            amount: { value: amountValue, currency: "RUB" },
                            capture: true,
                            payment_method_id: executor.yookassa_payment_method_id,
                            description: `Комиссия за взятие экспресс-заказа #${order.id} (исполнитель #${executorId})`,
                            metadata: {
                                type: "debt", // ✅ используем твой вебхук debt
                                userId: String(executorId),
                                expectedKopecks: String(feeKopecks),
                                expressOrderId: String(order.id),
                                reason: "express_accept_fee",
                            },
                            receipt: {
                                customer: { phone: String(executor.phone || "").replace(/[^\d+]/g, "") },
                                items: [
                                    {
                                        description: `Комиссия за экспресс-заказ #${order.id}`,
                                        quantity: 1,
                                        amount: { value: amountValue, currency: "RUB" },
                                        vat_code: 1,
                                        payment_mode: "full_payment",
                                        payment_subject: "service",
                                    },
                                ],
                                tax_system_code: 2,
                            },
                        },
                        idempotenceKey
                    );

                    paidBySavedCard = payment?.status === "succeeded";
                } catch (e) {
                    console.error("express accept fee autopay error:", e?.message || e);
                }
            }

            // если не оплатилось (или карты нет) — в debt
            if (!paidBySavedCard) {
                executor.debt = Number(executor.debt || 0) + feeKopecks;
                await executor.save({ transaction: t });
                debtAdded = true;
            }

            await req.logAction({
                req,
                actorUserId: executorId,
                actorRole: "user",
                actionType: "commission_debt_added",
                entityType: "user",
                entityId: executorId,
                expressOrderId: order.id,
                severity: "warn",
                meta: { feeKopecks, reason: "express_accept_fee" },
            });
        }

        await t.commit();
        return res.json({
            success: true,
            order,
            feeKopecks,
            premium: premiumActive,
            paidBySavedCard,
            debtAdded,
        });
    } catch (e) {
        await t.rollback();
        console.error("express-orders accept error:", e);
        return res.status(500).json({ success: false, message: "Ошибка сервера" });
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

        const from = order.status;
        order.status = "on_the_way_to_A";
        await order.save();

        const io = req.app.locals.io;
        emitExpressOrderUpdate(io, order);

        await req.logAction({
            req,
            actorUserId: executorId,
            actorRole: "user",
            actionType: "express_status_change",
            entityType: "express_order",
            entityId: order.id,
            expressOrderId: order.id,
            meta: { from, to: order.status },
        });

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

        const from = order.status;
        order.status = "arrived_at_A";
        order.arrivedAt = new Date();
        await order.save();

        const io = req.app.locals.io;
        emitExpressOrderUpdate(io, order);

        await req.logAction({
            req,
            actorUserId: executorId,
            actorRole: "user",
            actionType: "express_status_change",
            entityType: "express_order",
            entityId: order.id,
            expressOrderId: order.id,
            meta: { from, to: order.status },
        });

        res.json({ success: true, order });
    } catch (e) {
        console.error("express-orders arrived error:", e);
        res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

router.post("/express-orders/:id/start-waiting", authenticateToken, async (req, res) => {
    try {
        const executorId = req.user.id;
        const id = Number(req.params.id);

        const order = await ExpressOrder.findByPk(id);
        if (!order) {
            return res.status(404).json({ success: false, message: "Заказ не найден" });
        }

        if (Number(order.executorId) !== Number(executorId)) {
            return res.status(403).json({ success: false, message: "Только исполнитель" });
        }

        if (order.type !== "taxi") {
            return res.status(409).json({ success: false, message: "Ожидание доступно только для такси" });
        }

        if (order.status !== "arrived_at_A") {
            return res.status(409).json({ success: false, message: "Сначала подтвердите прибытие" });
        }

        const from = order.status;
        order.status = "waiting_at_A";
        order.waitingStartedAt = new Date();
        await order.save();

        const io = req.app.locals.io;
        emitExpressOrderUpdate(io, order);

        await req.logAction({
            req,
            actorUserId: executorId,
            actorRole: "user",
            actionType: "express_status_change",
            entityType: "express_order",
            entityId: order.id,
            expressOrderId: order.id,
            meta: { from, to: order.status },
        });

        return res.json({ success: true, order });
    } catch (e) {
        console.error("express-orders start-waiting error:", e);
        return res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

router.post("/express-orders/:id/pick-up", authenticateToken, async (req, res) => {
    try {
        const executorId = req.user.id;
        const id = Number(req.params.id);

        const order = await ExpressOrder.findByPk(id);
        if (!order) {
            return res.status(404).json({ success: false, message: "Заказ не найден" });
        }

        if (Number(order.executorId) !== Number(executorId)) {
            return res.status(403).json({ success: false, message: "Только исполнитель" });
        }

        if (order.type !== "courier") {
            return res.status(409).json({ success: false, message: "Этот шаг доступен только для курьера" });
        }

        if (order.status !== "arrived_at_A") {
            return res.status(409).json({ success: false, message: "Сначала подтвердите прибытие" });
        }

        const from = order.status;
        order.status = "picked_up";
        order.pickedUpAt = new Date();
        await order.save();

        const io = req.app.locals.io;
        emitExpressOrderUpdate(io, order);

        await req.logAction({
            req,
            actorUserId: executorId,
            actorRole: "user",
            actionType: "express_status_change",
            entityType: "express_order",
            entityId: order.id,
            expressOrderId: order.id,
            meta: { from, to: order.status },
        });

        return res.json({ success: true, order });
    } catch (e) {
        console.error("express-orders pick-up error:", e);
        return res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

router.post("/express-orders/:id/start", authenticateToken, async (req, res) => {
    try {
        const executorId = req.user.id;
        const id = Number(req.params.id);

        const order = await ExpressOrder.findByPk(id);
        if (!order) return res.status(404).json({ success: false, message: "Заказ не найден" });

        if (Number(order.executorId) !== Number(executorId)) {
            return res.status(403).json({ success: false, message: "Только исполнитель" });
        }

        const allowedStatuses =
            order.type === "taxi"
                ? ["waiting_at_A"]
                : ["picked_up"];

        if (!allowedStatuses.includes(order.status)) {
            return res.status(409).json({
                success: false,
                message: "Нельзя начать выполнение из текущего статуса",
            });
        }

        const from = order.status;
        order.status = "in_progress";
        order.startedAt = new Date();
        await order.save();

        const io = req.app.locals.io;
        emitExpressOrderUpdate(io, order);

        await req.logAction({
            req,
            actorUserId: executorId,
            actorRole: "user",
            actionType: "express_status_change",
            entityType: "express_order",
            entityId: order.id,
            expressOrderId: order.id,
            meta: { from, to: order.status },
        });

        return res.json({ success: true, order });
    } catch (e) {
        console.error("express-orders start error:", e);
        return res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

router.post("/express-orders/:id/complete", authenticateToken, async (req, res) => {
    try {
        const executorId = req.user.id;
        const id = Number(req.params.id);

        const order = await ExpressOrder.findByPk(id);
        if (!order) return res.status(404).json({ success: false, message: "Заказ не найден" });

        if (Number(order.executorId) !== Number(executorId)) {
            return res.status(403).json({ success: false, message: "Только исполнитель" });
        }

        if (order.status !== "in_progress") {
            return res.status(409).json({ success: false, message: "Заказ ещё не в процессе" });
        }

        const from = order.status;
        order.status = "completed";
        order.completedAt = new Date();
        await order.save();

        const io = req.app.locals.io;
        emitExpressOrderUpdate(io, order);

        await req.logAction({
            req,
            actorUserId: executorId,
            actorRole: "user",
            actionType: "express_status_change",
            entityType: "express_order",
            entityId: order.id,
            expressOrderId: order.id,
            meta: { from, to: order.status },
        });

        // ✅ уведомляем заказчика, что можно оставить отзыв
        if (io) {
            io.to(`user_${order.creatorId}`).emit("expressOrderCompleted", {
                message: "Экспресс-заказ завершён. Оцените исполнителя.",
                orderId: order.id,
                creatorId: order.creatorId,
                executorId: order.executorId,
                orderType: "express",
                type: order.type,
            });

            // по желанию можно обновить активные заказы у всех участников
            io.to(`user_${order.creatorId}`).emit("activeOrdersUpdated");
            io.to(`user_${order.executorId}`).emit("activeOrdersUpdated");
        }

        return res.json({
            success: true,
            order,
        });
    } catch (e) {
        console.error("express-orders complete error:", e);
        return res.status(500).json({ success: false, message: "Ошибка сервера" });
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

        const from = order.status;
        order.status = "cancelled";
        order.dealStatus = "cancelled";
        await order.save();

        await req.logAction({
            req,
            actorUserId: userId,
            actorRole: "user",
            actionType: "express_status_change",
            entityType: "express_order",
            entityId: order.id,
            expressOrderId: order.id,
            meta: { from, to: order.status },
        });

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