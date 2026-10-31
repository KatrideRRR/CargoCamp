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
    getChatReadState,
    markChatMessagesRead,
} = require("../services/chatReadReceipts");

const {
    notifyUser,
} = require("../services/notificationService");

const {
    requireChatOrderAccess,
    parsePositiveId,
} = require("../services/chatOrderAccess");

const {
    normalizeClientMessageId,
    getFullChatMessage,
    findExistingChatMessage,
    isDuplicateKeyError,
} = require("../services/chatMessageIdempotency");

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
                clientMessageId: rawClientMessageId,
            } = req.body || {};

            const clientMessageId =
                normalizeClientMessageId(rawClientMessageId);

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
             * Сначала проверяем повторную отправку.
             * Существующее сообщение возвращаем
             * без новых Socket.IO-событий и уведомлений.
             */
            const existingMessage =
                await findExistingChatMessage({
                    access,
                    clientMessageId,
                    content: cleanContent,
                });

            if (existingMessage) {
                return res.status(200).json(existingMessage);
            }

            let message;

            try {
                message = await Message.create({
                    content: cleanContent,

                    senderId: access.userId,
                    receiverId: access.otherUserId,

                    clientMessageId,

                    orderId: access.orderId,
                    orderType: access.orderType,
                });
            } catch (createError) {
                /*
                 * Два одинаковых запроса могли прийти
                 * одновременно.
                 *
                 * Уникальный индекс MySQL пропустит
                 * только один из них.
                 */
                if (
                    clientMessageId &&
                    isDuplicateKeyError(createError)
                ) {
                    const savedMessage =
                        await findExistingChatMessage({
                            access,
                            clientMessageId,
                            content: cleanContent,
                        });

                    if (savedMessage) {
                        return res.status(200).json(
                            savedMessage
                        );
                    }
                }

                throw createError;
            }

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
                (await getFullChatMessage(message.id)) ||
                message;

            /**
             * Событие оставляем совместимым
             * с текущим фронтендом.
             *
             * Защита самих Socket.IO-комнат —
             * следующий подэтап.
             */
            /*
             * Сообщение получают только два участника,
             * определённые сервером.
             *
             * Не рассылаем сообщения в общую комнату
             * заказа: её состав мог устареть после
             * изменения исполнителя.
             */

            sendToUser(
                access.userId,
                "receiveMessage",
                fullMessage
            );

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
 * GET /api/messages/sync/:orderType/:orderId?afterId=0
 *
 * Возвращает следующие 100 сообщений после afterId.
 * Проверка участия в заказе обязательна.
 *
 * Старые маршруты истории не меняем.
 */
router.get(
    "/sync/:orderType/:orderId",
    authenticateToken,
    async (req, res) => {
        try {
            const rawAfterId =
                req.query.afterId ?? "0";

            if (
                typeof rawAfterId !== "string" ||
                !/^(0|[1-9]\d*)$/.test(rawAfterId)
            ) {
                return res.status(400).json({
                    message: "Некорректный afterId",
                });
            }

            const afterId = Number(rawAfterId);

            if (!Number.isSafeInteger(afterId)) {
                return res.status(400).json({
                    message: "Некорректный afterId",
                });
            }

            const access =
                await requireChatOrderAccess({
                    orderId: req.params.orderId,
                    orderType: req.params.orderType,
                    userId: req.user.id,
                });

            const limit = 100;

            const messages = await Message.findAll({
                where: {
                    orderId: access.orderId,
                    orderType: access.orderType,

                    id: {
                        [Op.gt]: afterId,
                    },

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

                order: [["id", "ASC"]],

                limit,
            });

            const nextCursor = messages.length
                ? Number(messages[messages.length - 1].id)
                : afterId;

            return res.json({
                messages,
                nextCursor,
                hasMore: messages.length === limit,
            });
        } catch (error) {
            return handleChatError(res, error);
        }
    }
);

/**
 * GET /api/messages/read-state/:orderType/:orderId
 *
 * Узнаём, какие исходящие сообщения
 * уже прочитал собеседник.
 */
router.get(
    "/read-state/:orderType/:orderId",
    authenticateToken,
    async (req, res) => {
        try {
            const result =
                await getChatReadState({
                    userId: req.user.id,

                    orderId:
                    req.params.orderId,

                    orderType:
                    req.params.orderType,
                });

            return res.json(result);
        } catch (error) {
            return handleChatError(
                res,
                error
            );
        }
    }
);

/**
 * POST /api/messages/read/:orderType/:orderId
 *
 * Подтверждение прочтения входящих
 * сообщений до указанного ID.
 */
router.post(
    "/read/:orderType/:orderId",
    authenticateToken,
    async (req, res) => {
        try {
            const result =
                await markChatMessagesRead({
                    userId: req.user.id,

                    orderId:
                    req.params.orderId,

                    orderType:
                    req.params.orderType,

                    throughId:
                    req.body?.throughId,
                });

            return res.json(result);
        } catch (error) {
            return handleChatError(
                res,
                error
            );
        }
    }
);

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