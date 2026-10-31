const express = require("express");
const router = express.Router();
const {sendAdminNotification} = require("../services/adminNotificationService");
const { Op } = require("sequelize");
const authenticateToken = require("../middlewares/userAuth");
const { SupportMessage, User, Notification, ActionLog } = require("../models");
const {
    createSupportMessage,
} = require("../services/supportMessageIdempotency");

/**
 * Получить свой чат поддержки
 * GET /api/support/messages
 */
router.get("/messages", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const messages = await SupportMessage.findAll({
            where: { userId },
            order: [["createdAt", "ASC"]],
            include: [
                {
                    model: User,
                    as: "sender",
                    attributes: ["id", "username", "avatar", "role"],
                },
            ],
        });

        res.json(messages);
    } catch (error) {
        console.error("Ошибка получения сообщений поддержки:", error);
        res.status(500).json({
            message: "Ошибка получения сообщений поддержки",
        });
    }
});

/**
 * Пользователь отправляет сообщение в поддержку
 * POST /api/support/messages
 */
router.post("/messages", authenticateToken, async (req, res) => {
    try {
        const io = req.app.locals.io;
        const userId = req.user.id;
        const {
            text,
            clientMessageId,
        } = req.body || {};

        const result = await createSupportMessage({
            userId,
            senderId: userId,
            senderRole: "user",

            text,
            rawClientMessageId: clientMessageId,
        });

        const message = result.message;
        const fullMessage = result.message;
        const cleanText = fullMessage.text;

        /*
         * Повторная отправка:
         * запись уже существует.
         *
         * Не повторяем Telegram-уведомление,
         * журнал действий и Socket.IO-события.
         */
        if (!result.created) {
            return res.status(200).json(fullMessage);
        }

        const isPlatformSuggestion =
            cleanText.startsWith(
                "💡 ПРЕДЛОЖЕНИЕ ПО РАЗВИТИЮ CARGOCAMP"
            );

        void sendAdminNotification({
            topic:
                isPlatformSuggestion
                    ? "ideas"
                    : "support",

            title:
                isPlatformSuggestion
                    ? "💡 Новое предложение по развитию"
                    : "💬 Новое сообщение в поддержку",

            message: [
                `Пользователь ID: ${userId}`,

                fullMessage?.sender?.username
                    ? `Имя: ${fullMessage.sender.username}`
                    : null,

                "",
                cleanText,
            ]
                .filter(Boolean)
                .join("\n"),

            buttonText: "Открыть поддержку",
            buttonUrl: "https://admin.cargocamp.ru/support",
        });

        await ActionLog.create({
            actorUserId: userId,
            actorRole: "user",
            actionType: "support_message_sent",
            entityType: "message",
            entityId: message.id,
            severity: "info",
            success: true,
            meta: {
                support: true,
                textLength: cleanText.length,
            },
        }).catch((e) => {
            console.warn(
                "Не удалось записать ActionLog support_message_sent:",
                e.message
            );
        });

        if (io) {
            io.to("admins").emit("support:new_message", {
                userId,
                message: fullMessage,
            });

            io.to(`support_user_${userId}`).emit("support:new_message", {
                userId,
                message: fullMessage,
            });
        }

        return res.status(201).json(fullMessage);
    } catch (error) {
        console.error(
            "Ошибка отправки сообщения в поддержку:",
            error
        );

        return res.status(
            error.status || 500
        ).json({
            message: error.status
                ? error.message
                : "Ошибка отправки сообщения в поддержку",
        });
    }
});
/**
 * Пользователь отметил ответы поддержки прочитанными
 * PATCH /api/support/read
 */
router.patch(
    "/read",
    authenticateToken,
    async (req, res) => {
        try {
            const userId = req.user.id;

            const rawThroughId =
                req.body?.throughId;

            const throughId =
                rawThroughId == null
                    ? null
                    : Number(rawThroughId);

            if (
                throughId !== null &&
                (
                    !Number.isSafeInteger(throughId) ||
                    throughId <= 0
                )
            ) {
                return res.status(400).json({
                    message: "Некорректный throughId",
                });
            }

            const where = {
                userId,
                senderRole: "admin",
                isReadByUser: false,

                ...(throughId
                    ? {
                        id: {
                            [Op.lte]: throughId,
                        },
                    }
                    : {}),
            };

            const [updated] =
                await SupportMessage.update(
                    {
                        isReadByUser: true,
                    },
                    {
                        where,
                    }
                );

            /*
             * Уведомления об ответах поддержки
             * тоже должны становиться прочитанными.
             */
            const notificationWhere = {
                userId,
                type: "support_reply",
                isRead: false,

                ...(throughId
                    ? {
                        [Op.or]: [
                            {
                                messageId: {
                                    [Op.lte]: throughId,
                                },
                            },
                            {
                                messageId: {
                                    [Op.is]: null,
                                },
                            },
                        ],
                    }
                    : {}),
            };

            await Notification.update(
                {
                    isRead: true,
                },
                {
                    where: notificationWhere,
                }
            );

            if (updated > 0) {
                req.app.locals.io
                    ?.to("admins")
                    .emit("support:read", {
                        userId,
                        readerRole: "user",
                        throughId,
                    });
            }

            return res.json({
                success: true,
                updated,
                throughId,
            });
        } catch (error) {
            console.error(
                "Ошибка отметки поддержки прочитанной:",
                error
            );

            return res.status(500).json({
                message: "Ошибка обновления прочтения",
            });
        }
    }
);

module.exports = router;