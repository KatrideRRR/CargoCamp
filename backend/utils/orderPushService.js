const { Op, Sequelize } = require("sequelize");

function toNum(x) {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
}

function parseOrderCoords(order) {
    if (!order?.coordinates) return null;
    const [a, b] = String(order.coordinates).split(",").map(s => s.trim());
    const lat = toNum(a);
    const lng = toNum(b);
    if (lat === null || lng === null) return null;
    return { lat, lng };
}

function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const toRad = (v) => (v * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

function bbox(lat, lng, radiusKm) {
    const latDelta = radiusKm / 111.32;
    const lngDelta = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
    return {
        minLat: lat - latDelta,
        maxLat: lat + latDelta,
        minLng: lng - lngDelta,
        maxLng: lng + lngDelta,
    };
}

/**
 * Отправка PUSH 10 ближайшим подходящим
 */
async function sendOrderPush({
                                 db,
                                 io,
                                 orderId,
                                 radiusKm = 50,
                                 limit = 10,
                                 logAction = null, // опционально
                             }) {
    const { Order, User, ActionLog } = db;

    const order = await Order.findByPk(orderId);
    if (!order) return { ok: false, reason: "order_not_found" };

    // пуш только если реально оплачен и отмечен
    if (!order.is_push_notified) return { ok: false, reason: "push_not_enabled" };

    const coords = parseOrderCoords(order);
    if (!coords) return { ok: false, reason: "order_coords_missing" };

    const categoryId = Number(order.categoryId);
    if (!Number.isFinite(categoryId)) return { ok: false, reason: "category_missing" };

    console.log("[PUSH] start orderId =", orderId);

    console.log("[PUSH] order:", {
        id: order.id,
        categoryId: order.categoryId,
        coords: order.coordinates,
        is_push_notified: order.is_push_notified,
    });

    console.log("[PUSH] candidates from DB:", candidates.length);

    console.log("[PUSH] top selected:", top.map(x => ({ userId: x.userId, km: x.distanceKm.toFixed(2) })));

    // 1) кого уже пушили по этому заказу (чтобы не дублить)
    const alreadySet = new Set();
    if (ActionLog) {
        const sentRows = await ActionLog.findAll({
            where: { orderId: order.id, actionType: "push_sent" },
            attributes: ["meta"],
            limit: 5000,
        });

        for (const r of sentRows) {
            const uid = r?.meta?.toUserId;
            if (uid) alreadySet.add(String(uid));
        }
    }

    // 2) bbox фильтр
    const bb = bbox(coords.lat, coords.lng, radiusKm);

    // 3) кандидаты по SQL (быстро)
    const candidates = await User.findAll({
        where: {
            role: { [Op.ne]: "banned" },
            debt: { [Op.lte]: 0 },

            location_lat: { [Op.between]: [bb.minLat, bb.maxLat] },
            location_lng: { [Op.between]: [bb.minLng, bb.maxLng] },

            // preferred_category_ids содержит categoryId
            [Op.and]: Sequelize.literal(
                `JSON_CONTAINS(preferred_category_ids, CAST(${categoryId} AS JSON))`
            ),
        },
        attributes: ["id", "location_lat", "location_lng"],
        limit: 300,
    });

    // 4) точная дистанция + сортировка
    const scored = [];
    for (const u of candidates) {
        if (alreadySet.has(String(u.id))) continue;

        const lat = Number(u.location_lat);
        const lng = Number(u.location_lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

        const d = haversineKm(coords.lat, coords.lng, lat, lng);
        if (d > radiusKm) continue;

        scored.push({ userId: u.id, distanceKm: d });
    }

    scored.sort((a, b) => a.distanceKm - b.distanceKm);
    const top = scored.slice(0, limit);

    // 5) формируем payload пуша (его потом будет легко отправлять в моб пуши)
    const payloadBase = {
        type: "order_push",
        orderId: order.id,
        createdAt: new Date().toISOString(),
        data: {
            orderId: order.id,
            categoryId: order.categoryId,
            subcategoryId: order.subcategoryId,
            serviceId: order.serviceId,
            address: order.address,
            proposedSum: order.proposedSum,
        },
    };

    // 6) отправляем каждому + логируем
    for (const t of top) {
        io.to(`user_${t.userId}`).emit("push_notification", {
            ...payloadBase,
            title: "Новый заказ рядом",
            message: `Заказ #${order.id} • ${order.proposedSum || ""} ₽ • ${t.distanceKm.toFixed(1)} км`,
            data: { ...payloadBase.data, distanceKm: Number(t.distanceKm.toFixed(2)) },
        });

        if (logAction) {
            await logAction({
                req: null,
                actorUserId: null,
                actorRole: "system",
                actionType: "push_sent",
                entityType: "order",
                entityId: order.id,
                orderId: order.id,
                severity: "info",
                success: true,
                meta: {
                    toUserId: t.userId,
                    distanceKm: Number(t.distanceKm.toFixed(2)),
                    categoryId,
                },
            });
        }
    }

    if (top.length === 0 && logAction) {
        await logAction({
            req: null,
            actorUserId: null,
            actorRole: "system",
            actionType: "push_no_candidates",
            entityType: "order",
            entityId: order.id,
            orderId: order.id,
            severity: "warn",
            success: true,
            meta: { radiusKm, categoryId },
        });
    }

    return { ok: true, sent: top.length, userIds: top.map(x => x.userId) };
}

module.exports = { sendOrderPush };