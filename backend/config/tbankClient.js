// backend/config/tbankClient.js

const crypto = require("crypto");

const TBANK_API_URL = "https://securepay.tinkoff.ru/v2";

const TERMINAL_KEY = process.env.TBANK_TERMINAL_KEY;
const PASSWORD = process.env.TBANK_PASSWORD;

if (!TERMINAL_KEY || !PASSWORD) {
    console.warn("⚠️ TBANK_TERMINAL_KEY или TBANK_PASSWORD не заданы в .env");
}

function normalizeTBankValue(value) {
    if (value === null || value === undefined) return null;

    if (typeof value === "boolean") {
        return value ? "true" : "false";
    }

    return String(value);
}

/**
 * Токен Т-Банка:
 * 1. Берём только простые поля верхнего уровня.
 * 2. НЕ берём Token.
 * 3. НЕ берём вложенные объекты: DATA, Data, Receipt и т.д.
 * 4. Добавляем Password.
 * 5. Сортируем ключи.
 * 6. Склеиваем значения.
 * 7. SHA-256.
 */
function makeToken(payload = {}) {
    const tokenPayload = {};

    for (const [key, value] of Object.entries(payload)) {
        if (key === "Token") continue;

        // Вложенные объекты в токене не участвуют
        if (value && typeof value === "object") continue;

        const normalized = normalizeTBankValue(value);
        if (normalized === null) continue;

        tokenPayload[key] = normalized;
    }

    tokenPayload.Password = String(PASSWORD || "");

    const concat = Object.keys(tokenPayload)
        .sort()
        .map((key) => tokenPayload[key])
        .join("");

    return crypto
        .createHash("sha256")
        .update(concat, "utf8")
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
        console.error("TBank HTTP error:", {
            method,
            httpStatus: response.status,
            errorCode: data?.ErrorCode || null,
            message: data?.Message || null,
        });

        throw new Error(
            `TBank HTTP error ${response.status}`
        );
    }

    if (!data?.Success) {
        console.error("TBank API error:", {
            method,
            errorCode: data?.ErrorCode || null,
            message: data?.Message || null,
        });

        throw new Error(
            data?.Message || "TBank request failed"
        );
    }

    return data;
}

function verifyNotificationToken(body = {}) {
    if (!body?.Token) return false;

    const expectedToken = makeToken(body);
    const receivedToken = body.Token;

    if (expectedToken !== receivedToken) {
        console.warn("TBank webhook token mismatch", {
            paymentId: body.PaymentId || null,
            status: body.Status || null,
        });
    }

    return expectedToken === receivedToken;
}

module.exports = {
    requestTBank,
    makeToken,
    verifyNotificationToken,
};