const {
    Message,
    User,
} = require("../models");

const {
    chatAccessError,
} = require("./chatOrderAccess");

const {
    getChatMessageIncludes,
} = require("./chatReplyService");

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeClientMessageId(value) {
    // Старые приложения не передают этот параметр.
    if (value === undefined || value === null) {
        return null;
    }

    if (
        typeof value !== "string" ||
        !UUID_PATTERN.test(value)
    ) {
        throw chatAccessError(
            400,
            "Некорректный clientMessageId"
        );
    }

    return value.toLowerCase();
}

async function getFullChatMessage(messageId) {
    return Message.findByPk(messageId, {
        include: getChatMessageIncludes(),
    });
}

/**
 * Проверяем, не сохранился ли запрос раньше.
 *
 * Одинаковый ключ с другим текстом или заказом
 * запрещён: ключ нельзя переиспользовать
 * для нового сообщения.
 */
async function findExistingChatMessage({
                                           access,
                                           clientMessageId,
                                           content,
                                           replyToMessageId = null,
                                       }) {
    if (!clientMessageId) {
        return null;
    }

    const existing = await Message.findOne({
        where: {
            senderId: access.userId,
            clientMessageId,
        },
    });

    if (!existing) {
        return null;
    }

    const isSameMessage =
        Number(existing.orderId) === access.orderId &&
        existing.orderType === access.orderType &&
        Number(existing.receiverId) === access.otherUserId &&
        existing.content === content &&
        Number(existing.replyToMessageId || 0) ===
        Number(replyToMessageId || 0);

    if (!isSameMessage) {
        throw chatAccessError(
            409,
            "Этот идентификатор уже использован для другого сообщения"
        );
    }

    return (
        (await getFullChatMessage(existing.id)) ||
        existing
    );
}

function isDuplicateKeyError(error) {
    return (
        error?.name === "SequelizeUniqueConstraintError" ||
        error?.parent?.code === "ER_DUP_ENTRY"
    );
}

module.exports = {
    normalizeClientMessageId,
    getFullChatMessage,
    findExistingChatMessage,
    isDuplicateKeyError,
};