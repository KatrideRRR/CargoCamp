const COOKIE_NAME = "cc_admin_refresh";

const COOKIE_PATH = "/api/admin/session";

const ALLOWED_ORIGINS = new Set([
    "https://admin.cargocamp.ru",
    "http://localhost:3001",
]);

function validateAdminSessionOrigin(req, res, next) {
    const origin = req.get("Origin");

    if (!origin || !ALLOWED_ORIGINS.has(origin)) {
        return res.status(403).json({
            message: "Недопустимый источник запроса",
        });
    }

    next();
}

function getAdminRefreshToken(req) {
    const cookies = String(req.headers.cookie || "")
        .split(";")
        .map((item) => item.trim());

    const entry = cookies.find((item) =>
        item.startsWith(`${COOKIE_NAME}=`)
    );

    if (!entry) return null;

    return entry.slice(COOKIE_NAME.length + 1);
}

function cookieOptions(expiresAt) {
    const secure = process.env.NODE_ENV === "production";

    return {
        httpOnly: true,
        secure,
        sameSite: "lax",
        path: COOKIE_PATH,
        maxAge: Math.max(
            0,
            new Date(expiresAt).getTime() - Date.now()
        ),
    };
}

function setAdminRefreshCookie(res, token, expiresAt) {
    res.cookie(
        COOKIE_NAME,
        token,
        cookieOptions(expiresAt)
    );
}

function clearAdminRefreshCookie(res) {
    res.clearCookie(
        COOKIE_NAME,
        {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            path: COOKIE_PATH,
        }
    );
}

module.exports = {
    validateAdminSessionOrigin,
    getAdminRefreshToken,
    setAdminRefreshCookie,
    clearAdminRefreshCookie,
};