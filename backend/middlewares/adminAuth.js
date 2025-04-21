const jwt = require('jsonwebtoken');
const { User } = require('../models'); // Импортируем модель пользователя

const authMiddleware = async (req, res, next) => {
    try {
        const token = req.header('Authorization')?.split(' ')[1]; // Получаем токен из заголовка
        if (!token) return res.status(401).json({ message: 'Нет доступа' });

        const decoded = jwt.verify(token, process.env.JWT_SECRET); // Декодируем токен
        const user = await User.findByPk(decoded.id); // Ищем пользователя в БД

        if (!user) return res.status(401).json({ message: 'Пользователь не найден' });

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
