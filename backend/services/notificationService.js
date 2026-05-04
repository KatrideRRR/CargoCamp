const { Notification } = require("../models");
const {
    sendNotifications,
    sendToUser,
} = require("../socket");

/**
 * Универсальное уведомление пользователю.
 *
 * Сейчас:
 * 1. Создаёт запись Notification в БД
 * 2. Обновляет список уведомлений через socket
 * 3. Шлёт отдельное socket-событие, если передан socketEvent
 * 4. Позже сюда добавим реальный push через Firebase
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
    if (!userId || !type) return null;

    const notification = await Notification.create({
        userId,
        type,
        title: title || null,
        body: body || null,
        orderId,
        orderType,
        messageId,
        isRead: false,
        data: {
            ...(data || {}),
            orderId,
            orderType,
            type,
        },
    });

    await sendNotifications(userId);

    if (socketEvent) {
        sendToUser(userId, socketEvent, {
            type,
            title,
            body,
            orderId,
            orderType,
            notificationId: notification.id,
            ...(socketPayload || {}),
        });
    }

    // Здесь позже будет:
    // await sendPushToUser(userId, { title, body, data: notification.data });

    return notification;
}

async function notifyMany(users = [], payload = {}) {
    const uniqueUsers = [...new Set(users.filter(Boolean).map(Number))];

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