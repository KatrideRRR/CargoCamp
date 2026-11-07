const jwt = require("jsonwebtoken");

const {
    User,
    AuthSession,
} = require("../models");

const authMiddleware = async (req, res, next) => {
    try {
        const authorization = req.header("Authorization");

        const token =
            typeof authorization === "string" &&
            authorization.startsWith("Bearer ")
                ? authorization.slice(7).trim()
                : null;

        if (!token) {
            return res.status(401).json({
                message: "Нет доступа",
            });
        }

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        // Административные маршруты принимают
        // только JWT, привязанные к admin-сессии.
        if (
            decoded.scope !== "admin" ||
            !decoded.sid
        ) {
            return res.status(401).json({
                message:
                    "Недействительная административная сессия",
            });
        }

        const user = await User.findByPk(decoded.id);

        if (!user) {
            return res.status(401).json({
                message: "Пользователь не найден",
            });
        }

        const session = await AuthSession.findByPk(
            decoded.sid
        );

        const now = Date.now();

        const expiresAt = new Date(
            session?.expiresAt
        ).getTime();

        const absoluteExpiresAt = new Date(
            session?.absoluteExpiresAt
        ).getTime();

        if (
            !session ||
            session.scope !== "admin" ||
            Number(session.userId) !== Number(user.id) ||
            session.revokedAt ||
            !Number.isFinite(expiresAt) ||
            !Number.isFinite(absoluteExpiresAt) ||
            expiresAt <= now ||
            absoluteExpiresAt <= now
        ) {
            return res.status(401).json({
                message:
                    "Административная сессия завершена",
            });
        }

        req.user = user;
        req.adminSession = session;

        return next();
    } catch (error) {
        return res.status(401).json({
            message: "Ошибка авторизации",
        });
    }
};

const adminMiddleware = (req, res, next) => {
    if (req.user?.role !== "admin") {
        return res.status(403).json({
            message: "Доступ запрещен",
        });
    }

    return next();
};

module.exports = {
    authMiddleware,
    adminMiddleware,
};