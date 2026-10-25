const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { notifyUser } = require("../services/notificationService");
const {sendAdminNotification, adminOrderUrl, adminExpressOrderUrl} = require("../services/adminNotificationService");

const authMiddleware = require('../middlewares/userAuth');
const { Dispute, Order, ActionLog, ExpressOrder } = require('../models');

const multer = require("multer");
const jwt = require("jsonwebtoken");

const {
    authMiddleware: adminAuthMiddleware,
} = require("../middlewares/adminAuth");

const {
    MAX_PHOTOS,
    MAX_FILE_SIZE,
    saveDisputeEvidence,
    removeDisputeEvidence,
    getEvidenceFilePath,
} = require("../services/disputeEvidenceService");


const evidenceUploader = multer({
    storage: multer.memoryStorage(),
    limits: {
        files: MAX_PHOTOS,
        fileSize: MAX_FILE_SIZE,
        fields: 6,
        fieldSize: 64 * 1024,
    },
}).array("evidence", MAX_PHOTOS);

function parseDisputeEvidence(req, res, next) {
    evidenceUploader(req, res, (error) => {
        if (!error) return next();

        const isSizeError = error.code === "LIMIT_FILE_SIZE";

        return res.status(isSizeError ? 413 : 400).json({
            message: isSizeError
                ? "Каждая фотография должна быть не более 8 МБ"
                : "Не удалось принять фотографии. Максимум 5 файлов",
        });
    });
}

function authenticateEvidenceViewer(req, res, next) {
    const token = String(
        req.headers.authorization || ""
    ).replace(/^Bearer\s+/i, "");

    const decoded = jwt.decode(token);

    if (decoded?.scope === "admin") {
        return adminAuthMiddleware(req, res, next);
    }

    return authMiddleware(req, res, next);
}


// Открыть спор
router.post(
    "/open",
    authMiddleware,
    parseDisputeEvidence,
    async (req, res) => {
        try {
        const {
            orderId,
            orderType = "regular",
            reasonCode,
            reason,
            description,
        } = req.body;

        const userId = req.user.id;

        if (!orderId || !reasonCode || !reason) {
            return res.status(400).json({
                message: 'orderId, reasonCode и reason обязательны'
            });
        }

        if (!["regular", "express"].includes(orderType)) {
            return res.status(400).json({
                message: "Некорректный тип заказа"
            });
        }

        let order;

        if (orderType === "express") {
            order = await ExpressOrder.findByPk(orderId);
        } else {
            order = await Order.findByPk(orderId);
        }

        if (!order) {
            return res.status(404).json({
                message:
                    orderType === "express"
                        ? "Экспресс-заказ не найден"
                        : "Заказ не найден"
            });
        }

        /*
         * Проверяем статус отдельно,
         * потому что regular и express имеют разные статусы.
         */
        if (orderType === "regular") {
            const allowedStatuses = [
                "active",
                "completed",
            ];

            if (!allowedStatuses.includes(order.status)) {
                return res.status(400).json({
                    message:
                        "Спор можно открыть только по активному или завершённому заказу"
                });
            }
        }

        if (orderType === "express") {
            const allowedExpressStatuses = [
                "accepted",
                "on_the_way_to_A",
                "arrived_at_A",
                "waiting_at_A",
                "picked_up",
                "in_progress",
                "completed",
            ];

            if (!allowedExpressStatuses.includes(order.status)) {
                return res.status(400).json({
                    message:
                        "По этому экспресс-заказу сейчас нельзя открыть спор"
                });
            }
        }

        const isCreator =
            Number(order.creatorId) === Number(userId);

        const isExecutor =
            Number(order.executorId) === Number(userId);

        if (!isCreator && !isExecutor) {
            return res.status(403).json({
                message:
                    "Вы не участвуете в этом заказе"
            });
        }

        const existingDispute =
            await Dispute.findOne({
                where: {
                    orderId,

                    // ✅ новое поле
                    orderType,

                    status: {
                        [Op.in]: [
                            "open",
                            "in_review",
                            "waiting_creator",
                            "waiting_executor",
                        ]
                    }
                }
            });

        if (existingDispute) {
            return res.status(400).json({
                message:
                    "По этому заказу уже открыт спор"
            });
        }

            const uploadedFiles = req.files || [];

        const dispute =
            await Dispute.create({
                orderId: order.id,

                // ✅ новое поле
                orderType,

                openedById: userId,

                openedByRole:
                    isCreator
                        ? "creator"
                        : "executor",

                creatorId:
                order.creatorId,

                executorId:
                    order.executorId || null,

                reasonCode,
                reason,

                description:
                    description || null,

                status: "open",
            });


            try {
                const evidencePhotos = await saveDisputeEvidence(
                    dispute.id,
                    userId,
                    uploadedFiles
                );

                if (evidencePhotos.length) {
                    dispute.evidencePhotos = evidencePhotos;
                    await dispute.save();
                }
            } catch (error) {
                await removeDisputeEvidence(dispute.id);
                await dispute.destroy();
                throw error;
            }


            void sendAdminNotification({
            topic: "disputes",

            title:
                orderType === "express"
                    ? "⚠️ Открыта проблема по экспресс-заказу"
                    : "⚠️ Открыт спор по заказу",

            message: [
                `Спор ID: ${dispute.id}`,
                `Заказ ID: ${order.id}`,

                `Тип заказа: ${
                    orderType === "express"
                        ? "экспресс"
                        : "обычный"
                }`,

                `Открыл: ${
                    isCreator
                        ? "заказчик"
                        : "исполнитель"
                }`,

                `Пользователь ID: ${userId}`,

                "",
                `Причина: ${reason}`,

                reasonCode
                    ? `Код причины: ${reasonCode}`
                    : null,

                description
                    ? `Описание: ${description}`
                    : null,
            ]
                .filter(Boolean)
                .join("\n"),

            buttonText: "Открыть заказ",

            buttonUrl:
                orderType === "express"
                    ? adminExpressOrderUrl(order.id)
                    : adminOrderUrl(order.id),
        });

        const recipientUserId =
            isCreator
                ? order.executorId
                : order.creatorId;

        const recipientRole =
            isCreator
                ? "executor"
                : "creator";

        if (recipientUserId) {
            try {
                await notifyUser({
                    userId: recipientUserId,

                    type: "dispute_opened",

                    title:
                        orderType === "express"
                            ? `Открыта проблема по экспресс-заказу №${order.id}`
                            : `Открыт спор по заказу №${order.id}`,

                    body:
                        `Вторая сторона открыла обращение по заказу №${order.id}. ` +
                        `Причина: ${reason}`,

                    orderId: order.id,

                    // ✅ теперь правильный тип
                    orderType,

                    data: {
                        disputeId: dispute.id,

                        orderType,

                        creatorId:
                        order.creatorId,

                        executorId:
                            order.executorId || "",

                        openedById:
                        userId,

                        openedByRole:
                            isCreator
                                ? "creator"
                                : "executor",

                        recipientRole,

                        reasonCode,
                        reason,

                        status: "open",
                    },
                });
            } catch (notificationError) {
                console.error(
                    "Ошибка уведомления об открытии спора:",
                    notificationError
                );
            }
        }

        await req.logAction({
            req,

            actorUserId: userId,

            actorRole: "user",

            actionType:
                "dispute_opened",

            entityType:
                "dispute",

            entityId:
            dispute.id,

            // Для обычного заказа
            orderId:
                orderType === "regular"
                    ? order.id
                    : null,

            // Для экспресс-заказа
            expressOrderId:
                orderType === "express"
                    ? order.id
                    : null,

            severity:
                "warn",

            success:
                true,

            reason,

            meta: {
                disputeId:
                dispute.id,

                orderType,

                orderId:
                order.id,

                reasonCode,

                description:
                    description || null,

                openedByRole:
                    isCreator
                        ? "creator"
                        : "executor",
            },
        });

        return res.status(201).json({
            success: true,
            message: "Спор успешно открыт",
            dispute
        });

    } catch (error) {
        console.error(
            "Ошибка открытия спора:",
            error
        );

            return res.status(error.status || 500).json({
                message: error.status
                    ? error.message
                    : "Ошибка сервера",
            });
    }
});

// Получить спор по заказу
router.get('/order/:orderType/:orderId', authMiddleware, async (req, res) => {
        try {
            const {
                orderType,
                orderId,
            } = req.params;

            const userId = req.user.id;

            // Проверяем тип заказа
            if (
                !["regular", "express"].includes(orderType)
            ) {
                return res.status(400).json({
                    message: "Некорректный тип заказа",
                });
            }

            let order;

            // Ищем заказ в правильной таблице
            if (orderType === "express") {
                order = await ExpressOrder.findByPk(orderId);
            } else {
                order = await Order.findByPk(orderId);
            }

            if (!order) {
                return res.status(404).json({
                    message:
                        orderType === "express"
                            ? "Экспресс-заказ не найден"
                            : "Заказ не найден",
                });
            }

            // Проверяем, что пользователь участвует в заказе
            const isCreator =
                Number(order.creatorId) ===
                Number(userId);

            const isExecutor =
                Number(order.executorId) ===
                Number(userId);

            if (!isCreator && !isExecutor) {
                return res.status(403).json({
                    message:
                        "У вас нет доступа к этому спору",
                });
            }

            // Ищем спор именно по ID + типу заказа
            const dispute =
                await Dispute.findOne({
                    where: {
                        orderId,
                        orderType,
                    },
                    order: [
                        ["id", "DESC"],
                    ],
                });

            return res.json({
                success: true,
                dispute: dispute || null,
            });

        } catch (error) {
            console.error(
                "Ошибка получения спора:",
                error
            );

            return res.status(500).json({
                message: "Ошибка сервера",
            });
        }
    });


router.get(
    "/evidence/:disputeId/:photoId",
    authenticateEvidenceViewer,
    async (req, res) => {
        try {
            const disputeId = Number(req.params.disputeId);

            if (!Number.isSafeInteger(disputeId) || disputeId <= 0) {
                return res.status(400).json({
                    message: "Некорректный ID спора",
                });
            }

            const dispute = await Dispute.findByPk(disputeId);

            if (!dispute) {
                return res.sendStatus(404);
            }

            const userId = Number(req.user.id);
            const isAdmin = req.user.role === "admin";

            const isParticipant =
                Number(dispute.creatorId) === userId ||
                Number(dispute.executorId) === userId;

            if (!isAdmin && !isParticipant) {
                return res.sendStatus(403);
            }

            const photos = Array.isArray(dispute.evidencePhotos)
                ? dispute.evidencePhotos
                : [];

            const photo = photos.find(
                (item) => item.id === req.params.photoId
            );

            if (!photo) {
                return res.sendStatus(404);
            }

            const filePath = getEvidenceFilePath(
                dispute.id,
                photo.id
            );

            res.setHeader("Cache-Control", "no-store");
            res.setHeader("Content-Type", "image/jpeg");
            res.setHeader("X-Content-Type-Options", "nosniff");

            return res.sendFile(filePath, (error) => {
                if (error && !res.headersSent) {
                    res.sendStatus(404);
                }
            });
        } catch (error) {
            console.error("Ошибка просмотра доказательства:", error);

            return res.status(error.status || 500).json({
                message: error.status
                    ? error.message
                    : "Ошибка сервера",
            });
        }
    }
);


module.exports = router;