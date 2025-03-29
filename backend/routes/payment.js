const express = require("express");
const axios = require("axios");
const router = express.Router();
const crypto = require("crypto");

const TERMINAL_KEY = "1741722031269DEMO"; // Подставь свой ключ
const API_URL = "https://securepay.tinkoff.ru/v2";
const PASSWORD = "Kg%Vww7PG6fYoWM5"; // Пароль из Тинькофф

const generateToken = (params, password) => {
    const filteredParams = Object.keys(params)
        .filter((key) => key !== "Token" && params[key] !== undefined && params[key] !== null)
        .sort()
        .reduce((acc, key) => acc + params[key], "");

    return crypto.createHash("sha256").update(filteredParams + password).digest("hex").toLowerCase();
};

// 💳 1. Привязка карты
router.post("/bind_card", async (req, res) => {
    const { userId } = req.body;
    console.log("🔹 Запрос на привязку карты:", req.body);

    // Данные запроса
    const requestData = {
        TerminalKey: TERMINAL_KEY,
        OrderId: `user_${userId}`,
        CustomerKey: `user_${userId}`,
        Amount: "100", // Приводим к строке, так как API требует строковые значения
        Description: "Привязка карты",
    };
    console.log("🔹 Данные запроса в Тинькофф:", requestData);

    // Генерируем Token
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
