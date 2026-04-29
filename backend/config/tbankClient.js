// backend/config/tbankClient.js

const crypto = require("crypto");

const TBANK_API_URL = "https://securepay.tinkoff.ru/v2";

const TERMINAL_KEY = process.env.TBANK_TERMINAL_KEY;
const PASSWORD = process.env.TBANK_PASSWORD;

if (!TERMINAL_KEY || !PASSWORD) {
    console.warn("⚠️ TBANK_TERMINAL_KEY или TBANK_PASSWORD не заданы в .env");
}

/**
 * Токен Т-Банка:
 * 1. Берем только примитивные поля верхнего уровня.
 * 2. Добавляем Password.
 * 3. Сортируем ключи по алфавиту.
 * 4. Склеиваем значения.
 * 5. SHA-256.
 */
function makeToken(payload = {}) {
    const tokenPayload = {};

    for (const [key, value] of Object.entries(payload)) {
        if (key === "Token") continue;

        const isPrimitive =
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean";

        if (isPrimitive || value === null) {
            tokenPayload[key] = value;
        }
    }

    tokenPayload.Password = PASSWORD;

    const sortedKeys = Object.keys(tokenPayload).sort();

    const concat = sortedKeys
        .map((key) => String(tokenPayload[key]))
        .join("");

    return crypto
        .createHash("sha256")
        .update(concat)
        .digest("hex");
}

async function requestTBank(method, payload = {}) {
    const body = {
        TerminalKey: TERMINAL_KEY,
        ...payload,
    };

    body.Token = makeToken(body);

    const response = await fetch(`${TBANK_API_URL}/${method}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(`TBank HTTP error ${response.status}: ${JSON.stringify(data)}`);
    }

    if (!data?.Success) {
        throw new Error(data?.Message || data?.Details || "TBank request failed");
    }

    return data;
}

function verifyNotificationToken(body = {}) {
    if (!body?.Token) return false;

    const expectedToken = makeToken(body);

    return expectedToken === body.Token;
}

module.exports = {
    requestTBank,
    makeToken,
    verifyNotificationToken,
};