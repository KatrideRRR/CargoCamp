const express = require('express');
const router = express.Router();
const {Message, User} = require('../models');
const authenticateToken = require('../middlewares/userAuth');

router.post('/', authenticateToken, async (req, res) => {
    const {content, receiverId, orderId} = req.body;

    if (!content || !receiverId || !orderId) {
        return res.status(400).json({message: 'Content and receiverId are required.'});
    }

    const orderIdInt = parseInt(orderId, 10);
    if (isNaN(orderIdInt)) {
        return res.status(400).json({ message: 'Invalid orderId' });
    }


    try {
        const message = await Message.create({content, senderId: req.user.id, receiverId, orderId: orderIdInt});

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

        // Уведомляем получателя

        res.status(201).json(message);
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({message: 'Server error.'});
    }
});

router.get('/:orderId', authenticateToken, async (req, res) => {
    const {orderId} = req.params;

    try {
        const messages = await Message.findAll({
            where: {orderId},
            include: [
                {model: User, as: 'sender', attributes: ['id', 'username']},
                {model: User, as: 'receiver', attributes: ['id', 'username']},
            ],
            order: [['createdAt', 'ASC']],
        });
        res.json(messages);
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({message: 'Server error.'});
    }
});

module.exports = router;
