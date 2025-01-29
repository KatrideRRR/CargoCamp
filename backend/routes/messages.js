const express = require('express');
const router = express.Router();
const {Message, User} = require('../models');
const authenticateToken = require('../middlewares/authenticateToken');

// Отправка сообщения
router.post('/', authenticateToken, async (req, res) => {
    const {content, receiverId, orderId} = req.body;

    if (!content || !receiverId || !orderId) {
        return res.status(400).json({message: 'Content and receiverId are required.'});
    }

    try {
        const message = await Message.create({content, senderId: req.user.id, receiverId, orderId});

        // Уведомляем получателя

        res.status(201).json(message);
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({message: 'Server error.'});
    }
});

// Получение сообщений для заказа
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
