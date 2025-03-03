const jwt = require("jsonwebtoken");
const { User } = require("../models"); // Импорт модели пользователя

module.exports = async function authenticateToken(req, res, next) {
    try {
        const authHeader = req.headers["authorization"];
        const token = authHeader && authHeader.split(" ")[1];

        if (!token) {
            return res.status(401).json({ message: "No token provided" });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);


        // Загружаем пользователя из базы
        const user = await User.findByPk(decoded.id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // ⛔ Если пользователь заблокирован, удаляем токен и запрещаем доступ
        if (user.role === "banned") {
            return res.status(403).json({ message: "Your account has been banned. Please contact support." });
        }


        jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
            if (err) {
                if (err.name === 'TokenExpiredError') {
                    return res.status(403).json({ message: 'Срок действия токена истёк. Авторизуйтесь заново.' });
                }
                return res.status(403).json({ message: 'Неверный токен' });
            }
            req.user = user;
            next();
        });
    } catch (error) {
        console.error("Token verification error:", error);
        res.status(403).json({ message: "Invalid token" });
    }
};
