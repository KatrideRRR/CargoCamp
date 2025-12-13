const express = require('express');
const router = express.Router();
const { Order, User } = require('../models'); // sequelize models
const authenticateToken = require('../middlewares/userAuth'); // если нужен
const { v4: uuidv4 } = require('uuid');
const yooKassa = require('../utils/yookassaClient');

function verifyYookassaWebhook(req, res, next) {
    const auth = req.headers['authorization'] || '';
    if (!process.env.YOOKASSA_WEBHOOK_AUTH) {
        console.warn('YOOKASSA_WEBHOOK_AUTH is not set');
        return res.sendStatus(403);
    }
    if (auth !== process.env.YOOKASSA_WEBHOOK_AUTH) {
        return res.sendStatus(403);
    }
    next();
}

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
        if (debtKopecks <= 0) {
            return res.json({ success: true, noDebt: true });
        }

        const amountValue = (debtKopecks / 100).toFixed(2);
        const idempotenceKey = uuidv4();

        const payment = await yooKassa.createPayment(
            {
                amount: { value: amountValue, currency: 'RUB' },
                capture: true,
                confirmation: {
                    type: 'redirect',
                    return_url: `${process.env.FRONTEND_URL}/profile?debtReturn=1`,
                },
                description: `Погашение задолженности по комиссии пользователя #${userId}`,
                metadata: {
                    type: 'debt',
                    userId: String(userId),
                    expectedKopecks: String(debtKopecks),
                },

                // ✅ чек обязателен (у тебя включена фискализация), УСН доходы = tax_system_code 2
                receipt: {
                    customer: {
                        phone: String(user.phone || '').replace(/[^\d+]/g, ''),
                    },
                    items: [
                        {
                            description: `Погашение задолженности по комиссии`,
                            quantity: 1,
                            amount: { value: amountValue, currency: 'RUB' },
                            vat_code: 1, // без НДС
                            payment_mode: 'full_payment',
                            payment_subject: 'service',
                        },
                    ],
                    tax_system_code: 2,
                },
            },
            idempotenceKey
        );

        return res.json({
            success: true,
            paymentId: payment.id,
            confirmationUrl: payment.confirmation?.confirmation_url,
        });
    } catch (e) {
        console.error('debt/create error:', e);
        return res.status(500).json({ success: false, error: e?.message || 'Internal server error' });
    }
});

router.post('/debt/pay', authenticateToken, async (req, res) => {
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
                return_url: `${process.env.FRONTEND_URL}/orders?promoReturn=1`,
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

router.post('/yookassa/webhook',verifyYookassaWebhook, async (req, res) => {
    try {
        const event = req.body;
        if (event?.event !== 'payment.succeeded') return res.sendStatus(200);

        const payment = event.object;
        const meta = payment?.metadata || {};

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

            const pr = order.promotionRequested || {};

            await order.update({
                status: 'pending',
                is_highlighted: !!pr.highlight,
                is_recommended: !!pr.recommended,
                is_push_notified: !!pr.push,
                promotionPaidAt: new Date(),
            });

            io.emit('orderUpdated');

            return res.sendStatus(200);
        }

        return res.sendStatus(200);
    } catch (e) {
        console.error('yookassa webhook error:', e);
        return res.sendStatus(200);
    }
});

module.exports = router;