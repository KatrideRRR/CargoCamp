const express = require("express");
const axios = require("axios");
const router = express.Router();
const crypto = require("crypto");

const TERMINAL_KEY = "1741722031269DEMO"; // Подставь свой ключ
const API_URL = "https://securepay.tinkoff.ru/v2";
const PASSWORD = "Kg%Vww7PG6fYoWM5"; // Пароль из Тинькофф

// 🔹 Функция для генерации Token
function generateToken(params) {
    // Добавляем параметр Password
    params.Password = PASSWORD;

    // Сортируем ключи параметров в алфавитном порядке
    const sortedKeys = Object.keys(params).sort();

    // Объединяем значения параметров в одну строку
    const dataString = sortedKeys.map(key => params[key]).join('');

    // Вычисляем SHA-256 хеш
    const hash = crypto.createHash('sha256').update(dataString).digest('hex');

    // Удаляем параметр Password из исходных параметров
    delete params.Password;

    return hash;
}

// 🔹 Маршрут для создания тестового платежа
router.post("/bind_card", async (req, res) => {
    const { userId } = req.body;

    console.log("🔹 Запрос на тестовый платеж:", req.body);

    // Данные для платежа
    const params = {
        TerminalKey: '1741722031269DEMO',
        Amount: '10000',
        OrderId: 'test_order_39',
        Description: 'Тестовый платеж',
        CustomerKey: 'test_user_38',
    };

    // Генерируем Token
    params.Token = generateToken(params);
    console.log('Сгенерированный токен:', params.Token);

    console.log("🔹 Данные запроса в Тинькофф:", params);

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
