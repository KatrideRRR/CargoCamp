const express = require("express");
const router = express.Router();
const { Op } = require("sequelize");
const authenticateToken = require("../middlewares/userAuth");
const { v4: uuidv4 } = require("uuid");
const yooKassa = require("../config/yookassaClient");
const { sequelize, ExpressOrder, ExpressSavedAddress, User, Order } = require("../models");
const { notifyUser, notifyMany } = require("../services/notificationService");
const { notifyNearbyExpressExecutors } = require("../services/expressPushService");

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

const EXPRESS_PRICING = {
    taxi: {
        version: 1,
        basePrice: 200,
        pricePerKm: 25,
        minimumPrice: 350,
        maximumPrice: 300000,
    },

    courier: {
        version: 1,
        basePrice: 150,
        pricePerKm: 20,
        minimumPrice: 300,
        maximumPrice: 300000,
    },
};

function clampExpressPrice(value, min, max) {
    return Math.min(
        Math.max(value, min),
        max
    );}

function calculateExpressRecommendedPrice({type, distanceKm,}) {
    const pricing =
        EXPRESS_PRICING[type];

    if (!pricing) {
        return null;
    }

    const safeDistanceKm =
        Number(distanceKm);

    if (
        !Number.isFinite(
            safeDistanceKm
        ) ||
        safeDistanceKm <= 0 ||
        safeDistanceKm > 5000
    ) {
        return null;
    }

    const rawPrice =
        pricing.basePrice +
        safeDistanceKm *
        pricing.pricePerKm;

    const roundedPrice =
        Math.round(
            rawPrice / 10
        ) * 10;

    const recommendedPrice =
        clampExpressPrice(
            roundedPrice,
            pricing.minimumPrice,
            pricing.maximumPrice
        );

    return {
        pricingVersion:
        pricing.version,

        recommendedPrice,

        basePrice:
        pricing.basePrice,

        pricePerKm:
        pricing.pricePerKm,

        minimumPrice:
        pricing.minimumPrice,
    };
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

function emitToUserEverywhere(io, userId, event, payload) {
    if (!io || !userId || !event) return;

    const id = String(userId);

    io.to(`user_${id}`).emit(event, payload);
    io.to(`notifications_${id}`).emit(event, payload);
}

function buildExpressPayload(order, payload = {}) {
    return {
        orderId: order.id,
        id: order.id,

        orderType: "express",

        type: order.type,
        expressType: order.type,

        status: order.status,
        creatorId: order.creatorId,
        executorId: order.executorId,

        updatedAt: order.updatedAt || order.updated_at || new Date(),

        ...payload,
    };
}

function emitExpressOrderUpdate(io, order, payload = {}) {
    if (!io || !order) return;

    const basePayload = buildExpressPayload(order, payload);

    const participantIds = [
        order.creatorId,
        order.executorId,
    ].filter(Boolean);

    participantIds.forEach((userId) => {
        emitToUserEverywhere(io, userId, "activeOrdersUpdated", basePayload);
        emitToUserEverywhere(io, userId, "expressOrdersUpdated", basePayload);
    });
}

const notifyAdminsAboutNewExpressOrder = async ({order, creatorId,}) => {
        try {
            if (!order?.id) {
                return;
            }

            const admins =
                await User.findAll({
                    where: {
                        role: "admin",
                    },

                    attributes: [
                        "id",
                    ],
                });

            const adminIds = [
                ...new Set(
                    admins
                        .map((admin) =>
                            Number(admin.id)
                        )
                        .filter(
                            (id) =>
                                Number.isInteger(id) &&
                                id > 0
                        )
                ),
            ];

            if (
                adminIds.length === 0
            ) {
                console.warn(
                    `Администраторы не найдены. Уведомление по экспресс-заказу №${order.id} не отправлено.`
                );

                return;
            }

            const typeLabel =
                order.type === "taxi"
                    ? "Такси"
                    : order.type ===
                    "courier"
                        ? "Курьер"
                        : "Экспресс";

            const amount =
                Number(
                    order.totalPrice ||
                    0
                );

            const title =
                `Новый экспресс-заказ №${order.id}`;

            const body = [
                typeLabel,

                amount > 0
                    ? `${amount.toLocaleString(
                        "ru-RU"
                    )} ₽`
                    : null,

                order.fromAddress &&
                order.toAddress
                    ? `${order.fromAddress} → ${order.toAddress}`
                    : null,
            ]
                .filter(Boolean)
                .join(" • ");

            const notificationData = {
                orderId:
                order.id,

                expressOrderId:
                order.id,

                orderType:
                    "express",

                creatorId:
                    creatorId ||
                    order.creatorId,

                executorId:
                    order.executorId ||
                    null,

                expressType:
                order.type,

                fromAddress:
                order.fromAddress,

                toAddress:
                order.toAddress,

                fromLat:
                order.fromLat,

                fromLng:
                order.fromLng,

                toLat:
                order.toLat,

                toLng:
                order.toLng,

                proposedSum:
                amount,

                totalPrice:
                amount,

                status:
                order.status,

                adminUnfiltered:
                    true,
            };

            await notifyMany(
                adminIds,
                {
                    type:
                        "admin_new_express_order",

                    title,

                    body,

                    orderId:
                    order.id,

                    orderType:
                        "express",

                    data:
                    notificationData,

                    socketEvent:
                        "adminNewExpressOrder",

                    socketPayload: {
                        ...notificationData,

                        message:
                            `Создан новый экспресс-заказ №${order.id}`,
                    },
                }
            );

            console.log(
                "ADMIN NEW EXPRESS ORDER NOTIFICATION:",
                {
                    orderId:
                    order.id,

                    adminIds,

                    type:
                    order.type,

                    status:
                    order.status,
                }
            );
        } catch (error) {
            console.error(
                "Ошибка уведомления администраторов об экспресс-заказе:",
                {
                    orderId:
                        order?.id ||
                        null,

                    error:
                        error?.message ||
                        error,
                }
            );
        }
    };

function emitExpressStatusToParticipants(io, order, payload = {}) {
    if (!io || !order) return;

    const basePayload = buildExpressPayload(order, payload);

    const participantIds = [
        order.creatorId,
        order.executorId,
    ].filter(Boolean);

    participantIds.forEach((userId) => {
        emitToUserEverywhere(io, userId, "expressOrderStatusChanged", basePayload);
        emitToUserEverywhere(io, userId, "expressStatusChanged", basePayload);
        emitToUserEverywhere(io, userId, "activeOrdersUpdated", basePayload);
        emitToUserEverywhere(io, userId, "expressOrdersUpdated", basePayload);
    });
}

function emitExpressAccepted(io, order) {
    if (!io || !order) return;

    const creatorPayload = buildExpressPayload(order, {
        message: `Исполнитель принял ваш ${
            order.type === "taxi" ? "заказ такси" : "курьерский заказ"
        } №${order.id}`,
    });

    const executorPayload = buildExpressPayload(order, {
        message: "Вы приняли экспресс-заказ",
    });

    if (order.creatorId) {
        emitToUserEverywhere(io, order.creatorId, "expressOrderAccepted", creatorPayload);
        emitToUserEverywhere(io, order.creatorId, "expressOrderStatusChanged", creatorPayload);
        emitToUserEverywhere(io, order.creatorId, "activeOrdersUpdated", creatorPayload);
        emitToUserEverywhere(io, order.creatorId, "expressOrdersUpdated", creatorPayload);
    }

    if (order.executorId) {
        emitToUserEverywhere(io, order.executorId, "expressOrderAccepted", executorPayload);
        emitToUserEverywhere(io, order.executorId, "expressOrderStatusChanged", executorPayload);
        emitToUserEverywhere(io, order.executorId, "activeOrdersUpdated", executorPayload);
        emitToUserEverywhere(io, order.executorId, "expressOrdersUpdated", executorPayload);
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

router.get("/express-orders/admin/:id", authenticateToken, async (req, res) => {
        const orderId =
            Number(req.params.id);

        if (
            !Number.isInteger(orderId) ||
            orderId <= 0
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Некорректный ID экспресс-заказа",
            });
        }

        try {
            const currentUser =
                await User.findByPk(
                    req.user.id,
                    {
                        attributes: [
                            "id",
                            "role",
                        ],
                    }
                );

            if (
                !currentUser ||
                currentUser.role !== "admin"
            ) {
                return res.status(403).json({
                    success: false,
                    message:
                        "Доступ разрешён только администратору",
                });
            }

            const order =
                await ExpressOrder.findByPk(
                    orderId
                );

            if (!order) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Экспресс-заказ не найден",
                });
            }

            return res.json({
                success: true,

                order: {
                    ...order.toJSON(),

                    adminPreview:
                        true,
                },
            });
        } catch (error) {
            console.error(
                "Ошибка административного просмотра экспресс-заказа:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Ошибка сервера",
            });
        }
    });

router.get("/express-orders/available", async (req, res) => {
    try {
        const type = req.query.type ? String(req.query.type) : null;

        const where = {
            status: "created",
            executorId: null,
            creatorHidden: false,
            adminDeleted: false,
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

        let where;

        if (mode === "history") {
            where = {
                ...whereBase,
                status: { [Op.in]: ["completed", "cancelled"] },
            };
        } else if (mode === "created") {
            // Для страницы "Мои заказы":
            // показываем только экспресс-заказы заказчика, которые ещё никто не взял.
            where = {
                creatorId: userId,
                executorId: null,
                status: "created",
                creatorHidden: false,
                adminDeleted: false,
            };
        } else {
            // Для active-orders:
            // все активные экспресс-заказы, где пользователь заказчик или исполнитель.
            where = {
                ...whereBase,
                status: { [Op.notIn]: ["completed", "cancelled"] },
                adminDeleted: false,
            };
        }

        const orders = await ExpressOrder.findAll({
            where,
            order: [["id", "DESC"]],
            limit: 200,
        });

        /*
         * Получаем всех исполнителей экспресс-заказов одним запросом.
         */
        const executorIds = [
            ...new Set(
                orders
                    .map((order) => Number(order.executorId))
                    .filter((id) => Number.isInteger(id) && id > 0)
            ),
        ];

        let executorsMap = {};

        if (executorIds.length > 0) {
            const executors = await User.findAll({
                where: {
                    id: {
                        [Op.in]: executorIds,
                    },
                },

                attributes: [
                    "id",
                    "username",
                    "rating",

                    "vehicleBrand",
                    "vehicleModel",
                    "vehicleColor",
                    "vehiclePlate",
                    "vehiclePhoto",
                    "vehicleVerificationStatus",
                ],
            });

            executorsMap = Object.fromEntries(
                executors.map((executor) => [
                    Number(executor.id),
                    executor.toJSON(),
                ])
            );
        }

        const normalizedOrders = orders.map((row) => {
            const order = row.toJSON();

            const executor =
                executorsMap[Number(order.executorId)] ||
                null;

            /*
             * Snapshot заказа имеет приоритет.
             *
             * Если snapshot отсутствует — берём
             * актуальный автомобиль исполнителя.
             */
            if (
                order.type === "taxi" &&
                order.executorId
            ) {
                order.executorVehicleBrand =
                    order.executorVehicleBrand ||
                    executor?.vehicleBrand ||
                    null;

                order.executorVehicleModel =
                    order.executorVehicleModel ||
                    executor?.vehicleModel ||
                    null;

                order.executorVehicleColor =
                    order.executorVehicleColor ||
                    executor?.vehicleColor ||
                    null;

                order.executorVehiclePlate =
                    order.executorVehiclePlate ||
                    executor?.vehiclePlate ||
                    null;

                order.executorVehiclePhoto =
                    order.executorVehiclePhoto ||
                    executor?.vehiclePhoto ||
                    null;

                /*
                 * Пока оставим executor в ответе.
                 * Полезно для диагностики и потом
                 * можем показывать имя/рейтинг водителя.
                 */
                order.executor = executor;
            }

            return order;
        });

        return res.json({
            success: true,
            orders: normalizedOrders,
        });
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
            totalPrice,

            distanceKm,
            estimatedTimeMin,

            clientRecommendedPrice = null,
            clientPricingVersion = null,

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

        const normalizedDistanceKm =
            Number(distanceKm);

        if (
            !Number.isFinite(
                normalizedDistanceKm
            ) ||
            normalizedDistanceKm <= 0 ||
            normalizedDistanceKm > 5000
        ) {
            await t.rollback();

            return res.status(400).json({
                success: false,
                message:
                    "Не удалось проверить расстояние маршрута",
            });
        }

        const normalizedEstimatedTimeMin =
            Number.isFinite(
                Number(
                    estimatedTimeMin
                )
            )
                ? Math.max(
                    0,
                    Math.round(
                        Number(
                            estimatedTimeMin
                        )
                    )
                )
                : null;

        const serverCalculation =
            calculateExpressRecommendedPrice({
                type,
                distanceKm:
                normalizedDistanceKm,
            });

        if (!serverCalculation) {
            await t.rollback();

            return res.status(400).json({
                success: false,
                message:
                    "Не удалось рассчитать рекомендуемую стоимость",
            });
        }

        const tpRaw = Number(totalPrice);

        if (!Number.isFinite(tpRaw) || tpRaw < 0) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: "Некорректная стоимость экспресс-заказа",
            });
        }

        if (tpRaw > 300000) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: "Слишком большая стоимость экспресс-заказа. Проверьте маршрут.",
            });
        }

        const tp = Math.round(tpRaw * 100) / 100;

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
                distanceKm:
                    Math.round(
                        normalizedDistanceKm *
                        100
                    ) / 100,

                estimatedTimeMin:
                normalizedEstimatedTimeMin,

                basePrice:
                serverCalculation.basePrice,

                pricePerKm:
                serverCalculation.pricePerKm,


                totalPrice:
                tp,

                recommendedPrice:
                serverCalculation
                    .recommendedPrice,

                pricingVersion:
                serverCalculation
                    .pricingVersion,
                paymentType,
                dealStatus: "none",
                status: "created",
                subcategory,
                description,
            },
            { transaction: t }
        );

        const io = req.app.locals.io;
        if (io) {
            io.emit(
                "expressOrdersUpdated",
                buildExpressPayload(order, {
                    message: "Создан новый экспресс-заказ",
                })
            );
        }

        await req.logAction({
            req,
            actorUserId: creatorId,
            actorRole: "user",
            actionType: "express_order_create",
            entityType: "express_order",
            entityId: order.id,
            expressOrderId: order.id,
            meta: {
                type:
                order.type,

                paymentType:
                order.paymentType,

                offeredPrice:
                order.totalPrice,

                recommendedPrice:
                order.recommendedPrice,

                pricingVersion:
                order.pricingVersion,

                basePrice:
                order.basePrice,

                pricePerKm:
                order.pricePerKm,

                distanceKm:
                order.distanceKm,

                estimatedTimeMin:
                order.estimatedTimeMin,

                clientRecommendedPrice:
                    Number.isFinite(
                        Number(
                            clientRecommendedPrice
                        )
                    )
                        ? Number(
                            clientRecommendedPrice
                        )
                        : null,

                clientPricingVersion:
                    Number.isFinite(
                        Number(
                            clientPricingVersion
                        )
                    )
                        ? Number(
                            clientPricingVersion
                        )
                        : null,

                from: {
                    address:
                    order.fromAddress,

                    lat:
                    order.fromLat,

                    lng:
                    order.fromLng,
                },

                to: {
                    address:
                    order.toAddress,

                    lat:
                    order.toLat,

                    lng:
                    order.toLng,
                },
            },
        });

        // ✅ Авто-учёт использования сохранённых адресов
        await bumpSavedAddressUsage({ userId: creatorId, id: Number(fromSavedAddressId) || null, transaction: t });
        await bumpSavedAddressUsage({ userId: creatorId, id: Number(toSavedAddressId) || null, transaction: t });

        await t.commit();

        await notifyAdminsAboutNewExpressOrder({
            order,
            creatorId,
        });

        try {
            await notifyNearbyExpressExecutors({
                req,
                order,
            });
        } catch (pushError) {
            console.error(
                "express nearby push error:",
                pushError
            );

            await req.logAction?.({
                req,
                actorUserId:
                creatorId,

                actorRole:
                    "system",

                actionType:
                    "express_push_failed",

                entityType:
                    "express_order",

                entityId:
                order.id,

                expressOrderId:
                order.id,

                severity:
                    "error",

                success:
                    false,

                meta: {
                    error:
                        String(
                            pushError?.message ||
                            pushError
                        ),
                },
            });
        }

        return res.status(201).json({
            success: true,
            order,
        });
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

        if (!Number.isFinite(id) || id <= 0) {
            return res.status(400).json({
                success: false,
                message: "Некорректный id express-заказа",
            });
        }

        const order = await ExpressOrder.findByPk(id);

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Заказ не найден",
            });
        }

        const isCreator = Number(order.creatorId) === Number(userId);
        const isExecutor = Number(order.executorId) === Number(userId);

        const isAvailable =
            !order.executorId &&
            ["pending", "created"].includes(String(order.status || "pending"));

        if (!isCreator && !isExecutor && !isAvailable) {
            return res.status(403).json({
                success: false,
                message: "Нет доступа",
            });
        }

        return res.json({
            success: true,
            order,
        });
    } catch (e) {
        console.error("express-orders/:id GET error:", e);
        return res.status(500).json({
            success: false,
            message: "Ошибка сервера",
        });
    }
});

router.patch("/express-orders/:id/hide-by-creator", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const id = Number(req.params.id);

        if (!Number.isFinite(id) || id <= 0) {
            return res.status(400).json({
                success: false,
                message: "Некорректный id экспресс-заказа",
            });
        }

        const order = await ExpressOrder.findByPk(id);

        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Экспресс-заказ не найден",
            });
        }

        if (Number(order.creatorId) !== Number(userId)) {
            return res.status(403).json({
                success: false,
                message: "Можно удалить только свой экспресс-заказ",
            });
        }

        if (order.status !== "created" || order.executorId) {
            return res.status(409).json({
                success: false,
                message: "Этот экспресс-заказ уже нельзя удалить, потому что он уже принят или выполняется.",
            });
        }

        const before = {
            status: order.status,
            creatorHidden: order.creatorHidden,
            creatorHiddenAt: order.creatorHiddenAt,
        };

        order.creatorHidden = true;
        order.creatorHiddenAt = new Date();

        await order.save();

        await req.logAction?.({
            req,
            actorUserId: userId,
            actorRole: "user",
            actionType: "express_order_hidden_by_creator",
            entityType: "express_order",
            entityId: order.id,
            expressOrderId: order.id,
            severity: "info",
            success: true,
            meta: {
                before,
                after: {
                    status: order.status,
                    creatorHidden: order.creatorHidden,
                    creatorHiddenAt: order.creatorHiddenAt,
                },
            },
        });

        const io = req.app.locals.io;

        if (io) {
            io.emit("expressOrdersUpdated", buildExpressPayload(order, {
                action: "hidden_by_creator",
                message: "Экспресс-заказ скрыт создателем",
            }));

            io.emit("orderUpdated", {
                orderId: order.id,
                orderType: "express",
                creatorId: order.creatorId,
                action: "hidden_by_creator",
            });
        }

        return res.json({
            success: true,
            message: "Экспресс-заказ удалён из видимости",
            orderId: order.id,
        });
    } catch (e) {
        console.error("express hide-by-creator error:", e);
        return res.status(500).json({
            success: false,
            message: "Ошибка при удалении экспресс-заказа",
        });
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

        /*
 * Для курьерских заказов автомобиль не требуется.
 *
 * Для такси обязательны:
 * - заполненные данные машины
 * - одобрение автомобиля администратором
 */
        if (order.type === "taxi") {
            const hasVehicleData =
                String(executor.vehicleBrand || "").trim() &&
                String(executor.vehicleModel || "").trim() &&
                String(executor.vehicleColor || "").trim() &&
                String(executor.vehiclePlate || "").trim();

            if (!hasVehicleData) {
                await t.rollback();

                return res.status(403).json({
                    success: false,
                    code: "TAXI_VEHICLE_REQUIRED",
                    message:
                        "Чтобы принимать заказы такси, сначала добавьте данные автомобиля в профиле в разделе «Верификация».",
                });
            }

            if (
                executor.vehicleVerificationStatus === "pending"
            ) {
                await t.rollback();

                return res.status(403).json({
                    success: false,
                    code: "TAXI_VEHICLE_PENDING",
                    message:
                        "Данные автомобиля находятся на проверке. После одобрения администратором вы сможете принимать заказы такси.",
                });
            }

            if (
                executor.vehicleVerificationStatus === "rejected"
            ) {
                await t.rollback();

                return res.status(403).json({
                    success: false,
                    code: "TAXI_VEHICLE_REJECTED",
                    message:
                        executor.vehicleVerificationNote
                            ? `Автомобиль не прошёл проверку: ${executor.vehicleVerificationNote}`
                            : "Автомобиль не прошёл проверку. Откройте профиль и исправьте данные.",
                });
            }

            if (
                executor.vehicleVerificationStatus !== "verified"
            ) {
                await t.rollback();

                return res.status(403).json({
                    success: false,
                    code: "TAXI_VEHICLE_NOT_VERIFIED",
                    message:
                        "Для принятия заказов такси автомобиль должен быть подтверждён администратором.",
                });
            }
        }

        // ✅ 3) назначаем исполнителя
        // ✅ 3) назначаем исполнителя
        order.executorId = executorId;
        order.status = "accepted";

        /*
         * Для такси сохраняем снимок данных автомобиля
         * на момент принятия заказа.
         */
        if (order.type === "taxi") {
            order.executorVehicleBrand =
                executor.vehicleBrand;

            order.executorVehicleModel =
                executor.vehicleModel;

            order.executorVehicleColor =
                executor.vehicleColor;

            order.executorVehiclePlate =
                executor.vehiclePlate;

            order.executorVehiclePhoto =
                executor.vehiclePhoto || null;
        }

        await order.save({
            transaction: t,
        });



        await req.logAction({
            req,

            actorUserId:
            executorId,

            actorRole:
                "user",

            actionType:
                "express_order_accept",

            entityType:
                "express_order",

            entityId:
            order.id,

            expressOrderId:
            order.id,

            meta: {
                status:
                order.status,

                totalPrice:
                order.totalPrice,

                recommendedPrice:
                order.recommendedPrice,

                commissionStatus:
                order.commissionStatus,

                ...(order.type === "taxi"
                    ? {
                        vehicleBrand:
                        order.executorVehicleBrand,

                        vehicleModel:
                        order.executorVehicleModel,

                        vehicleColor:
                        order.executorVehicleColor,

                        vehiclePlate:
                        order.executorVehiclePlate,
                    }
                    : {}),
            },
        });

        await t.commit();

        const io = req.app.locals.io;

        emitExpressAccepted(io, order);

        try {

            let notificationTitle =
                "Экспресс-заказ принят";

            let notificationBody =
                `Исполнитель принял ваш ${
                    order.type === "taxi"
                        ? "заказ такси"
                        : "курьерский заказ"
                } №${order.id}`;

            if (order.type === "taxi") {
                const vehicleName = [
                    order.executorVehicleColor,
                    order.executorVehicleBrand,
                    order.executorVehicleModel,
                ]
                    .filter(Boolean)
                    .join(" ");

                notificationTitle =
                    "Водитель принял заказ";

                notificationBody =
                    `К вам приедет ${vehicleName}, ${
                        order.executorVehiclePlate
                    }.`;
            }

            await notifyUser({
                userId: order.creatorId,

                type: "express_status_changed",

                title:
                notificationTitle,

                body:
                notificationBody,

                orderId:
                order.id,

                orderType:
                    "express",

                data: {
                    creatorId:
                    order.creatorId,

                    executorId:
                    order.executorId,

                    expressType:
                    order.type,

                    type:
                    order.type,

                    status:
                    order.status,

                    vehicleBrand:
                    order.executorVehicleBrand,

                    vehicleModel:
                    order.executorVehicleModel,

                    vehicleColor:
                    order.executorVehicleColor,

                    vehiclePlate:
                    order.executorVehiclePlate,

                    vehiclePhoto:
                    order.executorVehiclePhoto,
                },
            });
        } catch (notifyError) {
            console.error("express accept notify error:", notifyError);
        }

        return res.json({
            success: true,
            order,

            message:
                "Заказ принят. Комиссия будет начислена только после завершения.",
        });
    } catch (e) {
        try {
            if (!t.finished) {
                await t.rollback();
            }
        } catch (rollbackError) {
            console.error("express accept rollback error:", rollbackError);
        }

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

        const vehicleName = [
            order.executorVehicleColor,
            order.executorVehicleBrand,
            order.executorVehicleModel,
        ]
            .filter(Boolean)
            .join(" ");

        const body =
            order.type === "taxi"
                ? `Водитель выехал к вам. ${vehicleName}${
                    order.executorVehiclePlate
                        ? `, ${order.executorVehiclePlate}`
                        : ""
                }.`
                : `Курьер выехал к точке A по заказу №${order.id}.`;

        const io = req.app.locals.io;

        emitExpressStatusToParticipants(io, order, {
            from,
            message: order.type === "taxi"
                ? "Водитель выехал к точке A"
                : "Курьер выехал к точке A",
        });

        await notifyUser({
            userId: order.creatorId,

            type: "express_status_changed",

            title:
                order.type === "taxi"
                    ? "Водитель выехал"
                    : "Курьер выехал",

            body,

            orderId: order.id,
            orderType: "express",

            data: {
                creatorId: order.creatorId,
                executorId: order.executorId,

                expressType: order.type,
                type: order.type,

                status: order.status,

                vehicleBrand:
                order.executorVehicleBrand,

                vehicleModel:
                order.executorVehicleModel,

                vehicleColor:
                order.executorVehicleColor,

                vehiclePlate:
                order.executorVehiclePlate,
            },
        });

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

        emitExpressStatusToParticipants(io, order, {
            from,
            arrivedAt: order.arrivedAt,
            message: order.type === "taxi"
                ? "Водитель прибыл к точке A"
                : "Курьер прибыл к точке A",
        });

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

        const arrivedTitle =
            order.type === "taxi"
                ? "Водитель на месте"
                : "Курьер на месте";

        const arrivedBody =
            order.type === "taxi"
                ? "Выходите, водитель прибыл к точке A"
                : "Курьер прибыл к точке A. Передайте посылку";

        const vehicleName = [
            order.executorVehicleColor,
            order.executorVehicleBrand,
            order.executorVehicleModel,
        ]
            .filter(Boolean)
            .join(" ");

        const body =
            order.type === "taxi"
                ? `${vehicleName || "Автомобиль"}${
                    order.executorVehiclePlate
                        ? `, ${order.executorVehiclePlate}`
                        : ""
                } ожидает вас в точке посадки.`
                : `Курьер прибыл в точку A по заказу №${order.id}.`;

        await notifyUser({
            userId: order.creatorId,

            type: "express_arrived",

            title:
                order.type === "taxi"
                    ? "Водитель приехал"
                    : "Курьер прибыл",

            body,

            orderId: order.id,
            orderType: "express",

            data: {
                creatorId: order.creatorId,
                executorId: order.executorId,

                expressType: order.type,
                type: order.type,

                status: order.status,

                vehicleBrand:
                order.executorVehicleBrand,

                vehicleModel:
                order.executorVehicleModel,

                vehicleColor:
                order.executorVehicleColor,

                vehiclePlate:
                order.executorVehiclePlate,
            },
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

        emitExpressStatusToParticipants(io, order, {
            from,
            waitingStartedAt: order.waitingStartedAt,
            message: "Водитель ожидает клиента",
        });

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

        await notifyUser({
            userId: order.creatorId,
            type: "express_status_changed",
            title: "Водитель ожидает",
            body: `Водитель ожидает вас по заказу №${order.id}`,
            orderId: order.id,
            orderType: "express",
            data: {
                creatorId: order.creatorId,
                executorId: order.executorId,
                expressType: order.type,
                status: order.status,
                waitingStartedAt: order.waitingStartedAt,
            },
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

        emitExpressStatusToParticipants(io, order, {
            from,
            pickedUpAt: order.pickedUpAt,
            message: "Курьер забрал посылку",
        });

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

        await notifyUser({
            userId: order.creatorId,
            type: "express_status_changed",
            title: "Посылка у курьера",
            body: `Курьер забрал посылку по заказу №${order.id}`,
            orderId: order.id,
            orderType: "express",
            data: {
                creatorId: order.creatorId,
                executorId: order.executorId,
                expressType: order.type,
                status: order.status,
                pickedUpAt: order.pickedUpAt,
            },
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

        emitExpressStatusToParticipants(io, order, {
            from,
            startedAt: order.startedAt,
            message: order.type === "taxi"
                ? "Поездка началась"
                : "Доставка началась",
        });

        await notifyUser({
            userId: order.creatorId,
            type: "express_status_changed",
            title: order.type === "taxi" ? "Поездка началась" : "Доставка началась",
            body: order.type === "taxi"
                ? `Поездка по заказу №${order.id} началась`
                : `Доставка по заказу №${order.id} началась`,
            orderId: order.id,
            orderType: "express",
            data: {
                creatorId: order.creatorId,
                executorId: order.executorId,
                expressType: order.type,
                type: order.type,
                status: order.status,
                startedAt: order.startedAt,
            },
        });

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
        const t =
            await sequelize.transaction();

        try {
            const executorId =
                req.user.id;

            const id =
                Number(
                    req.params.id
                );

            if (
                !Number.isFinite(id) ||
                id <= 0
            ) {
                await t.rollback();

                return res.status(400).json({
                    success: false,
                    message:
                        "Некорректный id",
                });
            }

            const order =
                await ExpressOrder.findByPk(
                    id,
                    {
                        transaction: t,
                        lock:
                        t.LOCK.UPDATE,
                    }
                );

            if (!order) {
                await t.rollback();

                return res.status(404).json({
                    success: false,
                    message:
                        "Заказ не найден",
                });
            }

            if (
                Number(
                    order.executorId
                ) !==
                Number(
                    executorId
                )
            ) {
                await t.rollback();

                return res.status(403).json({
                    success: false,
                    message:
                        "Только исполнитель",
                });
            }

            if (
                order.status !==
                "in_progress"
            ) {
                await t.rollback();

                return res.status(409).json({
                    success: false,
                    message:
                        "Заказ ещё не в процессе",
                });
            }

            if (
                order.commissionStatus !==
                "none"
            ) {
                await t.rollback();

                return res.status(409).json({
                    success: false,
                    message:
                        "Комиссия по этому заказу уже обработана",
                });
            }

            const executor =
                await User.findByPk(
                    executorId,
                    {
                        transaction: t,
                        lock:
                        t.LOCK.UPDATE,
                    }
                );

            if (!executor) {
                await t.rollback();

                return res.status(404).json({
                    success: false,
                    message:
                        "Исполнитель не найден",
                });
            }

            const now =
                new Date();

            const premiumActive =
                executor
                    .subscription_type ===
                "premium" &&
                (
                    !executor
                        .subscription_expires_at ||
                    new Date(
                        executor
                            .subscription_expires_at
                    ) > now
                );

            /*
             * totalPrice хранится в рублях.
             * Всегда переводим рубли
             * в копейки одинаково.
             */
            const totalRubles =
                Number(
                    order.totalPrice
                );

            if (
                !Number.isFinite(
                    totalRubles
                ) ||
                totalRubles <= 0
            ) {
                await t.rollback();

                return res.status(409).json({
                    success: false,
                    message:
                        "У заказа указана некорректная стоимость",
                });
            }

            const totalKopecks =
                Math.round(
                    totalRubles *
                    100
                );

            const feeKopecks =
                premiumActive
                    ? 0
                    : Math.round(
                        totalKopecks *
                        0.10
                    );

            let paidBySavedCard =
                false;

            let debtAdded =
                false;

            let commissionStatus =
                premiumActive
                    ? "waived"
                    : "none";

            if (feeKopecks > 0) {
                if (
                    executor
                        .yookassa_payment_method_id
                ) {
                    try {
                        const amountValue =
                            (
                                feeKopecks /
                                100
                            ).toFixed(2);

                        const payment =
                            await yooKassa
                                .createPayment(
                                    {
                                        amount: {
                                            value:
                                            amountValue,

                                            currency:
                                                "RUB",
                                        },

                                        capture:
                                            true,

                                        payment_method_id:
                                        executor
                                            .yookassa_payment_method_id,

                                        description:
                                            `Комиссия за завершённый экспресс-заказ #${order.id}`,

                                        metadata: {
                                            type:
                                                "debt",

                                            userId:
                                                String(
                                                    executorId
                                                ),

                                            expectedKopecks:
                                                String(
                                                    feeKopecks
                                                ),

                                            expressOrderId:
                                                String(
                                                    order.id
                                                ),

                                            reason:
                                                "express_complete_fee",
                                        },

                                        receipt: {
                                            customer: {
                                                phone:
                                                    String(
                                                        executor.phone ||
                                                        ""
                                                    ).replace(
                                                        /[^\d+]/g,
                                                        ""
                                                    ),
                                            },

                                            items: [
                                                {
                                                    description:
                                                        `Комиссия за экспресс-заказ #${order.id}`,

                                                    quantity:
                                                        1,

                                                    amount: {
                                                        value:
                                                        amountValue,

                                                        currency:
                                                            "RUB",
                                                    },

                                                    vat_code:
                                                        1,

                                                    payment_mode:
                                                        "full_payment",

                                                    payment_subject:
                                                        "service",
                                                },
                                            ],

                                            tax_system_code:
                                                2,
                                        },
                                    },

                                    uuidv4()
                                );

                        paidBySavedCard =
                            payment
                                ?.status ===
                            "succeeded";
                    } catch (
                        paymentError
                        ) {
                        console.error(
                            "express complete fee autopay error:",
                            paymentError
                                ?.message ||
                            paymentError
                        );
                    }
                }

                if (
                    paidBySavedCard
                ) {
                    commissionStatus =
                        "paid";
                } else {
                    executor.debt =
                        Number(
                            executor.debt ||
                            0
                        ) +
                        feeKopecks;

                    await executor.save({
                        transaction: t,
                    });

                    debtAdded =
                        true;

                    commissionStatus =
                        "debt";
                }
            }

            const from =
                order.status;

            order.status =
                "completed";

            order.completedAt =
                now;

            order.commissionKopecks =
                feeKopecks;

            order.commissionStatus =
                commissionStatus;

            order.commissionChargedAt =
                now;

            await order.save({
                transaction: t,
            });

            await req.logAction({
                req,

                actorUserId:
                executorId,

                actorRole:
                    "user",

                actionType:
                    "express_order_complete",

                entityType:
                    "express_order",

                entityId:
                order.id,

                expressOrderId:
                order.id,

                meta: {
                    from,

                    to:
                    order.status,

                    totalRubles,

                    totalKopecks,

                    premiumActive,

                    feeKopecks,

                    commissionStatus,

                    paidBySavedCard,

                    debtAdded,
                },
            });

            await t.commit();

            const io =
                req.app.locals.io;

            emitExpressStatusToParticipants(
                io,
                order,
                {
                    from,

                    completedAt:
                    order.completedAt,

                    message:
                        "Экспресс-заказ завершён",
                }
            );

            await notifyUser({
                userId:
                order.creatorId,

                type:
                    "review_needed",

                title:
                    "Экспресс-заказ завершён",

                body:
                    "Оцените исполнителя",

                orderId:
                order.id,

                orderType:
                    "express",

                data: {
                    creatorId:
                    order.creatorId,

                    executorId:
                    order.executorId,

                    expressType:
                    order.type,

                    status:
                    order.status,

                    completedAt:
                    order.completedAt,
                },

                socketEvent:
                    "expressOrderCompleted",

                socketPayload: {
                    message:
                        "Экспресс-заказ завершён. Оцените исполнителя.",

                    orderId:
                    order.id,

                    creatorId:
                    order.creatorId,

                    executorId:
                    order.executorId,

                    orderType:
                        "express",

                    type:
                    order.type,
                },
            });

            await notifyUser({
                userId:
                order.executorId,

                type:
                    "express_completed",

                title:
                    "Экспресс-заказ завершён",

                body:
                    `Заказ №${order.id} успешно завершён`,

                orderId:
                order.id,

                orderType:
                    "express",

                data: {
                    creatorId:
                    order.creatorId,

                    executorId:
                    order.executorId,

                    expressType:
                    order.type,

                    status:
                    order.status,

                    completedAt:
                    order.completedAt,

                    commissionKopecks:
                    feeKopecks,

                    commissionStatus,
                },

                socketEvent:
                    "expressOrderCompletedForExecutor",

                socketPayload: {
                    orderId:
                    order.id,

                    orderType:
                        "express",

                    message:
                        "Экспресс-заказ завершён",

                    commissionKopecks:
                    feeKopecks,

                    commissionStatus,
                },
            });

            return res.json({
                success: true,

                order,

                commission: {
                    premium:
                    premiumActive,

                    feeKopecks,

                    feeRubles:
                        feeKopecks /
                        100,

                    status:
                    commissionStatus,

                    paidBySavedCard,

                    debtAdded,
                },
            });
        } catch (e) {
            try {
                if (!t.finished) {
                    await t.rollback();
                }
            } catch (
                rollbackError
                ) {
                console.error(
                    "express complete rollback error:",
                    rollbackError
                );
            }

            console.error(
                "express-orders complete error:",
                e
            );

            return res.status(500).json({
                success: false,
                message:
                    "Ошибка сервера",
            });
        }
    });

router.post("/express-orders/:id/cancel", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const id = Number(req.params.id);

        if (!Number.isFinite(id) || id <= 0) {
            return res.status(400).json({
                success: false,
                message: "Некорректный id",
            });
        }

        const order = await ExpressOrder.findByPk(id);
        if (!order) {
            return res.status(404).json({
                success: false,
                message: "Заказ не найден",
            });
        }

        if (!isParticipant(order, userId)) {
            return res.status(403).json({
                success: false,
                message: "Нет доступа",
            });
        }

        if (["completed", "cancelled"].includes(order.status)) {
            return res.status(409).json({
                success: false,
                message: `Заказ уже ${order.status === "completed" ? "завершён" : "отменён"}`,
            });
        }

        const byCreator = Number(order.creatorId) === Number(userId);
        const byExecutor = Number(order.executorId) === Number(userId);

        const creatorAllowed = [
            "created",
            "accepted",
            "on_the_way_to_A",
            "arrived_at_A",
            "waiting_at_A",
        ].includes(order.status);

        const execAllowed = [
            "accepted",
            "on_the_way_to_A",
            "arrived_at_A",
            "waiting_at_A",
        ].includes(order.status);

        if ((byCreator && !creatorAllowed) || (byExecutor && !execAllowed)) {
            return res.status(409).json({
                success: false,
                message: `Нельзя отменить из статуса ${order.status}`,
            });
        }

        const from = order.status;

        order.status = "cancelled";
        order.dealStatus = "cancelled";
        order.cancelledAt = new Date();

        await order.save();

        const cancelledByRole = byCreator ? "creator" : "executor";

        const cancelledByText =
            cancelledByRole === "creator"
                ? "заказчиком"
                : "исполнителем";

        const title = "Экспресс-заказ отменён";
        const body = `Экспресс-заказ №${order.id} отменён ${cancelledByText}`;

        const socketPayload = buildExpressPayload(order, {
            from,
            cancelledBy: userId,
            cancelledByRole,
            cancelledAt: order.cancelledAt,
            message: body,
        });

        await req.logAction({
            req,
            actorUserId: userId,
            actorRole: "user",
            actionType: "express_order_cancel",
            entityType: "express_order",
            entityId: order.id,
            expressOrderId: order.id,
            severity: "warn",
            meta: {
                from,
                to: order.status,
                cancelledBy: userId,
                cancelledByRole,
            },
        });

        const io = req.app.locals.io;

        const participantIds = [
            order.creatorId,
            order.executorId,
        ].filter(Boolean);

        participantIds.forEach((participantId) => {
            // ✅ Отдельное событие именно отмены
            emitToUserEverywhere(io, participantId, "expressOrderCancelled", socketPayload);

            // ✅ Эти события только для обновления списков/карточек
            emitToUserEverywhere(io, participantId, "activeOrdersUpdated", socketPayload);
            emitToUserEverywhere(io, participantId, "expressOrdersUpdated", socketPayload);
        });

        const notifyTo = participantIds.filter(
            (participantId) => Number(participantId) !== Number(userId)
        );

        if (notifyTo.length > 0) {
            await notifyMany(notifyTo, {
                type: "express_cancelled",
                title,
                body,
                orderId: order.id,
                orderType: "express",
                data: {
                    orderId: order.id,
                    creatorId: order.creatorId,
                    executorId: order.executorId,
                    cancelledBy: userId,
                    cancelledByRole,
                    expressType: order.type,
                    type: order.type,
                    status: order.status,
                    cancelledAt: order.cancelledAt,
                },
            });
        }

        return res.json({
            success: true,
            order,
            cancelledBy: userId,
            cancelledByRole,
            message: body,
        });
    } catch (e) {
        console.error("express-orders cancel error:", e);
        return res.status(500).json({
            success: false,
            message: "Ошибка сервера",
        });
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