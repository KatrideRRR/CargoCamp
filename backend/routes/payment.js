const express = require("express");
const axios = require("axios");
const router = express.Router();
const crypto = require("crypto");

const TERMINAL_KEY = "1741722031269DEMO"; // Подставь свой ключ
const API_URL = "https://securepay.tinkoff.ru/v2";
const PASSWORD = "Kg%Vww7PG6fYoWM5"; // Пароль из Тинькофф

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

// 🔹 Маршрут для тестового платежа
router.post("/bind_card", async (req, res) => {
    const { userId } = req.body;

    console.log("🔹 Запрос на тестовый платеж:", req.body);

    // 🔸 1. Формируем параметры платежа
    const params = {
        TerminalKey: TERMINAL_KEY,
        Amount: 10000,
        OrderId: `test_order_19`,
        Description: "Тестовый платеж",
        CustomerKey: `test_user_${userId}`
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

    // 🔸 4. Отправляем запрос в Тинькофф
    try {
        const response = await axios.post(`${API_URL}/Init`, params);

        console.log("🔹 Ответ Тинькофф:", response.data);

        if (response.data.Success) {
            res.json({ success: true, PaymentURL: response.data.PaymentURL });
        } else {
            res.status(400).json({ success: false, error: response.data.Message });
        }
    } catch (error) {
        console.error("Ошибка создания платежа:", error?.response?.data || error.message);
        res.status(500).json({ success: false, error: "Ошибка создания платежа" });
    }
});




// 💰 2. Автосписание
router.post("/charge_card", async (req, res) => {
    const { userId, rebillId, amount, description } = req.body;

    try {
        const response = await axios.post(`${API_URL}/Charge`, {
            TerminalKey: TERMINAL_KEY,
            Amount: amount * 100,  // В копейках (100 рублей = 10000)
            OrderId: `charge_${userId}`,
            RebillId: rebillId,
            CustomerKey: `user_${userId}`,
            Description: description
        });

        res.json(response.data);  // Ответ Тинькофф
    } catch (error) {
        res.status(500).json({ error: "Ошибка автосписания" });
    }
});

module.exports = router;
