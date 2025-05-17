const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const router = express.Router();
const { Order } = require("../models");
const { User } = require("../models");
const { processPayment, refundPayment } = require("../utils/paymentService");
const authenticateToken = require("../middlewares/userAuth");

const TERMINAL_KEY = process.env.TERMINAL_KEY;
const PASSWORD = process.env.TINKOFF_PASSWORD;
const API_URL = "https://securepay.tinkoff.ru/v2";

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
    res.setHeader("Access-Control-Allow-Origin",  "http://18.184.43.44:3000");
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

        // Определяем комиссию
        let commission = 0;
        if (order.paymentType === "cash") {
            commission = 200 * 100; // 200 рублей (в копейках)
        } else if (order.paymentType === "guarantee") {
            commission = Math.round(order.proposedSum * 100 * 0.15);
        } else if (order.paymentType === "installments") {
            commission = Math.round(order.proposedSum * 100 * 0.20);
        }

        if (order.is_recommended) {
            commission -= 100 * 100;
            if (commission < 0) commission = 0; // комиссия не может быть отрицательной
        }

        if (commission <= 0) {
            return res.status(400).json({ success: false, error: "Некорректная комиссия" });
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
                },
                { where: { id: userId } }
            );

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

module.exports = router;
