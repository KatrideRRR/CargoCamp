const { v4: uuidv4 } = require("uuid");
const express = require("express");
const router = express.Router();
const { Order, User } = require('../models'); // sequelize models
const db = require("../models");
const authenticateToken = require('../middlewares/userAuth'); // если нужен
const { randomUUID } = require('crypto');
const yooKassa = require('../config/yookassaClient');
const { sendOrderPush } = require("../utils/orderPushService");
const {sendAdminNotification, adminUsersUrl, adminOrderUrl} = require("../services/adminNotificationService");

function notifyPaymentProblem({provider, type, title, message, userId = null, orderId = null,}) {
    const buttonUrl =
        orderId
            ? adminOrderUrl(orderId)
            : adminUsersUrl();

    const buttonText =
        orderId
            ? "Открыть заказ"
            : "Открыть пользователей";

    void sendAdminNotification({
        topic: "payments",

        title,

        message: [
            `Провайдер: ${provider}`,
            type ? `Тип: ${type}` : null,
            userId ? `Пользователь ID: ${userId}` : null,
            orderId ? `Заказ ID: ${orderId}` : null,
            "",
            message,
        ]
            .filter(Boolean)
            .join("\n"),

        buttonText,
        buttonUrl,
    });
}

router.post('/premium/create', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { duration } = req.body; // "7d" | "30d"

        const prices = {
            "7d": "2500.00",
            "30d": "9000.00",
        };

        const amountValue = prices[duration];

        if (!amountValue) {
            return res.status(400).json({
                success: false,
                error: "Неверная длительность",
            });
        }

        const user = await User.findByPk(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: "Пользователь не найден",
            });
        }

        const addDays = duration === "7d" ? 7 : 30;
        const idempotenceKey = uuidv4();

        const basePayload = {
            amount: {
                value: amountValue,
                currency: "RUB",
            },
            capture: true,
            description: `Premium ${duration} для пользователя #${userId}`,
            metadata: {
                type: "premium",
                userId: String(userId),
                duration,
            },
            receipt: {
                customer: {
                    phone: String(user.phone || "").replace(/[^\d+]/g, ""),
                },
                items: [
                    {
                        description: `Подписка Premium (${addDays} дней)`,
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
        };

        /**
         * ✅ 1) Если карта привязана — пробуем списать сразу.
         */
        if (user.yookassa_payment_method_id) {
            const payment = await yooKassa.createPayment(
                {
                    ...basePayload,
                    payment_method_id: user.yookassa_payment_method_id,
                },
                idempotenceKey
            );

            await req.logAction?.({
                req,
                actorUserId: userId,
                actorRole: "user",
                actionType: "payment_create",
                entityType: "payment",
                paymentId: payment.id,
                severity: payment.status === "canceled" ? "warn" : "info",
                meta: {
                    provider: "yookassa",
                    type: "premium",
                    duration,
                    amount: amountValue,
                    status: payment.status,
                    paidBySavedCard: true,
                },
            });

            if (payment.status === "canceled") {

                notifyPaymentProblem({
                    provider: "YooKassa",
                    type: "premium",

                    title: "❌ Не удалось оплатить Premium",

                    userId,

                    message: [
                        `Payment ID: ${payment.id}`,
                        `Статус: ${payment.status}`,
                        `Сумма: ${amountValue} ₽`,
                        `Период: ${duration}`,
                    ].join("\n"),
                });

                return res.json({
                    success: false,
                    paidBySavedCard: true,
                    paymentProcessing: false,
                    paymentId: payment.id,
                    status: payment.status,
                    error:
                        "Не удалось списать с привязанной карты. Проверьте баланс карты или выберите другой способ оплаты.",
                });
            }

            /**
             * ✅ Если ЮKassa сразу вернула succeeded —
             * активируем Premium сразу, не дожидаясь webhook.
             */
            if (payment.status === "succeeded") {
                if (user.premium_last_payment_id !== payment.id) {
                    const now = new Date();

                    const currentExp = user.subscription_expires_at
                        ? new Date(user.subscription_expires_at)
                        : null;

                    const base =
                        user.subscription_type === "premium" &&
                        currentExp &&
                        currentExp > now
                            ? currentExp
                            : now;

                    const newExp = new Date(
                        base.getTime() + addDays * 24 * 60 * 60 * 1000
                    );

                    await user.update({
                        subscription_type: "premium",
                        subscription_expires_at: newExp,
                        premium_last_payment_id: payment.id,
                    });

                    await req.logAction?.({
                        req,
                        actorUserId: userId,
                        actorRole: "system",
                        actionType: "premium_activated",
                        entityType: "user",
                        entityId: userId,
                        paymentId: payment.id,
                        severity: "info",
                        meta: {
                            provider: "yookassa",
                            duration,
                            addDays,
                            subscriptionExpiresAt: newExp,
                            activatedBy: "saved_card_payment",
                        },
                    });
                }
            }

            return res.json({
                success: true,
                paidBySavedCard: true,
                paymentProcessing: payment.status !== "succeeded",
                paid: payment.status === "succeeded",
                paymentId: payment.id,
                status: payment.status,
                message:
                    payment.status === "succeeded"
                        ? "Premium оплачен с привязанной карты"
                        : "Платёж создан. Premium активируется после подтверждения оплаты.",
            });
        }

        /**
         * ✅ 2) Если карты нет — обычная оплата через redirect.
         */
        const payment = await yooKassa.createPayment(
            {
                ...basePayload,
                confirmation: {
                    type: "redirect",
                    return_url: `${process.env.FRONTEND_URL}/profile?premiumReturn=1&paymentId={payment_id}`,
                },
            },
            idempotenceKey
        );

        await req.logAction?.({
            req,
            actorUserId: userId,
            actorRole: "user",
            actionType: "payment_create",
            entityType: "payment",
            paymentId: payment.id,
            severity: "info",
            meta: {
                provider: "yookassa",
                type: "premium",
                duration,
                amount: amountValue,
                status: payment.status,
                paidBySavedCard: false,
            },
        });

        return res.json({
            success: true,
            paidBySavedCard: false,
            paymentId: payment.id,
            confirmationUrl: payment.confirmation?.confirmation_url,
            status: payment.status,
        });
    } catch (e) {
        console.error("premium/create error:", e);

        return res.status(500).json({
            success: false,
            error: e?.message || "Internal server error",
        });
    }
});

router.post('/debt/create', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { returnPath } = req.body || {};

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({ success: false, error: 'Пользователь не найден' });
        }

        const debtKopecks = Number(user.debt || 0);
        if (debtKopecks <= 0) {
            return res.json({ success: true, noDebt: true });
        }

        const amountValue = (debtKopecks / 100).toFixed(2);
        const idempotenceKey = uuidv4();

        const safeReturnPath =
            typeof returnPath === "string" && returnPath.startsWith("/")
                ? returnPath
                : "/profile?debtReturn=1";

        const returnUrl = `${process.env.FRONTEND_URL}${safeReturnPath}`;

        const basePayload = {
            amount: { value: amountValue, currency: 'RUB' },
            capture: true,
            description: `Оплата комиссии (задолженность) пользователя #${userId}`,
            metadata: {
                type: 'debt',
                userId: String(userId),
                expectedKopecks: String(debtKopecks),
            },
            receipt: {
                customer: {
                    phone: String(user.phone || '').replace(/[^\d+]/g, ''),
                },
                items: [
                    {
                        description: `Оплата комиссии (задолженность)`,
                        quantity: 1,
                        amount: { value: amountValue, currency: 'RUB' },
                        vat_code: 1,
                        payment_mode: 'full_payment',
                        payment_subject: 'service',
                    }
                ],
                tax_system_code: 2,
            },
        };

        if (user.yookassa_payment_method_id) {
            const payment = await yooKassa.createPayment(
                {
                    ...basePayload,
                    payment_method_id: user.yookassa_payment_method_id,
                },
                idempotenceKey
            );

            await req.logAction?.({
                req,
                actorUserId: userId,
                actorRole: "user",
                actionType: "payment_create",
                entityType: "payment",
                paymentId: payment.id,
                severity: payment.status === "canceled" ? "warn" : "info",
                meta: {
                    provider: "yookassa",
                    type: "debt",
                    amount: amountValue,
                    status: payment.status,
                    paidBySavedCard: true,
                },
            });

            if (payment.status === "canceled") {

                notifyPaymentProblem({
                    provider: "YooKassa",
                    type: "debt",
                    title: "❌ Не удалось погасить задолженность",
                    userId,
                    message: [
                        `Payment ID: ${payment.id}`,
                        `Статус: ${payment.status}`,
                        `Сумма: ${amountValue} ₽`,
                    ].join("\n"),

                });

                return res.json({
                    success: false,
                    paidBySavedCard: true,
                    paymentProcessing: false,
                    paymentId: payment.id,
                    status: payment.status,
                    error:
                        "Не удалось списать с привязанной карты. Проверьте баланс карты или выберите другой способ оплаты.",
                });
            }

            return res.json({
                success: true,
                paidBySavedCard: true,
                paymentProcessing: true,
                paid: false,
                paymentId: payment.id,
                status: payment.status,
                message:
                    "Платёж создан. Долг будет погашен после подтверждения оплаты.",
            });
        }

        const payment = await yooKassa.createPayment(
            {
                ...basePayload,
                confirmation: {
                    type: 'redirect',
                    return_url: returnUrl,
                },
            },
            idempotenceKey
        );

        await req.logAction?.({
            req,
            actorUserId: userId,
            actorRole: "user",
            actionType: "payment_create",
            entityType: "payment",
            paymentId: payment.id,
            severity: "info",
            meta: {
                provider: "yookassa",
                type: "debt",
                amount: amountValue,
                status: payment.status,
                paidBySavedCard: false,
                returnUrl,
            },
        });

        return res.json({
            success: true,
            paidBySavedCard: false,
            paymentId: payment.id,
            confirmationUrl: payment.confirmation?.confirmation_url,
        });
    } catch (e) {
        console.error('debt/pay error:', e);

        notifyPaymentProblem({

            provider: "YooKassa",

            type: "premium",

            title: "🚨 Ошибка оплаты долга за заказ",

            userId: req.user?.id,

            message:

                `Ошибка: ${e?.message || "Unknown error"}`,

        });

        return res.status(500).json({
            success: false,
            error: e?.message || 'Internal server error',
        });
    }
});

router.post('/card/bind/create', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const bindToken = uuidv4();

        const user = await User.findByPk(userId);
        if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден' });

        const idempotenceKey = uuidv4();

        const payment = await yooKassa.createPayment(
            {
                amount: {
                    value: "1.00",
                    currency: "RUB",
                },

                capture: true,
                save_payment_method: true,

                confirmation: {
                    type: "redirect",
                    return_url: `${process.env.FRONTEND_URL}/profile?bindReturn=1&bindToken=${bindToken}`,
                },

                description: `Привязка карты пользователя #${userId}`,

                metadata: {
                    type: "bind_card",
                    userId: String(userId),
                    bindToken,
                },
                receipt: {
                    customer: {
                        phone: String(user.phone || "").replace(/[^\d+]/g, ""),
                    },
                    items: [
                        {
                            description: "Привязка карты",
                            quantity: 1,
                            amount: { value: "1.00", currency: "RUB" },
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

        await req.logAction?.({
            req,
            actorUserId: userId,
            actorRole: "user",
            actionType: "payment_create",
            entityType: "payment",
            paymentId: payment.id,
            severity: "info",
            meta: {
                provider: "yookassa",
                type: "bind_card",
                amount: "0.00",
                status: payment.status,
            },
        });

        return res.json({
            success: true,
            paymentId: payment.id,
            confirmationUrl: payment.confirmation?.confirmation_url,
            status: payment.status,
        });
    } catch (e) {
        console.error("card/bind/create error:", e);

        notifyPaymentProblem({

            provider: "YooKassa",

            type: "premium",

            title: "🚨 Ошибка привязки карты ",

            userId: req.user?.id,

            message:

                `Ошибка: ${e?.message || "Unknown error"}`,

        });

        return res.status(500).json({
            success: false,
            error: e?.message || "Internal server error",
        });
    }
});

router.post('/card/unbind', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const user = await User.findByPk(userId);
        if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден' });

        await user.update({
            yookassa_payment_method_id: null,
            yookassa_payment_method_saved_at: null,
            cardLastFour: null,
            cardType: null,
        });

        return res.json({ success: true });
    } catch (e) {
        console.error('card/unbind error:', e);
        return res.status(500).json({ success: false, error: e?.message || 'Internal server error' });
    }
});

router.post('/order/promotion/create', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { orderId } = req.body;

        if (!orderId) {
            return res.status(400).json({
                success: false,
                error: 'orderId обязателен',
            });
        }

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'Пользователь не найден',
            });
        }

        const order = await Order.findByPk(orderId);
        if (!order) {
            return res.status(404).json({
                success: false,
                error: 'Заказ не найден',
            });
        }

        if (Number(order.creatorId) !== Number(userId)) {
            return res.status(403).json({
                success: false,
                error: 'Нет доступа к этому заказу',
            });
        }

        if (order.status !== 'pending_payment') {
            return res.status(400).json({
                success: false,
                error: 'Этот заказ не требует оплаты продвижения',
            });
        }

        const PROMOTION_PRICES = {
            highlight: 50,
            recommended: 100,
            push: 150,
        };

        let pr = order.promotionRequested || {};

        if (typeof pr === "string") {
            try {
                pr = JSON.parse(pr);
            } catch {
                pr = {};
            }
        }

        const total = Object.entries(pr).reduce((sum, [key, enabled]) => {
            return enabled && PROMOTION_PRICES[key]
                ? sum + PROMOTION_PRICES[key]
                : sum;
        }, 0);

        if (total <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Продвижение не выбрано',
            });
        }

        const amountValue = total.toFixed(2);
        const idempotenceKey = uuidv4();

        const basePayload = {
            amount: {
                value: amountValue,
                currency: 'RUB',
            },
            capture: true,
            description: `Продвижение заказа #${orderId}`,
            metadata: {
                type: 'order_promotion',
                orderId: String(orderId),
                userId: String(userId),
            },
            receipt: {
                customer: {
                    phone: String(user.phone || '').replace(/[^\d+]/g, ''),
                },
                items: [
                    {
                        description: `Продвижение заказа #${orderId}`,
                        quantity: 1,
                        amount: {
                            value: amountValue,
                            currency: 'RUB',
                        },
                        vat_code: 1,
                        payment_mode: 'full_payment',
                        payment_subject: 'service',
                    },
                ],
                tax_system_code: 2,
            },
        };

        /**
         * ✅ 1) Если карта привязана — пробуем списать сразу.
         */
        if (user.yookassa_payment_method_id) {
            const payment = await yooKassa.createPayment(
                {
                    ...basePayload,
                    payment_method_id: user.yookassa_payment_method_id,
                },
                idempotenceKey
            );

            await order.update({
                promotionPaymentId: payment.id,
                promotionPaymentProvider: "yookassa",
            });

            await req.logAction?.({
                req,
                actorUserId: userId,
                actorRole: "user",
                actionType: "payment_create",
                entityType: "payment",
                paymentId: payment.id,
                orderId: Number(orderId),
                severity: payment.status === "canceled" ? "warn" : "info",
                meta: {
                    provider: "yookassa",
                    type: "order_promotion",
                    amount: amountValue,
                    status: payment.status,
                    paidBySavedCard: true,
                },
            });

            if (payment.status === "canceled") {

                notifyPaymentProblem({
                    provider: "YooKassa",
                    type: "order_promotion",
                    title: "❌ Ошибка оплаты продвижения",
                    userId,
                    orderId: order.id,
                    message: [
                        `Payment ID: ${payment.id}`,
                        `Статус: ${payment.status}`,
                        `Сумма: ${amountValue} ₽`,
                    ].join("\n"),
                });

                return res.json({
                    success: false,
                    paidBySavedCard: true,
                    paymentProcessing: false,
                    paymentId: payment.id,
                    status: payment.status,
                    error:
                        "Не удалось списать с привязанной карты. Проверьте баланс карты или выберите другой способ оплаты.",
                });
            }

            /**
             * ✅ Если ЮKassa сразу вернула succeeded — можно активировать продвижение сразу,
             * не дожидаясь вебхука. Вебхук потом придёт повторно, но ничего страшного.
             */
            if (payment.status === "succeeded") {
                await order.update({
                    status: "pending",
                    is_highlighted: !!pr.highlight,
                    is_recommended: !!pr.recommended,
                    is_push_notified: !!pr.push,
                    promotionPaidAt: new Date(),
                });

                req.app.locals.io?.emit("orderUpdated");

                if (pr.push) {
                    try {
                        const logAction =
                            req.logAction ||
                            req.app?.locals?.logAction ||
                            null;

                        await sendOrderPush({
                            db,
                            io: req.app.locals.io,
                            orderId: order.id,
                            radiusKm: 50,
                            limit: 10,
                            logAction,
                        });
                    } catch (e) {
                        console.error("sendOrderPush error:", e);
                    }
                }
            }

            return res.json({
                success: true,
                paidBySavedCard: true,
                paymentProcessing: payment.status !== "succeeded",
                paid: payment.status === "succeeded",
                paymentId: payment.id,
                status: payment.status,
                message:
                    payment.status === "succeeded"
                        ? "Продвижение оплачено с привязанной карты"
                        : "Платёж создан. Продвижение активируется после подтверждения оплаты.",
            });
        }

        /**
         * ✅ 2) Если карты нет — обычный redirect.
         */
        const payment = await yooKassa.createPayment(
            {
                ...basePayload,
                confirmation: {
                    type: 'redirect',
                    return_url: `${process.env.FRONTEND_URL}/orders?promoReturn=1&orderId=${orderId}&paymentId={payment_id}`,
                },
            },
            idempotenceKey
        );

        await order.update({
            promotionPaymentId: payment.id,
            promotionPaymentProvider: "yookassa",
        });

        await req.logAction?.({
            req,
            actorUserId: userId,
            actorRole: "user",
            actionType: "payment_create",
            entityType: "payment",
            paymentId: payment.id,
            orderId: Number(orderId),
            severity: "info",
            meta: {
                provider: "yookassa",
                type: "order_promotion",
                amount: amountValue,
                status: payment.status,
                paidBySavedCard: false,
            },
        });

        return res.json({
            success: true,
            paidBySavedCard: false,
            paymentId: payment.id,
            confirmationUrl: payment.confirmation?.confirmation_url,
            status: payment.status,
        });
    } catch (e) {
        console.error('order/promotion/create error:', e);

        notifyPaymentProblem({

            provider: "YooKassa",

            type: "premium",

            title: "🚨 Ошибка оплаты продвижения",

            userId: req.user?.id,

            message:

                `Ошибка: ${e?.message || "Unknown error"}`,

        });

        return res.status(500).json({
            success: false,
            error: e?.message || 'Internal server error',
        });
    }
});

router.post('/guarantee/create', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { orderId } = req.body;

        if (!orderId) return res.status(400).json({ success: false, error: 'orderId обязателен' });

        const order = await Order.findByPk(orderId);
        if (!order) return res.status(404).json({ success: false, error: 'Заказ не найден' });

        if (order.creatorId !== userId) {
            return res.status(403).json({ success: false, error: 'Нет доступа' });
        }

        if (order.paymentType !== 'guarantee') {
            return res.status(400).json({ success: false, error: 'Этот заказ не в режиме гарантии' });
        }

        if (!order.executorId) {
            return res.status(400).json({ success: false, error: 'Сначала выберите исполнителя' });
        }

        if (order.dealStatus !== 'waiting_payment') {
            return res.status(400).json({ success: false, error: 'Этот заказ не ожидает оплату' });
        }

        const amountKopecks = Number(order.finalPriceKopecks || 0);
        if (amountKopecks <= 0) {
            return res.status(400).json({ success: false, error: 'Сумма заказа некорректна' });
        }

        const amountValue = (amountKopecks / 100).toFixed(2);

        const customer = await User.findByPk(userId);
        if (!customer) return res.status(404).json({ success: false, error: 'Пользователь не найден' });

        const idempotenceKey = randomUUID();

        const payment = await yooKassa.createPayment({
            amount: { value: amountValue, currency: 'RUB' },

            capture: false,

            confirmation: {
                type: 'redirect',
                return_url: `${process.env.FRONTEND_URL}/my-orders/${userId}?guaranteeReturn=1`            },

            description: `Гарантия по заказу #${orderId}`,
            metadata: {
                type: 'guarantee',
                orderId: String(orderId),
                creatorId: String(order.creatorId),
                executorId: String(order.executorId),
                expectedKopecks: String(amountKopecks),
            },

            // чек (как у тебя)
            receipt: {
                customer: { phone: String(customer.phone || '').replace(/[^\d+]/g, '') },
                items: [{
                    description: `Гарантия по заказу #${orderId}`,
                    quantity: 1,
                    amount: { value: amountValue, currency: 'RUB' },
                    vat_code: 1,
                    payment_mode: 'full_payment',
                    payment_subject: 'service',
                }],
                tax_system_code: 2,
            },
        }, idempotenceKey);

        await order.update({
            yookassa_payment_id: payment.id,
            yookassa_payment_status: payment.status,
        });

        await req.logAction({
            req,
            actorUserId: userId,
            actorRole: "user",
            actionType: "payment_create",
            entityType: "payment",
            paymentId: payment.id,
            orderId: Number(orderId),
            meta: {
                provider: "yookassa",
                type: "guarantee",
                amount: amountValue,
                capture: false,
                status: payment.status,
                executorId: order.executorId,
            },
        });

        return res.json({
            success: true,
            paymentId: payment.id,
            status: payment.status,
            confirmationUrl: payment.confirmation?.confirmation_url,
        });

    } catch (e) {
        console.error('guarantee/create error:', e);
        return res.status(500).json({ success: false, error: e?.message || 'Internal server error' });
    }
});

router.post("/yookassa/webhook", async (req, res) => {
    const io = req.app.locals.io;

    if (!io) {
        console.warn("⚠️ io is not initialized yet");
    }

    try {
        const event = req.body;

        const allowed = [
            "payment.waiting_for_capture",
            "payment.succeeded",
            "payment.canceled",
        ];

        if (!allowed.includes(event?.event)) {
            return res.sendStatus(200);
        }

        const payment = event.object;
        const meta = payment?.metadata || {};
        const paymentStatus = payment?.status;
        const eventName = event.event;

        await req.logAction?.({
            req,
            actorUserId: null,
            actorRole: "webhook",
            actionType: `yookassa_${eventName}`,
            entityType: "payment",
            paymentId: payment.id,
            orderId: meta.orderId ? Number(meta.orderId) : null,
            severity: eventName === "payment.canceled" ? "warn" : "info",
            meta: {
                type: meta.type,
                status: paymentStatus,
                amount: payment.amount?.value,
                currency: payment.amount?.currency,
            },
        });

        /**
         * 1) Premium
         * ВАЖНО: активируем только при payment.succeeded.
         */
        if (meta.type === "premium") {
            if (eventName !== "payment.succeeded") {
                return res.sendStatus(200);
            }

            const userId = Number(meta.userId);
            const duration = meta.duration;

            const addDays =
                duration === "7d"
                    ? 7
                    : duration === "30d"
                        ? 30
                        : 0;

            if (!userId || !addDays) {
                return res.sendStatus(200);
            }

            const user = await User.findByPk(userId);

            if (!user) {
                return res.sendStatus(200);
            }

            /**
             * ✅ Защита от двойной активации:
             * если этот payment.id уже применяли — ничего не делаем.
             */
            if (user.premium_last_payment_id === payment.id) {
                return res.sendStatus(200);
            }

            const now = new Date();

            const currentExp = user.subscription_expires_at
                ? new Date(user.subscription_expires_at)
                : null;

            const base =
                user.subscription_type === "premium" &&
                currentExp &&
                currentExp > now
                    ? currentExp
                    : now;

            const newExp = new Date(
                base.getTime() + addDays * 24 * 60 * 60 * 1000
            );

            await user.update({
                subscription_type: "premium",
                subscription_expires_at: newExp,
                premium_last_payment_id: payment.id,
            });

            await req.logAction?.({
                req,
                actorUserId: userId,
                actorRole: "webhook",
                actionType: "premium_activated",
                entityType: "user",
                entityId: userId,
                paymentId: payment.id,
                severity: "info",
                meta: {
                    provider: "yookassa",
                    duration,
                    addDays,
                    subscriptionExpiresAt: newExp,
                    activatedBy: "webhook",
                },
            });

            return res.sendStatus(200);
        }

        /**
         * 2) Debt / Commission
         * ВАЖНО:
         * - payment.succeeded => уменьшаем долг
         * - payment.canceled  => долг НЕ трогаем
         */
        if (meta.type === "debt") {
            const userId = Number(meta.userId);
            const orderId = meta.orderId ? Number(meta.orderId) : null;

            const user = await User.findByPk(userId);
            if (!user) {
                return res.sendStatus(200);
            }

            if (eventName === "payment.canceled") {

                notifyPaymentProblem({
                    provider: "YooKassa",
                    type: "debt",

                    title: "⚠️ YooKassa отменила платёж задолженности",

                    userId,
                    orderId,

                    message: [
                        `Payment ID: ${payment.id}`,
                        `Статус: ${paymentStatus}`,
                        `Сумма: ${payment.amount?.value || "—"} ₽`,
                        payment.cancellation_details
                            ? `Причина: ${JSON.stringify(payment.cancellation_details)}`
                            : null,
                    ]
                        .filter(Boolean)
                        .join("\n"),
                });

                await req.logAction?.({
                    req,
                    actorUserId: userId,
                    actorRole: "webhook",
                    actionType: "debt_payment_canceled",
                    entityType: "payment",
                    paymentId: payment.id,
                    orderId,
                    severity: "warn",
                    meta: {
                        provider: "yookassa",
                        currentDebt: Number(user.debt || 0),
                        amount: payment.amount?.value,
                        reason: payment.cancellation_details || null,
                    },
                });

                return res.sendStatus(200);
            }

            if (eventName !== "payment.succeeded") {
                return res.sendStatus(200);
            }

            const paidKopecks = Math.round(
                parseFloat(payment.amount.value) * 100
            );

            const currentDebt = Number(user.debt || 0);

            if (currentDebt <= 0) {
                return res.sendStatus(200);
            }

            const newDebt = Math.max(0, currentDebt - paidKopecks);

            await user.update({
                debt: newDebt,
                commissionDebtOrderId:
                    newDebt === 0 ? null : user.commissionDebtOrderId,
            });

            await req.logAction?.({
                req,
                actorUserId: userId,
                actorRole: "webhook",
                actionType: "debt_payment_succeeded",
                entityType: "payment",
                paymentId: payment.id,
                orderId,
                severity: "info",
                meta: {
                    provider: "yookassa",
                    paidKopecks,
                    oldDebt: currentDebt,
                    newDebt,
                },
            });

            return res.sendStatus(200);
        }

        /**
         * 3) Bind Card
         * Сохраняем карту только при payment.succeeded
         * и только если payment_method.saved === true.
         */
        if (meta.type === "bind_card") {
            if (eventName !== "payment.succeeded") {
                return res.sendStatus(200);
            }

            const userId = Number(meta.userId);

            const user = await User.findByPk(userId);
            if (!user) {
                return res.sendStatus(200);
            }

            const pm = payment.payment_method;
            const pmId = pm?.id || null;
            const isSaved = pm?.saved === true;

            const last4 = pm?.card?.last4 || null;
            const cardType = pm?.card?.card_type || null;

            if (!pmId || !isSaved) {
                console.warn("bind_card: payment_method is not saved", {
                    paymentId: payment?.id,
                    pmId,
                    saved: pm?.saved,
                    status: payment?.status,
                });

                return res.sendStatus(200);
            }

            await user.update({
                yookassa_payment_method_id: pmId,
                yookassa_payment_method_saved_at: new Date(),
                cardLastFour: last4,
                cardType,
            });

            await req.logAction?.({
                req,
                actorUserId: userId,
                actorRole: "webhook",
                actionType: "card_bound",
                entityType: "user",
                paymentId: payment.id,
                severity: "info",
                meta: {
                    provider: "yookassa",
                    paymentMethodId: pmId,
                    cardLastFour: last4,
                    cardType,
                },
            });

            return res.sendStatus(200);
        }

        /**
         * 4) Promotion
         * ВАЖНО: активируем продвижение только при payment.succeeded.
         */
        if (meta.type === "order_promotion") {
            if (eventName !== "payment.succeeded") {
                return res.sendStatus(200);
            }

            const orderId = Number(meta.orderId);

            const order = await Order.findByPk(orderId);
            if (!order) {
                return res.sendStatus(200);
            }

            // ✅ Уже обработали именно этот платёж — ничего не делаем
            if (order.promotionPaymentId === payment.id && order.promotionPaidAt) {
                return res.sendStatus(200);
            }

            // ✅ Если у заказа уже есть другой paymentId — не трогаем
            if (
                order.promotionPaymentId &&
                order.promotionPaymentId !== payment.id
            ) {
                return res.sendStatus(200);
            }

            let pr = order.promotionRequested || {};

            if (typeof pr === "string") {
                try {
                    pr = JSON.parse(pr);
                } catch {
                    pr = {};
                }
            }

            const shouldSendPush = !!pr.push && !order.promotionPaidAt;

            await order.update({
                status: "pending",
                is_highlighted: !!pr.highlight,
                is_recommended: !!pr.recommended,
                is_push_notified: !!pr.push,
                promotionPaidAt: order.promotionPaidAt || new Date(),
                promotionPaymentId: payment.id,
                promotionPaymentProvider: "yookassa",
            });

            io?.emit("orderUpdated");

            if (shouldSendPush) {
                try {
                    const logAction =
                        req.logAction ||
                        req.app?.locals?.logAction ||
                        null;

                    await sendOrderPush({
                        db,
                        io,
                        orderId: order.id,
                        radiusKm: 50,
                        limit: 10,
                        logAction,
                    });
                } catch (e) {
                    console.error("sendOrderPush error:", e);
                }
            }

            return res.sendStatus(200);
        }

        /**
         * 5) Guarantee
         */
        if (meta.type === "guarantee") {
            const orderId = Number(meta.orderId);

            const order = await Order.findByPk(orderId);
            if (!order) {
                return res.sendStatus(200);
            }

            if (
                order.yookassa_payment_id &&
                order.yookassa_payment_id !== payment.id
            ) {
                return res.sendStatus(200);
            }

            if (eventName === "payment.waiting_for_capture") {
                await order.update({
                    dealStatus: "funds_held",
                    yookassa_payment_status: paymentStatus,
                    funds_held_at: new Date(),
                });

                io?.to(`user_${order.executorId}`).emit("guaranteeHeld", {
                    orderId: order.id,
                    message:
                        "Заказ оплачен по гарантии. Деньги заморожены ✅ Можно приступать.",
                });

                return res.sendStatus(200);
            }

            if (eventName === "payment.canceled") {
                await order.update({
                    dealStatus: "payment_failed",
                    yookassa_payment_status: paymentStatus,
                    payment_failed_at: new Date(),
                });

                return res.sendStatus(200);
            }

            if (eventName === "payment.succeeded") {
                await order.update({
                    dealStatus: "captured",
                    yookassa_payment_status: paymentStatus,
                    captured_at: new Date(),
                });

                return res.sendStatus(200);
            }

            return res.sendStatus(200);
        }

        return res.sendStatus(200);
    } catch (e) {
        console.error("yookassa webhook error:", e);

        notifyPaymentProblem({
            provider: "YooKassa",
            type: "webhook",

            title: "🚨 Ошибка обработки YooKassa webhook",

            message: [
                `Ошибка: ${e?.message || "Unknown error"}`,
                req.body?.event
                    ? `Event: ${req.body.event}`
                    : null,
                req.body?.object?.id
                    ? `Payment ID: ${req.body.object.id}`
                    : null,
            ]
                .filter(Boolean)
                .join("\n"),
        });

        return res.sendStatus(200);
    }
});

router.get("/card/bind/status", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { paymentId } = req.query;

        if (!paymentId) {
            return res.status(400).json({
                success: false,
                error: "paymentId обязателен",
            });
        }

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: "Пользователь не найден",
            });
        }

        const payment = await yooKassa.getPayment(paymentId);
        const meta = payment?.metadata || {};

        if (meta.type !== "bind_card" || Number(meta.userId) !== Number(userId)) {
            return res.status(403).json({
                success: false,
                error: "Нет доступа к этому платежу",
            });
        }

        const pm = payment.payment_method;
        const pmId = pm?.id || null;
        const isSaved = pm?.saved === true;

        if (payment.status === "succeeded" && pmId && isSaved) {
            await user.update({
                yookassa_payment_method_id: pmId,
                yookassa_payment_method_saved_at: new Date(),
                cardLastFour: pm?.card?.last4 || null,
                cardType: pm?.card?.card_type || null,
            });

            return res.json({
                success: true,
                bound: true,
                status: payment.status,
                cardLastFour: pm?.card?.last4 || null,
                cardType: pm?.card?.card_type || null,
            });
        }

        return res.json({
            success: true,
            bound: false,
            status: payment.status,
            saved: pm?.saved === true,
        });
    } catch (e) {
        console.error("card/bind/status error:", e);
        return res.status(500).json({
            success: false,
            error: e?.message || "Internal error",
        });
    }
});

router.get('/promotion/status', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { orderId } = req.query;
        if (!orderId) return res.status(400).json({ success: false, error: 'orderId required' });

        const order = await Order.findByPk(orderId);
        if (!order) return res.status(404).json({ success: false, error: 'order not found' });
        if (order.creatorId !== userId) return res.status(403).json({ success: false, error: 'no access' });

        if (!order.promotionPaymentId) {
            return res.json({ success: true, status: 'no_payment_id' });
        }

        const payment = await yooKassa.getPayment(order.promotionPaymentId);

        if (payment.status === 'succeeded' && order.status === 'pending_payment') {
            let pr = order.promotionRequested || {};

            if (typeof pr === "string") {
                try {
                    pr = JSON.parse(pr);
                } catch {
                    pr = {};
                }
            }

            await order.update({
                status: 'pending',
                is_highlighted: !!pr.highlight,
                is_recommended: !!pr.recommended,
                is_push_notified: !!pr.push,
                promotionPaidAt: new Date(),
            });

            io?.emit("orderUpdated");

            if (pr.push) {
                try {
                    const logAction =
                        req.logAction ||
                        req.app?.locals?.logAction ||
                        null;

                    await sendOrderPush({
                        db,
                        io,
                        orderId: order.id,
                        radiusKm: 50,
                        limit: 10,
                        logAction,
                    });
                } catch (e) {
                    console.error("sendOrderPush from promotion/status error:", e);
                }
            }
        }

        return res.json({ success: true, status: payment.status });
    } catch (e) {
        console.error('promotion/status error:', e);

        notifyPaymentProblem({

            provider: "YooKassa",

            type: "premium",

            title: "🚨 Ошибка оплаты",

            userId: req.user?.id,

            message:

                `Ошибка: ${e?.message || "Unknown error"}`,

        });

        return res.status(500).json({ success: false, error: e?.message || 'Internal error' });
    }
});

module.exports = router;