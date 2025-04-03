const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const router = express.Router();
const { Order } = require("../models");
const { User } = require("../models");
const { processPayment, refundPayment } = require("../paymentService");
const { encryptCard, decryptCard } = require("../encryption");
const authenticateToken = require("../middlewares/authenticateToken");

const TERMINAL_KEY = "1741722031308";
const PASSWORD = "5A_zMtY9nIkIeO^r";
const API_URL = "https://securepay.tinkoff.ru/v2";

// 🔹 Функция генерации Token (БЕЗ Receipt!)
function generateToken(params) {
    delete params.Token;
    params.Password = PASSWORD;

    const sortedKeys = Object.keys(params).filter(k => k !== "Receipt").sort();
    const dataString = sortedKeys.map(key => params[key]).join('');
    const hash = crypto.createHash('sha256').update(dataString).digest('hex');

    delete params.Password;
    return hash;
}

router.post("/bind-card", authenticateToken, async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
    res.setHeader("Access-Control-Allow-Credentials", "true");

    const { id } = req.user;
    console.log("userId:", id); // Проверяем, какой userId передаётся
    const { cardNumber, expiry, cvv } = req.body;

    if (!cardNumber || !expiry || !cvv) {
        return res.status(400).json({ message: "Некорректные данные карты" });
    }

    try {
        // 1. Проведение тестового платежа
        const paymentResult = await processPayment(id, 1);
        if (!paymentResult.success) {
            return res.status(400).json({ message: "Ошибка платежа" });
        }

        // 2. Возврат платежа
        await refundPayment(paymentResult.transactionId);

        // 3. Шифрование и сохранение карты в БД
        const encryptedCard = encryptCard(cardNumber);
        if (!id) {
            return res.status(400).json({ success: false, message: "Ошибка: userId не указан" });
        }

        await User.update({ cardNumber: encryptedCard }, { where: { id: id } });

        return res.json({ message: "Карта успешно привязана" });
    } catch (error) {
        console.error("Ошибка привязки карты:", error);
        return res.status(500).json({ message: "Ошибка сервера" });
    }
});

// 🔹 Оплата комиссии
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
            commission = Math.round(order.proposedSum * 0.15) * 100; // 15% от суммы
        } else if (order.paymentType === "installments") {
            commission = Math.round(order.proposedSum * 0.20) * 100; // 20% от суммы
        }

        if (commission <= 0) {
            return res.status(400).json({ success: false, error: "Некорректная комиссия" });
        }

        // 🔸 1. Формируем параметры платежа
        const params = {
            TerminalKey: TERMINAL_KEY,
            Amount: commission,
            OrderId: `commission_${orderId}`,
            Description: `Комиссия за заказ #${orderId}`,
            CustomerKey: `user_${userId}`,
            NotificationURL: "https://localhost:5000/api/payment/callback"
        };

        await axiosInstance.post(`${API_URL}/Init`, params);

        // 🔸 2. Генерируем `Token`
        params.Token = generateToken(params);

        // 🔸 3. Добавляем `Receipt`
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

        // 🔹 4. Отправляем запрос в Тинькофф
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

// 🔹 Обработка уведомления от Тинькофф (коллбек)
router.post("/callback", async (req, res) => {
    const { Success, Status, PaymentId, RebillId, OrderId, CustomerKey } = req.body;

    if (Success && Status === "CONFIRMED" && RebillId) {
        const userId = CustomerKey.replace("user_", "");
        console.log(`✅ Карта привязана для userId: ${userId}, RebillId: ${RebillId}`);

        // Сохраняем RebillId в базу
        await saveRebillIdToDB(userId, RebillId);

        res.json({ success: true });
    } else {
        console.log("⚠ Ошибка привязки карты:", req.body);
        res.status(400).json({ success: false });
    }
});

module.exports = router;
