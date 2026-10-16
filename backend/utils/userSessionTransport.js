const COOKIE_NAME = "cc_user_refresh";

const COOKIE_PATH = "/api/auth/session";

const WEB_ORIGINS = new Set([
    "https://cargocamp.ru",
    "https://www.cargocamp.ru",
    "http://localhost:3000",
]);

function sessionError(message, status = 400) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function getSessionClient(req) {
    const client = req.body?.sessionClient;

    // Старые версии приложения продолжат
    // использовать прежнюю авторизацию.
    if (client === undefined || client === null) {
        return null;
    }

    if (!["web", "native"].includes(client)) {
        throw sessionError(
            "Неизвестный тип клиента"
        );
    }

    // Для cookie-авторизации проверяем источник запроса.
    // Это также защищает refresh/logout от CSRF.
    if (client === "web") {
        const origin = req.get("Origin");

        if (!origin || !WEB_ORIGINS.has(origin)) {
            throw sessionError(
                "Недопустимый источник запроса",
                403
            );
        }
    }

    return client;
}

function getUserRefreshToken(req, client) {
    if (client === "native") {
        const token = req.body?.refreshToken;

        return typeof token === "string" &&
        /^[a-f0-9]{96}$/.test(token)
            ? token
            : null;
    }

    if (client !== "web") {
        return null;
    }

    const cookies = String(req.headers.cookie || "")
        .split(";")
        .map((item) => item.trim());

    const entry = cookies.find((item) =>
        item.startsWith(`${COOKIE_NAME}=`)
    );

    return entry
        ? entry.slice(COOKIE_NAME.length + 1)
        : null;
}

function cookieOptions(expiresAt) {
    return {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: COOKIE_PATH,
        maxAge: Math.max(
            0,
            new Date(expiresAt).getTime() - Date.now()
        ),
    };
}

function setUserRefreshCookie(res, token, expiresAt) {
    res.cookie(
        COOKIE_NAME,
        token,
        cookieOptions(expiresAt)
    );
}

function clearUserRefreshCookie(res) {
    res.clearCookie(COOKIE_NAME, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: COOKIE_PATH,
    });
}

function buildUserSessionResponse(res, client, session) {
    if (client === "web") {
        setUserRefreshCookie(
            res,
            session.refreshToken,
            session.expiresAt
        );
    }

    return {
        token: session.token,

        // Только нативное приложение получает
        // refresh-токен в JSON.
        ...(client === "native"
            ? { refreshToken: session.refreshToken }
            : {}),
    };
}

module.exports = {
    getSessionClient,
    getUserRefreshToken,
    buildUserSessionResponse,
    clearUserRefreshCookie,
};