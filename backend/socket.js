const socketIo = require("socket.io");
const { Notification } = require("./models");
const allowedOrigins = require("./config/allowedOrigins");

let io;

function getIo() {
    return io;
}

function normalizeUserId(userId) {
    if (!userId) return null;
    return String(userId);
}

function joinUserRooms(socket, userId) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) return null;

    socket.join(`user_${normalizedUserId}`);
    socket.join(`notifications_${normalizedUserId}`);
    socket.data.userId = normalizedUserId;

    console.log(
        `✅ socket ${socket.id} joined rooms: user_${normalizedUserId}, notifications_${normalizedUserId}`
    );

    return normalizedUserId;
}

async function sendNotifications(userId) {
    if (!io || !userId) return;

    const normalizedUserId = String(userId);

    try {
        const unreadNotifications = await Notification.findAll({
            where: {
                userId: normalizedUserId,
                isRead: false,
            },
            attributes: [
                "id",
                "type",
                "title",
                "body",
                "orderId",
                "orderType",
                "messageId",
                "data",
                "createdAt",
            ],
            order: [["id", "DESC"]],
        });

        io.to(`notifications_${normalizedUserId}`).emit(
            "new_notification",
            unreadNotifications
        );
    } catch (error) {
        console.error("Ошибка при отправке уведомлений:", error);
    }
}

function sendToUser(userId, event, data) {
    if (!io || !userId) return;

    io.to(`user_${String(userId)}`).emit(event, data);
}

function sendOrderRequestToUser(userId, data = {}) {
    if (!io || !userId) return;

    io.to(`user_${String(userId)}`).emit(`orderRequest:${String(userId)}`, {
        type: "order_request",
        ...data,
    });
}

function initializeSocket(server) {
    io = socketIo(server, {
        cors: {
            origin: allowedOrigins,
            methods: ["GET", "POST"],
            credentials: true,
        },
        transports: ["websocket", "polling"],
    });

    io.on("connection", (socket) => {
        console.log("🟢 socket connected:", socket.id);

        /**
         * Основная регистрация пользователя.
         * Используй это событие в приложении после авторизации.
         */
        socket.on("register", async (userId) => {
            const normalizedUserId = joinUserRooms(socket, userId);

            if (normalizedUserId) {
                await sendNotifications(normalizedUserId);
            }
        });

        /**
         * Оставляем старое событие, но теперь оно тоже подписывает
         * и на user-room, и на notifications-room.
         */
        socket.on("subscribeToNotifications", async (userId) => {
            const normalizedUserId = joinUserRooms(socket, userId);

            if (normalizedUserId) {
                await sendNotifications(normalizedUserId);
            }
        });

        /**
         * Дополнительное явное событие на случай, если где-то удобнее вызвать joinUserRoom.
         */
        socket.on("joinUserRoom", async (userId) => {
            const normalizedUserId = joinUserRooms(socket, userId);

            if (normalizedUserId) {
                await sendNotifications(normalizedUserId);
            }
        });

        socket.on("joinChat", ({ userId, orderId, orderType = "regular" }) => {
            if (userId) {
                joinUserRooms(socket, userId);
            }

            const normalizedOrderType = ["regular", "express"].includes(orderType)
                ? orderType
                : "regular";

            if (orderId) {
                const roomName = `chat_${normalizedOrderType}_${String(orderId)}`;
                socket.join(roomName);

                console.log(`💬 socket ${socket.id} joined chat room: ${roomName}`);
            }
        });

        socket.on("markAsRead", async ({ userId, orderId, orderType = "regular" }) => {
            if (!userId || !orderId) return;

            const normalizedOrderType = ["regular", "express"].includes(orderType)
                ? orderType
                : "regular";

            try {
                await Notification.update(
                    { isRead: true },
                    {
                        where: {
                            userId,
                            orderId,
                            orderType: normalizedOrderType,
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
            console.log("🔴 socket disconnected:", socket.id, reason);
        });
    });

    return io;
}

module.exports = {
    initializeSocket,
    sendNotifications,
    sendToUser,
    sendOrderRequestToUser,
    getIo,
};