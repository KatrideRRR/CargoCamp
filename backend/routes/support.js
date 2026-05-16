const express = require("express");
const router = express.Router();

const authenticateToken = require("../middlewares/userAuth");
const { SupportMessage, User, Notification, ActionLog } = require("../models");

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
        const { text } = req.body;

        if (!text || !text.trim()) {
            return res.status(400).json({
                message: "Сообщение не может быть пустым",
            });
        }

        const message = await SupportMessage.create({
            userId,
            senderId: userId,
            senderRole: "user",
            text: text.trim(),
            isReadByUser: true,
            isReadByAdmin: false,
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
                textLength: text.trim().length,
            },
        }).catch((e) => {
            console.warn("Не удалось записать ActionLog support_message_sent:", e.message);
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

        res.status(201).json(fullMessage);
    } catch (error) {
        console.error("Ошибка отправки сообщения в поддержку:", error);
        res.status(500).json({
            message: "Ошибка отправки сообщения в поддержку",
        });
    }
});

/**
 * Пользователь отметил ответы поддержки прочитанными
 * PATCH /api/support/read
 */
router.patch("/read", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        await SupportMessage.update(
            {
                isReadByUser: true,
            },
            {
                where: {
                    userId,
                    senderRole: "admin",
                    isReadByUser: false,
                },
            }
        );

        res.json({ success: true });
    } catch (error) {
        console.error("Ошибка отметки сообщений поддержки прочитанными:", error);
        res.status(500).json({
            message: "Ошибка отметки сообщений поддержки прочитанными",
        });
    }
});

module.exports = router;