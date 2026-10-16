const jwt = require("jsonwebtoken");

const {
    User,
    AuthSession,
} = require("../models");

module.exports = async function authenticateToken(
    req,
    res,
    next
) {
    try {
        const authHeader =
            req.headers["authorization"];

        const token =
            authHeader?.startsWith("Bearer ")
                ? authHeader.slice(7)
                : null;

        if (!token) {
            return res.status(401).json({
                message: "No token provided",
            });
        }

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        const user = await User.findByPk(decoded.id);

        if (!user) {
            return res.status(401).json({
                message: "Пользователь не найден",
            });
        }

        if (user.role === "banned") {
            return res.status(403).json({
                message: "Ваш аккаунт заблокирован",
            });
        }

        /*
         * Проверяем новые пользовательские сессии.
         *
         * Старые JWT без sid и scope пока поддерживаем,
         * чтобы не разлогинить пользователей старых версий.
         */

        if (decoded.sid || decoded.scope) {
            if (
                decoded.scope !== "user" ||
                !decoded.sid
            ) {
                return res.status(401).json({
                    message: "Недействительная сессия",
                });
            }

            const session = await AuthSession.findByPk(
                decoded.sid
            );

            const now = Date.now();

            if (
                !session ||
                session.scope !== "user" ||
                Number(session.userId) !== Number(user.id) ||
                session.revokedAt ||
                new Date(session.expiresAt).getTime() <= now ||
                new Date(session.absoluteExpiresAt).getTime() <= now
            ) {
                return res.status(401).json({
                    message: "Сессия завершена или истекла",
                });
            }
        }

        req.user = {
            ...decoded,
            role: user.role,
        };

        next();

    } catch (error) {
        if (
            error.name === "TokenExpiredError" ||
            error.name === "JsonWebTokenError" ||
            error.name === "NotBeforeError"
        ) {
            return res.status(401).json({
                message: "Недействительный или истёкший токен",
            });
        }

        console.error(
            "User authorization error:",
            error
        );

        return res.status(500).json({
            message: "Ошибка проверки авторизации",
        });
    }
};