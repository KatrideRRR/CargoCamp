const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const router = express.Router();
const { User } = require("../models"); // Подключаем модель пользователя

const TERMINAL_KEY = "1741722031308";
const PASSWORD = "5A_zMtY9nIkIeO^r";
const API_URL = "https://securepay.tinkoff.ru/v2";

async function saveRebillIdToDB(userId, rebillId) {
    try {
        await User.update({ cardNumber: rebillId }, { where: { id: userId } });
        console.log(`✅ RebillId сохранён для userId: ${userId}`);
    } catch (error) {
        console.error(`❌ Ошибка сохранения RebillId для userId: ${userId}`, error);
    }
}

// 🔹 Функция генерации Token (БЕЗ Receipt!)
function generateToken(params) {
    delete params.Token; // Убираем старый токен
    params.Password = PASSWORD; // Добавляем SecretKey

    // 🔸 Сортируем ключи параметров в алфавитном порядке (без Receipt)
    const sortedKeys = Object.keys(params).filter(k => k !== "Receipt").sort();

    // 🔸 Объединяем значения параметров в строку
    const dataString = sortedKeys.map(key => params[key]).join('');

    // 🔸 Вычисляем SHA-256 хеш
    const hash = crypto.createHash('sha256').update(dataString).digest('hex');

    delete params.Password; // ⚠️ Удаляем перед отправкой

    return hash;
}

// 🔹 Запрос на привязку карты
router.post("/bind_card", async (req, res) => {
    const { userId } = req.body;
    if (!userId) {
        return res.status(400).json({ success: false, error: "userId обязателен" });
    }

    // 🔸 1. Формируем параметры платежа
    const params = {
        TerminalKey: TERMINAL_KEY,
        Amount: 10000,
        OrderId: `test_23`,
        Description: "Тестовый платеж",
        CustomerKey: `test_user_${userId}`,
        NotificationURL: "https://http://18.184.43.44:5000/api/payment/callback"  // 🚀 Важно!
    };

    // 🔸 2. Генерируем `Token` (БЕЗ Receipt)
    params.Token = generateToken(params);

    // 🔸 3. Добавляем `Receipt` (НЕ включаем в Token)
    params.Receipt = {
        Email: "test@example.com",
        Phone: "+79001234567",
        Taxation: "osn",
        Items: [
            {
                Name: "Тестовый товар",
                Price: 10000,
                Quantity: 1,
                Amount: 10000,
                Tax: "vat10",
                PaymentMethod: "full_payment",
                PaymentObject: "commodity"
            }
        ]
    };

    console.log("🔹 Данные запроса в Тинькофф:", JSON.stringify(params, null, 2));

    console.log("🔹 Данные, отправляемые в Тинькофф:", params);
    const response = await axios.post(`${API_URL}/Init`, params);
    console.log("🔹 Ответ Тинькофф:", response.data);

    try {
        const response = await axios.post(`${API_URL}/Init`, params);
        if (response.data.Success) {
            res.json({ success: true, PaymentURL: response.data.PaymentURL });
        } else {
            res.status(400).json({ success: false, error: response.data.Message });
        }
    } catch (error) {
        res.status(500).json({ success: false, error: "Ошибка привязки карты" });
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
