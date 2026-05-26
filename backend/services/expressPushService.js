const { Op } = require("sequelize");
const { User, Order, ExpressOrder, Category } = require("../models");
const { notifyMany } = require("./notificationService");

function normalizeName(v) {
    return String(v || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function getDistanceKm(lat1, lon1, lat2, lon2) {
    const aLat = Number(lat1);
    const aLon = Number(lon1);
    const bLat = Number(lat2);
    const bLon = Number(lon2);

    if (
        !Number.isFinite(aLat) ||
        !Number.isFinite(aLon) ||
        !Number.isFinite(bLat) ||
        !Number.isFinite(bLon)
    ) {
        return null;
    }

    const R = 6371;

    const dLat = (bLat - aLat) * Math.PI / 180;
    const dLon = (bLon - aLon) * Math.PI / 180;

    const x =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(aLat * Math.PI / 180) *
        Math.cos(bLat * Math.PI / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));

    return R * c;
}

function getExpressPushConfig(type) {
    if (type === "taxi") {
        return {
            professionNames: ["такси"],
            primaryRadiusKm: 3,
            fallbackRadiusKm: 5,
            limit: 5,
            title: "Рядом новый заказ такси",
            body: "Новый заказ такси рядом с вами",
        };
    }

    return {
        professionNames: ["курьер", "курьерские услуги", "доставка"],
        primaryRadiusKm: 5,
        fallbackRadiusKm: 8,
        limit: 10,
        title: "Рядом новый курьерский заказ",
        body: "Новый курьерский заказ рядом с вами",
    };
}

async function getCategoryIdsForExpressType(type) {
    const config = getExpressPushConfig(type);

    const categories = await Category.findAll({
        attributes: ["id", "name"],
    });

    const targetNames = new Set(config.professionNames.map(normalizeName));

    return categories
        .filter((category) => {
            const name = normalizeName(category.name);
            return targetNames.has(name);
        })
        .map((category) => Number(category.id))
        .filter(Number.isFinite);
}

function parsePreferredCategoryIds(value) {
    if (!value) return [];

    if (Array.isArray(value)) {
        return value.map(Number).filter(Number.isFinite);
    }

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed)
                ? parsed.map(Number).filter(Number.isFinite)
                : [];
        } catch {
            return [];
        }
    }

    return [];
}

function userHasExpressProfession(user, expressCategoryIds) {
    const preferred = parsePreferredCategoryIds(user.preferredCategoryIds);

    if (!preferred.length) return false;
    if (!expressCategoryIds.length) return false;

    return preferred.some((id) => expressCategoryIds.includes(Number(id)));
}

async function notifyNearbyExpressExecutors({ req, order }) {
    const type = String(order?.type || "").trim();

    if (!["taxi", "courier"].includes(type)) {
        return {
            success: false,
            reason: "unsupported_type",
            notifiedUserIds: [],
        };
    }

    const fromLat = Number(order.fromLat);
    const fromLng = Number(order.fromLng);

    if (!Number.isFinite(fromLat) || !Number.isFinite(fromLng)) {
        return {
            success: false,
            reason: "bad_order_coordinates",
            notifiedUserIds: [],
        };
    }

    const config = getExpressPushConfig(type);
    const expressCategoryIds = await getCategoryIdsForExpressType(type);

    if (!expressCategoryIds.length) {
        await req.logAction?.({
            req,
            actorUserId: order.creatorId,
            actorRole: "system",
            actionType: "express_push_no_profession_category",
            entityType: "express_order",
            entityId: order.id,
            expressOrderId: order.id,
            severity: "warn",
            success: false,
            meta: {
                type,
                expectedProfessionNames: config.professionNames,
            },
        });

        return {
            success: false,
            reason: "profession_category_not_found",
            notifiedUserIds: [],
        };
    }

    const candidates = await User.findAll({
        where: {
            id: {
                [Op.ne]: order.creatorId,
            },
            role: {
                [Op.ne]: "banned",
            },
            debt: {
                [Op.lte]: 0,
            },
            locationLat: {
                [Op.ne]: null,
            },
            locationLng: {
                [Op.ne]: null,
            },
        },
        attributes: [
            "id",
            "username",
            "role",
            "debt",
            "rating",
            "ratingCount",
            "locationLat",
            "locationLng",
            "preferredCategoryIds",
        ],
        limit: 1000,
    });

    const professionCandidates = candidates.filter((user) =>
        userHasExpressProfession(user, expressCategoryIds)
    );

    if (!professionCandidates.length) {
        await req.logAction?.({
            req,
            actorUserId: order.creatorId,
            actorRole: "system",
            actionType: "express_push_no_profession_users",
            entityType: "express_order",
            entityId: order.id,
            expressOrderId: order.id,
            severity: "info",
            success: true,
            meta: {
                type,
                expressCategoryIds,
                candidatesCount: candidates.length,
                reason: "nobody_selected_taxi_or_courier_profession",
            },
        });

        return {
            success: true,
            reason: "no_users_with_profession",
            notifiedUserIds: [],
        };
    }

    const candidateIds = professionCandidates
        .map((user) => Number(user.id))
        .filter(Number.isFinite);

    const busyRegularRows = await Order.findAll({
        where: {
            executorId: {
                [Op.in]: candidateIds,
            },
            status: {
                [Op.notIn]: ["completed", "cancelled", "expired"],
            },
        },
        attributes: ["executorId"],
    });

    const busyRegularIds = new Set(
        busyRegularRows
            .map((order) => Number(order.executorId))
            .filter(Number.isFinite)
    );

    const busyExpressRows = await ExpressOrder.findAll({
        where: {
            executorId: {
                [Op.in]: candidateIds,
            },
            status: {
                [Op.notIn]: ["completed", "cancelled"],
            },
        },
        attributes: ["executorId"],
    });

    const busyExpressIds = new Set(
        busyExpressRows
            .map((order) => Number(order.executorId))
            .filter(Number.isFinite)
    );

    const available = [];

    for (const user of professionCandidates) {
        const userId = Number(user.id);

        if (!Number.isFinite(userId)) continue;
        if (busyRegularIds.has(userId)) continue;
        if (busyExpressIds.has(userId)) continue;

        const userLat = Number(user.locationLat);
        const userLng = Number(user.locationLng);

        const distanceKm = getDistanceKm(fromLat, fromLng, userLat, userLng);

        if (!Number.isFinite(distanceKm)) continue;

        available.push({
            userId,
            user,
            distanceKm,
            rating: Number(user.rating || 0),
            ratingCount: Number(user.ratingCount || 0),
        });
    }

    const sorter = (a, b) => {
        if (a.distanceKm !== b.distanceKm) {
            return a.distanceKm - b.distanceKm;
        }

        if (b.rating !== a.rating) {
            return b.rating - a.rating;
        }

        return b.ratingCount - a.ratingCount;
    };

    let selected = available
        .filter((item) => item.distanceKm <= config.primaryRadiusKm)
        .sort(sorter)
        .slice(0, config.limit);

    if (!selected.length) {
        selected = available
            .filter((item) => item.distanceKm <= config.fallbackRadiusKm)
            .sort(sorter)
            .slice(0, config.limit);
    }

    const notifiedUserIds = selected.map((item) => item.userId);

    if (!notifiedUserIds.length) {
        await req.logAction?.({
            req,
            actorUserId: order.creatorId,
            actorRole: "system",
            actionType: "express_push_no_nearby",
            entityType: "express_order",
            entityId: order.id,
            expressOrderId: order.id,
            severity: "info",
            success: true,
            meta: {
                type,
                expressCategoryIds,
                primaryRadiusKm: config.primaryRadiusKm,
                fallbackRadiusKm: config.fallbackRadiusKm,
                limit: config.limit,
                candidatesCount: candidates.length,
                professionCandidatesCount: professionCandidates.length,
                availableCount: available.length,
            },
        });

        return {
            success: true,
            reason: "no_nearby_available",
            notifiedUserIds: [],
        };
    }

    const title = config.title;
    const body = `${config.body}. Заказ №${order.id}.`;

    await notifyMany(notifiedUserIds, {
        type: "express_available_nearby",
        title,
        body,
        orderId: order.id,
        orderType: "express",
        data: {
            orderId: order.id,
            expressOrderId: order.id,
            orderType: "express",
            expressType: type,
            status: order.status,
            fromAddress: order.fromAddress,
            toAddress: order.toAddress,
            fromLat: String(order.fromLat),
            fromLng: String(order.fromLng),
            toLat: String(order.toLat),
            toLng: String(order.toLng),
        },
        socketEvent: "expressOrderNearby",
        socketPayload: {
            orderId: order.id,
            expressOrderId: order.id,
            orderType: "express",
            expressType: type,
            status: order.status,

            title,
            body,
            message: body,

            fromAddress: order.fromAddress,
            toAddress: order.toAddress,
            fromLat: String(order.fromLat),
            fromLng: String(order.fromLng),
            toLat: String(order.toLat),
            toLng: String(order.toLng),
        },
    });

    await req.logAction?.({
        req,
        actorUserId: order.creatorId,
        actorRole: "system",
        actionType: "express_push_sent_to_nearby",
        entityType: "express_order",
        entityId: order.id,
        expressOrderId: order.id,
        severity: "info",
        success: true,
        meta: {
            type,
            expressCategoryIds,
            primaryRadiusKm: config.primaryRadiusKm,
            fallbackRadiusKm: config.fallbackRadiusKm,
            limit: config.limit,
            candidatesCount: candidates.length,
            professionCandidatesCount: professionCandidates.length,
            availableCount: available.length,
            notifiedUserIds,
            selected: selected.map((item) => ({
                userId: item.userId,
                distanceKm: Number(item.distanceKm.toFixed(2)),
                rating: item.rating,
                ratingCount: item.ratingCount,
            })),
        },
    });

    return {
        success: true,
        reason: "sent",
        notifiedUserIds,
    };
}

module.exports = {
    notifyNearbyExpressExecutors,
};