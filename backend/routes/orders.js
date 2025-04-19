const express = require('express');
const router = express.Router();
const NodeGeocoder = require('node-geocoder');
const db = require('../models');
const authenticateToken = require('../middlewares/authenticateToken');
const multer = require('multer');
const { Op } = require('sequelize');
const path = require('path');
const { Sequelize } = require('sequelize');  // Импортируем Sequelize
const moment = require('moment'); // Для работы с датами
const { Order, User, Category, Subcategory } = require('../models'); // Добавь User
const fs = require('fs');
const generateContractPDF = require('../utils/generateContractPDF'); // путь поправь, если другой

// Устанавливаем интервал для проверки заказов (например, каждое утро в 6:00)
setInterval(async () => {
    try {
        // Получаем все заказы, которые не были взяты в работу и созданы более 24 часов назад
        const ordersToDelete = await Order.findAll({
            where: {
                status: 'pending',
                createdAt: {
                    [Sequelize.Op.lt]: moment().subtract(24, 'hours').toDate(), // Заказы старше 24 часов
                },
            },
        });

        // Удаляем все такие заказы
        for (const order of ordersToDelete) {
            await order.destroy();
            console.log(`Заказ ${order.id} удален автоматически.`);
        }
    } catch (error) {
        console.error("Ошибка при удалении старых заказов:", error);
    }
}, 60 * 60 * 1000); // Проверка раз в час (можно настроить под свои нужды)

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/orders'); // Папка для загрузки изображений
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname)); // Уникальное имя файла
    },
});

const upload = multer({ storage });

const geocoder = NodeGeocoder({ provider: 'openstreetmap' });

module.exports = (io) => {

    // Add a new order
    router.post('/', authenticateToken, upload.array('images', 5), async (req, res) => {  // 'images' — это поле для загрузки
        const { address, description, workTime, proposedSum, type, categoryId, subcategoryId, paymentType} = req.body;
        const userId = req.user.id;
        console.log(req.body); // Посмотреть входящие данные

        try {
            if (!address) {
                return res.status(400).json({ message: 'Адрес обязателен' });
            }

            // Получаем координаты из геокодера
            const geoData = await geocoder.geocode(address);
            if (!geoData.length) {
                return res.status(404).json({ message: 'Адрес не найден' });
            }

            const { latitude, longitude } = geoData[0];
            const coordinates = `${latitude},${longitude}`;

            // Собираем все фото в массив
            const photoUrls = req.files ? req.files.map(file => `/uploads/orders/${file.filename}`) : [];

            const paymentType = Array.isArray(req.body.paymentType) ? req.body.paymentType[0] : req.body.paymentType;

            const newOrder = await Order.create({
                userId,
                address,
                description,
                workTime,
                proposedSum,
                coordinates,
                type,
                createdAt: new Date().toISOString(),
                images: photoUrls,  // Сохраняем массив ссылок на фото
                creatorId: userId,
                status: 'pending',
                categoryId,
                subcategoryId,
                paymentType
            });

            io.emit('orderUpdated'); // Отправляем событие обновления заказов

            res.status(201).json(newOrder);
        } catch (error) {
            console.error('Ошибка при создании заказа:', error);
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    });

    // Получить все заказы
    router.get('/all', async (req, res) => {
        try {
            // Удаляем старые заказы, не взятые в работу (старше 24 часов)
            await Order.destroy({
                where: {
                    status: 'pending',
                    createdAt: {
                        [Sequelize.Op.lt]: moment().subtract(24, 'hours').toDate(),
                    },
                },
            });

            console.log("✅ Старые заказы удалены");

            // Фильтрация по категории и подкатегории
            const { categoryId, subcategoryId } = req.query;
            const whereClause = { status: 'pending' };

            if (categoryId) whereClause.categoryId = categoryId;
            if (subcategoryId) whereClause.subcategoryId = subcategoryId;

            // Запрос заказов с фильтром
            const orders = await Order.findAll({
                attributes: [
                    'id', 'createdAt', 'address', 'description', 'workTime',
                    'images', 'proposedSum', 'creatorId', 'coordinates',
                    'type', 'executorId', 'status', 'paymentType'
                ],
                where: whereClause,
                include: [
                    { model: db.Category, as: 'category', attributes: ['id', 'name'] },
                    { model: db.Subcategory, as: 'subcategory', attributes: ['id', 'name'] },
                ],
            });

            console.log("📦 Найденные заказы:", orders.length);
            res.json(orders);
        } catch (error) {
            console.error("❌ Ошибка при получении заказов:", error);
            res.status(500).json({ message: "Ошибка сервера" });
        }
    });

    router.get('/active-orders', authenticateToken, async (req, res) => {
        try {
            const userId = req.user.id;

            const activeOrders = await Order.findAll({
                where: {
                    status: 'active',
                    [Op.or]: [{ creatorId: userId }, { executorId: userId }],
                },
                include: [
                    { model: db.Category, as: 'category', attributes: ['id', 'name'] },
                    { model: db.Subcategory, as: 'subcategory', attributes: ['id', 'name'] }
                ]
            });

            if (!activeOrders.length) {
                return res.json({ orders: activeOrders, notifications: [] });
            }

            const orderIds = activeOrders.map(order => order.id);
            console.log("🛠️ Найденные orderIds:", orderIds); // Логируем orderIds

            const notifications = await db.Notification.findAll({
                where: {
                    orderId: { [Op.in]: orderIds }, // Используем Op.in для поиска по массиву
                    userId: userId, // Только для текущего пользователя
                    isRead: false,  // Только непрочитанные
                }
            });

            console.log("📩 Найденные уведомления:", notifications);

            res.json({ orders: activeOrders, notifications });


        } catch (error) {
            console.error('Ошибка при получении активных заказов:', error);
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    });

    // Get order by ID
    router.get('/:id', async (req, res) => {
        const { id } = req.params;

        try {
            // Ищем заказ по ID, включая данные о пользователе
            const order = await Order.findByPk(id, {
                include:[ { model: db.User, as: 'users', attributes: ['id', 'username', 'phone'] },
                          { model: db.Category, as: 'category', attributes: ['id', 'name'] },
                          { model: db.Subcategory, as: 'subcategory', attributes: ['id', 'name'] },
        ],
            });

            // Если заказ не найден
            if (!order) {
                return res.status(404).json({ message: 'Order not found' });
            }

            res.json(order);
        } catch (error) {
            console.error('Error fetching order:', error);
            res.status(500).json({ message: 'Server error' });
        }
    });

    // Запрос на выполнение заказа
    router.post("/:id/request", authenticateToken, async (req, res) => {
        const { id } = req.params;
        const { proposedSum, comment } = req.body;
        const executorId = req.user.id;

        try {
            const order = await Order.findByPk(id);
            if (!order) return res.status(404).json({ message: "Заказ не найден" });
            if (order.status !== "pending") return res.status(400).json({ message: "Заказ недоступен" });

            // Парсим existing requests
            let requests = [];
            if (order.requests) {
                try {
                    requests = Array.isArray(order.requests) ? order.requests : JSON.parse(order.requests);
                } catch (e) {
                    console.error("Ошибка парсинга requests:", e);
                }
            }

            // Проверка на повторный запрос
            if (requests.some(req => req.executorId === executorId)) {
                return res.status(400).json({ message: "Вы уже отправили запрос на этот заказ" });
            }

            // Добавляем новый запрос
            requests.push({
                executorId,
                proposedSum,
                comment,
                createdAt: new Date().toISOString()
            });

            order.requests = JSON.stringify(requests);

            // Обновим requestedExecutors (старый механизм)
            let requestedExecutors = [];
            if (order.requestedExecutors) {
                try {
                    requestedExecutors = JSON.parse(order.requestedExecutors);
                } catch (e) {}
            }
            if (!requestedExecutors.includes(executorId)) {
                requestedExecutors.push(executorId);
                order.requestedExecutors = JSON.stringify(requestedExecutors);
            }

            await order.save();

            io.emit(`orderRequest:${order.userId}`, { orderId: order.id });

            res.json({ message: "Запрос на выполнение отправлен заказчику", order });
        } catch (error) {
            console.error("Ошибка при запросе заказа:", error);
            res.status(500).json({ message: "Ошибка сервера" });
        }
    });

    // Получить список пользователей, запросивших заказ
    router.get('/:id/requested-executors', authenticateToken, async (req, res) => {
        const { id } = req.params;

        try {
            const order = await Order.findByPk(id);
            const requests = order.requests ? JSON.parse(order.requests) : [];

            if (!order) {
                return res.status(404).json({ message: 'Заказ не найден' });
            }

            let requestedExecutors = [];
            if (order.requestedExecutors) {
                // Проверяем, что строка не пуста и является строкой
                if (typeof order.requestedExecutors === 'string' && order.requestedExecutors.trim() !== '') {
                    try {
                        requestedExecutors = JSON.parse(order.requestedExecutors);
                        // Проверяем, что результат парсинга является массивом
                        if (!Array.isArray(requestedExecutors)) {
                            requestedExecutors = [];
                        }
                    } catch (error) {
                        console.error('Ошибка парсинга requestedExecutors:', error);
                        requestedExecutors = [];
                    }
                } else {
                    // Если строка пуста или невалидна, присваиваем пустой массив
                    requestedExecutors = [];
                }
            }


            if (requestedExecutors.length === 0) {
                return res.json([]);
            }

            // Находим пользователей по ID
            const executors = await User.findAll({
                where: { id: requestedExecutors },
                attributes: ['id', 'username', 'rating', 'ratingCount', 'isVerified'] // Выбираем нужные поля
            });
            console.log('📡 Ответ сервера:', requestedExecutors);
            const result = executors.map(exec => {
                const reqData = requests.find(r => r.executorId === exec.id);
                return {
                    ...exec.toJSON(),
                    proposedSum: reqData?.proposedSum,
                    comment: reqData?.comment
                };
            });

            res.json(result);
        } catch (error) {
            console.error('Ошибка при получении запросивших исполнителей:', error);
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    });

    // Get approve for order
    router.post('/:id/approve', authenticateToken, async (req, res) => {
        const { id } = req.params;
        const { executorId } = req.body;  // Получаем executorId из тела запроса

        try {
            console.log(`⚡ Одобрение заказа ID: ${id} для исполнителя ID: ${executorId} пользователем ID: ${req.user.id}`);

            const order = await Order.findByPk(id);

            if (!order) {
                console.log('❌ Заказ не найден');
                return res.status(404).json({ message: 'Заказ не найден' });
            }

            if (order.creatorId !== req.user.id) {
                console.log('❌ Попытка одобрения чужого заказа');
                return res.status(403).json({ message: 'Вы не можете одобрить этот заказ' });
            }

            if (!order.requestedExecutors || order.requestedExecutors.length === 0) {
                console.log('❌ Нет запросов от исполнителей');
                return res.status(400).json({ message: 'Нет исполнителей, ожидающих одобрения' });
            }

            // Проверка, что executorId выбранный заказчиком есть в requestedExecutors
            // Преобразуем строку JSON в массив, если нужно
            let requestedExecutors = [];
            try {
                requestedExecutors = JSON.parse(order.requestedExecutors);
                if (!Array.isArray(requestedExecutors)) {
                    requestedExecutors = [];
                }
            } catch (error) {
                console.error('Ошибка парсинга requestedExecutors:', error);
            }

            if (!requestedExecutors.includes(executorId)) {
                console.log('❌ Исполнитель не найден среди запросивших');
                return res.status(400).json({ message: 'Исполнитель не найден среди запросивших' });
            }

            // Предположим, что заявки хранятся как строка JSON в order.requests
            let requests = [];
            try {
                requests = JSON.parse(order.requests);
                if (!Array.isArray(requests)) requests = [];
            } catch (error) {
                console.error('Ошибка парсинга requests:', error);
            }

            const matchedRequest = requests.find(r => r.executorId === executorId);

            if (matchedRequest) {
                order.proposedSum = matchedRequest.proposedSum; // 👈 Сюда пишем цену из заявки
                console.log(`💰 Установлена сумма заказа: ${matchedRequest.proposedSum} ₽`);
            } else {
                console.log('⚠️ Не найдена заявка исполнителя, сумма не будет обновлена');
            }

            // Устанавливаем исполнителя и очищаем список запросов
            order.executorId = executorId;
            order.requestedExecutors = []; // Очищаем массив запросов
            order.status = 'active'; // Устанавливаем статус заказа как активный

            await order.save(); // Сохраняем изменения в базе данных

            console.log(`✅ Заказ ${order.id} одобрен, исполнитель выбран!`);

            // ⬇️ Добавляем updatedAt (если нужно)
            order.updatedAt = new Date();
            await order.save();

// ✅ Генерация PDF-договора
            const contractData = {
                orderId: order.id,
                approvalDate: new Date().toLocaleDateString('ru-RU'),
                city: 'Москва', // или из профиля
                customerId: order.creatorId,
                performerId: executorId,
                customerName: `Пользователь ${order.creatorId}`, // позже можно из Users
                performerName: `Пользователь ${executorId}`,     // позже можно из Users
                category: order.category || 'Общая категория',
                subcategory: order.subcategory || 'Общая подкатегория',
                address: order.address || 'Адрес не указан',
                description: order.description || 'Описание не указано',
                price: order.proposedSum || 0,
                paymentType: order.paymentType || 'не указано',
                dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString('ru-RU'),
                completeAt: null,
                completedBy: [],
            };

// Путь для сохранения файла
            const filePath = path.join(__dirname, '..', 'contracts', `contract_${order.id}.pdf`);

            try {
                await generateContractPDF(contractData, filePath);
                console.log(`📄 Договор сохранён: ${filePath}`);
            } catch (err) {
                console.error('❌ Ошибка генерации PDF договора:', err);
            }

            // Обновление списка заказов
            io.emit('orderUpdated');

            // Уведомляем исполнителя
            io.to(`user_${order.executorId}`).emit('orderApproved', {
                orderId: order.id,
                message: 'Ваш запрос на выполнение заказа одобрен!',
            });

            // Уведомляем заказчика
            io.to(`user_${order.creatorId}`).emit('orderApproved', {
                orderId: order.id,
                message: 'Вы успешно одобрили заказ!',
            });

            res.json({ message: 'Заказ одобрен и исполнитель выбран!', order });
        } catch (error) {
            console.error('❌ Ошибка при одобрении заказа:', error);
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    });

    //Get reject for order
    router.post('/:id/reject', authenticateToken, async (req, res) => {
        const { id } = req.params;

        try {
            const order = await Order.findByPk(id);

            if (!order) {
                return res.status(404).json({ message: 'Заказ не найден' });
            }

            if (order.creatorId !== req.user.id) {
                return res.status(403).json({ message: 'Вы не можете отклонить этот заказ' });
            }

            if (!order.executorId) {
                return res.status(400).json({ message: 'Нет исполнителя для отклонения' });
            }

            // Убираем исполнителя и оставляем заказ доступным
            order.executorId = null;
            await order.save();

            io.emit('orderUpdated');

            res.json({ message: 'Исполнитель отклонён', order });
        } catch (error) {
            console.error('Ошибка при отклонении заказа:', error);
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    });

    // Complete an order
    router.post("/complete/:id", authenticateToken, async (req, res) => {
        try {
            const orderId = req.params.id;
            const userId = req.user.id;

            const order = await Order.findByPk(orderId);
            if (!order) return res.status(404).json({ message: "Заказ не найден" });

            if (order.completedBy.includes(userId)) {
                return res.status(400).json({ message: "Вы уже подтвердили завершение" });
            }

            order.completedBy = [...order.completedBy, userId];

            if (order.completedBy.includes(order.creatorId) && !order.completedBy.includes(order.executorId)) {
                io.to(`user_${order.executorId}`).emit('orderCompleted', {
                    orderId: order.id,
                    message: 'Заказчик предложил завершить заказ',
                });
            }

            if (order.completedBy.includes(order.executorId) && !order.completedBy.includes(order.creatorId)) {
                io.to(`user_${order.creatorId}`).emit('orderCompleted', {
                    orderId: order.id,
                    message: 'Исполнитель предложил завершить заказ',
                    creatorId: order.creatorId,
                    executorId: order.executorId
                });
            }

            if (order.completedBy.includes(order.creatorId) && order.completedBy.includes(order.executorId)) {
                order.status = "completed";
                order.completedAt = new Date();
            }

            await order.save();

            // 👉 Обновим заказ с пользователями
            const fullOrder = await Order.findByPk(orderId, {
                include: [
                    { model: User, as: 'creator' },
                    { model: User, as: 'executor' },
                    { model: Category, as: 'category' },
                    { model: Subcategory, as: 'subcategory' }
                ]
            });

            // 👉 Генерация PDF с учетом второй страницы
            const data = {
                orderId: fullOrder.id,
                approvalDate: fullOrder.createdAt.toLocaleDateString('ru-RU'),
                city: "Москва", // или брать из данных заказа
                customerId: fullOrder.creatorId,
                customerName: fullOrder.creator.username,
                performerId: fullOrder.executorId,
                performerName: fullOrder.executor.username,
                category: fullOrder.category.name,
                subcategory: fullOrder.subcategory.name,
                address: fullOrder.address,
                description: fullOrder.description,
                price: fullOrder.proposedSum,
                paymentType: fullOrder.paymentType,
                dueDate: new Date(fullOrder.createdAt.getTime() + 5 * 24 * 60 * 60 * 1000).toLocaleDateString('ru-RU'),
                completeAt: fullOrder.completedAt,
                completedBy: fullOrder.completedBy
            };

            const contractPath = path.join(__dirname, `../contracts/contract_${order.id}.pdf`);
            await generateContractPDF(data, contractPath);

            fullOrder.contractPath = contractPath;
            await fullOrder.save();

            io.emit('orderUpdated');
            io.emit('activeOrdersUpdated');

            res.json(fullOrder);
        } catch (error) {
            console.error("Ошибка завершения заказа:", error);
            res.status(500).json({ message: "Ошибка сервера" });
        }
    });


    // Эндпоинт для отправки жалобы
    router.post('/complain', authenticateToken, async (req, res) => {
        const { orderId, complaintText } = req.body;
        const userId = req.user?.id;

        console.log('req.user:', req.user);
        console.log('userId:', userId);

        if (!userId) {
            return res.status(400).json({ message: 'Невозможно извлечь userId из токена' });
        }

        try {
            const order = await Order.findByPk(orderId);
            if (!order) {
                return res.status(404).json({ message: 'Заказ не найден' });
            }

            console.log('order:', order);
            console.log('customerId:', order.creatorId, 'executorId:', order.executorId, 'userId:', userId);

            let complainedUserId = null;
            if (userId === order.creatorId) {
                if (!order.executorId) {
                    return res.status(400).json({ message: 'У заказа пока нет исполнителя' });
                }
                complainedUserId = order.executorId;
            } else if (userId === order.executorId) {
                complainedUserId = order.creatorId;
            } else {
                console.log(`❌ Ошибка: Пользователь ${userId} не является участником заказа`);
                return res.status(403).json({ message: 'Вы не являетесь участником этого заказа' });
            }

            console.log(`Жалоба отправляется на userId: ${complainedUserId}`);

            const complainedUser = await User.findByPk(complainedUserId);
            const currentComplaints = complainedUser.complaints || [];
            const updatedComplaints = [...currentComplaints, { userId, complaintText, date: new Date() }];

            await User.update({
                complaintsCount: (complainedUser.complaintsCount || 0) + 1,
                complaints: updatedComplaints
            }, { where: { id: complainedUserId } });

            return res.status(200).json({ message: 'Жалоба отправлена успешно' });

        } catch (error) {
            console.error('Ошибка при отправке жалобы:', error);
            return res.status(500).json({ message: 'Ошибка при отправке жалобы' });
        }
    });

    // Завершенные заказы пользователя
    router.get('/completed/:userId', async (req, res) => {
        const { userId } = req.params;

        console.log("userId из запроса:", userId); // Проверяем, приходит ли userId

        if (!userId) {
            return res.status(400).json({ message: 'Некорректный userId' });
        }

        try {
            const completedOrders = await Order.findAll({
                where: {
                    status: 'completed',
                    [Op.or]: [
                        { creatorId: userId },  // Заказчик
                        { executorId: userId }   // Исполнитель
                    ]
                },
                attributes: ['id','type','address','proposedSum', 'status', 'completedAt', 'creatorId', 'executorId', 'description'], // Указываем, какие поля хотим вернуть
            });

            // Отправляем заказ с актуальной датой завершения
            res.json(completedOrders);
        } catch (error) {
            console.error('Ошибка при получении завершенных заказов:', error);
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    });

    // Созданные пользователем заказы
    router.get('/creator/:userId', async (req, res) => {
        const { userId } = req.params;

        try {
            const orders = await Order.findAll({
                where: {
                    creatorId: userId,
                    status: 'pending',
                },  // Фильтруем заказы по ID создателя
                include: [
                    { model: db.Category, as: 'category', attributes: ['id', 'name'] },
                    { model: db.Subcategory, as: 'subcategory', attributes: ['id', 'name'] },
                    { model: db.User, as: 'users', attributes: ['id', 'username'] }
                ]

            });

            if (!orders || orders.length === 0) {
                return res.status(200).json([]); // Возвращаем пустой массив вместо 404
            }


            res.json(orders);
        } catch (error) {
            console.error('Error fetching orders:', error);
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    });

    return router;
};