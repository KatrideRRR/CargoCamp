const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const router = express.Router();
const { Order } = require("../models");
const { User } = require("../models");
const { processPayment, refundPayment } = require("../paymentService");
const { encryptCard, decryptCard } = require("../encryption");
const authenticateToken = require("../middlewares/authenticateToken");

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
    const bin = cardNumber.slice(0, 6);

    const visaRegex = /^4/;
    const masterRegex = /^5[1-5]/;
    const mirRegex = /^220[0-4]/;
    const amexRegex = /^3[47]/;
    const discoverRegex = /^6(?:011|5)/;

    if (visaRegex.test(cardNumber)) return 'Visa';
    if (masterRegex.test(cardNumber)) return 'MasterCard';
    if (mirRegex.test(cardNumber)) return 'MIR';
    if (amexRegex.test(cardNumber)) return 'American Express';
    if (discoverRegex.test(cardNumber)) return 'Discover';

    return 'Unknown';
}

router.post("/bind-card", authenticateToken, async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
    res.setHeader("Access-Control-Allow-Credentials", "true");

    const { id } = req.user;
    const { cardNumber, expiry, cvv } = req.body;

    if (!id) {
        return res.status(400).json({ message: "Ошибка: userId не указан" });
    }

    if (!cardNumber || !expiry || !cvv) {
        return res.status(400).json({ message: "Некорректные данные карты" });
    }

    try {
        const paymentResult = await processPayment(id, 1);
        if (!paymentResult.success) {
            return {
                success: false,
                error: "Ошибка инициализации"
            }
        }

        await refundPayment(paymentResult.transactionId);

        const encryptedCard = encryptCard(cardNumber);

        const last4 = cardNumber.slice(-4);  // последние 4 цифры
        const cardType = getCardType(cardNumber);  // Функция, которая определяет тип карты (например, Visa, MasterCard)

        console.log("Card type detected:", cardType);

        if (!id) {
            return res.status(400).json({ success: false, message: "Ошибка: userId не указан" });
        }

        // Сохраняем все данные в БД
        await User.update(
            {
                cardNumber: encryptedCard,
                cardLastFour: last4,  // Сохраняем последние 4 цифры
                cardType: cardType    // Сохраняем тип карты
            },
            { where: { id: id } }
        );


        return res.json({ message: "Карта успешно привязана" });
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
    const { Success, Status, PaymentId, RebillId, OrderId, CustomerKey } = req.body;

    if (Success && Status === "CONFIRMED" && RebillId) {
        const userId = CustomerKey.replace("user_", "");
        console.log(`✅ Карта привязана для userId: ${userId}, RebillId: ${RebillId}`);

        await User.update(
            { RebillId: RebillId },
            { where: { id: userId } }
        );

        res.json({ success: true });
    } else {
        console.log("⚠ Ошибка привязки карты:", req.body);
        res.status(400).json({ success: false });
    }
});

module.exports = router;
