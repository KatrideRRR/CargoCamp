const socketIo = require("socket.io");
const { Notification } = require("./models");
const allowedOrigins = require("./config/allowedOrigins");

let io;

function getIo() {
    return io;
}

async function sendNotifications(userId) {
    if (!io || !userId) return;

    try {
        const unreadNotifications = await Notification.findAll({
            where: { userId, isRead: false },
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

        io.to(`notifications_${String(userId)}`).emit(
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

        socket.on("register", (userId) => {
            if (!userId) return;

            const normalizedUserId = String(userId);

            socket.join(`user_${normalizedUserId}`);
            socket.join(`notifications_${normalizedUserId}`);
            socket.data.userId = normalizedUserId;
        });

        socket.on("subscribeAdminSupport", () => {
            socket.join("admins");
        });

        socket.on("subscribeSupportChat", (userId) => {
            if (!userId) return;
            socket.join(`support_user_${userId}`);
        });

        socket.on("subscribeToNotifications", (userId) => {
            if (!userId) return;

            const normalizedUserId = String(userId);
            socket.join(`notifications_${normalizedUserId}`);
        });

        socket.on("joinChat", ({ userId, orderId, orderType = "regular" }) => {
            if (userId) {
                socket.join(`user_${String(userId)}`);
                socket.join(`notifications_${String(userId)}`);
                socket.data.userId = String(userId);
            }

            const normalizedOrderType = ["regular", "express"].includes(orderType)
                ? orderType
                : "regular";

            if (orderId) {
                socket.join(`chat_${normalizedOrderType}_${String(orderId)}`);
            }
        });

        socket.on("markAsRead", async ({ userId, orderId, orderType = "regular" }) => {
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