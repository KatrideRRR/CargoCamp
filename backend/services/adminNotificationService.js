const axios = require("axios");

const NOTIFY_URL =
    process.env.CARGOCAMP_NOTIFY_URL ||
    "https://notify.cargocamp.ru/notify";

const NOTIFY_SECRET =
    process.env.CARGOCAMP_NOTIFY_SECRET;

const ADMIN_PANEL_URL =
    process.env.ADMIN_PANEL_URL ||
    "https://admin.cargocamp.ru";

const ALLOWED_TOPICS = new Set([
    "support",
    "ideas",
    "disputes",
    "verification",
    "vehicles",
    "payments",
    "system",
]);

function cleanValue(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value).trim();
}

function sanitizeMessage(value) {
    let text = cleanValue(value);

    // JWT
    text = text.replace(
        /eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
        "[JWT HIDDEN]"
    );

    // Authorization Bearer
    text = text.replace(
        /Bearer\s+[a-zA-Z0-9._\-]+/gi,
        "Bearer [HIDDEN]"
    );

    // Возможные пароли/секреты/токены в строках
    text = text.replace(
        /(password|secret|token|authorization)\s*[:=]\s*[^\s,\n]+/gi,
        "$1=[HIDDEN]"
    );

    // Ограничиваем размер сообщения
    if (text.length > 3500) {
        text =
            text.slice(0, 3500) +
            "\n\n[сообщение сокращено]";
    }

    return text;
}

async function sendAdminNotification({
                                         topic,
                                         title,
                                         message,
                                         buttonText,
                                         buttonUrl,
                                     }) {
    try {
        if (!NOTIFY_SECRET) {
            console.error(
                "[adminNotification] CARGOCAMP_NOTIFY_SECRET is not configured"
            );

            return {
                success: false,
                skipped: true,
            };
        }

        if (!ALLOWED_TOPICS.has(topic)) {
            console.error(
                `[adminNotification] Unknown topic: ${topic}`
            );

            return {
                success: false,
                skipped: true,
            };
        }

        const response = await axios.post(
            NOTIFY_URL,
            {
                topic,
                title: cleanValue(title),
                message: sanitizeMessage(message),

                ...(buttonText && buttonUrl
                    ? {
                        buttonText:
                            cleanValue(buttonText),

                        buttonUrl:
                            cleanValue(buttonUrl),
                    }
                    : {}),
            },
            {
                headers: {
                    Authorization:
                        `Bearer ${NOTIFY_SECRET}`,

                    "Content-Type":
                        "application/json",
                },

                timeout: 8000,
            }
        );

        return {
            success: true,
            data: response.data,
        };
    } catch (error) {
        console.error(
            "[adminNotification] send failed:",
            error.response?.data ||
            error.message
        );

        // Критично:
        // Telegram никогда не должен ломать основной запрос пользователя.
        return {
            success: false,
            error:
                error.response?.data ||
                error.message,
        };
    }
}

function adminUserUrl(userId) {
    return `${ADMIN_PANEL_URL}/users/${userId}`;
}

function adminUsersUrl() {
    return `${ADMIN_PANEL_URL}/users`;
}

function adminDisputeUrl(disputeId) {
    return `${ADMIN_PANEL_URL}/disputes/${disputeId}`;
}

function adminOrderUrl(orderId) {
    return `${ADMIN_PANEL_URL}/orders/${orderId}`;
}

function adminExpressOrderUrl(orderId) {
    return `${ADMIN_PANEL_URL}/express-orders/${orderId}`;
}

function sanitizeSystemError(error) {
    const message =
        error?.message ||
        String(error || "Unknown error");

    const stack =
        typeof error?.stack === "string"
            ? error.stack
                .split("\n")
                .slice(0, 8)
                .join("\n")
            : null;

    return {
        message: sanitizeMessage(message),
        stack: stack
            ? sanitizeMessage(stack)
            : null,
    };
}

function notifySystemError({title = "🚨 Ошибка backend", error, req = null, extra = null,}) {
    const safeError =
        sanitizeSystemError(error);

    const message = [
        `Environment: ${process.env.NODE_ENV || "unknown"}`,

        req?.method
            ? `Метод: ${req.method}`
            : null,

        req?.originalUrl
            ? `URL: ${req.originalUrl}`
            : null,

        req?.user?.id
            ? `User ID: ${req.user.id}`
            : null,

        error?.status
            ? `HTTP status: ${error.status}`
            : null,

        error?.code
            ? `Код ошибки: ${error.code}`
            : null,

        "",
        `Ошибка: ${safeError.message}`,

        extra
            ? `Контекст: ${sanitizeMessage(extra)}`
            : null,

        safeError.stack
            ? `\nStack:\n${safeError.stack}`
            : null,
    ]
        .filter(Boolean)
        .join("\n");

    return sendAdminNotification({
        topic: "system",
        title,
        message,
    });
}

module.exports = {
    sendAdminNotification,
    adminUserUrl,
    adminDisputeUrl,
    adminUsersUrl,
    adminOrderUrl,
    adminExpressOrderUrl,
    notifySystemError,
};