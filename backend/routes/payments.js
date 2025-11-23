const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const router = express.Router();
const { Order, User } = require('../models'); // sequelize models
const authenticateToken = require('../middlewares/userAuth'); // если нужен

const CLOUD_PUBLIC_ID = process.env.CLOUDPAYMENTS_PUBLIC_ID;
const CLOUD_API_SECRET = process.env.CLOUDPAYMENTS_API_SECRET;
if (!CLOUD_PUBLIC_ID || !CLOUD_API_SECRET) {
    console.warn('CLOUDPAYMENTS_PUBLIC_ID or CLOUDPAYMENTS_API_SECRET not set');
}

function calculateCommissionKopecks(order, user) {
    const isPremium = user.subscription_type === 'premium' &&
        user.subscription_expires_at && new Date(user.subscription_expires_at) > new Date();

    let commission = 0;
    if (!isPremium) {
        if (order.paymentType === 'cash') {
            commission = 200 * 100;
        } else if (order.paymentType === 'guarantee') {
            commission = Math.round((order.proposedSum || 0) * 100 * 0.15);
        } else if (order.paymentType === 'installments') {
            commission = Math.round((order.proposedSum || 0) * 100 * 0.20);
        }

        if (order.is_recommended) {
            commission -= 100 * 100;
            if (commission < 0) commission = 0;
        }
    }
    return commission; // в копейках
}

async function cloudRequest(endpoint, payload) {
    const url = `https://api.cloudpayments.ru${endpoint}`;
    const cfg = {
        auth: { username: CLOUD_PUBLIC_ID, password: CLOUD_API_SECRET },
        timeout: 20000
    };
    return axios.post(url, payload, cfg).then(r => r.data);
}

function verifyCloudWebhookSignature(rawBodyBuffer, headers) {
    const secret = CLOUD_API_SECRET;
    if (!secret) return false;

    const body = rawBodyBuffer.toString('utf8');
    const hmac = crypto.createHmac('sha256', secret).update(body).digest('base64');

    // Возможные имена заголовка, встречающиеся в интеграциях
    const headerSig = headers['content-hmac'] || headers['content-hmac'.toLowerCase()] ||
        headers['x-hook-signature'] || headers['x-hook-signature'.toLowerCase()] ||
        headers['signature'] || headers['signature'.toLowerCase()];

    if (!headerSig) return false;
    // иногда провайдер добавляет префикс типа "sha256=" — очищаем
    const cleaned = headerSig.replace(/^sha256=|^SHA256=|^sha=|^SHA=/, '').trim();

    return crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(cleaned));
}

function rawBodyMiddleware(req, res, next) {
    // express.json already parsed body; we need raw for HMAC — use req.rawBody if available.
    // To ensure raw body is available, in app.js mount bodyParser with verify option to save raw body:
    // app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf } }));
    if (!req.rawBody) {
        // fallback: re-stringify parsed body (may change spacing/ordering) — less secure
        req.rawBody = Buffer.from(JSON.stringify(req.body || {}), 'utf8');
    }
    next();
}

router.post('/commission', authenticateToken, async (req, res) => {
    try {
        const { userId, orderId, cardCryptogramPacket } = req.body;
        if (!userId || !orderId) return res.status(400).json({ success: false, error: 'userId и orderId обязательны' });

        const order = await Order.findByPk(orderId);
        if (!order) return res.status(404).json({ success: false, error: 'Заказ не найден' });

        const user = await User.findByPk(userId);
        if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден' });

        if (order.commissionPaid) {
            return res.status(409).json({ success: false, error: 'Комиссия уже оплачена' });
        }

        const commissionKopecks = calculateCommissionKopecks(order, user);
        if (commissionKopecks <= 0) {
            await order.update({ commissionPaid: true, commissionPaidAt: new Date(), commissionAmount: 0 });
            return res.json({ success: true, noCommission: true, message: 'Комиссия отсутствует' });
        }

        const amountRub = (commissionKopecks / 100).toFixed(2);
        let payload;
        let endpoint;

        if (cardCryptogramPacket) {
            endpoint = '/payments/cards/charge';
            payload = {
                Amount: parseFloat(amountRub),
                Currency: 'RUB',
                Description: `Комиссия за заказ #${orderId}`,
                AccountId: `commission_${orderId}`,
                JsonData: { orderId, userId, type: 'commission' },
                CardCryptogramPacket: cardCryptogramPacket
            };
        } else {
            const token = user.cardToken || user.card_token || user.RebillId || null;
            if (!token) {
                return res.status(400).json({ success: false, error: 'Нет cardCryptogramPacket и у пользователя нет сохранённой карты' });
            }
            endpoint = '/payments/charge';
            payload = {
                Amount: parseFloat(amountRub),
                Currency: 'RUB',
                Description: `Комиссия за заказ #${orderId}`,
                AccountId: `commission_${orderId}`,
                JsonData: { orderId, userId, type: 'commission' },
                Token: token
            };
        }

        const resp = await cloudRequest(endpoint, payload);

        if (!resp || resp.Success !== true) {
            console.error('CloudPayments commission failed:', resp);
            return res.status(400).json({ success: false, error: resp?.Message || 'Payment failed', raw: resp });
        }

        const transactionId = resp.Model && (resp.Model.TransactionId || resp.Model.Id || resp.Model.RecId) || null;

        await order.update({
            commissionPaid: true,
            commissionPaidAt: new Date(),
            commissionAmount: commissionKopecks,
            paymentTransactionId: transactionId
        });

        return res.json({ success: true, transactionId, raw: resp });
    } catch (err) {
        console.error('Error /payment/commission:', err.response?.data || err.message || err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.post('/commission/pay-debt', authenticateToken, async (req, res) => {
    try {
        const { userId, cardCryptogramPacket } = req.body;

        if (!userId)
            return res.status(400).json({ success: false, error: 'userId обязателен' });

        const user = await User.findByPk(userId);
        if (!user)
            return res.status(404).json({ success: false, error: 'Пользователь не найден' });

        const debtKopecks = user.has_debt || 0;

        if (debtKopecks <= 0)
            return res.json({ success: true, noDebt: true, message: 'Долгов нет' });

        const amountRub = (debtKopecks / 100).toFixed(2);

        let payload;
        let endpoint;

        // 🔐 Оплата новой картой
        if (cardCryptogramPacket) {
            endpoint = '/payments/cards/charge';
            payload = {
                Amount: parseFloat(amountRub),
                Currency: "RUB",
                AccountId: `pay_debt_${userId}`,
                Description: `Погашение задолженности пользователя #${userId}`,
                JsonData: { userId, type: 'has_debt' },
                CardCryptogramPacket: cardCryptogramPacket
            };
        }

        // 💳 Оплата сохранённой картой
        else {
            const token = user.cardToken || user.card_token || user.RebillId || null;

            if (!token)
                return res.status(400).json({ success: false, error: 'Нет сохраненной карты и нет криптограммы' });

            endpoint = '/payments/charge';
            payload = {
                Amount: parseFloat(amountRub),
                Currency: "RUB",
                AccountId: `pay_debt_${userId}`,
                Description: `Погашение задолженности пользователя #${userId}`,
                JsonData: { userId, type: 'has_debt' },
                Token: token
            };
        }

        const resp = await cloudRequest(endpoint, payload);

        if (!resp || resp.Success !== true) {
            console.error('CloudPayments debt payment failed:', resp);
            return res.status(400).json({
                success: false,
                error: resp?.Message || 'Payment failed',
                raw: resp
            });
        }

        // 🟢 Обнуляем долг
        user.has_debt = 0;
        user.commissionDebtOrderId = null;
        await user.save();

        return res.json({
            success: true,
            transactionId: resp.Model?.TransactionId || null,
            message: 'Долг успешно погашен',
            raw: resp
        });

    } catch (err) {
        console.error('Error /payment/commission/pay-debt:', err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.post('/premium', authenticateToken, async (req, res) => {
    try {
        const { userId, duration, cardCryptogramPacket } = req.body;
        if (!userId || !duration) return res.status(400).json({ success: false, error: 'userId и duration обязательны' });

        const prices = { '7d': 2500.00, '30d': 9000.00 }; // рубли: 2500 = 2500.00 (из старого: 250000 коп)
        // if your old values were in kopecks adjust accordingly. Here using rubles with decimals.
        const amount = prices[duration];
        if (!amount) return res.status(400).json({ success: false, error: 'Неверная длительность' });

        const user = await User.findByPk(userId);
        if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден' });

        let payload, endpoint;
        const accountId = `premium_${userId}_${Date.now()}`;

        if (cardCryptogramPacket) {
            endpoint = '/payments/cards/charge';
            payload = {
                Amount: parseFloat(amount),
                Currency: 'RUB',
                Description: `Премиум ${duration} для пользователя ${userId}`,
                AccountId: accountId,
                JsonData: { userId, duration, type: 'premium' },
                CardCryptogramPacket: cardCryptogramPacket,
                SaveToken: true  // опционально: если хочешь сохранить карту при оплате премиума
            };
        } else {
            const token = user.cardToken || user.card_token || user.RebillId || null;
            if (!token) {
                return res.status(400).json({ success: false, error: 'Нет cardCryptogramPacket и у пользователя нет сохранённой карты' });
            }
            endpoint = '/payments/charge';
            payload = {
                Amount: parseFloat(amount),
                Currency: 'RUB',
                Description: `Премиум ${duration} для пользователя ${userId}`,
                AccountId: accountId,
                JsonData: { userId, duration, type: 'premium' },
                Token: token
            };
        }

        const resp = await cloudRequest(endpoint, payload);
        if (!resp || resp.Success !== true) {
            console.error('CloudPayments premium failed:', resp);
            return res.status(400).json({ success: false, error: resp?.Message || 'Payment failed', raw: resp });
        }

        // Применяем премиум локально
        const now = new Date();
        const addDays = duration === '7d' ? 7 : 30;
        const newExpiration = user.subscription_type === 'premium' && user.subscription_expires_at && new Date(user.subscription_expires_at) > now
            ? new Date(new Date(user.subscription_expires_at).getTime() + addDays * 24 * 3600 * 1000)
            : new Date(now.getTime() + addDays * 24 * 3600 * 1000);

        user.subscription_type = 'premium';
        user.subscription_expires_at = newExpiration;
        await user.save();

        return res.json({ success: true, raw: resp });
    } catch (err) {
        console.error('Error /payment/premium:', err.response?.data || err.message || err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.post('/card/bind', authenticateToken, async (req, res) => {
    try {
        const { userId, cardCryptogramPacket } = req.body;
        if (!userId || !cardCryptogramPacket) return res.status(400).json({ success: false, error: 'userId и cardCryptogramPacket обязательны' });

        const user = await User.findByPk(userId);
        if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден' });

        const payload = {
            Amount: 1.00,
            Currency: 'RUB',
            Description: `Привязка карты user ${userId}`,
            AccountId: `bind_${userId}_${Date.now()}`,
            JsonData: { userId, type: 'bind' },
            CardCryptogramPacket: cardCryptogramPacket,
            SaveToken: true
        };

        const resp = await cloudRequest('/payments/cards/charge', payload);
        if (!resp || resp.Success !== true) {
            console.error('CloudPayments bind failed:', resp);
            return res.status(400).json({ success: false, error: resp?.Message || 'Bind failed', raw: resp });
        }

        const token = resp.Model && (resp.Model.Token || resp.Model.TokenValue || resp.Model.RecToken) || null;
        const cardPan = resp.Model && resp.Model.CardPan || resp.Model && resp.Model.CardMask || null;
        const last4 = cardPan ? cardPan.slice(-4) : null;

        if (token) {
            user.cardToken = token;
            user.cardLastFour = last4;
            user.cardType = resp.Model && resp.Model.CardType ? resp.Model.CardType : user.cardType || null;
            await user.save();

            return res.json({ success: true, token, raw: resp });
        } else {
            console.warn('Bind succeeded but token not found in resp:', resp);
            return res.status(500).json({ success: false, error: 'Token not returned by provider', raw: resp });
        }
    } catch (err) {
        console.error('Error /payment/card/bind:', err.response?.data || err.message || err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.post('/card/unbind', authenticateToken, async (req, res) => {
    try {
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ success: false, error: 'userId обязательный' });

        const user = await User.findByPk(userId);
        if (!user) return res.status(404).json({ success: false, error: 'Пользователь не найден' });

        const token = user.cardToken || user.card_token || user.RebillId || null;
        if (!token) return res.status(400).json({ success: false, error: 'Карта не привязана' });

        const resp = await cloudRequest('/payments/cards/unbind', { Token: token });

        if (!resp || resp.Success !== true) {
            console.error('CloudPayments unbind failed:', resp);
            user.cardToken = null;
            user.cardLastFour = null;
            user.cardType = null;
            await user.save();
            return res.status(200).json({ success: false, message: 'Unbind on provider failed - token cleared locally', raw: resp });
        }

        user.cardToken = null;
        user.cardLastFour = null;
        user.cardType = null;
        await user.save();

        return res.json({ success: true, raw: resp });
    } catch (err) {
        console.error('Error /payment/card/unbind:', err.response?.data || err.message || err);
        return res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

router.post('/cloud/callback', rawBodyMiddleware, async (req, res) => {
    try {
        // verify signature using raw body
        const ok = verifyCloudWebhookSignature(req.rawBody, req.headers);
        if (!ok) {
            console.warn('Invalid cloud webhook signature', req.headers);
            return res.status(403).send('Invalid signature');
        }

        const payload = req.body || {};
        // payload structure varies; common fields: Type, Data, Object
        console.log('CloudPayments webhook received:', JSON.stringify(payload).slice(0, 2000));

        // Example: if payload.Data contains AccountId or JsonData.orderId, update order status
        const data = payload.Data || payload.Object || payload.Model || payload;
        // Try to extract orderId from known places
        let accountId = data && (data.AccountId || data.accountId) || null;
        let jsonData = data && (data.JsonData || data.jsonData) || null;

        if (!accountId && jsonData && jsonData.orderId) {
            accountId = `order_${jsonData.orderId}`;
        }

        // If AccountId has commission_123 etc. -> extract
        if (accountId && typeof accountId === 'string') {
            const m = accountId.match(/commission_(\d+)/);
            if (m) {
                const orderId = parseInt(m[1], 10);
                // if payment succeeded, mark commission paid
                if (payload && payload.EventType && payload.EventType === 'PaymentSucceeded' || (payload && payload.Type === 'payment' && payload.Status === 'Completed') || (data && data.Status && data.Status === 'Completed')) {
                    await Order.update({ commissionPaid: true, commissionPaidAt: new Date() }, { where: { id: orderId } });
                }
            }
            // handle premium_... similar if you used AccountId pattern
            const m2 = accountId.match(/^premium_(\d+)_/);
            if (m2) {
                const userId = parseInt(m2[1], 10);
                // apply premium (you may prefer to rely on your /payment/premium flow instead)
                // ... omitted for brevity
            }
        }

        // Always respond 200 OK
        return res.send('OK');
    } catch (err) {
        console.error('Error /payment/cloud/callback:', err);
        return res.status(500).send('ERROR');
    }
});

router.get("/public-id", (req, res) => {
    try {
        res.json({
            success: true,
            publicId: process.env.CLOUDPAYMENTS_PUBLIC_ID
        });
    } catch (e) {
        res.status(500).json({ success: false, error: "Ошибка сервера" });
    }
});

module.exports = router;