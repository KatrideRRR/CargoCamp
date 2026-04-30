const express = require('express');
const router = express.Router();
const NodeGeocoder = require('node-geocoder');
const db = require('../models');
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
const { sendOrderRequestToUser } = require("../socket");

/* ===============================
   Папки uploads
================================ */

const uploadsRoot = path.join(__dirname, "..", "uploads");
const ordersRoot = path.join(uploadsRoot, "orders");
const tempRoot = path.join(uploadsRoot, "temp");
const uploadDocumentRoot = path.join("upload-document");
const contractsRoot = path.join(__dirname, "..", "contracts");

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

ensureDir(uploadsRoot);
ensureDir(ordersRoot);
ensureDir(tempRoot);
ensureDir(uploadDocumentRoot);
ensureDir(contractsRoot);

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

                ensureDir(dir);

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

                ensureDir(dir);

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
            severity: payment.status === "canceled" ? "warning" : "info",
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
            severity: "warning",
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
                proposedSum,
                categoryId,
                subcategoryId,
                serviceId,
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
                const lat = parseFloat(latStr);
                const lng = parseFloat(lngStr);
                if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
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
                coordinatesStr = `${latitude},${longitude}`;
                latlng = { lat: Number(latitude), lng: Number(longitude) };
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

            // paymentType может прийти массивом
            paymentType = Array.isArray(paymentType) ? paymentType[0] : paymentType;
            if (!paymentType) return res.status(400).json({ message: "paymentType обязателен" });

            // promotionTotal
            const promotionTotal = Object.entries(parsedPromotion).reduce((sum, [key, enabled]) => {
                return enabled && PROMOTION_PRICES[key] ? sum + PROMOTION_PRICES[key] : sum;
            }, 0);

            const status = promotionTotal > 0 ? "pending_payment" : "pending";

            // --- normalize ids ---
            const catId = Number(categoryId);
            if (!Number.isFinite(catId) || catId <= 0) {
                return res.status(400).json({ message: "categoryId обязателен" });
            }

            const subId = subcategoryId ? Number(subcategoryId) : null;
            const normalizedSubId = Number.isFinite(subId) && subId > 0 ? subId : null;

            const svcId = serviceId ? Number(serviceId) : null;
            const normalizedSvcId = Number.isFinite(svcId) && svcId > 0 ? svcId : null;

            // --- paymentType default ---
            paymentType = Array.isArray(paymentType) ? paymentType[0] : paymentType;
            paymentType = String(paymentType || "").trim();

            if (!paymentType) paymentType = "cash";

            const allowedPaymentTypes = new Set(["cash", "guarantee", "installment"]);
            if (!allowedPaymentTypes.has(paymentType)) {
                return res.status(400).json({ message: "Некорректный paymentType" });
            }

            const parsedProposedSum =
                proposedSum === "" || proposedSum === null || proposedSum === undefined
                    ? null
                    : Number(proposedSum);

            if (parsedProposedSum !== null && !Number.isFinite(parsedProposedSum)) {
                return res.status(400).json({ message: "Некорректная proposedSum" });
            }

            // 3) Сначала создаём заказ БЕЗ финальных путей картинок
            const newOrder = await Order.create({
                userId,
                address,
                description,
                workTime,
                proposedSum: parsedProposedSum,
                coordinates: coordinatesStr,
                createdAt: new Date().toISOString(),
                images: [],
                creatorId: userId,
                status,
                categoryId: catId,
                subcategoryId: normalizedSubId,
                serviceId: normalizedSvcId,
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
                    categoryId: newOrder.categoryId,
                    subcategoryId: newOrder.subcategoryId,
                    serviceId: newOrder.serviceId,
                    proposedSum: newOrder.proposedSum,
                    promotionTotal: newOrder.promotionCost,
                    coords: newOrder.coordinates,
                    imagesCount: photoUrls.length,
                    imagePaths: photoUrls,
                },
            });

            io.emit("orderUpdated");
            return res.status(201).json(newOrder);

        } catch (error) {
            console.error("Ошибка при создании заказа:", error);
            return res.status(500).json({ message: "Ошибка сервера" });
        }
    });

    router.get('/all', async (req, res) => {
        try {
            // Фильтрация по категории и подкатегории
            const { categoryId, subcategoryId, serviceId } = req.query;
            const whereClause = { status: 'pending' };

            if (categoryId) whereClause.categoryId = categoryId;
            if (subcategoryId) whereClause.subcategoryId = subcategoryId;
            if (serviceId) whereClause.serviceId = Number(serviceId);

            // Запрос заказов с фильтром
            const orders = await Order.findAll({
                attributes: [
                    'id', 'createdAt', 'address', 'description', 'workTime',
                    'images', 'proposedSum', 'creatorId', 'coordinates',
                    'executorId', 'status', 'paymentType',
                    'is_highlighted', 'is_recommended', 'is_push_notified', 'serviceId',
                    'categoryId',
                    'subcategoryId',

                ],
                where: whereClause,
                include: [
                    { model: db.Category, as: 'category', attributes: ['id', 'name'] },
                    { model: db.Subcategory, as: 'subcategory', attributes: ['id', 'name'] },
                    { model: db.Service, as: 'service', attributes: ['id', 'name'] },
                ],
                order: [
                    ['is_recommended', 'DESC'],
                ],

            });

            res.json(orders);
        } catch (error) {
            console.error("❌ Ошибка при получении заказов:", error);
            res.status(500).json({ message: "Ошибка сервера" });
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

    router.get('/:id', async (req, res) => {
        const { id } = req.params;

        try {
            // Ищем заказ по ID, включая данные о пользователе
            const order = await Order.findByPk(id, {
                include:[ { model: db.User, as: 'users', attributes: ['id', 'username', 'phone'] },
                          { model: db.Category, as: 'category', attributes: ['id', 'name'] },
                          { model: db.Subcategory, as: 'subcategory', attributes: ['id', 'name'] },
        ],
            });

            // Если заказ не найден
            if (!order) {
                return res.status(404).json({ message: 'Order not found' });
            }

            res.json(order);
        } catch (error) {
            console.error('Error fetching order:', error);
            res.status(500).json({ message: 'Server error' });
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

            sendOrderRequestToUser(order.creatorId || order.userId, {
                orderId: order.id,
                requesterId: executorId,
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

            const filePath = path.join(contractsRoot, `contract_${fullOrder.id}.pdf`);

            try {
                await generateContractPDF(contractData, filePath);

                fullOrder.contractPath = path.relative(path.join(__dirname, ".."), filePath);
                await fullOrder.save();
            } catch (err) {
                console.error("❌ Ошибка генерации PDF договора:", err);
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

            io.to(`user_${fullOrder.executorId}`).emit("orderApproved", {
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
                io.to(`user_${order.executorId}`).emit("orderCompleted", {
                    orderId: order.id,
                    message: "Заказчик предложил завершить заказ",
                });
            }

            if (order.completedBy.includes(order.executorId) && !order.completedBy.includes(order.creatorId)) {
                io.to(`user_${order.creatorId}`).emit("orderCompleted", {
                    orderId: order.id,
                    message: "Исполнитель предложил завершить заказ",
                    creatorId: order.creatorId,
                    executorId: order.executorId,
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
                    const contractPath = path.join(contractsRoot, `contract_${order.id}.pdf`);
                    await generateContractPDF(data, contractPath);

                    fullOrder.contractPath = path.relative(path.join(__dirname, ".."), contractPath);
                    await fullOrder.save();
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
                attributes: ['id','address','proposedSum', 'status', 'completedAt', 'creatorId', 'executorId', 'description', 'contractPath'], // Указываем, какие поля хотим вернуть
            });

            // Отправляем заказ с актуальной датой завершения
            res.json(completedOrders);
        } catch (error) {
            console.error('Ошибка при получении завершенных заказов:', error);
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    });

    router.get('/creator/:userId', async (req, res) => {
        const { userId } = req.params;

        try {
            const orders = await Order.findAll({
                where: {
                    creatorId: userId,
                    status: ["pending", "pending_payment"],
                },  // Фильтруем заказы по ID создателя
                order: [["createdAt", "DESC"]],
                include: [
                    { model: db.Category, as: 'category', attributes: ['id', 'name'] },
                    { model: db.Subcategory, as: 'subcategory', attributes: ['id', 'name'] },
                    { model: db.User, as: 'users', attributes: ['id', 'username'] }
                ]

            });

            if (!orders || orders.length === 0) {
                return res.status(200).json([]); // Возвращаем пустой массив вместо 404
            }


            res.json(orders);
        } catch (error) {
            console.error('Error fetching orders:', error);
            res.status(500).json({ message: 'Ошибка сервера' });
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

            return res.json({
                success: true,
                workStartedAt: order.workStartedAt,
            });
        } catch (error) {
            console.error("Ошибка начала работы:", error);
            return res.status(500).json({ message: "Ошибка сервера" });
        }
    });

    return router;
};