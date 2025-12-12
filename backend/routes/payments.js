const express = require('express');
const router = express.Router();
const { User } = require('../models'); // sequelize models
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
            const newDebt = Math.max(0, currentDebt - paidKopecks);
            await user.update({ debt: newDebt });

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

        return res.sendStatus(200);
    } catch (e) {
        console.error('yookassa webhook error:', e);
        return res.sendStatus(200);
    }
});

module.exports = router;