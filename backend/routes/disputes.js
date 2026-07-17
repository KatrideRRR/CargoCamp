const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { notifyUser } = require("../services/notificationService");

const authMiddleware = require('../middlewares/userAuth');
const { Dispute, Order, ActionLog } = require('../models');

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

        /*
 * Уведомление получает второй участник заказа.
 *
 * Если спор открыл заказчик — уведомляем исполнителя.
 * Если спор открыл исполнитель — уведомляем заказчика.
 */
        const recipientUserId = isCreator
            ? order.executorId
            : order.creatorId;

        const recipientRole = isCreator
            ? "executor"
            : "creator";

        if (recipientUserId) {
            try {
                await notifyUser({
                    userId: recipientUserId,

                    type: "dispute_opened",

                    title: `Открыт спор по заказу №${order.id}`,

                    body:
                        `Вторая сторона открыла спор по заказу №${order.id}. ` +
                        `Причина: ${reason}`,

                    orderId: order.id,
                    orderType: "regular",

                    data: {
                        disputeId: dispute.id,

                        creatorId: order.creatorId,
                        executorId: order.executorId || "",

                        openedById: userId,
                        openedByRole: isCreator
                            ? "creator"
                            : "executor",

                        recipientRole,

                        reasonCode,
                        reason,
                        status: "open",
                    },
                });
            } catch (notificationError) {
                /*
                 * Спор уже создан, поэтому ошибка уведомления
                 * не должна возвращать пользователю ошибку открытия спора.
                 */
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
            actionType: "dispute_opened",
            entityType: "dispute",
            entityId: dispute.id,
            orderId: order.id,
            severity: "warn",
            success: true,
            reason,
            meta: {
                disputeId: dispute.id,
                reasonCode,
                description: description || null,
                openedByRole: isCreator ? "creator" : "executor",
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
            return res.json({
                success: true,
                dispute: null,
            });
        }

        return res.json({
            success: true,
            dispute,
        });
    } catch (error) {
        console.error('Ошибка получения спора:', error);
        return res.status(500).json({ message: 'Ошибка сервера' });
    }
});

module.exports = router;