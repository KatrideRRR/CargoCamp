const socketIo = require("socket.io");

const {
    Notification,
} = require("./models");

const allowedOrigins =
    require("./config/allowedOrigins");

const {
    authenticateSocket,
    validateSocketSession,
} = require("./middlewares/socketAuth");

const {
    requireChatOrderAccess,
} = require("./services/chatOrderAccess");

let io;

function getIo() {
    return io;
}

async function sendNotifications(userId) {
    if (!io || !userId) return;

    try {
        const unreadNotifications =
            await Notification.findAll({
                where: {
                    userId,
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

        io.to(
            `notifications_${String(userId)}`
        ).emit(
            "new_notification",
            unreadNotifications
        );
    } catch (error) {
        console.error(
            "Ошибка отправки уведомлений:",
            error
        );
    }
}

function sendToUser(userId, event, data) {
    if (!io || !userId) return;

    io.to(
        `user_${String(userId)}`
    ).emit(event, data);
}

function sendOrderRequestToUser(
    userId,
    data = {}
) {
    if (!io || !userId) return;

    io.to(
        `user_${String(userId)}`
    ).emit(
        `orderRequest:${String(userId)}`,
        {
            type: "order_request",
            ...data,
        }
    );
}

function initializeSocket(server) {
    io = socketIo(server, {
        cors: {
            origin: allowedOrigins,
            methods: ["GET", "POST"],
            credentials: true,
        },

        transports: [
            "websocket",
            "polling",
        ],
    });

    // Обязательная авторизация до подключения.
    io.use(authenticateSocket);

    io.on("connection", (socket) => {
        const userId = socket.data.userId;
        const scope = socket.data.scope;

        /*
         * Личные комнаты определяются сервером.
         * Клиент не выбирает чужой userId.
         */
        if (scope === "user") {
            socket.join(`user_${userId}`);
            socket.join(`notifications_${userId}`);
        }

        /*
         * Повторно проверяем действительность
         * сессии во время долгого соединения.
         *
         * Это позволяет отключить сокет при
         * отзыве сессии или блокировке аккаунта.
         */
        let checkingSession = false;

        const sessionTimer = setInterval(
            async () => {
                if (checkingSession) return;

                checkingSession = true;

                try {
                    const valid =
                        await validateSocketSession(
                            socket.data
                        );

                    if (!valid) {
                        socket.disconnect(true);
                    }
                } catch (error) {
                    console.error(
                        "Socket session validation error:",
                        error
                    );

                    socket.disconnect(true);
                } finally {
                    checkingSession = false;
                }
            },
            60 * 1000
        );

        sessionTimer.unref?.();

        /*
         * Совместимость со старым названием
         * события. Переданный userId игнорируем.
         */
        socket.on("register", () => {
            if (scope !== "user") return;

            socket.join(`user_${userId}`);
            socket.join(`notifications_${userId}`);
        });

        /*
         * Подписка на личные уведомления.
         * Нельзя выбрать чужого пользователя.
         */
        socket.on(
            "subscribeToNotifications",
            () => {
                if (scope !== "user") return;

                socket.join(
                    `notifications_${userId}`
                );
            }
        );

        /*
         * Административная поддержка.
         *
         * Только администратор с действительной
         * административной сессией.
         */
        socket.on(
            "subscribeAdminSupport",
            () => {
                if (scope !== "admin") {
                    return;
                }

                socket.join("admins");
            }
        );

        /*
         * Личный чат поддержки.
         *
         * ID из события не используется.
         */
        socket.on(
            "subscribeSupportChat",
            () => {
                if (scope !== "user") {
                    return;
                }

                socket.join(
                    `support_user_${userId}`
                );
            }
        );

        socket.on(
            "unsubscribeSupportChat",
            () => {
                if (scope !== "user") {
                    return;
                }

                socket.leave(
                    `support_user_${userId}`
                );
            }
        );

        /*
         * Подписка на чат заказа.
         */
        socket.on(
            "joinChat",
            async (payload = {}, acknowledge) => {
                const reply = (result) => {
                    if (
                        typeof acknowledge === "function"
                    ) {
                        acknowledge(result);
                    }
                };

                if (scope !== "user") {
                    reply({
                        ok: false,
                        message: "Доступ запрещён",
                    });
                    return;
                }

                try {
                    const {
                        orderId,
                        orderType = "regular",
                    } = payload || {};

                    const access =
                        await requireChatOrderAccess({
                            orderId,
                            orderType,
                            userId,
                        });

                    const nextRoom =
                        `chat_${access.orderType}_${access.orderId}`;

                    const previousRoom =
                        socket.data.activeChatRoom;

                    if (
                        previousRoom &&
                        previousRoom !== nextRoom
                    ) {
                        socket.leave(previousRoom);
                    }

                    socket.join(nextRoom);

                    socket.data.activeChatRoom =
                        nextRoom;

                    reply({
                        ok: true,
                        orderId: access.orderId,
                        orderType: access.orderType,
                    });
                } catch (error) {
                    reply({
                        ok: false,
                        message:
                            error.status === 400
                                ? "Некорректный заказ"
                                : "Нет доступа к чату",
                    });
                }
            }
        );

        /*
         * Выход из комнаты открытого чата.
         */
        socket.on("leaveChat", () => {
            const room =
                socket.data.activeChatRoom;

            if (!room) return;

            socket.leave(room);

            socket.data.activeChatRoom = null;
        });

        /*
         * Пометка уведомлений прочитанными.
         *
         * Используем только ID пользователя,
         * установленный при авторизации.
         */
        socket.on(
            "markAsRead",
            async (payload = {}) => {
                if (scope !== "user") {
                    return;
                }

                try {
                    const {
                        orderId,
                        orderType = "regular",
                    } = payload || {};

                    const access =
                        await requireChatOrderAccess({
                            orderId,
                            orderType,
                            userId,
                        });

                    await Notification.update(
                        {
                            isRead: true,
                        },
                        {
                            where: {
                                userId: access.userId,
                                orderId: access.orderId,
                                orderType: access.orderType,
                                isRead: false,
                            },
                        }
                    );

                    await sendNotifications(
                        access.userId
                    );
                } catch (error) {
                    if (error.status) return;

                    console.error(
                        "Ошибка обновления уведомлений:",
                        error
                    );
                }
            }
        );

        socket.on("disconnect", () => {
            clearInterval(sessionTimer);
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