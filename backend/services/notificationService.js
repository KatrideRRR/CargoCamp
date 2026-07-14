const { Notification } = require("../models");
const { sendPushToUser } = require("./pushService");
const { sendToUser } = require("../socket");

function normalizeOrderType(orderType) {
    return ["regular", "express"].includes(orderType)
        ? orderType
        : "regular";
}

function stringifyPushData(data = {}) {
    const result = {};

    for (const [key, value] of Object.entries(data || {})) {
        if (value === null || value === undefined) {
            result[key] = "";
        } else if (typeof value === "object") {
            result[key] = JSON.stringify(value);
        } else {
            result[key] = String(value);
        }
    }

    return result;
}

/**
 * Универсальное уведомление пользователю.
 *
 * 1. Создаёт запись Notification в БД
 * 2. Отправляет через socket только новое уведомление
 * 3. Отправляет отдельное socket-событие, если передан socketEvent
 * 4. Отправляет push через Firebase
 */
async function notifyUser({
                              userId,
                              type,
                              title,
                              body,
                              orderId = null,
                              orderType = "regular",
                              messageId = null,
                              data = {},
                              socketEvent = null,
                              socketPayload = null,
                          }) {
    if (!userId || !type) {
        return null;
    }

    const normalizedOrderType = normalizeOrderType(orderType);

    const payloadData = {
        ...(data || {}),
        orderId,
        orderType: normalizedOrderType,
        type,
    };

    const notification = await Notification.create({
        userId,
        type,
        title: title || null,
        body: body || null,
        orderId,
        orderType: normalizedOrderType,
        messageId,
        isRead: false,
        data: payloadData,
    });

    /*
     * Отправляем через new_notification только что созданное
     * уведомление, а не весь список уведомлений пользователя.
     */
    const notificationPayload = {
        id: notification.id,
        notificationId: notification.id,

        userId: notification.userId,
        type: notification.type,

        title: notification.title,
        body: notification.body,

        orderId: notification.orderId,
        orderType:
            notification.orderType ||
            normalizedOrderType,

        messageId: notification.messageId || null,
        isRead: Boolean(notification.isRead),

        createdAt: notification.createdAt,

        data: {
            ...payloadData,
            notificationId: notification.id,
            createdAt: notification.createdAt,
        },
    };

    sendToUser(
        userId,
        "new_notification",
        notificationPayload
    );

    /*
     * Дополнительное socket-событие для конкретного действия.
     * Например orderRequest:12, reviewNeeded и так далее.
     */
    if (socketEvent) {
        sendToUser(userId, socketEvent, {
            ...(socketPayload || {}),

            notificationId: notification.id,

            type,
            title: title || null,
            body: body || null,

            orderId:
                socketPayload?.orderId ??
                notification.orderId ??
                orderId,

            orderType:
                socketPayload?.orderType ||
                notification.orderType ||
                normalizedOrderType,

            createdAt: notification.createdAt,
        });
    }

    /*
     * Push отправляем отдельно.
     * Ошибка push не должна ломать создание уведомления.
     */
    sendPushToUser({
        userId,
        title: title || "CargoCamp",
        body: body || "Новое уведомление",

        data: stringifyPushData({
            notificationId: notification.id,
            createdAt: notification.createdAt,
            ...payloadData,
        }),
    }).catch((error) => {
        console.error(
            "push send failed:",
            error
        );
    });

    return notification;
}

async function notifyMany(users = [], payload = {}) {
    const uniqueUsers = [
        ...new Set(
            users
                .filter(Boolean)
                .map(Number)
        ),
    ];

    const results = [];

    for (const userId of uniqueUsers) {
        const result = await notifyUser({
            ...payload,
            userId,
        });

        results.push(result);
    }

    return results;
}

module.exports = {
    notifyUser,
    notifyMany,
};