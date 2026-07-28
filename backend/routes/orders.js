const { v4: uuidv4 } = require("uuid");
const express = require('express');
const router = express.Router();
const NodeGeocoder = require('node-geocoder');
const db = require('../models');
const { notifyUser, notifyMany } = require("../services/notificationService");
const authenticateToken = require('../middlewares/userAuth');
const { Op } = require('sequelize');
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { Order, User, Category, Subcategory, ExpressOrder } = require('../models');
const generateContractPDF = require('../utils/generateContractPDF');
const yooKassa = require('../config/yookassaClient');
const uploadExecutorBefore = buildOrderPhotoUploader("executor_before");
const uploadExecutorAfter = buildOrderPhotoUploader("executor_after");
const uploadCustomerBefore = buildOrderPhotoUploader("customer_before");
const uploadCustomerAfter = buildOrderPhotoUploader("customer_after");
const { sendNotifications } = require("../socket");
const { calculateRecommendedPrice } = require("../services/recommendedPriceService");

/* ===============================
   Папки uploads
================================ */

const {
    uploadsRoot,
    ordersRoot,
    tempRoot,
    contractsRoot,
    ensureDirectory,
} = require("../config/storagePaths");

const uploadDocumentRoot =
    path.resolve(__dirname, "..", "upload-document");

ensureDirectory(uploadDocumentRoot);

/* ===============================
   MULTER для создания заказа
   (временная папка)
================================ */

const tempStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, tempRoot);
    },

    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || ".jpg";
        const random = Math.round(Math.random() * 1e9);
        cb(null, `temp_${Date.now()}_${random}${ext}`);
    },
});

const upload = multer({ storage: tempStorage });

/* ===============================
   MULTER для фото заказа
================================ */

function buildOrderPhotoUploader(type) {

    const storage = multer.diskStorage({

        destination: (req, file, cb) => {
            try {

                const orderId = req.params.id;

                const dir = path.join(
                    ordersRoot,
                    `order_${orderId}`
                );

                ensureDirectory(dir);

                cb(null, dir);

            } catch (err) {
                cb(err);
            }
        },

        filename: (req, file, cb) => {

            try {

                const orderId = req.params.id;

                const dir = path.join(
                    ordersRoot,
                    `order_${orderId}`
                );

                ensureDirectory(dir);

                const ext = path.extname(file.originalname) || ".jpg";

                const existing = fs
                    .readdirSync(dir)
                    .filter(name => name.startsWith(type));

                const nextIndex = existing.length + 1;

                cb(null, `${type}_${nextIndex}${ext}`);

            } catch (err) {
                cb(err);
            }

        },

    });

    return multer({ storage });

}

const geocoder = NodeGeocoder({
    provider: 'yandex',
    apiKey: process.env.YANDEX_API_KEY,
    lang: 'ru-RU'
});

function safeJsonArray(value) {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value !== "string") return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

async function hasBusyRegularOrder(Order, executorId, excludeOrderId = null) {
    const where = {
        executorId,
        status: {
            [Op.notIn]: ["completed", "cancelled", "expired"],
        },
    };

    if (excludeOrderId) {
        where.id = { [Op.ne]: excludeOrderId };
    }

    const busyOrder = await Order.findOne({ where });
    return !!busyOrder;
}

async function hasBusyTaxiOrder(ExpressOrder, executorId) {
    if (!ExpressOrder) return false;

    const busyTaxi = await ExpressOrder.findOne({
        where: {
            executorId,
            type: "taxi",
            status: {
                [Op.notIn]: ["completed", "cancelled"],
            },
        },
    });

    return !!busyTaxi;
}

async function removeExecutorFromOtherPendingOrders(Order, executorId, approvedOrderId) {
    const orders = await Order.findAll({
        where: {
            id: { [Op.ne]: approvedOrderId },
            status: "pending",
        },
    });

    const updatedOrderIds = [];

    for (const order of orders) {
        let requestedExecutors = safeJsonArray(order.requestedExecutors);
        let requests = safeJsonArray(order.requests);

        const beforeRequestedLen = requestedExecutors.length;
        const beforeRequestsLen = requests.length;

        requestedExecutors = requestedExecutors.filter(id => Number(id) !== Number(executorId));
        requests = requests.filter(r => Number(r.executorId) !== Number(executorId));

        const changed =
            requestedExecutors.length !== beforeRequestedLen ||
            requests.length !== beforeRequestsLen;

        if (changed) {
            order.requestedExecutors = JSON.stringify(requestedExecutors);
            order.requests = JSON.stringify(requests);
            await order.save();
            updatedOrderIds.push(order.id);
        }
    }

    return updatedOrderIds;
}

function cleanPhoneForPayment(phone) {
    return String(phone || "").replace(/[^\d+]/g, "");
}

function sanitizeServiceDetails(value, depth = 0) {
    if (depth > 3) {
        return null;
    }

    if (value === null) {
        return null;
    }

    if (typeof value === "string") {
        return value.trim().slice(0, 1000);
    }

    if (typeof value === "number") {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value === "boolean") {
        return value;
    }

    if (Array.isArray(value)) {
        return value
            .slice(0, 30)
            .map((item) =>
                sanitizeServiceDetails(item, depth + 1)
            );
    }

    if (typeof value === "object") {
        const result = {};

        Object.entries(value)
            .slice(0, 50)
            .forEach(([key, item]) => {
                const safeKey = String(key)
                    .replace(/[^a-zA-Z0-9А-Яа-яЁё_-]/g, "")
                    .slice(0, 80);

                if (!safeKey) return;

                result[safeKey] =
                    sanitizeServiceDetails(item, depth + 1);
            });

        return result;
    }

    return null;
}

function isValidLatLngObject(value) {
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
    ) {
        return false;
    }

    const lat = Number(value.lat);
    const lng = Number(value.lng);

    if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng)
    ) {
        return false;
    }

    if (lat < -90 || lat > 90) {
        return false;
    }

    if (lng < -180 || lng > 180) {
        return false;
    }

    if (
        Math.abs(lat) < 0.000001 &&
        Math.abs(lng) < 0.000001
    ) {
        return false;
    }

    return true;
}

function calculateStraightDistanceKm(
    startLat,
    startLng,
    endLat,
    endLng
) {
    const lat1 = Number(startLat);
    const lng1 = Number(startLng);
    const lat2 = Number(endLat);
    const lng2 = Number(endLng);

    if (
        !Number.isFinite(lat1) ||
        !Number.isFinite(lng1) ||
        !Number.isFinite(lat2) ||
        !Number.isFinite(lng2)
    ) {
        return null;
    }

    const earthRadiusKm = 6371;

    const toRadians = (degrees) =>
        degrees * (Math.PI / 180);

    const deltaLat =
        toRadians(lat2 - lat1);

    const deltaLng =
        toRadians(lng2 - lng1);

    const a =
        Math.sin(deltaLat / 2) ** 2 +
        Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(deltaLng / 2) ** 2;

    const c =
        2 *
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );

    return (
        Math.round(
            earthRadiusKm * c * 10
        ) / 10
    );
}

async function tryPayCommissionFromSavedCard({ req, executor, order, amountKopecks }) {
    if (!executor.yookassa_payment_method_id) {
        return {
            autoPaymentTried: false,
            autoPaymentPaid: false,
            autoPaymentProcessing: false,
            autoPaymentStatus: null,
            paymentId: null,
            message: "Карта не привязана.",
        };
    }

    const amountValue = (Number(amountKopecks || 0) / 100).toFixed(2);

    try {
        const payment = await yooKassa.createPayment(
            {
                amount: {
                    value: amountValue,
                    currency: "RUB",
                },
                capture: true,
                payment_method_id: executor.yookassa_payment_method_id,
                description: `Комиссия CargoCamp за заказ #${order.id}`,
                metadata: {
                    type: "debt",
                    userId: String(executor.id),
                    orderId: String(order.id),
                    expectedKopecks: String(amountKopecks),
                    source: "order_approve_auto",
                },
                receipt: {
                    customer: {
                        phone: cleanPhoneForPayment(executor.phone),
                    },
                    items: [
                        {
                            description: `Комиссия CargoCamp за заказ #${order.id}`,
                            quantity: 1,
                            amount: {
                                value: amountValue,
                                currency: "RUB",
                            },
                            vat_code: 1,
                            payment_mode: "full_payment",
                            payment_subject: "service",
                        },
                    ],
                    tax_system_code: 2,
                },
            },
            uuidv4()
        );

        await req.logAction?.({
            req,
            actorUserId: executor.id,
            actorRole: "user",
            actionType: "commission_auto_payment_create",
            entityType: "payment",
            paymentId: payment.id,
            orderId: order.id,
            severity: payment.status === "canceled" ? "warn" : "info",
            meta: {
                provider: "yookassa",
                type: "debt",
                source: "order_approve_auto",
                amount: amountValue,
                status: payment.status,
            },
        });

        if (payment.status === "canceled") {
            return {
                autoPaymentTried: true,
                autoPaymentPaid: false,
                autoPaymentProcessing: false,
                autoPaymentStatus: payment.status,
                paymentId: payment.id,
                message:
                    "Автоматическое списание не прошло. Комиссия осталась в задолженности.",
            };
        }

        return {
            autoPaymentTried: true,
            autoPaymentPaid: payment.status === "succeeded",
            autoPaymentProcessing: payment.status !== "succeeded",
            autoPaymentStatus: payment.status,
            paymentId: payment.id,
            message:
                payment.status === "succeeded"
                    ? "Комиссия списана с привязанной карты."
                    : "Пробуем списать комиссию с привязанной карты.",
        };
    } catch (e) {
        console.error("commission auto payment error:", e);

        await req.logAction?.({
            req,
            actorUserId: executor.id,
            actorRole: "user",
            actionType: "commission_auto_payment_error",
            entityType: "payment",
            orderId: order.id,
            severity: "warn",
            meta: {
                provider: "yookassa",
                amount: amountValue,
                error: e?.message,
            },
        });

        return {
            autoPaymentTried: true,
            autoPaymentPaid: false,
            autoPaymentProcessing: false,
            autoPaymentStatus: "error",
            paymentId: null,
            message:
                "Автоматическое списание не удалось. Комиссия осталась в задолженности.",
        };
    }
}

module.exports = (io) => {

    router.post('/:id/restore', authenticateToken, async (req, res) => {
        const { id } = req.params;

        try {
            const order = await Order.findByPk(id);
            if (!order || order.status !== 'expired') {
                return res.status(404).json({ success: false, error: 'Заказ не найден или не может быть восстановлен' });
            }

            order.status = 'pending';
            order.createdAt = new Date();

            await Order.update(
                { status: 'pending', createdAt: new Date(), updatedAt: new Date() },
                { where: { id } }
            );

            await logAction({
                req,
                actorUserId: req.user?.id || null,
                actorRole: "user",
                actionType: "order_restore",
                entityType: "order",
                entityId: Number(id),
                orderId: Number(id),
                meta: { newStatus: "pending" },
            });

            res.json({ success: true, message: 'Заказ восстановлен' });

        } catch (error) {
            console.error("Ошибка при восстановлении заказа:", error);
            res.status(500).json({ success: false, error: 'Ошибка сервера' });
        }
    });

    router.post("/", authenticateToken, upload.array("images", 5), async (req, res) => {
        try {
            let {
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
                promotion,
                paymentType,
            } = req.body;

            const userId = req.user.id;

            const PROMOTION_PRICES = { highlight: 50, recommended: 100, push: 150 };

            // promotion
            let parsedPromotion = {};
            try {
                parsedPromotion = JSON.parse(promotion || "{}");
            } catch (e) {
                parsedPromotion = {};
            }

            let parsedServiceDetails = {};

            try {
                if (typeof serviceDetails === "string") {
                    parsedServiceDetails = JSON.parse(serviceDetails || "{}");
                } else if (
                    serviceDetails &&
                    typeof serviceDetails === "object" &&
                    !Array.isArray(serviceDetails)
                ) {
                    parsedServiceDetails = serviceDetails;
                }
            } catch (e) {
                return res.status(400).json({
                    message: "Некорректные дополнительные параметры услуги",
                });
            }

            if (
                !parsedServiceDetails ||
                typeof parsedServiceDetails !== "object" ||
                Array.isArray(parsedServiceDetails)
            ) {
                return res.status(400).json({
                    message: "Дополнительные параметры услуги должны быть объектом",
                });
            }

            parsedServiceDetails =
                sanitizeServiceDetails(parsedServiceDetails);

            const serviceDetailsSize = Buffer.byteLength(
                JSON.stringify(parsedServiceDetails),
                "utf8"
            );

            if (serviceDetailsSize > 20000) {
                return res.status(400).json({
                    message: "Слишком большой объём дополнительных параметров заказа",
                });
            }

            delete parsedServiceDetails.recommendedPrice;
            delete parsedServiceDetails.recommendedPriceMin;
            delete parsedServiceDetails.recommendedPriceMax;
            delete parsedServiceDetails.pricingCalculator;
            delete parsedServiceDetails.pricingConfigVersion;
            delete parsedServiceDetails.pricingCalculatedAt;
            delete parsedServiceDetails.pricingSource;
            delete parsedServiceDetails.pricingBreakdown;

            // helpers
            const looksLikeCoordsAddress = (v) => {
                if (!v) return true;
                const s = String(v).trim();
                return s === "" || s.startsWith("Координаты:");
            };

            const parseLatLng = (v) => {
                if (!v) return null;

                const raw = Array.isArray(v) ? v[0] : v;
                if (typeof raw !== "string" || !raw.includes(",")) return null;

                const [latStr, lngStr] = raw.split(",").map((x) => x.trim());
                const lat = Number(latStr);
                const lng = Number(lngStr);

                if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

                if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

                // 0,0 почти всегда означает ошибку определения координат
                if (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001) return null;

                return { lat, lng };
            };

            // 1) Координаты: либо с фронта, либо из геокодера по адресу
            let coordinatesStr = null;
            let latlng = parseLatLng(incomingCoords);

            if (latlng) {
                coordinatesStr = `${latlng.lat},${latlng.lng}`;
            }

            if (!coordinatesStr) {
                if (!address || !String(address).trim()) {
                    return res.status(400).json({ message: "Адрес обязателен" });
                }

                const geoData = await geocoder.geocode(address);
                if (!geoData || !geoData.length) {
                    return res.status(404).json({ message: "Адрес не найден" });
                }

                const { latitude, longitude } = geoData[0];

                latlng = {
                    lat: Number(latitude),
                    lng: Number(longitude),
                };

                if (
                    !Number.isFinite(latlng.lat) ||
                    !Number.isFinite(latlng.lng) ||
                    latlng.lat < -90 ||
                    latlng.lat > 90 ||
                    latlng.lng < -180 ||
                    latlng.lng > 180 ||
                    (Math.abs(latlng.lat) < 0.000001 && Math.abs(latlng.lng) < 0.000001)
                ) {
                    return res.status(400).json({
                        message: "Не удалось определить корректные координаты адреса. Выберите адрес на карте или уточните адрес.",
                    });
                }

                coordinatesStr = `${latlng.lat},${latlng.lng}`;
            }

            // 2) Reverse-geocode: если адрес пустой/“Координаты: …” — получаем нормальный адрес
            if (latlng && looksLikeCoordsAddress(address)) {
                try {
                    const rev = await geocoder.reverse({ lat: latlng.lat, lon: latlng.lng });
                    if (Array.isArray(rev) && rev[0]) {
                        address =
                            rev[0].formattedAddress ||
                            rev[0].streetName ||
                            rev[0].city ||
                            `${latlng.lat.toFixed(5)}, ${latlng.lng.toFixed(5)}`;
                    }
                } catch (e) {
                    // если reverse не сработал — оставляем что было
                }
            }

            // promotionTotal
            const promotionTotal = Object.entries(parsedPromotion).reduce((sum, [key, enabled]) => {
                return enabled && PROMOTION_PRICES[key] ? sum + PROMOTION_PRICES[key] : sum;
            }, 0);

            const status = promotionTotal > 0 ? "pending_payment" : "pending";

            // --- normalize and validate category/subcategory ids ---

            categoryId = Array.isArray(categoryId)
                ? categoryId[0]
                : categoryId;

            subcategoryId = Array.isArray(subcategoryId)
                ? subcategoryId[0]
                : subcategoryId;

            serviceId = Array.isArray(serviceId)
                ? serviceId[0]
                : serviceId;

            const catId = Number(categoryId);

            if (!Number.isInteger(catId) || catId <= 0) {
                return res.status(400).json({
                    message: "Выберите корректную категорию",
                });
            }

            const subId =
                subcategoryId === null ||
                subcategoryId === undefined ||
                String(subcategoryId).trim() === ""
                    ? null
                    : Number(subcategoryId);

            if (
                subId !== null &&
                (!Number.isInteger(subId) || subId <= 0)
            ) {
                return res.status(400).json({
                    message: "Выберите корректную подкатегорию",
                });
            }

            const normalizedSubId = subId;

            const svcId =
                serviceId === null ||
                serviceId === undefined ||
                String(serviceId).trim() === ""
                    ? null
                    : Number(serviceId);

            if (
                svcId !== null &&
                (!Number.isInteger(svcId) || svcId <= 0)
            ) {
                return res.status(400).json({
                    message: "Передан некорректный serviceId",
                });
            }

            const normalizedSvcId = svcId;

// Проверяем существование категории.
// В этом роуте разрешены только обычные категории.
            const selectedCategory = await Category.findOne({
                where: {
                    id: catId,
                    is_express: false,
                },
                attributes: [
                    "id",
                    "name",
                    "is_express",
                ],
            });

            if (!selectedCategory) {
                return res.status(400).json({
                    message:
                        "Категория не найдена или недоступна для обычного заказа",
                });
            }

// Если подкатегория передана,
// она обязательно должна принадлежать выбранной категории.
            let selectedSubcategory = null;

            if (normalizedSubId !== null) {
                selectedSubcategory = await Subcategory.findOne({
                    where: {
                        id: normalizedSubId,
                        categoryId: catId,
                    },
                    attributes: [
                        "id",
                        "name",
                        "code",
                        "categoryId",
                        "price",
                        "formConfig",
                        "pricingConfig",
                    ],
                });

                if (!selectedSubcategory) {
                    return res.status(400).json({
                        message:
                            "Подкатегория не найдена или не относится к выбранной категории",
                    });
                }
            }

            const configuredFields = Array.isArray(
                selectedSubcategory?.formConfig?.fields
            )
                ? selectedSubcategory.formConfig.fields
                : [];

            for (const field of configuredFields) {
                let value =
                    parsedServiceDetails?.[field.key];

                if (field.required) {
                    const isEmpty =
                        value === undefined ||
                        value === null ||
                        String(value).trim() === "";

                    if (isEmpty) {
                        return res.status(400).json({
                            message:
                                `Заполните обязательное поле «${field.label}»`,
                        });
                    }
                }

                if (
                    field.type === "address" &&
                    field.required
                ) {
                    const coordinatesKey =
                        field.coordinatesKey ||
                        `${field.key}Coordinates`;

                    const coordinates =
                        parsedServiceDetails?.[
                            coordinatesKey
                            ];

                    if (
                        !isValidLatLngObject(
                            coordinates
                        )
                    ) {
                        return res.status(400).json({
                            message:
                                `Выберите точный адрес в поле «${field.label}»`,
                        });
                    }
                }

                if (
                    field.type === "number" &&
                    value !== undefined &&
                    value !== null &&
                    value !== ""
                ) {
                    const numberValue =
                        Number(value);

                    if (
                        !Number.isFinite(
                            numberValue
                        )
                    ) {
                        return res.status(400).json({
                            message:
                                `В поле «${field.label}» должно быть число`,
                        });
                    }

                    if (
                        field.min !== undefined &&
                        numberValue <
                        Number(field.min)
                    ) {
                        return res.status(400).json({
                            message:
                                `Минимальное значение поля «${field.label}» — ${field.min}`,
                        });
                    }

                    if (
                        field.max !== undefined &&
                        numberValue >
                        Number(field.max)
                    ) {
                        return res.status(400).json({
                            message:
                                `Максимальное значение поля «${field.label}» — ${field.max}`,
                        });
                    }

                    parsedServiceDetails[
                        field.key
                        ] = numberValue;

                    value = numberValue;
                }

                if (
                    field.type === "boolean" &&
                    value !== undefined &&
                    value !== null
                ) {
                    const normalizedBoolean =
                        value === true ||
                        value === 1 ||
                        value === "1" ||
                        String(value)
                            .toLowerCase() ===
                        "true";

                    parsedServiceDetails[
                        field.key
                        ] = normalizedBoolean;

                    value = normalizedBoolean;
                }

                if (
                    field.type === "select" &&
                    value !== undefined &&
                    value !== null &&
                    value !== ""
                ) {
                    const allowedValues =
                        Array.isArray(field.options)
                            ? field.options.map(
                                (option) =>
                                    String(
                                        option.value
                                    )
                            )
                            : [];

                    const stringValue =
                        String(value);

                    if (
                        allowedValues.length > 0 &&
                        !allowedValues.includes(
                            stringValue
                        )
                    ) {
                        return res.status(400).json({
                            message:
                                `Выберите корректное значение поля «${field.label}»`,
                        });
                    }

                    parsedServiceDetails[
                        field.key
                        ] = stringValue;

                    value = stringValue;
                }

                if (
                    ["text", "textarea"].includes(
                        field.type
                    ) &&
                    value !== undefined &&
                    value !== null
                ) {
                    const stringValue =
                        String(value).trim();

                    const maximumLength =
                        Number(
                            field.maxLength ||
                            1000
                        );

                    if (
                        stringValue.length >
                        maximumLength
                    ) {
                        return res.status(400).json({
                            message:
                                `Поле «${field.label}» слишком длинное`,
                        });
                    }

                    parsedServiceDetails[
                        field.key
                        ] = stringValue;
                }
            }

            // --- paymentType default ---
            paymentType = Array.isArray(paymentType) ? paymentType[0] : paymentType;
            paymentType = String(paymentType || "").trim();

            if (!paymentType) paymentType = "cash";

            const allowedPaymentTypes = new Set(["cash", "guarantee", "installment"]);
            if (!allowedPaymentTypes.has(paymentType)) {
                return res.status(400).json({ message: "Некорректный paymentType" });
            }

            if (!coordinatesStr || !latlng) {
                return res.status(400).json({
                    message: "Координаты заказа обязательны. Выберите адрес из подсказки, по GPS или на карте.",
                });
            }

            proposedSum = Array.isArray(proposedSum)
                ? proposedSum[0]
                : proposedSum;

            const proposedSumRaw = Number(proposedSum);

            if (
                !Number.isFinite(proposedSumRaw) ||
                proposedSumRaw <= 0
            ) {
                return res.status(400).json({
                    message:
                        "Стоимость заказа должна быть больше нуля",
                });
            }

            if (proposedSumRaw > 300000) {
                return res.status(400).json({
                    message: "Слишком большая стоимость заказа. Проверьте сумму.",
                });
            }

            const safeProposedSum = Math.round(proposedSumRaw * 100) / 100;

            // --- normalize ASAP / work time ---

            isAsap = Array.isArray(isAsap) ? isAsap[0] : isAsap;
            workTime = Array.isArray(workTime) ? workTime[0] : workTime;

            const normalizedIsAsap =
                isAsap === true ||
                isAsap === 1 ||
                isAsap === "1" ||
                String(isAsap).toLowerCase() === "true";

            let normalizedWorkTime = null;

            if (!normalizedIsAsap) {
                if (!workTime || !String(workTime).trim()) {
                    return res.status(400).json({
                        message: "Выберите дату и время выполнения заказа",
                    });
                }

                const parsedWorkTime = new Date(workTime);

                if (Number.isNaN(parsedWorkTime.getTime())) {
                    return res.status(400).json({
                        message: "Указано некорректное время выполнения заказа",
                    });
                }

                if (parsedWorkTime.getTime() < Date.now()) {
                    return res.status(400).json({
                        message: "Время выполнения заказа не может быть в прошлом",
                    });
                }

                normalizedWorkTime = parsedWorkTime;
            }

            const destinationField =
                configuredFields.find(
                    (field) =>
                        field.type === "address" &&
                        field.required
                );

            if (destinationField) {
                const coordinatesKey =
                    destinationField.coordinatesKey ||
                    `${destinationField.key}Coordinates`;

                const destinationCoordinates =
                    parsedServiceDetails[
                        coordinatesKey
                        ];

                if (
                    !isValidLatLngObject(
                        destinationCoordinates
                    )
                ) {
                    return res.status(400).json({
                        message:
                            `Выберите точный адрес в поле «${destinationField.label}»`,
                    });
                }

                const [
                    startLatValue,
                    startLngValue,
                ] = String(coordinatesStr)
                    .split(",")
                    .map((item) =>
                        Number(item.trim())
                    );

                const straightDistanceKm =
                    calculateStraightDistanceKm(
                        startLatValue,
                        startLngValue,
                        destinationCoordinates.lat,
                        destinationCoordinates.lng
                    );

                if (straightDistanceKm === null) {
                    return res.status(400).json({
                        message:
                            "Не удалось рассчитать расстояние между адресами",
                    });
                }

                const distanceCoefficient = 1.35;

                const estimatedRoadDistanceKm =
                    Math.round(
                        straightDistanceKm *
                        distanceCoefficient *
                        10
                    ) / 10;

                parsedServiceDetails = {
                    ...parsedServiceDetails,

                    straightDistanceKm,
                    estimatedRoadDistanceKm,

                    distanceKm:
                    estimatedRoadDistanceKm,

                    distanceCoefficient,

                    distanceType:
                        "estimated_from_coordinates",
                };
            } else {
                delete parsedServiceDetails
                    .straightDistanceKm;

                delete parsedServiceDetails
                    .estimatedRoadDistanceKm;

                delete parsedServiceDetails
                    .distanceKm;

                delete parsedServiceDetails
                    .distanceCoefficient;

                delete parsedServiceDetails
                    .distanceType;
            }

            const serverRecommendedPrice =
                calculateRecommendedPrice({
                    pricingConfig:
                    selectedSubcategory
                        ?.pricingConfig,

                    serviceDetails:
                    parsedServiceDetails,
                });

            if (serverRecommendedPrice) {
                parsedServiceDetails = {
                    ...parsedServiceDetails,

                    recommendedPrice:
                    serverRecommendedPrice
                        .recommendedPrice,

                    recommendedPriceMin:
                    serverRecommendedPrice
                        .minPrice,

                    recommendedPriceMax:
                    serverRecommendedPrice
                        .maxPrice,

                    pricingCalculator:
                    serverRecommendedPrice
                        .calculator,

                    pricingConfigVersion:
                    serverRecommendedPrice
                        .configVersion,

                    pricingCalculatedAt:
                        new Date().toISOString(),

                    pricingSource:
                        "server",

                    pricingBreakdown:
                        serverRecommendedPrice.breakdown || [],
                };
            }

            // 3) Сначала создаём заказ БЕЗ финальных путей картинок
            const newOrder = await Order.create({
                userId,
                address: String(address || "").trim(),
                description: String(description || "").trim(),

                isAsap: normalizedIsAsap,
                workTime: normalizedWorkTime,

                proposedSum: safeProposedSum,
                coordinates: coordinatesStr,
                createdAt: new Date(),
                images: [],
                creatorId: userId,
                status,
                categoryId: catId,
                subcategoryId: normalizedSubId,
                serviceId: normalizedSvcId,
                serviceDetails: parsedServiceDetails,
                paymentType,

                promotionCost: promotionTotal,
                promotionRequested: parsedPromotion,

                is_highlighted: promotionTotal > 0 ? false : !!parsedPromotion.highlight,
                is_recommended: promotionTotal > 0 ? false : !!parsedPromotion.recommended,
                is_push_notified: promotionTotal > 0 ? false : !!parsedPromotion.push,
            });

            // 4) Создаём папку заказа и переносим туда файлы из temp
            const orderDir = path.join(__dirname, "..", "uploads", "orders", `order_${newOrder.id}`);
            ensureDir(orderDir);

            let photoUrls = [];

            if (req.files && req.files.length > 0) {
                photoUrls = req.files.map((file, index) => {
                    const ext = path.extname(file.originalname) || path.extname(file.filename) || ".jpg";
                    const newFileName = `customer_${index + 1}${ext}`;
                    const newPath = path.join(orderDir, newFileName);

                    fs.renameSync(file.path, newPath);

                    return `/uploads/orders/order_${newOrder.id}/${newFileName}`;
                });

                newOrder.images = photoUrls;
                await newOrder.save();
            }

            await req.logAction({
                req,
                actorUserId: userId,
                actorRole: "user",
                actionType: "order_create",
                entityType: "order",
                entityId: newOrder.id,
                orderId: newOrder.id,
                meta: {
                    status: newOrder.status,
                    paymentType: newOrder.paymentType,
                    isAsap: newOrder.isAsap,
                    workTime: newOrder.workTime,
                    categoryId: newOrder.categoryId,
                    categoryName: selectedCategory.name,
                    subcategoryId: newOrder.subcategoryId,
                    subcategoryName: selectedSubcategory?.name || null,
                    serviceId: newOrder.serviceId,
                    serviceDetails: newOrder.serviceDetails,
                    proposedSum: newOrder.proposedSum,
                    promotionTotal: newOrder.promotionCost,
                    coords: newOrder.coordinates,
                    imagesCount: photoUrls.length,
                    imagePaths: photoUrls,
                    recommendedPrice:
                        serverRecommendedPrice
                            ?.recommendedPrice || null,

                    recommendedPriceMin:
                        serverRecommendedPrice
                            ?.minPrice || null,

                    recommendedPriceMax:
                        serverRecommendedPrice
                            ?.maxPrice || null,

                    pricingCalculator:
                        serverRecommendedPrice
                            ?.calculator || null,

                    pricingConfigVersion:
                        serverRecommendedPrice
                            ?.configVersion || null,

                    pricingBreakdown:
                        serverRecommendedPrice
                            ?.breakdown || [],
                },
            });

            io.emit("orderUpdated");
            return res.status(201).json({
                ...newOrder.toJSON(),

                pricing: serverRecommendedPrice
                    ? {
                        recommendedPrice:
                        serverRecommendedPrice.recommendedPrice,

                        minPrice:
                        serverRecommendedPrice.minPrice,

                        maxPrice:
                        serverRecommendedPrice.maxPrice,

                        calculator:
                        serverRecommendedPrice.calculator,

                        source: "server",

                        breakdown:
                            serverRecommendedPrice
                                .breakdown || [],
                    }
                    : null,
            });

        } catch (error) {
            console.error("Ошибка при создании заказа:", error);
            return res.status(500).json({ message: "Ошибка сервера" });
        }
    });

    router.post("/:id/remind-complete", authenticateToken, async (req, res) => {
        try {
            const orderId = Number(req.params.id);
            const userId = Number(req.user.id);

            if (!Number.isFinite(orderId) || orderId <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Некорректный id заказа",
                });
            }

            const order = await Order.findByPk(orderId);

            if (!order) {
                return res.status(404).json({
                    success: false,
                    message: "Заказ не найден",
                });
            }

            const creatorId = Number(order.creatorId);
            const executorId = Number(order.executorId);

            const isParticipant =
                userId === creatorId || userId === executorId;

            if (!isParticipant) {
                return res.status(403).json({
                    success: false,
                    message: "Нет доступа к заказу",
                });
            }

            const completedBy = Array.isArray(order.completedBy)
                ? order.completedBy.map(Number).filter(Number.isFinite)
                : [];

            if (!completedBy.includes(userId)) {
                return res.status(400).json({
                    success: false,
                    message: "Сначала подтвердите завершение со своей стороны",
                });
            }

            if (order.status === "completed") {
                return res.status(400).json({
                    success: false,
                    message: "Заказ уже завершён",
                });
            }

            const targetUserId =
                userId === creatorId ? executorId : creatorId;

            if (!targetUserId) {
                return res.status(400).json({
                    success: false,
                    message: "Не удалось определить второго участника",
                });
            }

            await notifyUser({
                userId: targetUserId,
                type: "order_completion_reminder",
                title: "Подтвердите завершение заказа",
                body: `Участник заказа №${order.id} уже подтвердил завершение. Проверьте заказ и подтвердите завершение.`,
                orderId: order.id,
                orderType: "regular",
                data: {
                    orderId: order.id,
                    orderType: "regular",
                    creatorId: order.creatorId,
                    executorId: order.executorId,
                },
            });

            await sendNotifications(targetUserId);

            return res.json({
                success: true,
                message: "Напоминание отправлено",
            });
        } catch (e) {
            console.error("remind-complete error:", e);
            return res.status(500).json({
                success: false,
                message: "Ошибка сервера",
            });
        }
    });

    router.get("/all", async (req, res) => {
        try {
            const {
                categoryId,
                subcategoryId,
                serviceId,
            } = req.query;

            const whereClause = {
                status: "pending",
                creatorHidden: false,
                adminDeleted: false,
            };

            if (categoryId) {
                whereClause.categoryId =
                    Number(categoryId);
            }

            if (subcategoryId) {
                whereClause.subcategoryId =
                    Number(subcategoryId);
            }

            if (serviceId) {
                whereClause.serviceId =
                    Number(serviceId);
            }

            const orders = await Order.findAll({
                attributes: [
                    "id",
                    "createdAt",
                    "address",
                    "description",
                    "workTime",
                    "isAsap",
                    "images",
                    "proposedSum",
                    "creatorId",
                    "coordinates",
                    "executorId",
                    "status",
                    "paymentType",

                    "is_highlighted",
                    "is_recommended",
                    "is_push_notified",

                    "categoryId",
                    "subcategoryId",
                    "serviceId",

                    /*
                     * Новое поле с параметрами услуги,
                     * расстоянием и расчётом цены.
                     */
                    "serviceDetails",
                ],

                where: whereClause,

                include: [
                    {
                        model: db.Category,
                        as: "category",
                        attributes: [
                            "id",
                            "name",
                        ],
                    },

                    {
                        model: db.Subcategory,
                        as: "subcategory",
                        attributes: [
                            "id",
                            "name",
                            "code",
                            "formConfig",
                        ],
                    },

                    {
                        model: db.Service,
                        as: "service",
                        attributes: [
                            "id",
                            "name",
                        ],
                    },
                ],

                order: [
                    ["is_recommended", "DESC"],
                    ["createdAt", "DESC"],
                ],
            });

            return res.json(orders);
        } catch (error) {
            console.error(
                "❌ Ошибка при получении заказов:",
                error
            );

            return res.status(500).json({
                message: "Ошибка сервера",
            });
        }
    });

    router.get('/active-orders', authenticateToken, async (req, res) => {
        try {
            const userId = req.user.id;

            const activeOrders = await Order.findAll({
                where: {
                    status: 'active',
                    [Op.or]: [{ creatorId: userId }, { executorId: userId }],
                },
                include: [
                    { model: db.Category, as: 'category', attributes: ['id', 'name'] },
                    { model: db.Subcategory, as: 'subcategory', attributes: ['id', 'name'] },
                    { model: User, as: 'creator', attributes: ['id', 'username']},
                    { model: User, as: 'executor', attributes: ['id', 'username']},
                ],
            });

            if (!activeOrders.length) {
                return res.json({ orders: activeOrders, notifications: [] });
            }

            const orderIds = activeOrders.map(order => order.id);

            const notifications = await db.Notification.findAll({
                where: {
                    orderId: { [Op.in]: orderIds }, // Используем Op.in для поиска по массиву
                    userId: userId, // Только для текущего пользователя
                    isRead: false,  // Только непрочитанные
                }
            });

            res.json({ orders: activeOrders, notifications });


        } catch (error) {
            console.error('Ошибка при получении активных заказов:', error);
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    });

    router.get("/:id", async (req, res) => {
        const orderId = Number(req.params.id);

        if (
            !Number.isInteger(orderId) ||
            orderId <= 0
        ) {
            return res.status(400).json({
                message: "Некорректный ID заказа",
            });
        }

        try {
            const order = await Order.findByPk(
                orderId,
                {
                    include: [
                        {
                            model: db.User,
                            as: "users",
                            attributes: [
                                "id",
                                "username",
                                "phone",
                            ],
                        },

                        {
                            model: db.Category,
                            as: "category",
                            attributes: [
                                "id",
                                "name",
                            ],
                        },

                        {
                            model: db.Subcategory,
                            as: "subcategory",
                            attributes: [
                                "id",
                                "name",
                                "code",
                                "formConfig",
                            ],
                        },

                        {
                            model: db.Service,
                            as: "service",
                            attributes: [
                                "id",
                                "name",
                            ],
                        },
                    ],
                }
            );

            if (!order) {
                return res.status(404).json({
                    message: "Заказ не найден",
                });
            }

            return res.json(order);
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

    router.get('/me/status', authenticateToken, async (req, res) => {
        try {
            const user = await User.findByPk(req.user.id);
            if (!user) {
                return res.status(404).json({ message: 'Пользователь не найден' });
            }

            res.json({ debt: user.debt });  // ← ИСПРАВЛЕНО
        } catch (err) {
            console.error('Ошибка при проверке статуса пользователя:', err);
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    });

    router.post("/:id/request", authenticateToken, async (req, res) => {
        const { id } = req.params;
        const { proposedSum, comment } = req.body;
        const executorId = req.user.id;

        try {
            const executor = await User.findByPk(executorId, {
                attributes: ["id", "debt", "subscription_type", "subscription_expires_at"],
            });

            if (!executor) {
                return res.status(404).json({ message: "Пользователь не найден" });
            }

            const hasActivePremium =
                executor.subscription_type === "premium" &&
                executor.subscription_expires_at &&
                new Date(executor.subscription_expires_at) > new Date();

            if (!hasActivePremium && Number(executor.debt || 0) > 0) {
                return res.status(400).json({
                    message: "У вас есть задолженность по комиссии. Погасите её, чтобы брать новые заказы.",
                });
            }

            const busyRegular = await hasBusyRegularOrder(Order, executorId);
            const busyTaxi = await hasBusyTaxiOrder(ExpressOrder, executorId);

            if (busyRegular || busyTaxi) {
                return res.status(400).json({
                    message: "У вас уже есть активный заказ. Завершите его, чтобы брать новый.",
                });
            }

            const order = await Order.findByPk(id);
            if (!order) {
                return res.status(404).json({ message: "Заказ не найден" });
            }

            if (order.status !== "pending") {
                return res.status(400).json({ message: "Заказ недоступен" });
            }

            if (Number(order.creatorId) === Number(executorId)) {
                return res.status(400).json({ message: "Нельзя откликнуться на свой заказ" });
            }

            const normalizedProposedSum = Number(
                String(proposedSum ?? "")
                    .replace(",", ".")
                    .trim()
            );

            if (!Number.isFinite(normalizedProposedSum) || normalizedProposedSum <= 0) {
                return res.status(400).json({
                    message: "Введите корректную сумму больше 0",
                });
            }

            const safeProposedSum = Math.round(normalizedProposedSum);
            const safeComment = comment ? String(comment).trim().slice(0, 1000) : "";

            let requests = [];
            try {
                requests = Array.isArray(order.requests)
                    ? order.requests
                    : JSON.parse(order.requests || "[]");

                if (!Array.isArray(requests)) {
                    requests = [];
                }
            } catch (e) {
                console.error("Ошибка парсинга requests:", e);
                requests = [];
            }

            if (requests.some((reqItem) => Number(reqItem.executorId) === Number(executorId))) {
                return res.status(400).json({ message: "Вы уже отправили запрос на этот заказ" });
            }

            requests.push({
                executorId,
                proposedSum: safeProposedSum,
                comment: safeComment,
                createdAt: new Date().toISOString(),
            });

            order.requests = JSON.stringify(requests);

            let requestedExecutors = [];
            try {
                requestedExecutors = Array.isArray(order.requestedExecutors)
                    ? order.requestedExecutors
                    : JSON.parse(order.requestedExecutors || "[]");

                if (!Array.isArray(requestedExecutors)) {
                    requestedExecutors = [];
                }
            } catch (e) {
                requestedExecutors = [];
            }

            if (!requestedExecutors.map(Number).includes(Number(executorId))) {
                requestedExecutors.push(executorId);
            }

            order.requestedExecutors = JSON.stringify(requestedExecutors);

            await order.save();

            if (req.logAction) {
                await req.logAction({
                    req,
                    actorUserId: executorId,
                    actorRole: "user",
                    actionType: "order_request_create",
                    entityType: "order",
                    entityId: order.id,
                    orderId: order.id,
                    meta: {
                        proposedSum: safeProposedSum,
                        comment: safeComment || null,
                    },
                });
            }

            await notifyUser({
                userId: order.creatorId || order.userId,
                type: "order_request",
                title: "Новый отклик на заказ",
                body: `Исполнитель хочет выполнить заказ №${order.id}`,
                orderId: order.id,
                orderType: "regular",
                data: {
                    creatorId: order.creatorId || order.userId,
                    executorId,
                    requesterId: executorId,
                    proposedSum: safeProposedSum,
                },
                socketEvent: `orderRequest:${String(order.creatorId || order.userId)}`,
                socketPayload: {
                    orderId: order.id,
                    orderType: "regular",

                    creatorId: order.creatorId || order.userId,
                    executorId,
                    requesterId: executorId,

                    proposedSum: safeProposedSum,
                },
            });

            return res.json({
                message: "Запрос на выполнение отправлен заказчику",
                order,
            });
        } catch (error) {
            console.error("Ошибка при запросе заказа:", error);
            return res.status(500).json({ message: "Ошибка сервера" });
        }
    });

    router.get('/:id/requested-executors', authenticateToken, async (req, res) => {
        const { id } = req.params;

        try {
            const order = await Order.findByPk(id);
            let requests = [];
            try {
                if (typeof order.requests === 'string' && order.requests.trim() !== '') {
                    requests = JSON.parse(order.requests);
                }
            } catch (e) {
                console.error('Ошибка парсинга order.requests:', e);
                requests = [];
            }

            if (!order) {
                return res.status(404).json({ message: 'Заказ не найден' });
            }

            let requestedExecutors = [];
            if (order.requestedExecutors) {
                // Проверяем, что строка не пуста и является строкой
                if (typeof order.requestedExecutors === 'string' && order.requestedExecutors.trim() !== '') {
                    try {
                        requestedExecutors = JSON.parse(order.requestedExecutors);
                        // Проверяем, что результат парсинга является массивом
                        if (!Array.isArray(requestedExecutors)) {
                            requestedExecutors = [];
                        }
                    } catch (error) {
                        console.error('Ошибка парсинга requestedExecutors:', error);
                        requestedExecutors = [];
                    }
                } else {
                    // Если строка пуста или невалидна, присваиваем пустой массив
                    requestedExecutors = [];
                }
            }


            if (requestedExecutors.length === 0) {
                return res.json([]);
            }

            // Находим пользователей по ID
            const executors = await User.findAll({
                where: { id: requestedExecutors },
                attributes: ['id', 'username', 'rating', 'ratingCount', 'userStatus'] // Выбираем нужные поля
            });
            const result = executors.map(exec => {
                const reqData = requests.find(r => r.executorId === exec.id);
                return {
                    ...exec.toJSON(),
                    proposedSum: reqData?.proposedSum,
                    comment: reqData?.comment
                };
            });

            res.json(result);
        } catch (error) {
            console.error('Ошибка при получении запросивших исполнителей:', error);
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    });

    router.post("/:id/approve", authenticateToken, async (req, res) => {
        const { id } = req.params;
        const { executorId } = req.body;

        try {
            const normalizedExecutorId = Number(executorId);

            if (!Number.isFinite(normalizedExecutorId) || normalizedExecutorId <= 0) {
                return res.status(400).json({ message: "Некорректный executorId" });
            }

            const order = await Order.findByPk(id);
            if (!order) {
                return res.status(404).json({ message: "Заказ не найден" });
            }

            if (Number(order.creatorId) !== Number(req.user.id)) {
                return res.status(403).json({ message: "Вы не можете одобрить этот заказ" });
            }

            // requestedExecutors -> array
            let requestedExecutors = [];
            try {
                requestedExecutors = Array.isArray(order.requestedExecutors)
                    ? order.requestedExecutors
                    : JSON.parse(order.requestedExecutors || "[]");

                if (!Array.isArray(requestedExecutors)) {
                    requestedExecutors = [];
                }
            } catch (e) {
                requestedExecutors = [];
            }

            if (!requestedExecutors.map(Number).includes(normalizedExecutorId)) {
                return res.status(400).json({ message: "Исполнитель не найден среди запросивших" });
            }

            // requests -> array
            let requests = [];
            try {
                requests = Array.isArray(order.requests)
                    ? order.requests
                    : JSON.parse(order.requests || "[]");

                if (!Array.isArray(requests)) {
                    requests = [];
                }
            } catch (e) {
                requests = [];
            }

            const matchedRequest = requests.find(
                (r) => Number(r.executorId) === normalizedExecutorId
            );

            if (!matchedRequest) {
                return res.status(400).json({ message: "Запрос исполнителя не найден" });
            }

            const approvedSum = Number(
                String(matchedRequest.proposedSum ?? "")
                    .replace(",", ".")
                    .trim()
            );

            if (!Number.isFinite(approvedSum) || approvedSum <= 0) {
                return res.status(400).json({
                    message: "У выбранного исполнителя некорректная сумма. Попросите отправить запрос заново.",
                });
            }

            const executorBusyRegular = await hasBusyRegularOrder(Order, normalizedExecutorId, order.id);
            const executorBusyTaxi = await hasBusyTaxiOrder(ExpressOrder, normalizedExecutorId);

            if (executorBusyRegular || executorBusyTaxi) {
                return res.status(409).json({
                    message: "Этот исполнитель уже занят другим заказом",
                });
            }

            // Назначаем исполнителя
            order.executorId = normalizedExecutorId;
            order.proposedSum = Math.round(approvedSum);
            order.finalPriceKopecks = Math.max(0, Math.round(approvedSum * 100));

            // Статус / сделка
            if (order.paymentType === "cash") {
                order.status = "active";
                order.dealStatus = "none";
            } else if (order.paymentType === "guarantee") {
                // если у тебя дальше отдельная логика холда - подстрой под неё
                order.status = "active";
                if (!order.dealStatus || order.dealStatus === "none") {
                    order.dealStatus = "waiting_payment";
                }
            } else if (order.paymentType === "installment" || order.paymentType === "installments") {
                order.status = "active";
                order.dealStatus = "none";
            } else {
                order.status = "active";
            }

            // чистим список запросов
            order.requestedExecutors = JSON.stringify([]);
            order.requests = JSON.stringify([]);

            await order.save();

            const cleanedOrderIds = await removeExecutorFromOtherPendingOrders(
                Order,
                normalizedExecutorId,
                order.id
            );

            if (req.logAction) {
                await req.logAction({
                    req,
                    actorUserId: req.user.id,
                    actorRole: "user",
                    actionType: "order_executor_requests_cleaned",
                    entityType: "order",
                    entityId: order.id,
                    orderId: order.id,
                    meta: {
                        executorId: normalizedExecutorId,
                        removedFromOrderIds: cleanedOrderIds,
                    },
                });
            }

            const executor = await User.findByPk(normalizedExecutorId);
            if (!executor) {
                return res.status(404).json({ message: "Исполнитель не найден" });
            }

            const isPremium =
                executor.subscription_type === "premium" &&
                executor.subscription_expires_at &&
                new Date(executor.subscription_expires_at) > new Date();

            const isCash = order.paymentType === "cash";
            const isRecommended = !!order.is_recommended;

            const feeRub = isRecommended ? 100 : 200;
            const commissionKopecks = !isPremium && isCash ? feeRub * 100 : 0;

            let finalDebtKopecks = Number(executor.debt || 0);

            let commissionPayment = {
                autoPaymentTried: false,
                autoPaymentPaid: false,
                autoPaymentProcessing: false,
                autoPaymentStatus: null,
                paymentId: null,
                message: "",
            };

            if (commissionKopecks > 0) {
                /**
                 * ВАЖНО:
                 * Сначала начисляем долг.
                 * Потом пробуем списать.
                 * Если списание пройдет, webhook payment.succeeded уменьшит долг.
                 * Если денег не хватит или payment.canceled — долг останется.
                 */
                finalDebtKopecks = Number(executor.debt || 0) + commissionKopecks;

                await executor.update({
                    debt: finalDebtKopecks,
                    commissionDebtOrderId: order.id,
                });

                commissionPayment = await tryPayCommissionFromSavedCard({
                    req,
                    executor,
                    order,
                    amountKopecks: commissionKopecks,
                });
            } else {
                /**
                 * ВАЖНО:
                 * НЕ ОБНУЛЯЕМ старый долг.
                 */
                finalDebtKopecks = Number(executor.debt || 0);
            }

            await req.logAction({
                req,
                actorUserId: req.user.id,
                actorRole: "user",
                actionType: "order_executor_approved",
                entityType: "order",
                entityId: order.id,
                orderId: order.id,
                meta: {
                    executorId: normalizedExecutorId,
                    paymentType: order.paymentType,
                    finalPriceKopecks: order.finalPriceKopecks,
                    status: order.status,
                    dealStatus: order.dealStatus,
                    commissionKopecks,
                    debtKopecks: finalDebtKopecks,
                    isPremium,
                    autoPaymentTried: commissionPayment.autoPaymentTried,
                    autoPaymentPaid: commissionPayment.autoPaymentPaid,
                    autoPaymentProcessing: commissionPayment.autoPaymentProcessing,
                    autoPaymentStatus: commissionPayment.autoPaymentStatus,
                    autoPaymentId: commissionPayment.paymentId,
                },
            });

            // ✅ грузим полный заказ с ассоциациями для PDF
            const fullOrder = await Order.findByPk(order.id, {
                include: [
                    { model: User, as: "creator" },
                    { model: User, as: "executor" },
                    { model: Category, as: "category" },
                    { model: Subcategory, as: "subcategory" },
                ],
            });

            // ===== договор =====
            const contractData = {
                orderId: fullOrder.id,
                approvalDate: new Date().toLocaleDateString("ru-RU"),
                city: "Москва",

                customerId: fullOrder.creatorId,
                performerId: fullOrder.executorId,

                customerName: fullOrder.creator?.username || `Пользователь ${fullOrder.creatorId}`,
                performerName: fullOrder.executor?.username || `Пользователь ${fullOrder.executorId}`,

                category: fullOrder.category?.name || "Общая категория",
                subcategory: fullOrder.subcategory?.name || "Общая подкатегория",

                address: fullOrder.address || "Адрес не указан",
                description: fullOrder.description || "Описание не указано",
                price: fullOrder.proposedSum || 0,
                paymentType: fullOrder.paymentType || "не указано",
                dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString("ru-RU"),
                completeAt: null,
                completedBy: [],
            };

            const contractFileName =
                `contract_${fullOrder.id}.pdf`;

            const filePath =
                path.join(
                    contractsRoot,
                    contractFileName
                );

            try {
                await generateContractPDF(
                    contractData,
                    filePath
                );

                await fullOrder.update({
                    contractPath:
                        `/contracts/${contractFileName}`,
                });
            } catch (err) {
                console.error(
                    "❌ Ошибка генерации PDF договора:",
                    err
                );
            }

            io.emit("orderUpdated");

            let executorMessage = "Ваш запрос на выполнение заказа одобрен!";

            if (commissionKopecks > 0) {
                if (commissionPayment.autoPaymentPaid) {
                    executorMessage =
                        "Ваш запрос одобрен! Комиссия списана с привязанной карты ✅";
                } else if (commissionPayment.autoPaymentProcessing) {
                    executorMessage =
                        "Ваш запрос одобрен! Пробуем списать комиссию с привязанной карты.";
                } else if (commissionPayment.autoPaymentTried) {
                    executorMessage =
                        "Ваш запрос одобрен! Автоматическое списание не прошло, комиссия осталась в задолженности.";
                } else {
                    executorMessage =
                        "Ваш запрос одобрен! Комиссия начислена в задолженность.";
                }
            } else if (isPremium) {
                executorMessage =
                    "Ваш запрос одобрен! У вас активен Premium — комиссия не требуется.";
            }

            await notifyUser({
                userId: fullOrder.executorId,
                type: "order_request_approved",
                title: "Вас выбрали исполнителем",
                body: `Ваш отклик на заказ №${fullOrder.id} одобрен`,
                orderId: fullOrder.id,
                orderType: "regular",
                data: {
                    creatorId: fullOrder.creatorId,
                    executorId: fullOrder.executorId,
                    debt: finalDebtKopecks,
                    needPay:
                        commissionKopecks > 0 &&
                        finalDebtKopecks > 0 &&
                        !commissionPayment.autoPaymentProcessing &&
                        !commissionPayment.autoPaymentPaid,
                },
                socketEvent: "orderApproved",
                socketPayload: {
                    orderId: fullOrder.id,
                    message: executorMessage,
                    isPremium,

                    commissionKopecks,
                    debt: finalDebtKopecks,

                    needPay:
                        commissionKopecks > 0 &&
                        finalDebtKopecks > 0 &&
                        !commissionPayment.autoPaymentProcessing &&
                        !commissionPayment.autoPaymentPaid,

                    paid:
                        commissionKopecks === 0 ||
                        commissionPayment.autoPaymentPaid,

                    autoPaymentTried: commissionPayment.autoPaymentTried,
                    autoPaymentPaid: commissionPayment.autoPaymentPaid,
                    autoPaymentProcessing: commissionPayment.autoPaymentProcessing,
                    autoPaymentStatus: commissionPayment.autoPaymentStatus,
                },
            });

            io.to(`user_${fullOrder.creatorId}`).emit("orderApproved", {
                orderId: fullOrder.id,
                message: "Вы успешно одобрили заказ!",
            });

            return res.json({
                success: true,
                orderId: fullOrder.id,
                paymentType: fullOrder.paymentType,
                status: fullOrder.status,
                dealStatus: fullOrder.dealStatus,
            });
        } catch (error) {
            console.error("❌ Ошибка при одобрении заказа:", error);
            return res.status(500).json({ message: "Ошибка сервера" });
        }
    });

    router.post("/complete/:id", authenticateToken, async (req, res) => {
        try {
            const orderId = req.params.id;
            const userId = req.user.id;

            const order = await Order.findByPk(orderId);
            if (!order) return res.status(404).json({ message: "Заказ не найден" });

            if (order.completedBy.includes(userId)) {
                return res.status(400).json({ message: "Вы уже подтвердили завершение" });
            }

            const isExecutor = Number(order.executorId) === Number(userId);

            if (isExecutor) {
                const beforePhotos = Array.isArray(order.executorBeforePhotos) ? order.executorBeforePhotos : [];
                const afterPhotos = Array.isArray(order.executorAfterPhotos) ? order.executorAfterPhotos : [];

                await req.logAction({
                    req,
                    actorUserId: userId,
                    actorRole: "user",
                    actionType: "order_complete_without_full_photo_protocol_check",
                    entityType: "order",
                    entityId: order.id,
                    orderId: order.id,
                    meta: {
                        executorBeforePhotosCount: beforePhotos.length,
                        executorAfterPhotosCount: afterPhotos.length,
                        hasBeforePhotos: beforePhotos.length > 0,
                        hasAfterPhotos: afterPhotos.length > 0,
                    },
                });
            }

            order.completedBy = [...order.completedBy, userId];

            await req.logAction({
                req,
                actorUserId: userId,
                actorRole: "user",
                actionType: "order_complete_confirm",
                entityType: "order",
                entityId: order.id,
                orderId: order.id,
                meta: { completedBy: order.completedBy },
            });

            if (order.completedBy.includes(order.creatorId) && !order.completedBy.includes(order.executorId)) {
                await notifyUser({
                    userId: order.executorId,
                    type: "order_completion_requested",
                    title: "Подтвердите завершение заказа",
                    body: `Заказчик предложил завершить заказ №${order.id}`,
                    orderId: order.id,
                    orderType: "regular",
                    data: {
                        creatorId: order.creatorId,
                        executorId: order.executorId,
                        completedBy: order.completedBy,
                    },
                    socketEvent: "orderCompleted",
                    socketPayload: {
                        orderId: order.id,
                        message: "Заказчик предложил завершить заказ",
                        creatorId: order.creatorId,
                        executorId: order.executorId,
                        orderType: "regular",
                    },
                });
            }

            if (order.completedBy.includes(order.executorId) && !order.completedBy.includes(order.creatorId)) {
                await notifyUser({
                    userId: order.creatorId,
                    type: "order_completion_requested",
                    title: "Подтвердите завершение заказа",
                    body: `Исполнитель предложил завершить заказ №${order.id}`,
                    orderId: order.id,
                    orderType: "regular",
                    data: {
                        creatorId: order.creatorId,
                        executorId: order.executorId,
                        completedBy: order.completedBy,
                    },
                    socketEvent: "orderCompleted",
                    socketPayload: {
                        orderId: order.id,
                        message: "Исполнитель предложил завершить заказ",
                        creatorId: order.creatorId,
                        executorId: order.executorId,
                        orderType: "regular",
                    },
                });
            }

            let fullyCompleted = false;

            if (order.completedBy.includes(order.creatorId) && order.completedBy.includes(order.executorId)) {
                order.status = "completed";
                order.completedAt = new Date();
                fullyCompleted = true;

                if (order.paymentType === "guarantee" && order.dealStatus === "funds_held" && order.yookassa_payment_id) {
                    const amountValue = (Number(order.finalPriceKopecks || 0) / 100).toFixed(2);

                    try {
                        const captured = await yooKassa.capturePayment(order.yookassa_payment_id, {
                            amount: { value: amountValue, currency: "RUB" }
                        });

                        order.yookassa_payment_status = captured.status;
                    } catch (e) {
                        console.error("capturePayment error:", e);

                        await req.logAction({
                            req,
                            actorUserId: null,
                            actorRole: "system",
                            actionType: "payment_capture_failed",
                            entityType: "payment",
                            entityId: null,
                            orderId: order.id,
                            paymentId: order.yookassa_payment_id,
                            severity: "error",
                            success: false,
                            meta: { error: String(e?.message || e) },
                        });

                        return res.status(500).json({
                            message: "Не удалось завершить заказ: ошибка списания оплаты по гарантии",
                        });
                    }
                }
            }

            await order.save();

            if (fullyCompleted) {
                await req.logAction({
                    req,
                    actorUserId: userId,
                    actorRole: "user",
                    actionType: "order_completed",
                    entityType: "order",
                    entityId: order.id,
                    orderId: order.id,
                    meta: {
                        paymentType: order.paymentType,
                        dealStatus: order.dealStatus,
                        completedAt: order.completedAt,
                    },
                });
            }

            if (fullyCompleted) {
                await notifyMany([order.creatorId, order.executorId], {
                    type: "review_needed",
                    title: "Заказ завершён",
                    body: `Заказ №${order.id} завершён. Оставьте отзыв`,
                    orderId: order.id,
                    orderType: "regular",
                    data: {
                        creatorId: order.creatorId,
                        executorId: order.executorId,
                        completedAt: order.completedAt,
                    },
                    socketEvent: "reviewNeeded",
                    socketPayload: {
                        orderId: order.id,
                        message: "Заказ завершён. Оставьте отзыв.",
                        creatorId: order.creatorId,
                        executorId: order.executorId,
                        orderType: "regular",
                    },
                });
            }

            const fullOrder = await Order.findByPk(orderId, {
                include: [
                    { model: User, as: "creator" },
                    { model: User, as: "executor" },
                    { model: Category, as: "category" },
                    { model: Subcategory, as: "subcategory" }
                ]
            });

            if (fullyCompleted) {
                const data = {
                    orderId: fullOrder.id,
                    approvalDate: fullOrder.createdAt.toLocaleDateString("ru-RU"),
                    city: "Москва",
                    customerId: fullOrder.creatorId,
                    customerName: fullOrder.creator.username,
                    performerId: fullOrder.executorId,
                    performerName: fullOrder.executor.username,
                    category: fullOrder.category?.name || "",
                    subcategory: fullOrder.subcategory?.name || "",
                    address: fullOrder.address,
                    description: fullOrder.description,
                    price: fullOrder.proposedSum,
                    paymentType: fullOrder.paymentType,
                    dueDate: new Date(fullOrder.createdAt.getTime() + 5 * 24 * 60 * 60 * 1000).toLocaleDateString("ru-RU"),
                    completeAt: fullOrder.completedAt,
                    completedBy: fullOrder.completedBy
                };

                try {
                    const contractFileName =
                        `contract_${fullOrder.id}.pdf`;

                    const physicalContractPath =
                        path.join(
                            contractsRoot,
                            contractFileName
                        );

                    await generateContractPDF(
                        data,
                        physicalContractPath
                    );

                    await fullOrder.update({
                        contractPath:
                            `/contracts/${contractFileName}`,
                    });
                } catch (pdfError) {
                    console.error("Ошибка генерации договора:", pdfError);
                }
            }

            io.emit("orderUpdated");
            io.emit("activeOrdersUpdated");

            res.json(fullOrder);
        } catch (error) {
            console.error("Ошибка завершения заказа:", error);
            res.status(500).json({ message: "Ошибка сервера" });
        }
    });

    router.get('/completed/:userId', async (req, res) => {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({ message: 'Некорректный userId' });
        }

        try {
            const completedOrders = await Order.findAll({
                where: {
                    status: {
                        [Op.in]: ['completed'],
                    },
                    [Op.or]: [
                        { creatorId: userId },  // Заказчик
                        { executorId: userId }   // Исполнитель
                    ]
                },
                attributes: ['id','address','proposedSum', 'status', 'completedAt', 'creatorId', 'executorId', 'description', 'contractPath', "serviceDetails"], // Указываем, какие поля хотим вернуть
            });

            // Отправляем заказ с актуальной датой завершения
            res.json(completedOrders);
        } catch (error) {
            console.error('Ошибка при получении завершенных заказов:', error);
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    });

    router.get("/creator/:userId", async (req, res) => {
        const creatorId = Number(req.params.userId);

        if (
            !Number.isInteger(creatorId) ||
            creatorId <= 0
        ) {
            return res.status(400).json({
                message: "Некорректный userId",
            });
        }

        try {
            const orders = await Order.findAll({
                where: {
                    creatorId,

                    status: {
                        [Op.in]: [
                            "pending",
                            "pending_payment",
                        ],
                    },

                    creatorHidden: false,
                    adminDeleted: false,
                },

                order: [
                    ["createdAt", "DESC"],
                ],

                include: [
                    {
                        model: db.Category,
                        as: "category",
                        attributes: [
                            "id",
                            "name",
                        ],
                    },

                    {
                        model: db.Subcategory,
                        as: "subcategory",
                        attributes: [
                            "id",
                            "name",
                            "code",
                            "formConfig",
                        ],
                    },

                    {
                        model: db.Service,
                        as: "service",
                        attributes: [
                            "id",
                            "name",
                        ],
                    },

                    {
                        model: db.User,
                        as: "users",
                        attributes: [
                            "id",
                            "username",
                        ],
                    },
                ],
            });

            return res.status(200).json(
                Array.isArray(orders)
                    ? orders
                    : []
            );
        } catch (error) {
            console.error(
                "Ошибка получения заказов создателя:",
                error
            );

            return res.status(500).json({
                message: "Ошибка сервера",
            });
        }
    });

    router.post("/:id/executor-before-photos", authenticateToken, uploadExecutorBefore.array("images", 5), async (req, res) => {
            try {
                const orderId = req.params.id;
                const userId = req.user.id;

                const order = await Order.findByPk(orderId);
                if (!order) return res.status(404).json({ message: "Заказ не найден" });

                if (Number(order.executorId) !== Number(userId)) {
                    return res.status(403).json({ message: "Только назначенный исполнитель может загрузить эти фото" });
                }

                const existing = Array.isArray(order.executorBeforePhotos) ? order.executorBeforePhotos : [];
                const photoUrls = (req.files || []).map((f) => `/uploads/orders/order_${orderId}/${f.filename}`);

                order.executorBeforePhotos = [...existing, ...photoUrls];
                order.executorBeforeUploadedAt = new Date();

                await order.save();

                await req.logAction({
                    req,
                    actorUserId: userId,
                    actorRole: "user",
                    actionType: "executor_before_photos_uploaded",
                    entityType: "order",
                    entityId: order.id,
                    orderId: order.id,
                    meta: {
                        count: photoUrls.length,
                        photoUrls,
                    },
                });

                return res.json({
                    success: true,
                    executorBeforePhotos: order.executorBeforePhotos,
                });
            } catch (error) {
                console.error("Ошибка загрузки фото исполнителя ДО:", error);
                return res.status(500).json({ message: "Ошибка сервера" });
            }
        });

    router.post("/:id/executor-after-photos", authenticateToken, uploadExecutorAfter.array("images", 5), async (req, res) => {
            try {
                const orderId = req.params.id;
                const userId = req.user.id;

                const order = await Order.findByPk(orderId);
                if (!order) return res.status(404).json({ message: "Заказ не найден" });

                if (Number(order.executorId) !== Number(userId)) {
                    return res.status(403).json({ message: "Только назначенный исполнитель может загрузить эти фото" });
                }

                const existing = Array.isArray(order.executorAfterPhotos) ? order.executorAfterPhotos : [];
                const photoUrls = (req.files || []).map((f) => `/uploads/orders/order_${orderId}/${f.filename}`);

                order.executorAfterPhotos = [...existing, ...photoUrls];
                order.executorAfterUploadedAt = new Date();

                await order.save();

                await req.logAction({
                    req,
                    actorUserId: userId,
                    actorRole: "user",
                    actionType: "executor_after_photos_uploaded",
                    entityType: "order",
                    entityId: order.id,
                    orderId: order.id,
                    meta: {
                        count: photoUrls.length,
                        photoUrls,
                    },
                });

                return res.json({
                    success: true,
                    executorAfterPhotos: order.executorAfterPhotos,
                });
            } catch (error) {
                console.error("Ошибка загрузки фото исполнителя ПОСЛЕ:", error);
                return res.status(500).json({ message: "Ошибка сервера" });
            }
        });

    router.post("/:id/customer-before-photos", authenticateToken, uploadCustomerBefore.array("images", 5), async (req, res) => {
            try {
                const orderId = req.params.id;
                const userId = req.user.id;

                const order = await Order.findByPk(orderId);
                if (!order) return res.status(404).json({ message: "Заказ не найден" });

                if (Number(order.creatorId) !== Number(userId)) {
                    return res.status(403).json({ message: "Только заказчик может загрузить эти фото" });
                }

                const existing = Array.isArray(order.customerBeforePhotos) ? order.customerBeforePhotos : [];
                const photoUrls = (req.files || []).map((f) => `/uploads/orders/order_${orderId}/${f.filename}`);

                order.customerBeforePhotos = [...existing, ...photoUrls];
                order.customerBeforeUploadedAt = new Date();

                await order.save();

                await req.logAction({
                    req,
                    actorUserId: userId,
                    actorRole: "user",
                    actionType: "customer_before_photos_uploaded",
                    entityType: "order",
                    entityId: order.id,
                    orderId: order.id,
                    meta: {
                        count: photoUrls.length,
                        photoUrls,
                    },
                });

                return res.json({
                    success: true,
                    customerBeforePhotos: order.customerBeforePhotos,
                });
            } catch (error) {
                console.error("Ошибка загрузки фото заказчика ДО:", error);
                return res.status(500).json({ message: "Ошибка сервера" });
            }
        });

    router.post("/:id/customer-after-photos", authenticateToken, uploadCustomerAfter.array("images", 5), async (req, res) => {
            try {
                const orderId = req.params.id;
                const userId = req.user.id;

                const order = await Order.findByPk(orderId);
                if (!order) return res.status(404).json({ message: "Заказ не найден" });

                if (Number(order.creatorId) !== Number(userId)) {
                    return res.status(403).json({ message: "Только заказчик может загрузить эти фото" });
                }

                const existing = Array.isArray(order.customerAfterPhotos) ? order.customerAfterPhotos : [];
                const photoUrls = (req.files || []).map((f) => `/uploads/orders/order_${orderId}/${f.filename}`);

                order.customerAfterPhotos = [...existing, ...photoUrls];
                order.customerAfterUploadedAt = new Date();

                await order.save();

                await req.logAction({
                    req,
                    actorUserId: userId,
                    actorRole: "user",
                    actionType: "customer_after_photos_uploaded",
                    entityType: "order",
                    entityId: order.id,
                    orderId: order.id,
                    meta: {
                        count: photoUrls.length,
                        photoUrls,
                    },
                });

                return res.json({
                    success: true,
                    customerAfterPhotos: order.customerAfterPhotos,
                });
            } catch (error) {
                console.error("Ошибка загрузки фото заказчика ПОСЛЕ:", error);
                return res.status(500).json({ message: "Ошибка сервера" });
            }
        });

    router.post("/:id/start-work", authenticateToken, async (req, res) => {
        try {
            const orderId = req.params.id;
            const userId = req.user.id;

            const order = await Order.findByPk(orderId);
            if (!order) return res.status(404).json({ message: "Заказ не найден" });

            if (Number(order.executorId) !== Number(userId)) {
                return res.status(403).json({ message: "Только исполнитель может начать работу" });
            }

            const beforePhotos = Array.isArray(order.executorBeforePhotos) ? order.executorBeforePhotos : [];

            if (!order.workStartedAt) {
                order.workStartedAt = new Date();
                await order.save();
            }

            await req.logAction({
                req,
                actorUserId: userId,
                actorRole: "user",
                actionType: "order_work_started",
                entityType: "order",
                entityId: order.id,
                orderId: order.id,
                meta: {
                    workStartedAt: order.workStartedAt,
                    executorBeforePhotosCount: beforePhotos.length,
                },
            });

            await notifyUser({
                userId: order.creatorId,
                type: "order_started",
                title: "Исполнитель начал работу",
                body: `По заказу №${order.id} отмечено начало работы`,
                orderId: order.id,
                orderType: "regular",
                data: {
                    creatorId: order.creatorId,
                    executorId: order.executorId,
                    workStartedAt: order.workStartedAt,
                },
                socketEvent: "orderStarted",
                socketPayload: {
                    orderId: order.id,
                    creatorId: order.creatorId,
                    executorId: order.executorId,
                    workStartedAt: order.workStartedAt,
                    message: "Исполнитель начал работу",
                },
            });

            return res.json({
                success: true,
                workStartedAt: order.workStartedAt,
            });
        } catch (error) {
            console.error("Ошибка начала работы:", error);
            return res.status(500).json({ message: "Ошибка сервера" });
        }
    });

    router.patch("/:orderId/hide-by-creator", authenticateToken, async (req, res) => {
        try {
            const { orderId } = req.params;
            const actorUserId = req.user.id;

            const order = await Order.findByPk(orderId);

            if (!order) {
                return res.status(404).json({ message: "Заказ не найден" });
            }

            if (Number(order.creatorId) !== Number(actorUserId)) {
                await req.logAction?.({
                    req,
                    actorUserId,
                    actorRole: "user",
                    actionType: "order_hide_denied",
                    entityType: "order",
                    entityId: order.id,
                    orderId: order.id,
                    severity: "warn",
                    success: false,
                    meta: {
                        reason: "not_creator",
                        creatorId: order.creatorId,
                        actorUserId,
                    },
                });

                return res.status(403).json({
                    message: "Можно удалить только свой заказ",
                });
            }

            const allowedStatuses = ["pending", "pending_payment"];

            if (!allowedStatuses.includes(order.status)) {
                await req.logAction?.({
                    req,
                    actorUserId,
                    actorRole: "user",
                    actionType: "order_hide_denied",
                    entityType: "order",
                    entityId: order.id,
                    orderId: order.id,
                    severity: "warn",
                    success: false,
                    meta: {
                        reason: "status_not_allowed",
                        status: order.status,
                        allowedStatuses,
                    },
                });

                return res.status(400).json({
                    message: "Этот заказ уже нельзя удалить. Его можно скрыть только до начала выполнения.",
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
                actorUserId,
                actorRole: "user",
                actionType: "order_hidden_by_creator",
                entityType: "order",
                entityId: order.id,
                orderId: order.id,
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

            io.emit("orderUpdated", {
                orderId: order.id,
                creatorId: order.creatorId,
                action: "hidden_by_creator",
            });

            return res.json({
                success: true,
                message: "Заказ удалён из видимости",
                orderId: order.id,
            });
        } catch (error) {
            console.error("Ошибка скрытия заказа:", error);

            await req.logAction?.({
                req,
                actorUserId: req.user?.id || null,
                actorRole: "user",
                actionType: "order_hide_failed",
                entityType: "order",
                entityId: req.params.orderId || null,
                orderId: req.params.orderId || null,
                severity: "error",
                success: false,
                meta: {
                    error: String(error?.message || error),
                },
            });

            return res.status(500).json({
                message: "Ошибка при удалении заказа",
            });
        }
    });

    return router;
};