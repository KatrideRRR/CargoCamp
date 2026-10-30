const express = require("express");
const router = express.Router();

const { Op } = require("sequelize");

const {
    Message,
    User,
    Notification,
} = require("../models");

const authenticateToken =
    require("../middlewares/userAuth");

const {
    sendNotifications,
    sendToUser,
} = require("../socket");

const {
    notifyUser,
} = require("../services/notificationService");

const {
    requireChatOrderAccess,
    parsePositiveId,
} = require("../services/chatOrderAccess");

/**
 * Унифицированная обработка ошибок.
 */
function handleChatError(res, error) {
    if (error.status) {
        return res.status(error.status).json({
            message: error.message,
        });
    }

    console.error(
        "Chat API error:",
        error
    );

    return res.status(500).json({
        message: "Ошибка работы с сообщениями",
    });
}

/**
 * POST /api/messages
 *
 * Отправка сообщения по заказу.
 */
router.post(
    "/",
    authenticateToken,
    async (req, res) => {
        try {
            const {
                content,
                receiverId,
                orderId,
                orderType = "regular",
            } = req.body || {};

            if (typeof content !== "string") {
                return res.status(400).json({
                    message: "Некорректный текст сообщения",
                });
            }

            const cleanContent = content.trim();

            if (!cleanContent) {
                return res.status(400).json({
                    message: "Сообщение не может быть пустым",
                });
            }

            if (cleanContent.length > 10000) {
                return res.status(400).json({
                    message:
                        "Сообщение слишком длинное. Максимум 10000 символов.",
                });
            }

            const access = await requireChatOrderAccess({
                orderId,
                orderType,
                userId: req.user.id,
            });

            /**
             * Нельзя отправлять сообщения,
             * пока у заказа нет второго участника.
             */
            if (!access.otherUserId) {
                return res.status(409).json({
                    message:
                        "Собеседник по заказу ещё не назначен",
                });
            }

            /**
             * Старый фронтенд передаёт receiverId.
             *
             * Проверяем его, но не доверяем ему.
             * Настоящий получатель определяется
             * сервером по участникам заказа.
             */
            if (receiverId !== undefined) {
                const requestedReceiverId =
                    parsePositiveId(receiverId);

                if (
                    requestedReceiverId !==
                    access.otherUserId
                ) {
                    return res.status(403).json({
                        message:
                            "Получатель не является участником заказа",
                    });
                }
            }

            /**
             * Отправитель берётся исключительно
             * из проверенной сервером сессии.
             */
            const message = await Message.create({
                content: cleanContent,

                senderId: access.userId,
                receiverId: access.otherUserId,

                orderId: access.orderId,
                orderType: access.orderType,
            });

            /**
             * Ошибка журнала не должна превращать
             * сохранённое сообщение в ошибку отправки.
             */
            try {
                await req.logAction({
                    req,

                    actorUserId: access.userId,
                    actorRole: "user",

                    actionType: "message_sent",
                    entityType: "message",
                    entityId: message.id,

                    orderId: access.orderId,

                    meta: {
                        receiverId: access.otherUserId,
                        contentLen: cleanContent.length,
                        orderType: access.orderType,
                    },
                });
            } catch (logError) {
                console.error(
                    "Chat action log error:",
                    logError
                );
            }

            const fullMessage =
                (await Message.findByPk(message.id, {
                    include: [
                        {
                            model: User,
                            as: "sender",
                            attributes: [
                                "id",
                                "username",
                            ],
                        },
                        {
                            model: User,
                            as: "receiver",
                            attributes: [
                                "id",
                                "username",
                            ],
                        },
                    ],
                })) || message;

            /**
             * Событие оставляем совместимым
             * с текущим фронтендом.
             *
             * Защита самих Socket.IO-комнат —
             * следующий подэтап.
             */
            const io = req.app.locals.io;

            if (io) {
                io.to(
                    `chat_${access.orderType}_${access.orderId}`
                ).emit(
                    "receiveMessage",
                    fullMessage
                );
            }

            sendToUser(
                access.otherUserId,
                "receiveMessage",
                fullMessage
            );

            /**
             * Создание уведомления не должно
             * отменять уже сохранённое сообщение.
             */
            try {
                const existingNotification =
                    await Notification.findOne({
                        where: {
                            userId: access.otherUserId,
                            messageId: message.id,
                        },
                    });

                if (!existingNotification) {
                    await notifyUser({
                        userId: access.otherUserId,

                        type: "new_message",
                        title: "Новое сообщение",

                        body: cleanContent.slice(0, 120),

                        orderId: access.orderId,
                        orderType: access.orderType,

                        messageId: message.id,

                        data: {
                            senderId: access.userId,
                            receiverId: access.otherUserId,
                        },
                    });

                    await sendNotifications(
                        access.otherUserId
                    );
                }
            } catch (notificationError) {
                console.error(
                    "Chat notification error:",
                    notificationError
                );
            }

            return res.status(201).json(
                fullMessage
            );

        } catch (error) {
            return handleChatError(res, error);
        }
    }
);

/**
 * Общий обработчик получения истории.
 *
 * Возвращаем только сообщения, в которых
 * текущий пользователь был участником.
 */
async function getChatHistory(
    req,
    res,
    orderType,
    orderId
) {
    try {
        const access = await requireChatOrderAccess({
            orderId,
            orderType,
            userId: req.user.id,
        });

        const messages = await Message.findAll({
            where: {
                orderId: access.orderId,
                orderType: access.orderType,

                [Op.or]: [
                    {
                        senderId: access.userId,
                    },
                    {
                        receiverId: access.userId,
                    },
                ],
            },

            include: [
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
            ],

            order: [
                ["createdAt", "ASC"],
                ["id", "ASC"],
            ],
        });

        return res.json(messages);

    } catch (error) {
        return handleChatError(res, error);
    }
}

/**
 * Основной маршрут.
 *
 * GET /api/messages/regular/:orderId
 * GET /api/messages/express/:orderId
 */
router.get(
    "/:orderType/:orderId",
    authenticateToken,
    async (req, res) => {
        return getChatHistory(
            req,
            res,
            req.params.orderType,
            req.params.orderId
        );
    }
);

/**
 * Старый маршрут сохраняем
 * ради обратной совместимости.
 *
 * GET /api/messages/:orderId
 *
 * По умолчанию обычный заказ.
 */
router.get(
    "/:orderId",
    authenticateToken,
    async (req, res) => {
        return getChatHistory(
            req,
            res,
            "regular",
            req.params.orderId
        );
    }
);

module.exports = router;