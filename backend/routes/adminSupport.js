const express = require("express");
const router = express.Router();

const { authMiddleware, adminMiddleware } = require("../middlewares/adminAuth");

const {
    sequelize,
    SupportMessage,
    User,
    Notification,
    ActionLog,
} = require("../models");

/**
 * Список чатов поддержки для админки
 * GET /api/admin/support/chats
 */
router.get("/chats", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const chats = await SupportMessage.findAll({
            attributes: [
                "userId",
                [
                    sequelize.fn("MAX", sequelize.col("SupportMessage.createdAt")),
                    "lastMessageAt",
                ],
                [
                    sequelize.fn(
                        "SUM",
                        sequelize.literal(
                            "CASE WHEN senderRole = 'user' AND isReadByAdmin = false THEN 1 ELSE 0 END"
                        )
                    ),
                    "unreadCount",
                ],
            ],
            include: [
                {
                    model: User,
                    as: "user",
                    attributes: ["id", "username", "phone", "avatar", "role"],                },
            ],
            group: ["SupportMessage.userId", "user.id"],
            order: [[sequelize.literal("lastMessageAt"), "DESC"]],
        });

        res.json(chats);
    } catch (error) {
        console.error("Ошибка получения чатов поддержки:", error);
        res.status(500).json({
            message: "Ошибка получения чатов поддержки",
        });
    }
});

/**
 * Получить сообщения конкретного пользователя
 * GET /api/admin/support/chats/:userId/messages
 */
router.get("/chats/:userId/messages", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;

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
        console.error("Ошибка получения сообщений поддержки админом:", error);
        res.status(500).json({
            message: "Ошибка получения сообщений поддержки",
        });
    }
});

/**
 * Админ отвечает пользователю
 * POST /api/admin/support/chats/:userId/messages
 */
router.post("/chats/:userId/messages", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const io = req.app.locals.io;
        const adminId = req.user.id;
        const { userId } = req.params;
        const { text } = req.body;

        if (!text || !text.trim()) {
            return res.status(400).json({
                message: "Сообщение не может быть пустым",
            });
        }

        const user = await User.findByPk(userId);

        if (!user) {
            return res.status(404).json({
                message: "Пользователь не найден",
            });
        }

        const message = await SupportMessage.create({
            userId,
            senderId: adminId,
            senderRole: "admin",
            text: text.trim(),
            isReadByUser: false,
            isReadByAdmin: true,
        });

        const fullMessage = await SupportMessage.findByPk(message.id, {
            include: [
                {
                    model: User,
                    as: "sender",
                    attributes: ["id", "username", "avatar", "role"],
                },
            ],
        });

        await Notification.create({
            userId,
            type: "support_reply",
            title: "Ответ поддержки",
            body: text.trim().slice(0, 200),
            isRead: false,
            data: {
                support: true,
                url: "/support",
            },
        }).catch((e) => {
            console.warn("Не удалось создать Notification support_reply:", e.message);
        });

        await ActionLog.create({
            actorUserId: adminId,
            actorRole: "admin",
            actionType: "support_admin_reply_sent",
            entityType: "message",
            entityId: message.id,
            severity: "info",
            success: true,
            meta: {
                supportUserId: Number(userId),
                textLength: text.trim().length,
            },
        }).catch((e) => {
            console.warn("Не удалось записать ActionLog support_admin_reply_sent:", e.message);
        });

        if (io) {
            io.to(`user_${userId}`).emit("support:reply", {
                userId,
                message: fullMessage,
            });

            io.to(`support_user_${userId}`).emit("support:reply", {
                userId,
                message: fullMessage,
            });

            io.to(`notifications_${userId}`).emit("new_notification", {
                type: "support_reply",
                support: true,
            });

            io.to("admins").emit("support:admin_reply", {
                userId,
                message: fullMessage,
            });
        }

        res.status(201).json(fullMessage);
    } catch (error) {
        console.error("Ошибка ответа поддержки:", error);
        res.status(500).json({
            message: "Ошибка ответа поддержки",
        });
    }
});

/**
 * Админ отметил сообщения пользователя прочитанными
 * PATCH /api/admin/support/chats/:userId/read
 */
router.patch("/chats/:userId/read", authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { userId } = req.params;

        await SupportMessage.update(
            {
                isReadByAdmin: true,
            },
            {
                where: {
                    userId,
                    senderRole: "user",
                    isReadByAdmin: false,
                },
            }
        );

        res.json({ success: true });
    } catch (error) {
        console.error("Ошибка отметки сообщений поддержки прочитанными админом:", error);
        res.status(500).json({
            message: "Ошибка отметки сообщений поддержки прочитанными",
        });
    }
});

module.exports = router;