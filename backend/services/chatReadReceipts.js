const { Op } = require("sequelize");

const {
    Message,
    Notification,
} = require("../models");

const {
    requireChatOrderAccess,
    parsePositiveId,
    chatAccessError,
} = require("./chatOrderAccess");

const {
    sendToUser,
    sendNotifications,
} = require("../socket");

/**
 * Проверяем доступ к конкретной переписке.
 */
async function getAccess({
                             userId,
                             orderId,
                             orderType,
                         }) {
    return requireChatOrderAccess({
        userId,
        orderId,
        orderType,
    });
}

/**
 * Получаем последнее исходящее сообщение,
 * прочитанное собеседником.
 *
 * Нужно для восстановления галочек,
 * если Socket.IO-событие было пропущено.
 */
async function getChatReadState({
                                    userId,
                                    orderId,
                                    orderType,
                                }) {
    const access = await getAccess({
        userId,
        orderId,
        orderType,
    });

    if (!access.otherUserId) {
        return {
            orderId: access.orderId,
            orderType: access.orderType,
            readerId: null,
            lastReadMessageId: 0,
            readAt: null,
        };
    }

    const latest = await Message.findOne({
        where: {
            orderId: access.orderId,
            orderType: access.orderType,

            senderId: access.userId,
            receiverId: access.otherUserId,

            readAt: {
                [Op.ne]: null,
            },
        },

        attributes: [
            "id",
            "readAt",
        ],

        order: [["id", "DESC"]],
    });

    return {
        orderId: access.orderId,
        orderType: access.orderType,

        readerId: access.otherUserId,

        lastReadMessageId:
            latest ? Number(latest.id) : 0,

        readAt:
            latest?.readAt
                ? new Date(latest.readAt).toISOString()
                : null,
    };
}

/**
 * Отмечаем прочитанными входящие сообщения
 * до конкретного ID включительно.
 *
 * Нельзя отметить чужой заказ или произвольное
 * исходящее сообщение.
 */
async function markChatMessagesRead({
                                        userId,
                                        orderId,
                                        orderType,
                                        throughId,
                                    }) {
    const access = await getAccess({
        userId,
        orderId,
        orderType,
    });

    const messageId = parsePositiveId(
        throughId
    );

    if (!messageId) {
        throw chatAccessError(
            400,
            "Некорректный throughId"
        );
    }

    if (!access.otherUserId) {
        throw chatAccessError(
            409,
            "У заказа отсутствует собеседник"
        );
    }

    /*
     * throughId должен принадлежать входящему
     * сообщению этого пользователя и заказа.
     */
    const target = await Message.findOne({
        where: {
            id: messageId,

            orderId: access.orderId,
            orderType: access.orderType,

            senderId: access.otherUserId,
            receiverId: access.userId,
        },

        attributes: [
            "id",
            "readAt",
        ],
    });

    if (!target) {
        throw chatAccessError(
            404,
            "Сообщение не найдено"
        );
    }

    const readAt = new Date();

    /*
     * Обновляем все более ранние входящие
     * сообщения, которые ещё не были прочитаны.
     */
    const [updatedCount] = await Message.update(
        {
            readAt,
        },
        {
            where: {
                orderId: access.orderId,
                orderType: access.orderType,

                senderId: access.otherUserId,
                receiverId: access.userId,

                id: {
                    [Op.lte]: messageId,
                },

                readAt: {
                    [Op.is]: null,
                },
            },
        }
    );

    const result = {
        orderId: access.orderId,
        orderType: access.orderType,

        readerId: access.userId,

        lastReadMessageId: messageId,

        readAt:
            target.readAt
                ? new Date(target.readAt).toISOString()
                : readAt.toISOString(),
    };

    /*
     * Уведомляем отправителя только тогда,
     * когда появились новые подтверждения.
     *
     * Если он офлайн, состояние позже
     * восстановится через HTTP API.
     */
    if (updatedCount > 0) {
        sendToUser(
            access.otherUserId,
            "chat:read",
            result
        );
    }

    /*
     * Отмечаем прочитанными только уведомления
     * о сообщениях, которые пользователь увидел.
     *
     * Остальные уведомления заказа
     * здесь не затрагиваем.
     */
    try {
        await Notification.update(
            {
                isRead: true,
            },
            {
                where: {
                    userId: access.userId,

                    orderId: access.orderId,
                    orderType: access.orderType,

                    type: "new_message",

                    messageId: {
                        [Op.lte]: messageId,
                    },

                    isRead: false,
                },
            }
        );

        await sendNotifications(
            access.userId
        );
    } catch (error) {
        console.error(
            "Не удалось обновить уведомления чата:",
            error
        );
    }

    return result;
}

module.exports = {
    getChatReadState,
    markChatMessagesRead,
};