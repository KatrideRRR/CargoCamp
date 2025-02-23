const express = require('express');
const { authMiddleware, adminMiddleware } = require('../middlewares/adminMiddlewares');
const { User, Order, Message } = require('../models');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const NodeGeocoder = require("node-geocoder");

const geocoder = NodeGeocoder({
    provider: "openstreetmap", // Или другой сервис, который ты используешь
});

const router = express.Router();

// Получение документов пользователя (только для админов)
router.get('/user-documents/:userId', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await User.findByPk(userId, {
            attributes: ['id', 'documentPhotos'],
        });

        if (!user) {
            return res.status(404).json({ message: 'Пользователь не найден' });
        }

        res.status(200).json({ documents: user.documentPhotos || [] });
    } catch (error) {
        console.error('Ошибка при получении документов пользователя:', error);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Add a new order as admin
router.post('/create-order', authMiddleware,  async (req, res) => {
    const { address, description, workTime, proposedSum, type, categoryId, subcategoryId, userId } = req.body;

    try {
        if (!address || !userId) {
            return res.status(400).json({ message: 'Адрес и ID пользователя обязательны' });
        }

        // Получаем координаты из геокодера
        const geoData = await geocoder.geocode(address);
        if (!geoData.length) {
            return res.status(404).json({ message: 'Адрес не найден' });
        }

        const { latitude, longitude } = geoData[0];
        const coordinates = `${latitude},${longitude}`;


        const newOrder = await Order.create({
            userId, // Создаём заказ от указанного пользователя
            address,
            description,
            workTime,
            proposedSum,
            coordinates,
            type,
            createdAt: new Date().toISOString(),
            creatorId: userId, // ID админа, создавшего заказ
            status: 'pending',
            categoryId,
            subcategoryId,
        });


        res.status(201).json(newOrder);
    } catch (error) {
        console.error('Ошибка при создании заказа админом:', error);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Админский маршрут для создания пользователя
router.post('/create-user', authMiddleware, adminMiddleware, async (req, res) => {
    const { username, phone, password } = req.body;

    if (!phone || !password) {
        return res.status(400).json({ error: 'Укажите номер телефона и пароль' });
    }

    try {
        const userExists = await User.findOne({ where: { phone } });
        if (userExists) {
            return res.status(400).json({ message: 'Телефон уже используется' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = await User.create({ username, phone, password: hashedPassword });

        const token = jwt.sign({ id: newUser.id, phone: newUser.phone }, process.env.JWT_SECRET, { expiresIn: '1h' });
        res.status(201).json({ message: 'Пользователь зарегистрирован', token });
    } catch (error) {
        console.error('Ошибка при создании пользователя:', error);
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Получить всех пользователей (только для админов)
router.get('/users', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const users = await User.findAll();
        res.json(users);
    } catch (error) {
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Заблокировать пользователя (установить статус "banned")
router.put('/users/:id/block', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const user = await User.findByPk(req.params.id);
        if (!user) return res.status(404).json({ message: 'Пользователь не найден' });

        user.role = 'banned';
        await user.save();

        res.json({ message: 'Пользователь заблокирован', user });
    } catch (error) {
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Разблокировать пользователя (установить статус "user")
router.put('/users/:id/unblock', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const user = await User.findByPk(req.params.id);
        if (!user) return res.status(404).json({ message: 'Пользователь не найден' });

        user.role = 'user'; // Меняем статус на обычного пользователя
        await user.save();

        res.json({ message: 'Пользователь разблокирован', user });
    } catch (error) {
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Получить все заказы
router.get('/orders', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const orders = await Order.findAll();
        res.json(orders);
    } catch (error) {
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Удалить заказ
router.delete('/orders/:id', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const order = await Order.findByPk(req.params.id);
        if (!order) return res.status(404).json({ message: 'Заказ не найден' });

        await order.destroy();
        res.json({ message: 'Заказ удален' });
    } catch (error) {
        res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Вход администратора
router.post('/login', async (req, res) => {
    const { phone, password } = req.body;
    try {
        // Находим пользователя по номеру телефона
        const user = await User.findOne({ where: { phone } });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Проверка пароля
        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            return res.status(401).json({ message: 'Invalid password' });
        }

        // Проверка, является ли пользователь администратором
        if (user.role !== 'admin') {
            return res.status(403).json({ message: 'Access denied: You are not an admin' });
        }

        // Создание JWT токена для администратора
        const token = jwt.sign({ id: user.id, phone: user.phone, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });

        // Возвращаем токен и информацию о пользователе
        res.json({
            token,
            user: { id: user.id, username: user.username, phone: user.phone, role: user.role, rating: user.rating || 5 }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

router.get("/:orderId/messages", async (req, res) => {
    try {
        const { orderId } = req.params;
        // Получаем все сообщения для этого заказа
        const messages = await Message.findAll({
            where: { orderId },
            order: [['createdAt', 'ASC']], // Сортировка по времени создания
            include: [
                {
                    model: User,
                    as: 'sender',
                    attributes: ['username']
                }
            ]
        });

        res.json(messages);
    } catch (error) {
        console.error("Ошибка получения сообщений:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});


// Детали заказа
router.get('/orders/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const order = await Order.findOne({ where: { id } });
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        res.json(order);
    } catch (error) {
        console.error('Error fetching order:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Получение информации о пользователе по ID (включая жалобы)
router.get("/users/:id/complaints", authMiddleware, adminMiddleware, async (req, res) => {
    const { id } = req.params;

    try {
        const user = await User.findByPk(id);

        if (!user) {
            return res.status(404).json({ message: "Пользователь не найден" });
        }

        res.json({
            id: user.id,
            username: user.username,
            phone: user.phone,
            complaints: user.complaints || [],
        });
    } catch (error) {
        console.error("Ошибка при получении пользователя:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

// routes/adminRoutes.js
router.get("/users/:userId/orders", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;
        const orders = await Order.findAll({ where: { userId } });
        res.json({ orders });
    } catch (error) {
        console.error("Ошибка при получении заказов пользователя:", error);
        res.status(500).json({ error: "Ошибка сервера" });
    }
});

// Админ создаёт заказ за другого пользователя
router.post("/create", authMiddleware, adminMiddleware, async (req, res) => {
        try {
            const {
                userId,
                address,
                description,
                workTime,
                proposedSum,
                type,
                categoryId,
                subcategoryId,
            } = req.body;

            if (!userId || !address) {
                return res.status(400).json({ message: "ID пользователя и адрес обязательны" });
            }

            // Проверяем, существует ли пользователь
            const user = await User.findByPk(userId);
            if (!user) {
                return res.status(404).json({ message: "Пользователь не найден" });
            }

            // Получаем координаты из геокодера
            const geoData = await geocoder.geocode(address);
            if (!geoData.length) {
                return res.status(404).json({ message: "Адрес не найден" });
            }

            const { latitude, longitude } = geoData[0];
            const coordinates = `${latitude},${longitude}`;

            // Собираем фото в массив
            const photoUrls = req.files ? req.files.map(file => `/uploads/orders/${file.filename}`) : [];

            // Создаем заказ
            const newOrder = await Order.create({
                userId,
                address,
                description,
                workTime,
                proposedSum,
                coordinates,
                type,
                createdAt: new Date().toISOString(),
                creatorId: userId,
                status: "pending",
                categoryId,
                subcategoryId,
            });
            res.status(201).json({ message: "Заказ успешно создан", order: newOrder });
        } catch (error) {
            console.error("Ошибка при создании заказа админом:", error);
            res.status(500).json({ message: "Ошибка сервера" });
        }
    }
);

module.exports = router;
