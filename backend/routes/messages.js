const express = require("express");
const router = express.Router();
const { Message, User, Notification } = require("../models");
const authenticateToken = require("../middlewares/userAuth");
const { sendNotifications, sendToUser } = require("../socket");
const { notifyUser } = require("../services/notificationService");

router.post("/", authenticateToken, async (req, res) => {
    const { content, receiverId, orderId, orderType = "regular" } = req.body;

    const normalizedOrderType = ["regular", "express"].includes(orderType)
        ? orderType
        : "regular";

    if (!content || !receiverId || !orderId) {
        return res.status(400).json({
            message: "Content, receiverId and orderId are required.",
        });
    }

    const orderIdInt = parseInt(orderId, 10);
    if (isNaN(orderIdInt)) {
        return res.status(400).json({ message: "Invalid orderId" });
    }

    try {
        const message = await Message.create({
            content,
            senderId: req.user.id,
            receiverId,
            orderId: orderIdInt,
            orderType: normalizedOrderType,
        });

        await req.logAction({
            req,
            actorUserId: req.user.id,
            actorRole: "user",
            actionType: "message_sent",
            entityType: "message",
            entityId: message.id,
            orderId: orderIdInt,
            meta: {
                receiverId,
                contentLen: String(content).length,
            },
        });

        const fullMessage = await Message.findByPk(message.id, {
            include: [
                { model: User, as: "sender", attributes: ["id", "username"] },
                { model: User, as: "receiver", attributes: ["id", "username"] },
            ],
        });

        const io = req.app.locals.io;

        io.to(`chat_${normalizedOrderType}_${orderIdInt}`).emit("receiveMessage", fullMessage);
        sendToUser(receiverId, "receiveMessage", fullMessage);

        const existingNotification = await Notification.findOne({
            where: {
                userId: receiverId,
                messageId: message.id,
            },
        });

        if (!existingNotification) {
            await notifyUser({
                userId: receiverId,
                type: "new_message",
                title: "Новое сообщение",
                body: String(content).slice(0, 120),
                orderId: orderIdInt,
                orderType: normalizedOrderType,
                messageId: message.id,
                data: {
                    senderId: req.user.id,
                    receiverId,
                },
            });

            await sendNotifications(receiverId);
        }

        res.status(201).json(fullMessage);
    } catch (error) {
        console.error("Error sending message:", error);
        res.status(500).json({ message: "Server error." });
    }
});

router.get("/:orderType/:orderId", authenticateToken, async (req, res) => {
    const { orderType, orderId } = req.params;

    const normalizedOrderType = ["regular", "express"].includes(orderType)
        ? orderType
        : "regular";

    try {
        const messages = await Message.findAll({
            where: {
                orderId,
                orderType: normalizedOrderType,
            },
            include: [
                { model: User, as: "sender", attributes: ["id", "username", "avatar"] },
                { model: User, as: "receiver", attributes: ["id", "username", "avatar"] },
            ],
            order: [["createdAt", "ASC"]],
        });

        res.json(messages);
    } catch (error) {
        console.error("Error fetching messages:", error);
        res.status(500).json({ message: "Server error." });
    }
});

router.get("/:orderId", authenticateToken, async (req, res) => {
    const { orderId } = req.params;

    try {
        const messages = await Message.findAll({
            where: {
                orderId,
                orderType: "regular",
            },
            include: [
                { model: User, as: "sender", attributes: ["id", "username", "avatar"] },
                { model: User, as: "receiver", attributes: ["id", "username", "avatar"] },
            ],
            order: [["createdAt", "ASC"]],
        });

        res.json(messages);
    } catch (error) {
        console.error("Error fetching messages:", error);
        res.status(500).json({ message: "Server error." });
    }
});

module.exports = router;