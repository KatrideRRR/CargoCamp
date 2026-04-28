const { v4: uuidv4 } = require("uuid");const express = require('express');
const router = express.Router();
const { Order, User } = require('../models'); // sequelize models
const db = require("../models");
const authenticateToken = require('../middlewares/userAuth'); // если нужен
const { randomUUID } = require('crypto');
const idempotenceKey = randomUUID();
const yooKassa = require('../config/yookassaClient');
const { sendOrderPush } = require("../utils/orderPushService");

router.post('/premium/create', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { duration } = req.body; // "7d" | "30d"

        const prices = { '7d': '2500.00', '30d': '9000.00' };
        const amountValue = prices[duration];
        if (!amountValue) return res.status(400).json({ success: false, error: 'Неверная длительность' });

        const user = await User.findByPk(userId);
        if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден' });

        const addDays = duration === '7d' ? 7 : 30;

        const idempotenceKey = require('uuid').v4();

        const payment = await yooKassa.createPayment({
            amount: { value: amountValue, currency: 'RUB' },
            capture: true,
            confirmation: {
                type: 'redirect',
                return_url: `${process.env.FRONTEND_URL}/profile?premiumReturn=1`,
            },
            description: `Premium ${duration} для пользователя #${userId}`,
            metadata: { type: 'premium', userId: String(userId), duration },

            // ✅ чек обязателен при включенной фискализации
            receipt: {
                customer: {
                    phone: String(user.phone || '').replace(/[^\d+]/g, ''),
                    // если появится email — лучше добавить и его:
                    // email: user.email
                },
                items: [
                    {
                        description: `Подписка Premium (${addDays} дней)`,
                        quantity: 1,
                        amount: { value: amountValue, currency: 'RUB' },
                        vat_code: 1,                 // без НДС  [oai_citation:2‡ЮKassa](https://yookassa.ru/developers/payment-acceptance/receipts/54fz/yoomoney/parameters-values?utm_source=chatgpt.com)
                        payment_mode: 'full_payment',
                        payment_subject: 'service',
                    }
                ],
                tax_system_code: 2, // ✅ УСН (доходы)  [oai_citation:3‡ЮKassa](https://yookassa.ru/developers/payment-acceptance/receipts/54fz/other-services/parameters-values?utm_source=chatgpt.com)
            }
        }, idempotenceKey);

        await req.logAction({
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
            },
        });

        return res.json({
            success: true,
            paymentId: payment.id,
            confirmationUrl: payment.confirmation?.confirmation_url,
            status: payment.status,
        });
    } catch (e) {
        console.error('premium/create error:', e);
        return res.status(500).json({ success: false, error: e?.message || 'Internal server error' });
    }
});

router.post('/debt/create', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const user = await User.findByPk(userId);
        if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден' });

        const debtKopecks = Number(user.debt || 0);
        if (debtKopecks <= 0) return res.json({ success: true, noDebt: true });

        const amountValue = (debtKopecks / 100).toFixed(2);
        const idempotenceKey = uuidv4();

        const basePayload = {
            amount: { value: amountValue, currency: 'RUB' },
            capture: true,
            description: `Оплата комиссии (задолженность) пользователя #${userId}`,
            metadata: { type: 'debt', userId: String(userId), expectedKopecks: String(debtKopecks) },
            receipt: {
                customer: { phone: String(user.phone || '').replace(/[^\d+]/g, '') },
                items: [{
                    description: `Оплата комиссии (задолженность)`,
                    quantity: 1,
                    amount: { value: amountValue, currency: 'RUB' },
                    vat_code: 1,
                    payment_mode: 'full_payment',
                    payment_subject: 'service',
                }],
                tax_system_code: 2,
            },
        };

        // ✅ 1) Автосписание по сохраненной карте
        if (user.yookassa_payment_method_id) {
            const payment = await yooKassa.createPayment({
                ...basePayload,
                payment_method_id: user.yookassa_payment_method_id,
            }, idempotenceKey);

            return res.json({
                success: true,
                paidBySavedCard: true,
                paymentId: payment.id,
                status: payment.status, // succeeded / pending и т.д.
            });
        }

        // ✅ 2) Редирект, если карты нет
        const payment = await yooKassa.createPayment({
            ...basePayload,
            confirmation: {
                type: 'redirect',
                return_url: `${process.env.FRONTEND_URL}/profile?debtReturn=1`,
            },
        }, idempotenceKey);

        await req.logAction({
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
                amount: amountValue,
                status: payment.status,
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
        return res.status(500).json({ success: false, error: e?.message || 'Internal server error' });
    }
});

router.post('/card/bind/create', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const user = await User.findByPk(userId);
        if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден' });

        const idempotenceKey = uuidv4();
        const amountValue = '1.00';

        const payment = await yooKassa.createPayment(
            {
                amount: { value: amountValue, currency: 'RUB' },
                capture: true,
                save_payment_method: true, // ✅ сохраняем метод оплаты
                confirmation: {
                    type: 'redirect',
                    return_url: `${process.env.FRONTEND_URL}/profile?bindReturn=1`,
                },
                description: `Привязка карты пользователя #${userId}`,
                metadata: {
                    type: 'bind_card',
                    userId: String(userId),
                },
                receipt: {
                    customer: {
                        phone: String(user.phone || '').replace(/[^\d+]/g, ''),
                    },
                    items: [
                        {
                            description: `Привязка карты (проверочный платеж)`,
                            quantity: 1,
                            amount: { value: amountValue, currency: 'RUB' },
                            vat_code: 1, // без НДС
                            payment_mode: 'full_payment',
                            payment_subject: 'service',
                        },
                    ],
                    tax_system_code: 2, // УСН доходы
                },
            },
            idempotenceKey
        );

        await req.logAction({
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
            },
        });

        return res.json({
            success: true,
            paymentId: payment.id,
            confirmationUrl: payment.confirmation?.confirmation_url,
            status: payment.status,
        });
    } catch (e) {
        console.error('card/bind/create error:', e);
        return res.status(500).json({ success: false, error: e?.message || 'Internal server error' });
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
        if (!orderId) return res.status(400).json({ success: false, error: 'orderId обязателен' });

        const user = await User.findByPk(userId);
        if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден' });

        const order = await Order.findByPk(orderId);
        if (!order) return res.status(404).json({ success: false, error: 'Заказ не найден' });

        if (order.creatorId !== userId) {
            return res.status(403).json({ success: false, error: 'Нет доступа к этому заказу' });
        }

        if (order.status !== 'pending_payment') {
            return res.status(400).json({ success: false, error: 'Этот заказ не требует оплаты продвижения' });
        }

        const PROMOTION_PRICES = { highlight: 50, recommended: 100, push: 150 };
        const pr = order.promotionRequested || {};
        const total = Object.entries(pr).reduce((sum, [k, v]) => (v && PROMOTION_PRICES[k] ? sum + PROMOTION_PRICES[k] : sum), 0);

        if (total <= 0) return res.status(400).json({ success: false, error: 'Продвижение не выбрано' });

        const amountValue = total.toFixed(2);
        const idempotenceKey = uuidv4();

        const payment = await yooKassa.createPayment({
            amount: { value: amountValue, currency: 'RUB' },
            capture: true,
            confirmation: {
                type: 'redirect',
                return_url: `${process.env.FRONTEND_URL}/orders?promoReturn=1&orderId=${orderId}`,
            },
            description: `Продвижение заказа #${orderId}`,
            metadata: {
                type: 'order_promotion',
                orderId: String(orderId),
                userId: String(userId),
            },
            receipt: {
                customer: { phone: String(user.phone || '').replace(/[^\d+]/g, '') },
                items: [
                    {
                        description: `Продвижение заказа #${orderId}`,
                        quantity: 1,
                        amount: { value: amountValue, currency: 'RUB' },
                        vat_code: 1,
                        payment_mode: 'full_payment',
                        payment_subject: 'service',
                    }
                ],
                tax_system_code: 2, // УСН доходы
            },
        }, idempotenceKey);

        await order.update({ promotionPaymentId: payment.id });

        await req.logAction({
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
            },
        });

        return res.json({
            success: true,
            paymentId: payment.id,
            confirmationUrl: payment.confirmation?.confirmation_url,
        });
    } catch (e) {
        console.error('order/promotion/create error:', e);
        return res.status(500).json({ success: false, error: e?.message || 'Internal server error' });
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

router.post('/yookassa/webhook', async (req, res) => {

    const io = req.app.locals.io; // ✅ вот так
    if (!io) {
        console.warn("⚠️ io is not initialized yet");
    }

    try {
        const event = req.body;
        const allowed = ['payment.waiting_for_capture', 'payment.succeeded', 'payment.canceled'];
        if (!allowed.includes(event?.event)) return res.sendStatus(200);

        const payment = event.object;
        const meta = payment?.metadata || {};

        await req.logAction({
            req,
            actorUserId: null,
            actorRole: "webhook",
            actionType: `yookassa_${event.event}`, // например yookassa_payment.succeeded
            entityType: "payment",
            paymentId: payment.id,
            orderId: meta.orderId ? Number(meta.orderId) : null,
            severity: "info",
            meta: {
                type: meta.type,
                status: payment.status,
                amount: payment.amount?.value,
                currency: payment.amount?.currency,
            },
        });

        // ====== 1) Premium ======
        if (meta.type === 'premium') {
            const userId = Number(meta.userId);
            const duration = meta.duration;
            const addDays = duration === '7d' ? 7 : duration === '30d' ? 30 : 0;
            if (!addDays) return res.sendStatus(200);

            const user = await User.findByPk(userId);
            if (!user) return res.sendStatus(200);

            const now = new Date();
            const currentExp = user.subscription_expires_at ? new Date(user.subscription_expires_at) : null;
            const base = (user.subscription_type === 'premium' && currentExp && currentExp > now) ? currentExp : now;
            const newExp = new Date(base.getTime() + addDays * 24 * 60 * 60 * 1000);

            user.subscription_type = 'premium';
            user.subscription_expires_at = newExp;
            await user.save();

            return res.sendStatus(200);
        }

        // ====== 2) Debt ======
        if (meta.type === 'debt') {
            const userId = Number(meta.userId);
            const paidKopecks = Math.round(parseFloat(payment.amount.value) * 100);

            const user = await User.findByPk(userId);
            if (!user) return res.sendStatus(200);

            const currentDebt = Number(user.debt || 0);

            // optional: защита, если пришел платеж "в никуда"
            if (currentDebt <= 0) return res.sendStatus(200);

            const newDebt = Math.max(0, currentDebt - paidKopecks);

            await user.update({
                debt: newDebt,
                commissionDebtOrderId: newDebt === 0 ? null : user.commissionDebtOrderId,
            });

            return res.sendStatus(200);
        }

        // ====== 3) Bind Card ======
        if (meta.type === 'bind_card') {
            const userId = Number(meta.userId);

            const user = await User.findByPk(userId);
            if (!user) return res.sendStatus(200);

            // ЮKassa возвращает сохраненный метод оплаты внутри payment_method
            const pm = payment.payment_method;
            const pmId = pm?.id || null;
            const last4 = pm?.card?.last4 || null;
            const cardType = pm?.card?.card_type || null;

            if (!pmId) {
                console.warn('bind_card succeeded but payment_method.id missing', payment?.id);
                return res.sendStatus(200);
            }

            await user.update({
                yookassa_payment_method_id: pmId,
                yookassa_payment_method_saved_at: new Date(),
                cardLastFour: last4,
                cardType: cardType,
            });

            return res.sendStatus(200);
        }

        // ====== 4) promotion ======
        if (meta.type === 'order_promotion') {
            const orderId = Number(meta.orderId);
            const order = await Order.findByPk(orderId);
            if (!order) return res.sendStatus(200);

            // защита от "чужого" платежа
            if (order.promotionPaymentId && order.promotionPaymentId !== payment.id) {
                return res.sendStatus(200);
            }

            let pr = order.promotionRequested || {};
            if (typeof pr === "string") {
                try { pr = JSON.parse(pr); } catch { pr = {}; }
            }
            await order.update({
                status: 'pending',
                is_highlighted: !!pr.highlight,
                is_recommended: !!pr.recommended,
                is_push_notified: !!pr.push,
                promotionPaidAt: new Date(),
            });

            io.emit('orderUpdated');

            if (pr.push) {
                try {
                    const logAction = req.logAction || req.app?.locals?.logAction || null;
                    await sendOrderPush({
                        db,   // у тебя db уже есть в этом файле (как в остальных местах)
                        io,   // твой io из сокетов
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

        // ====== 5) Guarantee (hold/capture) ======
        if (meta.type === 'guarantee') {
            const orderId = Number(meta.orderId);
            const order = await Order.findByPk(orderId);
            if (!order) return res.sendStatus(200);

            // защита от "чужого" платежа
            if (order.yookassa_payment_id && order.yookassa_payment_id !== payment.id) {
                return res.sendStatus(200);
            }

            // 1) холд успешен (деньги заморожены)
            if (event.event === 'payment.waiting_for_capture') {
                await order.update({
                    dealStatus: 'funds_held',
                    yookassa_payment_status: payment.status,
                    funds_held_at: new Date(),
                });

                // можно уведомить исполнителя "деньги в гарантии, можно ехать"
                io.to(`user_${order.executorId}`).emit('guaranteeHeld', {
                    orderId: order.id,
                    message: 'Заказ оплачен по гарантии. Деньги заморожены ✅ Можно приступать.',
                });

                return res.sendStatus(200);
            }

            // 2) платеж отменен/не прошел
            if (event.event === 'payment.canceled') {
                await order.update({
                    dealStatus: 'payment_failed',
                    yookassa_payment_status: payment.status,
                    payment_failed_at: new Date(),
                });

                return res.sendStatus(200);
            }

            // 3) финальное списание (после capture)
            if (event.event === 'payment.succeeded') {
                await order.update({
                    dealStatus: 'captured',
                    yookassa_payment_status: payment.status,
                    captured_at: new Date(),
                });

                return res.sendStatus(200);
            }

            return res.sendStatus(200);
        }

        return res.sendStatus(200);
    } catch (e) {
        console.error('yookassa webhook error:', e);
        return res.sendStatus(200);
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
            const pr = order.promotionRequested || {};
            await order.update({
                status: 'pending',
                is_highlighted: !!pr.highlight,
                is_recommended: !!pr.recommended,
                is_push_notified: !!pr.push,
                promotionPaidAt: new Date(),
            });
        }

        return res.json({ success: true, status: payment.status });
    } catch (e) {
        console.error('promotion/status error:', e);
        return res.status(500).json({ success: false, error: e?.message || 'Internal error' });
    }
});

module.exports = router;