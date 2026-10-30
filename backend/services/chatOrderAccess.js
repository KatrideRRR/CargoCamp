const {
    Order,
    ExpressOrder,
} = require("../models");

function chatAccessError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function parsePositiveId(value) {
    const text = String(value ?? "").trim();

    if (!/^[1-9]\d*$/.test(text)) {
        return null;
    }

    const id = Number(text);

    if (!Number.isSafeInteger(id)) {
        return null;
    }

    return id;
}

function normalizeChatOrderType(value) {
    if (value === "regular" || value === "express") {
        return value;
    }

    throw chatAccessError(
        400,
        "Недопустимый тип заказа"
    );
}

/**
 * Проверяет:
 * 1. Существование заказа.
 * 2. Корректность идентификаторов.
 * 3. Участие пользователя в заказе.
 *
 * Возвращает участников и собеседника.
 */
async function requireChatOrderAccess({
                                          orderId,
                                          orderType,
                                          userId,
                                      }) {
    const normalizedType =
        normalizeChatOrderType(orderType);

    const normalizedOrderId =
        parsePositiveId(orderId);

    const normalizedUserId =
        parsePositiveId(userId);

    if (!normalizedOrderId || !normalizedUserId) {
        throw chatAccessError(
            400,
            "Некорректный идентификатор"
        );
    }

    const Model =
        normalizedType === "express"
            ? ExpressOrder
            : Order;

    const order = await Model.findByPk(
        normalizedOrderId,
        {
            attributes: [
                "id",
                "creatorId",
                "executorId",
            ],
        }
    );

    if (!order) {
        throw chatAccessError(
            404,
            "Заказ не найден"
        );
    }

    const creatorId =
        parsePositiveId(order.creatorId);

    const executorId =
        parsePositiveId(order.executorId);

    const isCreator =
        creatorId === normalizedUserId;

    const isExecutor =
        executorId === normalizedUserId;

    if (!isCreator && !isExecutor) {
        // Не раскрываем постороннему существование
        // чужой переписки.
        throw chatAccessError(
            404,
            "Заказ не найден"
        );
    }

    const otherUserId =
        isCreator
            ? executorId
            : creatorId;

    return {
        orderId: normalizedOrderId,
        orderType: normalizedType,

        userId: normalizedUserId,
        creatorId,
        executorId,

        isCreator,
        isExecutor,

        otherUserId,
    };
}

module.exports = {
    chatAccessError,
    parsePositiveId,
    normalizeChatOrderType,
    requireChatOrderAccess,
};