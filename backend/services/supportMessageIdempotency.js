const {
    SupportMessage,
    User,
} = require("../models");

const {
    normalizeClientMessageId,
    isDuplicateKeyError,
} = require("./chatMessageIdempotency");

function supportError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

async function getFullSupportMessage(id) {
    return SupportMessage.findByPk(id, {
        include: [{
            model: User,
            as: "sender",
            attributes: [
                "id",
                "username",
                "avatar",
                "role",
            ],
        }],
    });
}

async function findExisting({
                                userId,
                                senderId,
                                senderRole,
                                text,
                                clientMessageId,
                            }) {
    if (!clientMessageId) {
        return null;
    }

    const existing =
        await SupportMessage.findOne({
            where: {
                senderId,
                clientMessageId,
            },
        });

    if (!existing) {
        return null;
    }

    const matches =
        Number(existing.userId) === Number(userId) &&
        existing.senderRole === senderRole &&
        existing.text === text;

    if (!matches) {
        throw supportError(
            409,
            "Идентификатор уже использован для другого сообщения поддержки"
        );
    }

    return (
        await getFullSupportMessage(existing.id)
    ) || existing;
}

/**
 * Одна логическая отправка — одна запись MySQL.
 * Для старых клиентов без clientMessageId
 * сохраняется прежнее поведение.
 */
async function createSupportMessage({
                                        userId,
                                        senderId,
                                        senderRole,
                                        text,
                                        rawClientMessageId,
                                    }) {
    if (typeof text !== "string") {
        throw supportError(
            400,
            "Некорректный текст сообщения"
        );
    }

    const cleanText = text.trim();

    if (!cleanText) {
        throw supportError(
            400,
            "Сообщение не может быть пустым"
        );
    }

    if (cleanText.length > 10000) {
        throw supportError(
            400,
            "Сообщение слишком длинное"
        );
    }

    const clientMessageId =
        normalizeClientMessageId(
            rawClientMessageId
        );

    const criteria = {
        userId,
        senderId,
        senderRole,
        text: cleanText,
        clientMessageId,
    };

    const existing =
        await findExisting(criteria);

    if (existing) {
        return {
            created: false,
            message: existing,
        };
    }

    let saved;

    try {
        saved = await SupportMessage.create({
            userId,
            senderId,
            senderRole,

            text: cleanText,
            clientMessageId,

            isReadByUser:
                senderRole === "user",

            isReadByAdmin:
                senderRole === "admin",
        });
    } catch (error) {
        if (
            clientMessageId &&
            isDuplicateKeyError(error)
        ) {
            const duplicate =
                await findExisting(criteria);

            if (duplicate) {
                return {
                    created: false,
                    message: duplicate,
                };
            }
        }

        throw error;
    }

    return {
        created: true,

        message:
            (await getFullSupportMessage(saved.id)) ||
            saved,
    };
}

module.exports = {
    createSupportMessage,
};