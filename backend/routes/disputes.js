const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');

const authMiddleware = require('../middlewares/userAuth');
const { Dispute, Order } = require('../models');

// Открыть спор
router.post('/open', authMiddleware, async (req, res) => {
    try {
        const { orderId, reasonCode, reason, description } = req.body;
        const userId = req.user.id;

        if (!orderId || !reasonCode || !reason) {
            return res.status(400).json({
                message: 'orderId, reasonCode и reason обязательны'
            });
        }

        const order = await Order.findByPk(orderId);

        if (!order) {
            return res.status(404).json({ message: 'Заказ не найден' });
        }

        const allowedStatuses = ['active', 'completed'];

        if (!allowedStatuses.includes(order.status)) {
            return res.status(400).json({
                message: 'Спор можно открыть только по активному или завершённому заказу'
            });
        }

        const isCreator = Number(order.creatorId) === Number(userId);
        const isExecutor = Number(order.executorId) === Number(userId);

        if (!isCreator && !isExecutor) {
            return res.status(403).json({
                message: 'Вы не участвуете в этом заказе'
            });
        }

        const existingDispute = await Dispute.findOne({
            where: {
                orderId,
                status: {
                    [Op.in]: ['open', 'in_review', 'waiting_creator', 'waiting_executor']
                }
            }
        });

        if (existingDispute) {
            return res.status(400).json({
                message: 'По этому заказу уже открыт спор'
            });
        }

        const dispute = await Dispute.create({
            orderId: order.id,
            openedById: userId,
            openedByRole: isCreator ? 'creator' : 'executor',
            creatorId: order.creatorId,
            executorId: order.executorId || null,
            reasonCode,
            reason,
            description: description || null,
            status: 'open'
        });

        await ActionLog.create({
            orderId: order.id,
            actorUserId: userId,
            actorRole: isCreator ? 'creator' : 'executor',
            actionType: 'dispute_opened',
            severity: 'warning',
            success: true,
            reason,
            ts: new Date(),
            meta: {
                disputeId: dispute.id,
                reasonCode,
                description: description || null,
                openedByRole: isCreator ? 'creator' : 'executor',
            }
        });

        return res.status(201).json({
            message: 'Спор успешно открыт',
            dispute
        });

    } catch (error) {
        console.error('Ошибка открытия спора:', error);
        return res.status(500).json({ message: 'Ошибка сервера' });
    }
});

// Получить спор по заказу
router.get('/order/:orderId', authMiddleware, async (req, res) => {
    try {
        const { orderId } = req.params;
        const userId = req.user.id;

        const order = await Order.findByPk(orderId);

        if (!order) {
            return res.status(404).json({ message: 'Заказ не найден' });
        }

        const isCreator = Number(order.creatorId) === Number(userId);
        const isExecutor = Number(order.executorId) === Number(userId);

        if (!isCreator && !isExecutor) {
            return res.status(403).json({
                message: 'У вас нет доступа к этому спору'
            });
        }

        const dispute = await Dispute.findOne({
            where: { orderId },
            order: [['id', 'DESC']]
        });

        if (!dispute) {
            return res.status(404).json({ message: 'Спор не найден' });
        }

        return res.json(dispute);

    } catch (error) {
        console.error('Ошибка получения спора:', error);
        return res.status(500).json({ message: 'Ошибка сервера' });
    }
});

module.exports = router;