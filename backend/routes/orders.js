const express = require('express');
const router = express.Router();
const NodeGeocoder = require('node-geocoder');
const db = require('../models');
const authenticateToken = require('../middlewares/userAuth');
const multer = require('multer');
const { Op } = require('sequelize');
const path = require('path');
const { Sequelize } = require('sequelize');
const moment = require('moment');
const { Order, User, Category, Subcategory, Service } = require('../models');
const fs = require('fs');
const generateContractPDF = require('../utils/generateContractPDF');

setInterval(async () => {
    try {
        const expiredOrders = await Order.findAll({
            where: {
                status: 'pending',
                createdAt: {
                    [Sequelize.Op.lt]: moment().subtract(24, 'hours').toDate(),
                },
            },
        });

        for (const order of expiredOrders) {
            order.status = 'expired';
            await order.save();
            console.log(`Заказ ${order.id} переведен в статус "expired".`);
        }
    } catch (error) {
        console.error("Ошибка при архивировании старых заказов:", error);
    }
}, 60 * 60 * 1000); // каждые 60 минут

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/orders');
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + path.extname(file.originalname));
    },
});

const upload = multer({ storage });

const geocoder = NodeGeocoder({
    provider: 'yandex',
    apiKey: process.env.YANDEX_API_KEY, // Помести ключ в .env
    lang: 'ru-RU'
});

module.exports = (io) => {

    router.post('/orders/:id/restore', authenticateToken, async (req, res) => {
        const { id } = req.params;

        try {
            const order = await Order.findByPk(id);
            if (!order || order.status !== 'expired') {
                return res.status(404).json({ success: false, error: 'Заказ не найден или не может быть восстановлен' });
            }

            order.status = 'pending';
            await order.save();

            res.json({ success: true, message: 'Заказ восстановлен' });
        } catch (error) {
            console.error("Ошибка при восстановлении заказа:", error);
            res.status(500).json({ success: false, error: 'Ошибка сервера' });
        }
    });

    router.post('/', authenticateToken, upload.array('images', 5), async (req, res) => {  // 'images' — это поле для загрузки
        const { address, description, workTime, proposedSum,categoryId, subcategoryId, serviceId} = req.body;
        const userId = req.user.id;
        let parsedPromotion = {};
        console.log(req.body); // Посмотреть входящие данные

        const PROMOTION_PRICES = {
            highlight: 50,
            recommended: 100,
            push: 150,
        };

        try {
            parsedPromotion = JSON.parse(req.body.promotion || "{}");
        } catch (e) {
            console.error("Ошибка парсинга promotion:", e);
        }

        try {
            parsedPromotion = JSON.parse(req.body.promotion || "{}");
        } catch (e) {
            console.error("Ошибка парсинга promotion:", e);
        }


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

            // 🧠 Вычисляем стоимость продвижения
            const promotionTotal = Object.entries(parsedPromotion).reduce(
                (sum, [key, enabled]) =>
                    enabled && PROMOTION_PRICES[key] ? sum + PROMOTION_PRICES[key] : sum,
                0
            );

            // 🟡 Выбираем статус: если есть стоимость — ждем оплаты
            const status = promotionTotal > 0 ? 'pending_payment' : 'pending';

            const newOrder = await Order.create({
                userId,
                address,
                description,
                workTime,
                proposedSum,
                coordinates,
                createdAt: new Date().toISOString(),
                images: photoUrls,  // Сохраняем массив ссылок на фото
                creatorId: userId,
                status,
                categoryId,
                subcategoryId,
                serviceId: serviceId && serviceId !== '0' ? serviceId : null,
                paymentType,
                is_highlighted: parsedPromotion.highlight ?? false,
                is_recommended: parsedPromotion.recommended ?? false,
                is_push_notified: parsedPromotion.push ?? false,
                promotionCost: promotionTotal, // если есть такое поле в модели

            });

            io.emit('orderUpdated'); // Отправляем событие обновления заказов

            res.status(201).json(newOrder);
        } catch (error) {
            console.error('Ошибка при создании заказа:', error);
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    });

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
            const { categoryId, subcategoryId, serviceId } = req.query;
            const whereClause = { status: 'pending' };

            if (categoryId) whereClause.categoryId = categoryId;
            if (subcategoryId) whereClause.subcategoryId = subcategoryId;
            if (serviceId) whereClause.serviceId = Number(serviceId);

            console.log('📌 whereClause:', whereClause);

            // Запрос заказов с фильтром
            const orders = await Order.findAll({
                attributes: [
                    'id', 'createdAt', 'address', 'description', 'workTime',
                    'images', 'proposedSum', 'creatorId', 'coordinates',
                    'executorId', 'status', 'paymentType',
                    'is_highlighted', 'is_recommended', 'is_push_notified', 'taxi_courier', 'serviceId',
                ],
                where: whereClause,
                include: [
                    { model: db.Category, as: 'category', attributes: ['id', 'name'] },
                    { model: db.Subcategory, as: 'subcategory', attributes: ['id', 'name'] },
                    { model: db.Service, as: 'service', attributes: ['id', 'name'] },
                ],
                order: [
                    ['is_recommended', 'DESC'],
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
                    { model: db.Subcategory, as: 'subcategory', attributes: ['id', 'name'] },
                    { model: User, as: 'creator', attributes: ['id', 'username']},
                    { model: User, as: 'executor', attributes: ['id', 'username']},
                ],
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

    router.get('/me/status', authenticateToken, async (req, res) => {
        try {
            const user = await User.findByPk(req.user.id);
            if (!user) {
                return res.status(404).json({ message: 'Пользователь не найден' });
            }

            res.json({ has_debt: user.has_debt });
        } catch (err) {
            console.error('Ошибка при проверке статуса пользователя:', err);
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    });

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

    router.get('/:id/requested-executors', authenticateToken, async (req, res) => {
        const { id } = req.params;

        try {
            const order = await Order.findByPk(id);
            let requests = [];
            try {
                if (typeof order.requests === 'string' && order.requests.trim() !== '') {
                    requests = JSON.parse(order.requests);
                }
            } catch (e) {
                console.error('Ошибка парсинга order.requests:', e);
                requests = [];
            }

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
                attributes: ['id', 'username', 'rating', 'ratingCount', 'userStatus'] // Выбираем нужные поля
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

            // Получаем данные исполнителя
            const executor = await User.findByPk(executorId);


            let isPremium = false;
            if (executor) {
                const { subscription_type, subscription_expires_at } = executor;

                isPremium =
                    subscription_type === 'premium' &&
                    new Date(subscription_expires_at) > new Date();
            }

            // Устанавливаем долг ТОЛЬКО если не премиум
            if (!isPremium) {
                await User.update({ has_debt: true }, { where: { id: executorId } });
                console.log(`💸 Установлен флаг has_debt для пользователя ${executorId}`);
            } else {
                console.log(`✅ У пользователя ${executorId} активен Premium — долг не устанавливается`);
            }


            order.requestedExecutors = []; // Очищаем массив запросов
            order.status = 'active'; // Устанавливаем статус заказа как активный

            await order.save(); // Сохраняем изменения в базе данных

            console.log(`✅ Заказ ${order.id} одобрен, исполнитель выбран!`);

            // ⬇️ Добавляем updatedAt (если нужно)
            order.updatedAt = new Date();
            await order.save();

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

            const filePath = path.join(__dirname, '..', 'contracts', `contract_${order.id}.pdf`);
            console.log(filePath)
            try {
                await generateContractPDF(contractData, filePath);
                console.log(`📄 Договор сохранён: ${filePath}`);
                order.contractPath = path.relative(path.join(__dirname, '..'), filePath); // например, "contracts/contract_123.pdf"
                await order.save();
                console.log(`💾 Путь к договору сохранён в БД: ${order.contractPath}`);

            } catch (err) {
                console.error('❌ Ошибка генерации PDF договора:', err);
            }

            // Обновление списка заказов
            io.emit('orderUpdated');

            // Уведомляем исполнителя
            io.to(`user_${order.executorId}`).emit('orderApproved', {
                orderId: order.id,
                message: 'Ваш запрос на выполнение заказа одобрен!',
                isPremium, // <-- добавлено
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

    router.get('/completed/:userId', async (req, res) => {
        const { userId } = req.params;

        console.log("userId из запроса:", userId); // Проверяем, приходит ли userId

        if (!userId) {
            return res.status(400).json({ message: 'Некорректный userId' });
        }

        try {
            const completedOrders = await Order.findAll({
                where: {
                    status: {
                        [Op.in]: ['completed', 'expired'], // ⬅️ Теперь ищем оба статуса
                    },
                    [Op.or]: [
                        { creatorId: userId },  // Заказчик
                        { executorId: userId }   // Исполнитель
                    ]
                },
                attributes: ['id','address','proposedSum', 'status', 'completedAt', 'creatorId', 'executorId', 'description', 'contractPath'], // Указываем, какие поля хотим вернуть
            });

            // Отправляем заказ с актуальной датой завершения
            res.json(completedOrders);
        } catch (error) {
            console.error('Ошибка при получении завершенных заказов:', error);
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    });

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

    router.post('/express', authenticateToken, async (req, res) => {
        try {
            const { type, from, to, description, proposedSum, paymentType, subcategory } = req.body;

            if (!type || !from || !to || !paymentType) {
                return res.status(400).json({ message: 'Не все обязательные поля заполнены' });
            }

            const userId = req.user.id;

            const address = `${from} → ${to}`;
            const categoryName = type === 'taxi' ? 'Такси' : 'Курьер';
            const category = await Category.findOne({ where: { name: categoryName } });

            if (!category) {
                return res.status(400).json({ message: 'Категория не найдена' });
            }

            let subcategoryId = null;
            if (subcategory) {
                const subcat = await Subcategory.findOne({ where: { name: subcategory, categoryId: category.id } });
                if (subcat) subcategoryId = subcat.id;
            }

            const newOrder = await Order.create({
                address,
                description,
                proposedSum,
                paymentType,
                type,
                userId,
                creatorId: userId,
                categoryId: category.id,
                subcategoryId,
                taxi_courier: true,
                createdAt: new Date(),
            });

            res.status(201).json(newOrder);
        } catch (err) {
            console.error('❌ Ошибка создания express-заказа:', err);
            res.status(500).json({ message: 'Ошибка сервера' });
        }
    });

    return router;
};