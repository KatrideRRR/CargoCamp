const express = require('express');
const { authMiddleware, adminMiddleware } = require('../middlewares/adminAuth');
const jwt = require('jsonwebtoken');
const NodeGeocoder = require("node-geocoder");
const { Op } = require("sequelize");
const { notifyUser } = require("../services/notificationService");
const { User, Message, Order, ExpressOrder, Category, Subcategory, Dispute, ActionLog, sequelize, Service,} = require("../models");
const bcrypt = require("bcrypt");
const {
    calculateRecommendedPrice,
} = require("../services/recommendedPriceService");

const geocoder = NodeGeocoder({
    provider: "openstreetmap",
});

function toNum(v) {
    const n = typeof v === "string" ? Number(v) : v;
    return Number.isFinite(n) ? n : null;
}

function normalizeBoolean(value) {
    if (
        value === true ||
        value === 1 ||
        value === "1" ||
        value === "true"
    ) {
        return true;
    }

    if (
        value === false ||
        value === 0 ||
        value === "0" ||
        value === "false"
    ) {
        return false;
    }

    return null;
}

function parseJsonObject(value) {
    if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
    ) {
        return value;
    }

    if (typeof value !== "string") {
        return {};
    }

    try {
        const parsed = JSON.parse(value);

        return parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
            ? parsed
            : {};
    } catch {
        return {};
    }
}

function normalizeNullablePositiveId(value) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return null;
    }

    const id = Number(value);

    return Number.isInteger(id) && id > 0
        ? id
        : null;
}

function normalizeOptionalMoney(value) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return null;
    }

    const amount = Number(value);

    if (
        !Number.isFinite(amount) ||
        amount < 0
    ) {
        return null;
    }

    return Math.round(amount);
}

const router = express.Router();

router.put('/users/:id/verify',authMiddleware, adminMiddleware, async (req, res) => {
    const { id } = req.params; // Получаем id пользователя из параметров URL
    const { userStatus } = req.body; // Получаем новый статус верификации

    try {
        // Проверка на валидность статуса
        const validStatuses = ["unverified", "pensioner", "verified"];
        if (!validStatuses.includes(userStatus)) {
            return res.status(400).json({ message: 'Неверный статус верификации' });
        }

        // Ищем пользователя по ID
        const user = await User.findByPk(id);

        if (!user) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }

        // Обновляем поле userStatus
        user.userStatus = userStatus;

        // Сохраняем изменения в базе
        await user.save();

        // Отправляем успешный ответ
        res.status(200).json({ message: `Статус верификации пользователя ${id} обновлен`, user });
    } catch (error) {
        console.error('Ошибка при обновлении верификации', error);
        res.status(500).json({ message: 'Ошибка на сервере' });
    }
});

router.get('/user-documents/:userId', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await User.findByPk(userId, {
            attributes: ['id', 'documentPhotos'],
        });

        if (!user) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }

        res.status(200).json({ documents: user.documentPhotos || [] });
    } catch (error) {
        console.error('Ошибка при получении документов пользователя:', error);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

router.post("/create-order", authMiddleware, adminMiddleware, async (req, res) => {
        const transaction =
            await sequelize.transaction();

        try {
            let {
                userId,
                address,
                description,
                workTime,
                isAsap,
                proposedSum,
                categoryId,
                subcategoryId,
                serviceId,
                serviceDetails,
                coordinates: incomingCoords,
                paymentType,
            } = req.body;

            /*
             * Пользователь
             */

            const targetUserId = Number(userId);

            if (
                !Number.isInteger(targetUserId) ||
                targetUserId <= 0
            ) {
                await transaction.rollback();

                return res.status(400).json({
                    success: false,
                    message:
                        "Некорректный userId",
                });
            }

            const targetUser =
                await User.findByPk(
                    targetUserId,
                    {
                        transaction,
                    }
                );

            if (!targetUser) {
                await transaction.rollback();

                return res.status(404).json({
                    success: false,
                    message:
                        "Пользователь не найден",
                });
            }

            /*
             * Адрес
             */

            address =
                String(address || "").trim();

            if (!address) {
                await transaction.rollback();

                return res.status(400).json({
                    success: false,
                    message: "Адрес обязателен",
                });
            }

            const looksLikeCoordsAddress = (
                value
            ) => {
                const normalized =
                    String(value || "").trim();

                return (
                    normalized === "" ||
                    normalized.startsWith(
                        "Координаты:"
                    )
                );
            };

            const parseLatLng = (value) => {
                if (!value) {
                    return null;
                }

                const raw = Array.isArray(value)
                    ? value[0]
                    : value;

                if (
                    typeof raw !== "string" ||
                    !raw.includes(",")
                ) {
                    return null;
                }

                const [latString, lngString] =
                    raw
                        .split(",")
                        .map((item) =>
                            item.trim()
                        );

                const lat =
                    Number(latString);

                const lng =
                    Number(lngString);

                if (
                    !Number.isFinite(lat) ||
                    !Number.isFinite(lng) ||
                    lat < -90 ||
                    lat > 90 ||
                    lng < -180 ||
                    lng > 180
                ) {
                    return null;
                }

                return {
                    lat,
                    lng,
                };
            };

            let latLng =
                parseLatLng(incomingCoords);

            let coordinatesString =
                latLng
                    ? `${latLng.lat},${latLng.lng}`
                    : null;

            /*
             * Если координаты не пришли,
             * пробуем определить их по адресу.
             */

            if (!coordinatesString) {
                try {
                    const geocodeResult =
                        await geocoder.geocode(
                            address
                        );

                    const firstResult =
                        Array.isArray(
                            geocodeResult
                        )
                            ? geocodeResult[0]
                            : null;

                    const latitude =
                        Number(
                            firstResult?.latitude
                        );

                    const longitude =
                        Number(
                            firstResult?.longitude
                        );

                    if (
                        !Number.isFinite(
                            latitude
                        ) ||
                        !Number.isFinite(
                            longitude
                        )
                    ) {
                        await transaction.rollback();

                        return res
                            .status(400)
                            .json({
                                success: false,
                                message:
                                    "Не удалось определить координаты по адресу. Выберите адрес из подсказок.",
                            });
                    }

                    latLng = {
                        lat: latitude,
                        lng: longitude,
                    };

                    coordinatesString =
                        `${latitude},${longitude}`;
                } catch (geocodeError) {
                    console.error(
                        "Ошибка геокодирования:",
                        geocodeError
                    );

                    await transaction.rollback();

                    return res
                        .status(400)
                        .json({
                            success: false,
                            message:
                                "Не удалось определить координаты адреса",
                        });
                }
            }

            /*
             * Если вместо адреса пришли
             * только координаты, определяем адрес.
             */

            if (
                latLng &&
                looksLikeCoordsAddress(address)
            ) {
                try {
                    const reverseResult =
                        await geocoder.reverse({
                            lat: latLng.lat,
                            lon: latLng.lng,
                        });

                    const firstResult =
                        Array.isArray(
                            reverseResult
                        )
                            ? reverseResult[0]
                            : null;

                    if (firstResult) {
                        address =
                            firstResult
                                .formattedAddress ||
                            firstResult.streetName ||
                            firstResult.city ||
                            address;
                    }
                } catch (reverseError) {
                    console.error(
                        "Ошибка reverse geocode:",
                        reverseError
                    );
                }
            }

            /*
             * Оплата
             */

            paymentType =
                Array.isArray(paymentType)
                    ? paymentType[0]
                    : paymentType;

            paymentType =
                String(
                    paymentType || "cash"
                ).trim();

            const allowedPaymentTypes =
                new Set([
                    "cash",
                    "guarantee",
                    "installment",
                ]);

            if (
                !allowedPaymentTypes.has(
                    paymentType
                )
            ) {
                await transaction.rollback();

                return res.status(400).json({
                    success: false,
                    message:
                        "Некорректный paymentType",
                });
            }

            /*
             * Категория
             */

            const normalizedCategoryId =
                normalizeNullablePositiveId(
                    categoryId
                );

            if (!normalizedCategoryId) {
                await transaction.rollback();

                return res.status(400).json({
                    success: false,
                    message:
                        "Выберите категорию",
                });
            }

            const category =
                await Category.findByPk(
                    normalizedCategoryId,
                    {
                        transaction,
                    }
                );

            if (!category) {
                await transaction.rollback();

                return res.status(404).json({
                    success: false,
                    message:
                        "Категория не найдена",
                });
            }

            /*
             * Подкатегория
             */

            const normalizedSubcategoryId =
                normalizeNullablePositiveId(
                    subcategoryId
                );

            let subcategory = null;

            if (normalizedSubcategoryId) {
                subcategory =
                    await Subcategory.findOne({
                        where: {
                            id:
                            normalizedSubcategoryId,
                            categoryId:
                            normalizedCategoryId,
                        },
                        transaction,
                    });

                if (!subcategory) {
                    await transaction.rollback();

                    return res.status(400).json({
                        success: false,
                        message:
                            "Подкатегория не относится к выбранной категории",
                    });
                }
            }

            /*
             * Услуга
             */

            const normalizedServiceId =
                normalizeNullablePositiveId(
                    serviceId
                );

            let service = null;

            if (normalizedServiceId) {
                service =
                    await Service.findByPk(
                        normalizedServiceId,
                        {
                            transaction,
                        }
                    );

                if (!service) {
                    await transaction.rollback();

                    return res.status(404).json({
                        success: false,
                        message:
                            "Услуга не найдена",
                    });
                }

                /*
                 * Название внешнего ключа
                 * проверь по модели Service.
                 */

                if (
                    normalizedSubcategoryId &&
                    service.subcategoryId != null &&
                    Number(
                        service.subcategoryId
                    ) !==
                    Number(
                        normalizedSubcategoryId
                    )
                ) {
                    await transaction.rollback();

                    return res.status(400).json({
                        success: false,
                        message:
                            "Услуга не относится к выбранной подкатегории",
                    });
                }
            }

            /*
             * Дополнительные параметры услуги
             */

            const normalizedServiceDetails =
                parseJsonObject(
                    serviceDetails
                );

            /*
             * Время выполнения
             */

            const normalizedIsAsap =
                normalizeBoolean(isAsap);

            let normalizedWorkTime = null;

            if (normalizedIsAsap === true) {
                normalizedWorkTime = null;
            } else if (workTime) {
                const parsedWorkTime =
                    new Date(workTime);

                if (
                    Number.isNaN(
                        parsedWorkTime.getTime()
                    )
                ) {
                    await transaction.rollback();

                    return res.status(400).json({
                        success: false,
                        message:
                            "Некорректная дата выполнения",
                    });
                }

                normalizedWorkTime =
                    parsedWorkTime;
            } else {
                await transaction.rollback();

                return res.status(400).json({
                    success: false,
                    message:
                        "Укажите срок выполнения или выберите «Как можно скорее»",
                });
            }

            /*
             * Рекомендованная стоимость
             */

            const pricingConfig =
                subcategory?.pricingConfig ||
                service?.pricingConfig ||
                null;

            let recommendedPriceResult = null;

            if (
                pricingConfig &&
                pricingConfig.enabled === true
            ) {
                try {
                    recommendedPriceResult =
                        calculateRecommendedPrice({
                            pricingConfig,
                            serviceDetails:
                            normalizedServiceDetails,
                        });
                } catch (
                    calculationError
                    ) {
                    console.error(
                        "Ошибка расчёта рекомендуемой цены:",
                        calculationError
                    );
                }
            }

            const normalizedProposedSum =
                normalizeOptionalMoney(
                    proposedSum
                );

            if (
                proposedSum !== "" &&
                proposedSum !== null &&
                proposedSum !== undefined &&
                normalizedProposedSum === null
            ) {
                await transaction.rollback();

                return res.status(400).json({
                    success: false,
                    message:
                        "Некорректная сумма заказа",
                });
            }

            /*
             * Если администратор не указал сумму,
             * используем рекомендацию калькулятора.
             */

            const finalProposedSum =
                normalizedProposedSum ??
                recommendedPriceResult
                    ?.recommendedPrice ??
                null;

            /*
             * Создание заказа
             */

            const newOrder =
                await Order.create(
                    {
                        userId: targetUserId,
                        creatorId:
                        targetUserId,

                        address,
                        coordinates:
                        coordinatesString,

                        description:
                            String(
                                description || ""
                            ).trim() || null,

                        workTime:
                        normalizedWorkTime,

                        isAsap:
                            normalizedIsAsap ===
                            true,

                        proposedSum:
                        finalProposedSum,

                        categoryId:
                        normalizedCategoryId,

                        subcategoryId:
                        normalizedSubcategoryId,

                        serviceId:
                        normalizedServiceId,

                        serviceDetails:
                            Object.keys(
                                normalizedServiceDetails
                            ).length > 0
                                ? normalizedServiceDetails
                                : null,

                        paymentType,

                        paymentStatus:
                            paymentType === "cash"
                                ? "unpaid"
                                : "pending",

                        dealStatus: "none",
                        status: "pending",

                        images: [],
                        completedBy: [],
                        requests: [],

                        promotionCost: 0,
                        promotionRequested: {
                            highlight: false,
                            recommended: false,
                            push: false,
                        },

                        is_highlighted: false,
                        is_recommended: false,
                        is_push_notified: false,

                        creatorHidden: false,
                        adminDeleted: false,

                        createdAt: new Date(),
                    },
                    {
                        transaction,
                    }
                );

            await req.logAction?.({
                req,
                actorUserId:
                req.user.id,
                actorRole: "admin",

                actionType:
                    "admin_order_create",

                entityType: "order",
                entityId:
                newOrder.id,
                orderId:
                newOrder.id,

                severity: "info",
                success: true,

                meta: {
                    createdForUserId:
                    targetUserId,

                    status:
                    newOrder.status,

                    paymentType:
                    newOrder.paymentType,

                    categoryId:
                    newOrder.categoryId,

                    subcategoryId:
                    newOrder.subcategoryId,

                    serviceId:
                    newOrder.serviceId,

                    isAsap:
                    newOrder.isAsap,

                    workTime:
                    newOrder.workTime,

                    proposedSum:
                    newOrder.proposedSum,

                    recommendedPrice:
                        recommendedPriceResult
                            ?.recommendedPrice ??
                        null,

                    serviceDetails:
                    normalizedServiceDetails,

                    coordinates:
                    newOrder.coordinates,

                    imagesCount: 0,
                },
            });

            await transaction.commit();

            /*
             * Обновляем клиентские страницы.
             */

            req.app.locals.io?.emit(
                "orderUpdated",
                {
                    orderId:
                    newOrder.id,

                    creatorId:
                    targetUserId,

                    orderType:
                        "regular",

                    action:
                        "admin_created",
                }
            );

            return res.status(201).json({
                success: true,

                message:
                    "Заказ успешно создан администратором",

                order:
                newOrder,

                recommendedPrice:
                recommendedPriceResult,
            });
        } catch (error) {
            await transaction.rollback();

            console.error(
                "Ошибка при создании заказа админом:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "Ошибка сервера",
            });
        }
    });

router.post("/create-express-order", authMiddleware, adminMiddleware, async (req, res) => {
    const t = await sequelize.transaction();

    try {
        const {
            userId,
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
        } = req.body;

        if (!userId) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: "userId обязателен",
            });
        }

        const creatorId = Number(userId);
        if (!Number.isFinite(creatorId) || creatorId <= 0) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: "Некорректный userId",
            });
        }

        if (!type || !fromAddress || !toAddress) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: "type/fromAddress/toAddress обязательны",
            });
        }

        if (!["taxi", "courier"].includes(type)) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: "type должен быть taxi|courier",
            });
        }

        const normalizedPaymentType = String(paymentType || "cash").trim() || "cash";
        if (!["cash", "guarantee"].includes(normalizedPaymentType)) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: "paymentType должен быть cash|guarantee",
            });
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

        if (tp <= 0) {
            await t.rollback();
            return res.status(400).json({
                success: false,
                message: "totalPrice должен быть больше 0",
            });
        }

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
                paymentType: normalizedPaymentType,
                dealStatus: "none",
                status: "created",
                subcategory,
                description,
            },
            { transaction: t }
        );

        await req.logAction({
            req,
            actorUserId: req.user.id,
            actorRole: "admin",
            actionType: "admin_express_order_create",
            entityType: "express_order",
            entityId: order.id,
            expressOrderId: order.id,
            meta: {
                createdForUserId: creatorId,
                type: order.type,
                paymentType: order.paymentType,
                totalPrice: order.totalPrice,
                basePrice: order.basePrice,
                pricePerKm: order.pricePerKm,
                from: {
                    address: order.fromAddress,
                    lat: order.fromLat,
                    lng: order.fromLng,
                },
                to: {
                    address: order.toAddress,
                    lat: order.toLat,
                    lng: order.toLng,
                },
            },
        });

        await t.commit();

        return res.status(201).json({
            success: true,
            message: "Экспресс-заказ успешно создан администратором",
            order,
        });
    } catch (e) {
        await t.rollback();
        console.error("Ошибка при создании экспресс-заказа админом:", e);
        return res.status(500).json({
            success: false,
            message: "Ошибка сервера",
        });
    }
});

router.delete("/express-orders/:id", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const order = await ExpressOrder.findByPk(req.params.id);

        if (!order) {
            return res.status(404).json({ message: "Экспресс-заказ не найден" });
        }

        if (order.adminDeleted) {
            return res.status(400).json({
                message: "Экспресс-заказ уже помечен как удалённый админом",
            });
        }

        const before = {
            status: order.status,
            creatorHidden: order.creatorHidden,
            creatorHiddenAt: order.creatorHiddenAt,
            adminDeleted: order.adminDeleted,
            adminDeletedAt: order.adminDeletedAt,
            adminDeletedById: order.adminDeletedById,
        };

        order.adminDeleted = true;
        order.adminDeletedAt = new Date();
        order.adminDeletedById = req.user?.id || null;

        await order.save();

        await req.logAction?.({
            req,
            actorUserId: req.user?.id || null,
            actorRole: "admin",
            actionType: "admin_express_order_soft_deleted",
            entityType: "express_order",
            entityId: order.id,
            expressOrderId: order.id,
            severity: "warn",
            success: true,
            meta: {
                before,
                after: {
                    status: order.status,
                    creatorHidden: order.creatorHidden,
                    creatorHiddenAt: order.creatorHiddenAt,
                    adminDeleted: order.adminDeleted,
                    adminDeletedAt: order.adminDeletedAt,
                    adminDeletedById: order.adminDeletedById,
                },
            },
        });

        req.app.locals.io?.emit("expressOrdersUpdated", {
            orderId: order.id,
            id: order.id,
            orderType: "express",
            action: "admin_soft_deleted",
            creatorId: order.creatorId,
            executorId: order.executorId,
            status: order.status,
        });

        req.app.locals.io?.emit("orderUpdated", {
            orderId: order.id,
            orderType: "express",
            action: "admin_soft_deleted",
            creatorId: order.creatorId,
            executorId: order.executorId,
        });

        res.json({
            success: true,
            message: "Экспресс-заказ помечен как удалённый админом",
            order,
        });
    } catch (error) {
        console.error("Ошибка удаления экспресс-заказа админом:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.patch("/express-orders/:id/restore", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const order = await ExpressOrder.findByPk(req.params.id);

        if (!order) {
            return res.status(404).json({ message: "Экспресс-заказ не найден" });
        }

        const before = {
            creatorHidden: order.creatorHidden,
            creatorHiddenAt: order.creatorHiddenAt,
            adminDeleted: order.adminDeleted,
            adminDeletedAt: order.adminDeletedAt,
            adminDeletedById: order.adminDeletedById,
        };

        order.creatorHidden = false;
        order.creatorHiddenAt = null;
        order.adminDeleted = false;
        order.adminDeletedAt = null;
        order.adminDeletedById = null;

        await order.save();

        await req.logAction?.({
            req,
            actorUserId: req.user?.id || null,
            actorRole: "admin",
            actionType: "admin_express_order_restored",
            entityType: "express_order",
            entityId: order.id,
            expressOrderId: order.id,
            severity: "info",
            success: true,
            meta: {
                before,
                after: {
                    creatorHidden: order.creatorHidden,
                    creatorHiddenAt: order.creatorHiddenAt,
                    adminDeleted: order.adminDeleted,
                    adminDeletedAt: order.adminDeletedAt,
                    adminDeletedById: order.adminDeletedById,
                },
            },
        });

        req.app.locals.io?.emit("expressOrdersUpdated", {
            orderId: order.id,
            id: order.id,
            orderType: "express",
            action: "admin_restored",
            creatorId: order.creatorId,
            executorId: order.executorId,
            status: order.status,
        });

        req.app.locals.io?.emit("orderUpdated", {
            orderId: order.id,
            orderType: "express",
            action: "admin_restored",
            creatorId: order.creatorId,
            executorId: order.executorId,
        });

        res.json({
            success: true,
            message: "Экспресс-заказ восстановлен",
            order,
        });
    } catch (error) {
        console.error("Ошибка восстановления экспресс-заказа:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.post('/create-user', authMiddleware, adminMiddleware, async (req, res) => {
    const { username, phone, password } = req.body;

    if (!phone || !password) {
        return res.status(400).json({ error: 'Укажите номер телефона и пароль' });
    }

    try {
        const userExists = await User.findOne({ where: { phone } });
        if (userExists) {
            return res.status(400).json({ message: 'Телефон уже используется' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await User.create({ username, phone, password: hashedPassword });

        const token = jwt.sign({ id: newUser.id, phone: newUser.phone }, process.env.JWT_SECRET, { expiresIn: '7d' });
        res.status(201).json({ message: 'Пользователь зарегистрирован', token });
    } catch (error) {
        console.error('Ошибка при создании пользователя:', error);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

router.get('/users', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const users = await User.findAll();
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

router.put('/users/:id/block', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const user = await User.findByPk(req.params.id);
        if (!user) return res.status(404).json({ message: 'Пользователь не найден' });

        user.role = 'banned';
        await user.save();

        res.json({ message: 'Пользователь заблокирован', user });
    } catch (error) {
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

router.put('/users/:id/unblock', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const user = await User.findByPk(req.params.id);
        if (!user) return res.status(404).json({ message: 'Пользователь не найден' });

        user.role = 'user'; // Меняем статус на обычного пользователя
        await user.save();

        res.json({ message: 'Пользователь разблокирован', user });
    } catch (error) {
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

router.put("/users/:id/role", authMiddleware, adminMiddleware, async (req, res) => {
        try {
            const userId = req.params.id;
            const { role } = req.body;

            if (!["user", "admin"].includes(role)) {
                return res.status(400).json({
                    message: "Недопустимая роль",
                });
            }

            const user = await User.findByPk(userId);

            if (!user) {
                return res.status(404).json({
                    message: "Пользователь не найден",
                });
            }

            if (user.role === "banned") {
                return res.status(400).json({
                    message:
                        "Сначала разблокируйте пользователя",
                });
            }

            user.role = role;

            await user.save();

            return res.json({
                success: true,
                message:
                    role === "admin"
                        ? "Права администратора выданы"
                        : "Права администратора сняты",

                user: {
                    id: user.id,
                    role: user.role,
                },
            });
        } catch (error) {
            console.error(
                "Ошибка изменения роли пользователя:",
                error
            );

            return res.status(500).json({
                message:
                    "Ошибка изменения роли пользователя",
            });
        }
    });

router.put("/users/:id/premium", authMiddleware, adminMiddleware, async (req, res) => {
        try {
            const userId = req.params.id;
            const days = Number(req.body.days);

            if (![7, 30].includes(days)) {
                return res.status(400).json({
                    message:
                        "Премиум можно выдать только на 7 или 30 дней",
                });
            }

            const user = await User.findByPk(userId);

            if (!user) {
                return res.status(404).json({
                    message: "Пользователь не найден",
                });
            }

            /*
             * Если премиум уже активен —
             * продлеваем от существующей даты.
             *
             * Если отсутствует или закончился —
             * считаем от текущего момента.
             */

            const now = new Date();

            let startDate = now;

            if (
                user.subscription_type === "premium" &&
                user.subscription_expires_at
            ) {
                const currentExpiration =
                    new Date(
                        user.subscription_expires_at
                    );

                if (
                    !Number.isNaN(
                        currentExpiration.getTime()
                    ) &&
                    currentExpiration > now
                ) {
                    startDate =
                        currentExpiration;
                }
            }

            const expiresAt =
                new Date(
                    startDate.getTime() +
                    days *
                    24 *
                    60 *
                    60 *
                    1000
                );

            user.subscription_type =
                "premium";

            user.subscription_expires_at =
                expiresAt;

            await user.save();

            return res.json({
                success: true,
                message: `Премиум выдан на ${days} дней`,
                user: {
                    id: user.id,
                    subscription_type:
                    user.subscription_type,
                    subscription_expires_at:
                    user.subscription_expires_at,
                },
            });
        } catch (error) {
            console.error(
                "Ошибка ручной выдачи премиума:",
                error
            );

            return res.status(500).json({
                message:
                    "Ошибка выдачи премиума",
            });
        }
    });

router.delete("/users/:id/premium", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const user = await User.findByPk(req.params.id);

        if (!user) {
            return res.status(404).json({
                message: "Пользователь не найден",
            });
        }

        user.subscription_type = "standard";
        user.subscription_expires_at = null;

        await user.save();

        return res.json({
            success: true,
            message: "Премиум снят",
            user: {
                id: user.id,
                subscription_type: user.subscription_type,
                subscription_expires_at: user.subscription_expires_at,
            },
        });
    } catch (error) {
        console.error("Ошибка снятия премиума:", error);

        return res.status(500).json({
            message: "Ошибка снятия премиума",
            error: error.message,
        });
    }
});

router.get("/orders", authMiddleware, adminMiddleware, async (req, res) => {
        try {
            const orders =
                await Order.findAll({
                    include: [
                        {
                            model: Category,
                            as: "category",
                            attributes: [
                                "id",
                                "name",
                            ],
                        },
                        {
                            model: Subcategory,
                            as: "subcategory",
                            attributes: [
                                "id",
                                "name",
                                "code",
                            ],
                        },
                        {
                            model: Service,
                            as: "service",
                            attributes: [
                                "id",
                                "name",
                            ],
                        },
                        {
                            model: User,
                            as: "creator",
                            attributes: [
                                "id",
                                "username",
                                "phone",
                            ],
                        },
                        {
                            model: User,
                            as: "executor",
                            attributes: [
                                "id",
                                "username",
                                "phone",
                            ],
                            required: false,
                        },
                        {
                            model: Dispute,
                            as: "disputes",
                            required: false,
                        },
                    ],

                    order: [
                        ["createdAt", "DESC"],
                    ],
                });

            const result =
                orders.map((order) => {
                    const plain =
                        order.toJSON();

                    const disputes =
                        Array.isArray(
                            plain.disputes
                        )
                            ? plain.disputes
                            : [];

                    const activeDispute =
                        disputes.find(
                            (dispute) =>
                                [
                                    "open",
                                    "in_review",
                                    "waiting_creator",
                                    "waiting_executor",
                                ].includes(
                                    dispute.status
                                )
                        ) || null;

                    return {
                        ...plain,

                        activeDispute,

                        isHiddenByCreator:
                            Boolean(
                                plain.creatorHidden
                            ),
                    };
                });

            return res.json(result);
        } catch (error) {
            console.error(
                "Ошибка загрузки заказов:",
                error
            );

            return res.status(500).json({
                message: "Ошибка сервера",
            });
        }
    });

router.delete("/orders/:id", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const order = await Order.findByPk(req.params.id);

        if (!order) {
            await req.logAction?.({
                req,
                actorUserId: req.user?.id || null,
                actorRole: "admin",
                actionType: "admin_order_delete_failed",
                entityType: "order",
                entityId: Number(req.params.id),
                orderId: Number(req.params.id),
                severity: "warn",
                success: false,
                meta: {
                    reason: "order_not_found",
                },
            });

            return res.status(404).json({ message: "Заказ не найден" });
        }

        if (order.adminDeleted) {
            return res.status(400).json({
                message: "Заказ уже помечен как удалённый админом",
            });
        }

        const before = {
            status: order.status,
            creatorHidden: order.creatorHidden,
            creatorHiddenAt: order.creatorHiddenAt,
            adminDeleted: order.adminDeleted,
            adminDeletedAt: order.adminDeletedAt,
            adminDeletedById: order.adminDeletedById,
        };

        order.adminDeleted = true;
        order.adminDeletedAt = new Date();
        order.adminDeletedById = req.user?.id || null;

        await order.save();

        await req.logAction?.({
            req,
            actorUserId: req.user?.id || null,
            actorRole: "admin",
            actionType: "admin_order_soft_deleted",
            entityType: "order",
            entityId: order.id,
            orderId: order.id,
            severity: "warn",
            success: true,
            meta: {
                before,
                after: {
                    status: order.status,
                    creatorHidden: order.creatorHidden,
                    creatorHiddenAt: order.creatorHiddenAt,
                    adminDeleted: order.adminDeleted,
                    adminDeletedAt: order.adminDeletedAt,
                    adminDeletedById: order.adminDeletedById,
                },
            },
        });

        req.app.locals.io?.emit("orderUpdated", {
            orderId: order.id,
            creatorId: order.creatorId,
            action: "admin_soft_deleted",
        });

        res.json({
            success: true,
            message: "Заказ помечен как удалённый админом",
            order,
        });
    } catch (error) {
        console.error("Ошибка удаления заказа админом:", error);

        await req.logAction?.({
            req,
            actorUserId: req.user?.id || null,
            actorRole: "admin",
            actionType: "admin_order_delete_failed",
            entityType: "order",
            entityId: Number(req.params.id),
            orderId: Number(req.params.id),
            severity: "error",
            success: false,
            meta: {
                error: String(error?.message || error),
            },
        });

        res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.patch("/orders/:id/restore", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const order = await Order.findByPk(req.params.id);

        if (!order) {
            return res.status(404).json({ message: "Заказ не найден" });
        }

        const before = {
            creatorHidden: order.creatorHidden,
            creatorHiddenAt: order.creatorHiddenAt,
            adminDeleted: order.adminDeleted,
            adminDeletedAt: order.adminDeletedAt,
            adminDeletedById: order.adminDeletedById,
        };

        order.creatorHidden = false;
        order.creatorHiddenAt = null;
        order.adminDeleted = false;
        order.adminDeletedAt = null;
        order.adminDeletedById = null;

        await order.save();

        await req.logAction?.({
            req,
            actorUserId: req.user?.id || null,
            actorRole: "admin",
            actionType: "admin_order_restored",
            entityType: "order",
            entityId: order.id,
            orderId: order.id,
            severity: "info",
            success: true,
            meta: {
                before,
                after: {
                    creatorHidden: order.creatorHidden,
                    creatorHiddenAt: order.creatorHiddenAt,
                    adminDeleted: order.adminDeleted,
                    adminDeletedAt: order.adminDeletedAt,
                    adminDeletedById: order.adminDeletedById,
                },
            },
        });

        req.app.locals.io?.emit("orderUpdated", {
            orderId: order.id,
            creatorId: order.creatorId,
            action: "admin_restored",
        });

        res.json({
            success: true,
            message: "Заказ восстановлен",
            order,
        });
    } catch (error) {
        console.error("Ошибка восстановления заказа:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    try {
        // Находим пользователя по номеру телефона
        const user = await User.findOne({ where: { phone } });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Проверка пароля
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid password' });
        }

        // Проверка, является ли пользователь администратором
        if (user.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied: You are not an admin' });
        }

        // Создание JWT токена для администратора
        const token = jwt.sign({ id: user.id, phone: user.phone, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });

        // Возвращаем токен и информацию о пользователе
        res.json({
            token,
            user: { id: user.id, username: user.username, phone: user.phone, role: user.role, rating: user.rating || 5 }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get("/orders/:orderId/messages", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { orderId } = req.params;
        // Получаем все сообщения для этого заказа
        const messages = await Message.findAll({
            where: { orderId },
            order: [['createdAt', 'ASC']], // Сортировка по времени создания
            include: [
                {
                    model: User,
                    as: 'sender',
                    attributes: ['username']
                }
            ]
        });

        res.json(messages);
    } catch (error) {
        console.error("Ошибка получения сообщений:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.get("/orders/:id", authMiddleware, adminMiddleware, async (req, res) => {
        const orderId = Number(req.params.id);

        if (
            !Number.isFinite(orderId) ||
            orderId <= 0
        ) {
            return res.status(400).json({
                message: "Некорректный ID заказа",
            });
        }

        try {
            const order = await Order.findOne({
                where: {
                    id: orderId,
                },

                include: [
                    {
                        model: Category,
                        as: "category",
                        attributes: [
                            "id",
                            "name",
                        ],
                    },
                    {
                        model: Subcategory,
                        as: "subcategory",
                        attributes: [
                            "id",
                            "name",
                            "code",
                        ],
                    },
                    {
                        model: Service,
                        as: "service",
                        attributes: [
                            "id",
                            "name",
                        ],
                    },
                    {
                        model: User,
                        as: "creator",
                        attributes: [
                            "id",
                            "username",
                            "phone",
                            "rating",
                        ],
                    },
                    {
                        model: User,
                        as: "executor",
                        attributes: [
                            "id",
                            "username",
                            "phone",
                            "rating",
                        ],
                        required: false,
                    },
                    {
                        model: Dispute,
                        as: "disputes",
                        required: false,
                    },
                ],

                order: [
                    [
                        {
                            model: Dispute,
                            as: "disputes",
                        },
                        "createdAt",
                        "DESC",
                    ],
                ],
            });

            if (!order) {
                return res.status(404).json({
                    message: "Заказ не найден",
                });
            }

            const plain = order.toJSON();

            return res.json({
                ...plain,

                serviceDetails:
                    plain.serviceDetails &&
                    typeof plain.serviceDetails === "object"
                        ? plain.serviceDetails
                        : null,
            });
        } catch (error) {
            console.error(
                "Ошибка получения заказа:",
                error
            );

            return res.status(500).json({
                message: "Ошибка сервера",
            });
        }
    });

router.get("/users/:id/complaints", authMiddleware, adminMiddleware, async (req, res) => {
    const { id } = req.params;

    try {
        const user = await User.findByPk(id);

        if (!user) {
            return res.status(404).json({ message: "Пользователь не найден" });
        }

        res.json({
            id: user.id,
            username: user.username,
            phone: user.phone,
            complaints: user.complaints || [],
        });
    } catch (error) {
        console.error("Ошибка при получении пользователя:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.get("/users/:userId/orders", authMiddleware, adminMiddleware, async (req, res) => {
        try {
            const userId =
                Number(
                    req.params.userId
                );

            if (
                !Number.isInteger(userId) ||
                userId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Некорректный userId",
                });
            }

            const user =
                await User.findByPk(
                    userId,
                    {
                        attributes: [
                            "id",
                            "username",
                            "phone",
                            "role",
                            "userStatus",
                        ],
                    }
                );

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Пользователь не найден",
                });
            }

            const orders =
                await Order.findAll({
                    where: {
                        [Op.or]: [
                            {
                                creatorId:
                                userId,
                            },
                            {
                                userId,
                            },
                        ],
                    },

                    include: [
                        {
                            model: Category,
                            as: "category",
                            attributes: [
                                "id",
                                "name",
                            ],
                        },
                        {
                            model: Subcategory,
                            as: "subcategory",
                            attributes: [
                                "id",
                                "name",
                                "code",
                            ],
                        },
                        {
                            model: Service,
                            as: "service",
                            attributes: [
                                "id",
                                "name",
                            ],
                        },
                        {
                            model: User,
                            as: "executor",
                            attributes: [
                                "id",
                                "username",
                                "phone",
                            ],
                            required: false,
                        },
                        {
                            model: Dispute,
                            as: "disputes",
                            required: false,
                        },
                    ],

                    order: [
                        ["createdAt", "DESC"],
                    ],
                });

            const normalizedOrders =
                orders.map((order) => {
                    const plain =
                        order.toJSON();

                    const disputes =
                        Array.isArray(
                            plain.disputes
                        )
                            ? plain.disputes
                            : [];

                    const activeDispute =
                        disputes.find(
                            (dispute) =>
                                [
                                    "open",
                                    "in_review",
                                    "waiting_creator",
                                    "waiting_executor",
                                ].includes(
                                    dispute.status
                                )
                        ) || null;

                    return {
                        ...plain,
                        activeDispute,
                    };
                });

            return res.json({
                success: true,
                user,
                orders:
                normalizedOrders,
            });
        } catch (error) {
            console.error(
                "Ошибка получения заказов пользователя:",
                error
            );

            return res.status(500).json({
                success: false,
                message: "Ошибка сервера",
            });
        }
    });

router.get("/action-logs", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const {
            orderId,
            expressOrderId,
            actorUserId,
            actionType,
            severity,
            paymentId,
            dateFrom,
            dateTo,
            limit = 50,
            offset = 0,
        } = req.query;

        const where = {};

        if (orderId) where.orderId = Number(orderId);
        if (expressOrderId) where.expressOrderId = Number(expressOrderId);
        if (actorUserId) where.actorUserId = Number(actorUserId);
        if (actionType) where.actionType = String(actionType);
        if (severity) where.severity = String(severity);
        if (paymentId) where.paymentId = String(paymentId);

        if (dateFrom || dateTo) {
            where.ts = {};
            if (dateFrom) where.ts[Op.gte] = new Date(dateFrom);
            if (dateTo) where.ts[Op.lte] = new Date(dateTo);
        }

        const rows = await ActionLog.findAll({
            where,
            order: [["ts", "DESC"]],
            limit: Math.min(Number(limit) || 50, 200),
            offset: Number(offset) || 0,
        });

        res.json({ success: true, rows });
    } catch (e) {
        console.error("admin/action-logs error:", e);
        res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

router.get("/orders/:id/logs", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const id = Number(req.params.id);
        const rows = await ActionLog.findAll({
            where: { orderId: id },
            order: [["ts", "DESC"]],
            limit: 500,
        });
        res.json({ success: true, rows });
    } catch (e) {
        res.status(500).json({ success: false, message: "Ошибка сервера" });
    }
});

router.patch('/disputes/:id/status', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const disputeId = Number(req.params.id);
        const { status } = req.body;

        const allowedStatuses = ['open', 'in_review', 'waiting_creator', 'waiting_executor', 'resolved', 'closed'];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ message: 'Недопустимый статус спора' });
        }

        const dispute = await Dispute.findByPk(disputeId);

        if (!dispute) {
            return res.status(404).json({ message: 'Спор не найден' });
        }

        if (dispute.status === status) {
            return res.status(400).json({
                message: 'У спора уже такой статус'
            });
        }

        if (dispute.status === 'resolved' || dispute.status === 'closed') {
            return res.status(400).json({
                message: 'Нельзя изменить уже завершённый спор'
            });
        }

        if (
            dispute.takenByAdminId &&
            dispute.takenByAdminId !== req.user.id
        ) {
            return res.status(403).json({
                message: `Этот спор уже взят в работу другим администратором (ID: ${dispute.takenByAdminId})`
            });
        }

        const oldStatus = dispute.status;

        if (status === 'in_review') {
            dispute.status = 'in_review';

            if (!dispute.takenByAdminId) {
                dispute.takenByAdminId = req.user.id;
                dispute.takenAt = new Date();
            }
        } else {
            dispute.status = status;
        }

        await dispute.save();

        await ActionLog.create({
            entityType: 'dispute',
            entityId: dispute.id,
            orderId: dispute.orderId,
            actorUserId: req.user.id,
            actorRole: 'admin',
            actionType: 'dispute_status_changed',
            severity: 'info',
            success: true,
            reason: `Статус спора изменён: ${oldStatus} -> ${status}`,
            ts: new Date(),
            meta: {
                disputeId: dispute.id,
                oldStatus,
                newStatus: status,
                takenByAdminId: dispute.takenByAdminId || null,
                takenAt: dispute.takenAt || null,
            }
        });

        res.json({
            success: true,
            message: 'Статус спора обновлён',
            dispute
        });
    } catch (e) {
        console.error('Ошибка изменения статуса спора:', e);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

router.patch('/disputes/:id/resolve', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const disputeId = Number(req.params.id);
        const { resolution } = req.body;

        if (!resolution || !String(resolution).trim()) {
            return res.status(400).json({ message: 'Нужно указать решение по спору' });
        }

        const dispute = await Dispute.findByPk(disputeId);

        if (!dispute) {
            return res.status(404).json({ message: 'Спор не найден' });
        }

        if (dispute.status !== 'in_review') {
            return res.status(400).json({
                message: 'Решить можно только спор, который уже взят в работу'
            });
        }

        if (!dispute.takenByAdminId) {
            return res.status(400).json({
                message: 'У спора не указан администратор, который взял его в работу'
            });
        }

        if (dispute.takenByAdminId !== req.user.id) {
            return res.status(403).json({
                message: `Этот спор находится в работе у другого администратора (ID: ${dispute.takenByAdminId})`
            });
        }

        dispute.resolution = String(resolution).trim();
        dispute.status = 'resolved';
        dispute.resolvedById = req.user.id;
        dispute.resolvedAt = new Date();

        await dispute.save();

        await ActionLog.create({
            entityType: 'dispute',
            entityId: dispute.id,
            orderId: dispute.orderId,
            actorUserId: req.user.id,
            actorRole: 'admin',
            actionType: 'dispute_resolved',
            severity: 'info',
            success: true,
            reason: dispute.resolution,
            ts: new Date(),
            meta: {
                disputeId: dispute.id,
                resolution: dispute.resolution,
                takenByAdminId: dispute.takenByAdminId || null,
                resolvedById: dispute.resolvedById || null,
            }
        });

        res.json({
            success: true,
            message: 'Спор решён',
            dispute
        });
    } catch (e) {
        console.error('Ошибка решения спора:', e);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

router.get('/disputes', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const disputes = await Dispute.findAll({
            order: [['createdAt', 'DESC']]
        });

        res.json({ success: true, disputes });
    } catch (e) {
        console.error('Ошибка получения споров:', e);
        res.status(500).json({ success: false, message: 'Ошибка сервера' });
    }
});

router.get("/express-orders", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const orders = await ExpressOrder.findAll({
            order: [["created_at", "DESC"]],
            limit: 300,
        });

        res.json(orders);
    } catch (error) {
        console.error("Ошибка загрузки экспресс-заказов для админа:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.get("/express-orders/:id", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const id = Number(req.params.id);

        if (!Number.isFinite(id) || id <= 0) {
            return res.status(400).json({ message: "Некорректный id express-заказа" });
        }

        const order = await ExpressOrder.findByPk(id);

        if (!order) {
            return res.status(404).json({ message: "Экспресс-заказ не найден" });
        }

        res.json(order);
    } catch (error) {
        console.error("Ошибка загрузки express-заказа для админа:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.get("/express-orders/:id/logs", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const expressOrderId = Number(req.params.id);

        if (!Number.isFinite(expressOrderId) || expressOrderId <= 0) {
            return res.status(400).json({ message: "Некорректный id express-заказа" });
        }

        const rows = await ActionLog.findAll({
            where: {
                [Op.or]: [
                    { expressOrderId },
                    {
                        entityType: "express_order",
                        entityId: expressOrderId,
                    },
                ],
            },
            order: [["ts", "DESC"]],
            limit: 300,
        });

        res.json({ success: true, rows });
    } catch (error) {
        console.error("Ошибка загрузки логов express-заказа:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.put("/users/:id/vehicle-verification", authMiddleware, adminMiddleware, async (req, res) => {
        try {
            const userId = Number(req.params.id);

            const {
                status,
                note,
            } = req.body;

            if (
                !Number.isFinite(userId) ||
                userId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Некорректный ID пользователя",
                });
            }

            if (
                !["verified", "rejected"].includes(status)
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Допустимые статусы: verified или rejected",
                });
            }

            const user = await User.findByPk(userId);

            if (!user) {
                return res.status(404).json({
                    success: false,
                    message: "Пользователь не найден",
                });
            }

            /*
             * Одобрить машину можно только если
             * основные обязательные данные заполнены.
             */
            const requiredVehicleFields = [
                user.vehicleBrand,
                user.vehicleModel,
                user.vehicleColor,
                user.vehiclePlate,
            ];

            const hasAllRequiredVehicleData =
                requiredVehicleFields.every(
                    (value) =>
                        String(value || "").trim().length > 0
                );

            if (!hasAllRequiredVehicleData) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Нельзя подтвердить автомобиль: не заполнены обязательные данные",
                });
            }

            if (status === "rejected") {
                const cleanNote =
                    String(note || "").trim();

                if (cleanNote.length < 3) {
                    return res.status(400).json({
                        success: false,
                        message:
                            "Укажите причину отклонения автомобиля",
                    });
                }

                user.vehicleVerificationStatus =
                    "rejected";

                user.vehicleVerificationNote =
                    cleanNote;
            } else {
                user.vehicleVerificationStatus =
                    "verified";

                user.vehicleVerificationNote =
                    null;
            }

            await user.save();

            try {
                if (status === "verified") {
                    await notifyUser({
                        userId: user.id,

                        type: "vehicle_verification",

                        title: "Автомобиль подтверждён",

                        body:
                            "Ваш автомобиль прошёл проверку. Теперь вы можете принимать заказы такси.",

                        orderType: "regular",

                        data: {
                            vehicleVerificationStatus:
                                "verified",

                            vehicleBrand:
                            user.vehicleBrand,

                            vehicleModel:
                            user.vehicleModel,

                            vehicleColor:
                            user.vehicleColor,

                            vehiclePlate:
                            user.vehiclePlate,
                        },
                    });
                }

                if (status === "rejected") {
                    await notifyUser({
                        userId: user.id,

                        type: "vehicle_verification",

                        title:
                            "Автомобиль не прошёл проверку",

                        body:
                            user.vehicleVerificationNote
                                ? `Причина: ${user.vehicleVerificationNote}`
                                : "Проверьте данные автомобиля и отправьте их повторно.",

                        orderType: "regular",

                        data: {
                            vehicleVerificationStatus:
                                "rejected",

                            vehicleVerificationNote:
                                user.vehicleVerificationNote || null,

                            vehicleBrand:
                            user.vehicleBrand,

                            vehicleModel:
                            user.vehicleModel,

                            vehicleColor:
                            user.vehicleColor,

                            vehiclePlate:
                            user.vehiclePlate,
                        },
                    });
                }
            } catch (notifyError) {
                console.error(
                    "vehicle verification notify error:",
                    notifyError
                );
            }

            return res.json({
                success: true,

                message:
                    status === "verified"
                        ? "Автомобиль подтверждён"
                        : "Автомобиль отклонён",

                user: {
                    id: user.id,

                    vehicleBrand:
                    user.vehicleBrand,

                    vehicleModel:
                    user.vehicleModel,

                    vehicleColor:
                    user.vehicleColor,

                    vehiclePlate:
                    user.vehiclePlate,

                    vehicleYear:
                    user.vehicleYear,

                    vehiclePhoto:
                    user.vehiclePhoto,

                    vehicleVerificationStatus:
                    user.vehicleVerificationStatus,

                    vehicleVerificationNote:
                    user.vehicleVerificationNote,
                },
            });
        } catch (error) {
            console.error(
                "Ошибка проверки автомобиля:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Не удалось изменить статус проверки автомобиля",
            });
        }
    });

router.delete("/users/:id/vehicle", authMiddleware, adminMiddleware, async (req, res) => {
        try {
            const user =
                await User.findByPk(
                    req.params.id
                );

            if (!user) {
                return res
                    .status(404)
                    .json({
                        success: false,
                        message:
                            "Пользователь не найден",
                    });
            }

            user.vehicleBrand = null;
            user.vehicleModel = null;
            user.vehicleColor = null;
            user.vehiclePlate = null;
            user.vehicleYear = null;
            user.vehiclePhoto = null;

            user.vehicleVerificationStatus =
                "none";

            user.vehicleVerificationNote =
                null;

            await user.save();

            return res.json({
                success: true,

                message:
                    "Автомобиль удалён",

                user: {
                    id: user.id,

                    vehicleBrand:
                    user.vehicleBrand,

                    vehicleModel:
                    user.vehicleModel,

                    vehicleColor:
                    user.vehicleColor,

                    vehiclePlate:
                    user.vehiclePlate,

                    vehicleYear:
                    user.vehicleYear,

                    vehiclePhoto:
                    user.vehiclePhoto,

                    vehicleVerificationStatus:
                    user.vehicleVerificationStatus,

                    vehicleVerificationNote:
                    user.vehicleVerificationNote,
                },
            });
        } catch (error) {
            console.error(
                "admin remove vehicle error:",
                error
            );

            return res
                .status(500)
                .json({
                    success: false,
                    message:
                        "Не удалось удалить автомобиль",
                });
        }
    });

module.exports = router;
