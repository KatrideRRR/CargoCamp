const socketIo = require("socket.io");
const { Notification } = require("./models");

let io;

function getIo() {
    return io;
}

async function sendNotifications(userId) {
    if (!io) return;

    const unreadNotifications = await Notification.findAll({
        where: { userId, isRead: false },
        attributes: ["id", "type", "orderId"],
        order: [["id", "DESC"]],
    });

    io.to(`notifications_${String(userId)}`).emit("new_notification", unreadNotifications);
}

function sendToUser(userId, event, data) {
    if (!io) return;
    io.to(`user_${String(userId)}`).emit(event, data);
}

function initializeSocket(server) {
    io = socketIo(server, {
        cors: {
            origin: [
                "http://localhost:3000",
                "http://localhost:3001",
                "http://localhost:8080",
                "http://18.184.43.44:3001",
                "https://81.163.27.147:3001",
                "https://81.163.27.147:8080",
                "https://cargocamp.ru",
                "https://www.cargocamp.ru",
                "https://admin.cargocamp.ru",
                "http://81.163.27.147:8080",
                "http://localhost",
            ],
            methods: ["GET", "POST"],
            credentials: true,
        },
        transports: ["websocket", "polling"],
    });

    io.on("connection", (socket) => {
        console.log(`🟢 Новое подключение: ${socket.id}`);

        socket.on("register", (userId) => {
            if (!userId) return;

            const normalizedUserId = String(userId);

            socket.join(`user_${normalizedUserId}`);
            socket.join(`notifications_${normalizedUserId}`);
            socket.data.userId = normalizedUserId;

            console.log(`✅ Пользователь ${normalizedUserId} зарегистрирован в WebSocket`);
        });

        socket.on("subscribeToNotifications", (userId) => {
            if (!userId) return;
            socket.join(`notifications_${String(userId)}`);
        });

        socket.on("joinChat", ({ userId, orderId }) => {
            if (userId) {
                socket.join(`user_${String(userId)}`);
            }

            if (orderId) {
                socket.join(`chat_${String(orderId)}`);
            }

            console.log(`💬 joinChat: user=${userId}, order=${orderId}`);
        });

        socket.on("sendOrderRequest", () => {
            console.log("🔔 Получен новый запрос на заказ!");
            io.emit("orderRequest");
        });

        socket.on("markAsRead", async ({ userId, orderId }) => {
            console.log("✅ markAsRead:", { userId, orderId });

            try {
                await Notification.update(
                    { isRead: true },
                    {
                        where: {
                            userId,
                            orderId,
                            isRead: false,
                        },
                    }
                );

                await sendNotifications(userId);
            } catch (error) {
                console.error("Ошибка при обновлении уведомлений:", error);
            }
        });

        socket.on("disconnect", (reason) => {
            console.log(`🔴 Отключение: ${socket.id}. Причина: ${reason}`);
        });
    });

    return io;
}

module.exports = {
    initializeSocket,
    sendNotifications,
    sendToUser,
    getIo,
};