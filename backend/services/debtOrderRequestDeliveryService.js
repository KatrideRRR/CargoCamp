"use strict";

const {
    sendToUser,
} = require("../socket");

const {
    sendPushToUser,
} = require("./pushService");

async function deliverDebtOrderRequestNotifications(
    notifications = []
) {
    for (const notification of notifications) {
        const payload = {
            ...notification,

            notificationId:
            notification.id,

            data: {
                ...(notification.data || {}),
                notificationId:
                notification.id,
                createdAt:
                notification.createdAt,
            },
        };

        try {
            sendToUser(
                notification.userId,
                "new_notification",
                payload
            );

            if (
                notification.type ===
                "order_request"
            ) {
                sendToUser(
                    notification.userId,
                    `orderRequest:${notification.userId}`,
                    {
                        ...payload,
                        ...payload.data,
                    }
                );
            }

            if (
                [
                    "debt_order_request_sent",
                    "debt_order_request_failed",
                ].includes(notification.type)
            ) {
                sendToUser(
                    notification.userId,
                    "debtOrderRequestResult",
                    payload
                );
            }
        } catch (error) {
            console.error(
                "Debt request socket delivery failed:",
                error.message
            );
        }

        try {
            const pushData = {};

            for (
                const [key, value]
                of Object.entries(payload.data)
                ) {
                pushData[key] =
                    value == null
                        ? ""
                        : typeof value === "object"
                            ? JSON.stringify(value)
                            : String(value);
            }

            await sendPushToUser({
                userId: notification.userId,
                title: notification.title,
                body: notification.body,
                data: pushData,
            });
        } catch (error) {
            console.error(
                "Debt request push delivery failed:",
                error.message
            );
        }
    }
}

module.exports = {
    deliverDebtOrderRequestNotifications,
};