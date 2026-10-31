const { Op } = require("sequelize");

const {
    Message,
    User,
} = require("../models");

const {
    parsePositiveId,
    chatAccessError,
} = require("./chatOrderAccess");

/**
 * Необязательный идентификатор сообщения,
 * на которое пользователь отвечает.
 */
function normalizeReplyToMessageId(value) {
    if (value === undefined || value === null) {
        return null;
    }

    const id = parsePositiveId(value);

    if (!id) {
        throw chatAccessError(
            400,
            "Некорректный replyToMessageId"
        );
    }

    return id;
}

/**
 * Проверяем, что исходное сообщение:
 *
 * 1. Существует.
 * 2. Относится к тому же заказу.
 * 3. Написано одним из текущих собеседников.
 * 4. Адресовано второму участнику.
 */
async function requireReplyTarget({
                                      access,
                                      replyToMessageId,
                                  }) {
    if (!replyToMessageId) {
        return null;
    }

    const target = await Message.findOne({
        where: {
            id: replyToMessageId,

            orderId: access.orderId,
            orderType: access.orderType,

            [Op.or]: [
                {
                    senderId: access.userId,
                    receiverId: access.otherUserId,
                },
                {
                    senderId: access.otherUserId,
                    receiverId: access.userId,
                },
            ],
        },

        attributes: ["id"],
    });

    if (!target) {
        throw chatAccessError(
            404,
            "Исходное сообщение не найдено"
        );
    }

    return Number(target.id);
}

/**
 * Единый список связей при загрузке сообщений.
 *
 * Цитату ограничиваем нужными полями:
 * не загружаем всю цепочку ответов.
 */
function getChatMessageIncludes() {
    return [
        {
            model: User,
            as: "sender",
            attributes: [
                "id",
                "username",
                "avatar",
            ],
        },
        {
            model: User,
            as: "receiver",
            attributes: [
                "id",
                "username",
                "avatar",
            ],
        },
        {
            model: Message,
            as: "replyTo",
            attributes: [
                "id",
                "senderId",
                "content",
                "createdAt",
            ],
            required: false,
        },
    ];
}

module.exports = {
    normalizeReplyToMessageId,
    requireReplyTarget,
    getChatMessageIncludes,
};