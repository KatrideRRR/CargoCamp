const jwt = require('jsonwebtoken');
const {User, AuthSession,} = require("../models");

const authMiddleware = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.split(' ')[1]; // Получаем токен из заголовка
        if (!token) return res.status(401).json({ message: 'Нет доступа' });

        const decoded = jwt.verify(token, process.env.JWT_SECRET); // Декодируем токен
        const user = await User.findByPk(decoded.id); // Ищем пользователя в БД

        if (!user) return res.status(401).json({ message: 'Пользователь не найден' });

        if (decoded.scope === "admin" && decoded.sid) {
            const session = await AuthSession.findByPk(
                decoded.sid
            );

            if (
                !session ||
                session.scope !== "admin" ||
                Number(session.userId) !== Number(user.id) ||
                session.revokedAt ||
                new Date(session.expiresAt) <= new Date() ||
                new Date(session.absoluteExpiresAt) <= new Date()
            ) {
                return res.status(401).json({
                    message: "Административная сессия завершена",
                });
            }
        }

        req.user = user; // Передаём пользователя в req
        next();
    } catch (error) {
        res.status(401).json({ message: 'Ошибка авторизации' });
    }
};

// Middleware для проверки роли admin
const adminMiddleware = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Доступ запрещен' });
    }
    next();
};

module.exports = { authMiddleware, adminMiddleware };
