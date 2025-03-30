const express = require("express");
const axios = require("axios");
const router = express.Router();
const crypto = require("crypto");

const TERMINAL_KEY = "1741722031269DEMO"; // Подставь свой ключ
const API_URL = "https://securepay.tinkoff.ru/v2";
const PASSWORD = "Kg%Vww7PG6fYoWM5"; // Пароль из Тинькофф

const generateToken = (params, password) => {
    // Правильный порядок параметров для токена
    const orderedValues = [
        params.Amount,        // "100"
        params.OrderId,       // "user_38"
        params.Description,   // "Привязка карты"
        params.CustomerKey,   // "user_38"
        password,             // "Kg%Vww7PG6fYoWM5"
        params.TerminalKey    // "1741722031269DEMO"
    ].join(""); // Объединяем без разделителей

    return crypto.createHash("sha256").update(orderedValues).digest("hex").toLowerCase();
};



// 💳 1. Привязка карты
router.post("/bind_card", async (req, res) => {
    const { userId } = req.body;
    console.log("🔹 Запрос на привязку карты:", req.body);

    // Данные запроса
    const requestData = {
        TerminalKey: TERMINAL_KEY,
        Amount: "100",
        OrderId: `user_${userId}`,
        Description: "Привязка карты",
        CustomerKey: `user_${userId}`,
    };

    console.log("🔹 Данные запроса в Тинькофф:", requestData);

    // Генерируем Token с правильным порядком параметров
    requestData.Token = generateToken(requestData, PASSWORD);
    console.log("🔹 Token:", requestData.Token);

    try {
        const response = await axios.post(`${API_URL}/Init`, {
            ...requestData,
            SuccessURL: "https://your-site.com/success",
            FailURL: "https://your-site.com/fail"
        });

        console.log("🔹 Ответ Тинькофф:", response.data);
        res.json(response.data);
    } catch (error) {
        console.error("Ошибка привязки карты:", error?.response?.data || error.message);
        res.status(500).json({ error: "Ошибка привязки карты", details: error?.response?.data });
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
