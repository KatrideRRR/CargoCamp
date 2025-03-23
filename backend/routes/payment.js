const express = require("express");
const axios = require("axios");
const router = express.Router();
const crypto = require("crypto");

const TERMINAL_KEY = "1741722031269DEMO"; // Подставь свой ключ
const API_URL = "https://securepay.tinkoff.ru/v2";
const PASSWORD = "Kg%Vww7PG6fYoWM5"; // Пароль из Тинькофф

// 💳 Функция для генерации Token
const generateToken = (params) => {
    const sortedParams = Object.keys(params)
        .filter((key) => key !== "Token") // Исключаем Token
        .sort()
        .reduce((acc, key) => acc + params[key], "");
    return crypto.createHash("sha256").update(sortedParams + PASSWORD).digest("hex");
};


// 💳 1. Привязка карты
router.post("/bind_card", async (req, res) => {
    const { userId } = req.body;  // Получаем ID пользователя
    console.log("🔹 Привязка карты для пользователя:", userId); // Проверяем userId

    // Формируем параметры запроса
    const requestData = {
        TerminalKey: TERMINAL_KEY,
        OrderId: `user_${userId}`,
        CustomerKey: `user_${userId}`,
        Amount: 100, // 1 рубль (в копейках)
        Description: "Привязка карты",
        SuccessURL: "https://your-site.com/success",
        FailURL: "https://your-site.com/fail"
    };

    // Генерируем Token
    requestData.Token = generateToken(requestData);

    try {
        const response = await axios.post(`${API_URL}/Init`, requestData);
        console.log("🔹 Ответ Тинькофф:", response.data);

        res.json(response.data);
    } catch (error) {
        console.error("Ошибка привязки карты:", error.response?.data || error.message);
        res.status(500).json({ error: "Ошибка привязки карты" });
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
