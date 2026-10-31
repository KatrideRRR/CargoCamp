const {
    requireChatOrderAccess,
} = require("./chatOrderAccess");

const TYPING_TIMEOUT_MS = 5500;
const MIN_EVENT_INTERVAL_MS = 1200;

/**
 * События набора текста для одного
 * авторизованного Socket.IO-подключения.
 *
 * Текст сообщения на сервер не передаётся.
 */
function registerChatTypingEvents({
                                      socket,
                                      userId,
                                      scope,
                                      sendToUser,
                                  }) {
    let activeTyping = null;
    let lastAttemptAt = 0;
    let generation = 0;

    const stopTyping = () => {
        // Отменяем проверки, которые ещё
        // выполняются асинхронно.
        generation += 1;

        if (!activeTyping) return;

        const previous = activeTyping;

        activeTyping = null;

        clearTimeout(previous.timer);

        sendToUser(
            previous.receiverId,
            "chat:typing",
            {
                orderId: previous.orderId,
                orderType: previous.orderType,
                senderId: Number(userId),
                isTyping: false,
            }
        );
    };

    socket.on("chat:typing", async (payload) => {
        if (
            scope !== "user" ||
            !payload ||
            typeof payload !== "object" ||
            typeof payload.isTyping !== "boolean"
        ) {
            return;
        }

        /*
         * Прекращение набора обрабатываем
         * немедленно, без обращения к MySQL.
         */
        if (!payload.isTyping) {
            stopTyping();
            return;
        }

        if (
            !socket.connected ||
            !socket.data.activeChatRoom
        ) {
            return;
        }

        /*
         * Ограничение частоты обращений к БД.
         */
        const now = Date.now();

        if (
            now - lastAttemptAt <
            MIN_EVENT_INTERVAL_MS
        ) {
            return;
        }

        lastAttemptAt = now;

        const requestGeneration =
            ++generation;

        try {
            const {
                orderId,
                orderType = "regular",
            } = payload;

            /*
             * Проверка выполняется на сервере.
             * Пользователь не выбирает получателя.
             */
            const access =
                await requireChatOrderAccess({
                    orderId,
                    orderType,
                    userId,
                });

            if (
                requestGeneration !== generation ||
                !socket.connected
            ) {
                return;
            }

            if (!access.otherUserId) {
                return;
            }

            const expectedRoom =
                `chat_${access.orderType}_${access.orderId}`;

            /*
             * Отправитель должен находиться
             * именно в этом чате.
             */
            if (
                socket.data.activeChatRoom !==
                expectedRoom
            ) {
                return;
            }

            if (
                activeTyping &&
                activeTyping.room !== expectedRoom
            ) {
                stopTyping();
            }

            if (activeTyping) {
                clearTimeout(activeTyping.timer);
            }

            const timer = setTimeout(
                stopTyping,
                TYPING_TIMEOUT_MS
            );

            timer.unref?.();

            activeTyping = {
                room: expectedRoom,
                orderId: access.orderId,
                orderType: access.orderType,
                receiverId: access.otherUserId,
                timer,
            };

            /*
             * Событие отправляем исключительно
             * второму участнику заказа.
             */
            sendToUser(
                access.otherUserId,
                "chat:typing",
                {
                    orderId: access.orderId,
                    orderType: access.orderType,
                    senderId: access.userId,
                    isTyping: true,
                }
            );
        } catch (error) {
            if (!error.status) {
                console.error(
                    "Ошибка индикатора набора:",
                    error
                );
            }
        }
    });

    /*
     * Вызывается при выходе из чата
     * или отключении соединения.
     */
    return stopTyping;
}

module.exports = {
    registerChatTypingEvents,
};