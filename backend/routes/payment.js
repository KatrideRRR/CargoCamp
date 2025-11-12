const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const router = express.Router();
const { Order } = require("../models");
const { User } = require("../models");
const { processPayment, refundPayment } = require("../utils/paymentService");
const authenticateToken = require("../middlewares/userAuth");
const { createPayment } = require("../utils/tinkoff"); // 👈 вот это важно

const TERMINAL_KEY = process.env.TERMINAL_KEY;
const PASSWORD = process.env.TINKOFF_PASSWORD;
const API_URL = "https://securepay.tinkoff.ru/v2";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:5001";

function generateToken(params) {
    delete params.Token;
    params.Password = PASSWORD;

    const sortedKeys = Object.keys(params).filter(k => k !== "Receipt").sort();
    const dataString = sortedKeys.map(key => params[key]).join('');
    const hash = crypto.createHash('sha256').update(dataString).digest('hex');

    delete params.Password;
    return hash;
}

function getCardType(cardNumber) {
    if (!cardNumber) return "Unknown";
    const firstDigit = cardNumber[0];
    switch (firstDigit) {
        case '4': return 'Visa';
        case '5': return 'MasterCard';
        case '2': return 'МИР';
        default: return 'Unknown';
    }
}

router.post("/bind-card", authenticateToken, async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin",  "https://cargocamp.ru");
    res.setHeader("Access-Control-Allow-Credentials", "true");

    const { id } = req.user;

    if (!id) {
        return res.status(400).json({ message: "Ошибка: userId не указан" });
    }

    try {
        const paymentResult = await processPayment(id, 1); // 1 рубль

        if (!paymentResult.success) {
            return res.status(500).json({ message: "Ошибка инициализации", error: paymentResult.message });
        }

        return res.json({ message: "Перейдите по ссылке для привязки карты", paymentUrl: paymentResult.paymentUrl });
    } catch (error) {
        console.error("Ошибка привязки карты:", error);
        return res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.post("/pay_commission", async (req, res) => {
    const { userId, orderId } = req.body;
    const axiosInstance = axios.create({
        timeout: 20000, // Увеличиваем до 20 секунд
    });
    console.log("🔹 Полученные данные:", req.body);

    if (!userId || !orderId) {
        return res.status(400).json({ success: false, error: "userId и orderId обязательны" });
    }

    try {
        // Получаем заказ из БД
        const order = await Order.findByPk(orderId);
        if (!order) {
            return res.status(404).json({ success: false, error: "Заказ не найден" });
        }
        const user = await User.findByPk(userId);
        const isPremium = user.subscription_type === 'premium' && new Date(user.subscription_expires_at) > new Date();

        let commission = 0;
        if (!isPremium) {
            if (order.paymentType === "cash") {
                commission = 200 * 100;
            } else if (order.paymentType === "guarantee") {
                commission = Math.round(order.proposedSum * 100 * 0.15);
            } else if (order.paymentType === "installments") {
                commission = Math.round(order.proposedSum * 100 * 0.20);
            }

            if (order.is_recommended) {
                commission -= 100 * 100;
                if (commission < 0) commission = 0;
            }
        }

        if (commission <= 0) {
            return res.json({
                success: true,
                noCommission: true,
                message: "У вас премиум, комиссия отсутствует"
            });
        }

        const params = {
            TerminalKey: TERMINAL_KEY,
            Amount: commission,
            OrderId: `commission_${orderId}`,
            Description: `Комиссия за заказ #${orderId}`,
            CustomerKey: `user_${userId}`,
            NotificationURL: "https://localhost:5000/api/payment/callback"
        };

        params.Token = generateToken(params);

        params.Receipt = {
            Email: "test@example.com",
            Phone: "+79001234567",
            Taxation: "osn",
            Items: [
                {
                    Name: `Комиссия за заказ #${orderId}`,
                    Price: commission,
                    Quantity: 1,
                    Amount: commission,
                    Tax: "vat10",
                    PaymentMethod: "full_payment",
                    PaymentObject: "service"
                }
            ]
        };

        console.log("🔹 Запрос в Тинькофф:", params);

        const response = await axios.post(`${API_URL}/Init`, params);
        console.log("🔹 Ответ Тинькофф:", response.data);

        if (response.data.Success) {
            res.json({ success: true, PaymentURL: response.data.PaymentURL });
        } else {
            res.status(400).json({ success: false, error: response.data.Message });
        }
    } catch (error) {
        console.error("❌ Ошибка оплаты комиссии:", error);
        res.status(500).json({ success: false, error: "Ошибка оплаты комиссии" });
    }
});

router.post("/callback", async (req, res) => {
    const { Success, Status, RebillId, CustomerKey, CardPan, PaymentId } = req.body;

    console.log("🔥 Пришёл колбэк:", req.body);

    if (Success && Status === "CONFIRMED" && RebillId && CustomerKey) {
        const userId = CustomerKey.replace("user_", "");

        const last4 = CardPan?.slice(-4);
        const cardType = getCardType(CardPan);

        console.log(`✅ Карта привязана: userId: ${userId}, last4: ${last4}, type: ${cardType}, RebillId: ${RebillId}`);

        try {
            await User.update(
                {
                    cardLastFour: last4,
                    cardType,
                    RebillId,
                    has_debt: false, // 💥 снимаем флаг долга
                },
                { where: { id: userId } }
            );
            console.log(`✅ Пользователь ${userId} успешно обновлён, долг снят`);

            await refundPayment(PaymentId);

            return res.json({ success: true });
        } catch (err) {
            console.error("❌ Ошибка сохранения карты:", err);
            return res.status(500).json({ success: false });
        }
    } else {
        console.log("⚠ Ошибка привязки карты:", req.body);
        return res.status(400).json({ success: false });
    }
});

router.post("/unbind-card", authenticateToken, async (req, res) => {
    try {
        const { id } = req.user;

        if (!id) {
            return res.status(400).json({ message: "Не удалось определить пользователя" });
        }

        await User.update(
            {
                cardNumber: null,
                cardLastFour: null,
                cardType: null,
                RebillId: null
            },
            { where: { id } }
        );

        return res.json({ message: "Карта успешно удалена" });
    } catch (error) {
        console.error("Ошибка при удалении карты:", error);
        return res.status(500).json({ message: "Ошибка сервера при удалении карты" });
    }
});

router.post("/init_premium_payment", authenticateToken, async (req, res) => {
    const { duration } = req.body; // '7d' или '30d'
    const userId = req.user.id;

    const prices = {
        '7d': 250000,
        '30d': 900000,
    };

    const descriptions = {
        '7d': 'Премиум на 7 дней',
        '30d': 'Премиум на 30 дней',
    };

    const amount = prices[duration];
    if (!amount) {
        return res.status(400).json({ success: false, error: "Неверная длительность подписки" });
    }

    const params = {
        TerminalKey: TERMINAL_KEY,
        Amount: amount,
        OrderId: `premium_${userId}_${Date.now()}`,
        Description: descriptions[duration],
        CustomerKey: `user_${userId}`,
        NotificationURL: "https://cargocamp.ru/api/payment/premium_callback"
    };

    params.Token = generateToken(params);

    params.Receipt = {
        Email: "test@example.com",
        Phone: "+79001234567",
        Taxation: "osn",
        Items: [
            {
                Name: descriptions[duration],
                Price: amount,
                Quantity: 1,
                Amount: amount,
                Tax: "vat10",
                PaymentMethod: "full_payment",
                PaymentObject: "service"
            }
        ]
    };

    try {
        const response = await axios.post(`${API_URL}/Init`, params);
        res.json({ success: true, PaymentURL: response.data.PaymentURL });
    } catch (err) {
        console.error("Ошибка оплаты премиума:", err);
        res.status(500).json({ success: false, error: "Ошибка создания платежа" });
    }
});

router.post("/payment/premium_callback", async (req, res) => {
    const { OrderId, Success } = req.body;
    if (!Success) return res.send("OK");

    // Извлекаем userId
    const match = OrderId.match(/^premium_(\d+)_/);
    if (!match) return res.send("OK");

    const userId = parseInt(match[1], 10);
    const user = await User.findByPk(userId);
    if (!user) return res.send("OK");

    const now = new Date();
    const additionalDays = OrderId.includes("7d") ? 7 : 30;

    const newExpiration = user.subscription_type === 'premium' && user.subscription_expires_at > now
        ? new Date(user.subscription_expires_at.getTime() + additionalDays * 86400000)
        : new Date(now.getTime() + additionalDays * 86400000);

    user.subscription_type = 'premium';
    user.subscription_expires_at = newExpiration;
    await user.save();

    res.send("OK");
});

router.post("/start", async (req, res) => {
    const { orderId, amount } = req.body;

    try {
        // Подготовка параметров для Тинькофф Кассы
        const paymentUrl = await createPayment({
            amount,
            orderId,
            successURL: `${FRONTEND_URL}/orders`,
            failURL: `${FRONTEND_URL}/payment-fail`,
            notificationURL: `${BACKEND_URL}/order/callback`,
        });

        res.json({ paymentUrl });
    } catch (error) {
        console.error("Ошибка при создании платежа:", error);
        res.status(500).json({ error: "Не удалось инициировать оплату" });
    }
});

router.post('/pay-pending/:orderId', async (req, res) => {
    const { orderId } = req.params;

    try {
        const order = await Order.findByPk(orderId);

        if (!order) {
            return res.status(404).json({ message: 'Заказ не найден' });
        }

        if (order.status !== 'pending_payment') {
            return res.status(400).json({ message: 'Заказ не ожидает оплаты' });
        }

        const amount = order.promotionCost;
        if (!amount || amount <= 0) {
            return res.status(400).json({ message: 'Продвижение не требуется' });
        }

        const paymentUrl = await createPayment({
            amount,
            orderId,
            successURL: `${process.env.FRONTEND_URL}/orders`,
            failURL: `${process.env.FRONTEND_URL}/payment-fail`,
            notificationURL: `${process.env.BACKEND_URL}/order/callback`,
        });

        res.json({ paymentUrl });
    } catch (error) {
        console.error('Ошибка при создании оплаты для pending_payment:', error);
        res.status(500).json({ message: 'Ошибка при создании оплаты' });
    }
});

router.post("/order/callback", async (req, res) => {
    const { OrderId, Status, Token } = req.body;

    // Здесь должна быть проверка подписи Token
    const isValid = validateTinkoffToken(req.body); // реализация зависит от твоего пароля
    if (!isValid) return res.status(403).send("Invalid token");

    try {
        if (Status === "CONFIRMED") {
            await db.query(
                "UPDATE orders SET status = 'pending' WHERE id = ?",
                [OrderId]
            );
        }
        res.send("OK");
    } catch (err) {
        console.error("Ошибка при обработке колбэка:", err);
        res.status(500).send("Server error");
    }
});


module.exports = router;
