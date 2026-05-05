const { Notification } = require("../models");
const { sendPushToUser } = require("./pushService");
const {
    sendNotifications,
    sendToUser,
} = require("../socket");

function normalizeOrderType(orderType) {
    return ["regular", "express"].includes(orderType) ? orderType : "regular";
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
 * 2. Обновляет список уведомлений через socket
 * 3. Шлёт отдельное socket-событие, если передан socketEvent
 * 4. Шлёт push через Firebase
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

    await sendNotifications(userId);

    if (socketEvent) {
        sendToUser(userId, socketEvent, {
            type,
            title,
            body,
            orderId,
            orderType: normalizedOrderType,
            notificationId: notification.id,
            ...(socketPayload || {}),
        });
    }

    sendPushToUser({
        userId,
        title: title || "CargoCamp",
        body: body || "Новое уведомление",
        data: stringifyPushData({
            notificationId: notification.id,
            ...payloadData,
        }),
    }).catch((e) => {
        console.error("push send failed:", e);
    });

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