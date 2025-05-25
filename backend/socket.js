const socketIo = require('socket.io');
const { Notification } = require('./models');
const { Message } = require('./models'); // Добавляем импорт модели Message

let io;
let users = {}; // Храним пользователей, подключившихся к WebSocket

function initializeSocket(server) {
    io = socketIo(server, {
        cors: {
            origin: ['http://localhost:3001', 'http://localhost:8080', 'http://18.184.43.44:3001',
                'https://81.163.27.147:3001', 'https://81.163.27.147:8080',
                'https://cargocamp.ru'],
            methods: ["GET", "POST"],
            credentials: true,
        }
    });

    io.on('connection', (socket) => {
        console.log(`🟢 Новое подключение: ${socket.id}`);

        // Регистрация пользователя в сокетах
        socket.on('register', (userId) => {
            console.log(`✅ Пользователь ${userId} зарегистрирован в WebSocket`);
            socket.join(`user_${userId}`); // Пользователь подключается к комнате с его ID
        });

        // Подписка на уведомления
        socket.on('subscribeToNotifications', (userId) => {
            socket.join(`notifications_${userId}`);
        });

        // Прочие события, например, для чатов
        socket.on('joinChat', ({ userId }) => {
            users[userId] = socket.id;
            console.log(`Пользователь ${userId} подключился: ${socket.id}`);
        });

        socket.on('sendMessage', async (message) => {
            console.log('Новое сообщение:', message);

            if (users[message.receiverId]) {
                io.to(users[message.receiverId]).emit('receiveMessage', message);
            }

            // 🔹 Получаем сообщение из базы, чтобы достать `orderId`
            const fullMessage = await Message.findOne({
                where: { id: message.id }
            });

            if (!fullMessage) {
                console.error("Ошибка: сообщение не найдено в базе!");
                return;
            }

            // Проверяем, существует ли уже уведомление для этого сообщения
            const existingNotification = await Notification.findOne({
                where: {
                    userId: message.receiverId,
                    messageId: message.id
                }
            });



            // Если уведомления еще нет, создаем новое для BottomMenu
            if (!existingNotification) {
                console.log(`✅ Создаем уведомление: userId=${message.receiverId}, orderId=${fullMessage.orderId}`);

                await Notification.create({
                    userId: message.receiverId,
                    type: 'new_message',
                    messageId: message.id,
                    isRead: false,
                    orderId: fullMessage.orderId, // ✅ orderId гарантированно есть
                });
                console.log("📤 Отправка уведомления:", { orderId: fullMessage.orderId, userId: message.receiverId });


                // Отправляем уведомление в BottomMenu
                await sendNotifications(message.receiverId);
            }

        });


        socket.on("sendOrderRequest", () => {
            console.log("🔔 Получен новый запрос на заказ!");
            io.emit("orderRequest"); // Оповещаем всех клиентов
        });

        // Обработчик для события markAsRead
        socket.on('markAsRead', async ({ userId, orderId }) => {
            console.log("✅ Обрабатываем 'markAsRead' для userId:", userId, "orderId:", orderId);

            try {
                await Notification.update({ isRead: true }, {
                    where: { userId, orderId, isRead: false }
                });

                console.log(`✅ Уведомления для заказа ${orderId} обновлены`);

                // Отправляем обновлённые уведомления
                sendNotifications(userId);
            } catch (error) {
                console.error("Ошибка при обновлении уведомлений:", error);
            }
        });




        socket.on('disconnect', () => {
            console.log(`🔴 Отключение: ${socket.id}`);
            Object.keys(users).forEach(userId => {
                if (users[userId] === socket.id) {
                    delete users[userId];
                }
            });
        });
    });

    return io;
}

// Обновленный код отправки уведомлений для пользователя
async function sendNotifications(userId) {
    const unreadNotifications = await Notification.findAll({
        where: { userId, isRead: false },
        attributes: ['id', 'type', 'orderId'], // Берем нужные поля
    });

    console.log(`📩 Отправка уведомлений для user_${userId}:`, unreadNotifications);

    io.to(`notifications_${userId}`).emit('new_notification', unreadNotifications);
}


// Функция для отправки уведомлений заказчику и исполнителю
function sendNotification(userId, event, data) {
    if (io) {
        io.to(`user_${userId}`).emit(event, data);
    }
}

module.exports = { initializeSocket, sendNotification };
