
const express = require("express");
const { Op } = require("sequelize");

const authenticateToken =
    require("../middlewares/userAuth");

const { notifyUser } =
    require("../services/notificationService");

const {
    sequelize,
    Order,
    OrderChangeRequest,
    Dispute,
} = require("../models");

const router = express.Router();

router.use(authenticateToken);

const PENDING_STATUSES = [
    "pending",
    "approved_pending_agreement",
];

const ACTIVE_DISPUTE_STATUSES = [
    "open",
    "in_review",
    "waiting_creator",
    "waiting_executor",
];

function fail(status, message) {
    return Object.assign(new Error(message), {
        httpStatus: status,
    });
}

function respondError(res, error) {
    if (error.httpStatus) {
        return res.status(error.httpStatus).json({
            success: false,
            message: error.message,
        });
    }

    console.error("Order changes error:", error);

    return res.status(500).json({
        success: false,
        message: "Ошибка обработки изменений заказа",
    });
}

function parseId(value) {
    const text = String(value || "");

    if (!/^[1-9]\d*$/.test(text)) {
        throw fail(400, "Некорректный ID");
    }

    const id = Number(text);

    if (!Number.isSafeInteger(id)) {
        throw fail(400, "Некорректный ID");
    }

    return id;
}

function parsePriceRub(value) {
    const text = String(value ?? "")
        .trim()
        .replace(",", ".");

    if (!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(text)) {
        throw fail(400, "Укажите корректную стоимость в рублях");
    }

    const [rub, kopecks = ""] = text.split(".");

    const result =
        Number(rub) * 100 +
        Number(kopecks.padEnd(2, "0"));

    if (result < 100 || result > 1_000_000_000) {
        throw fail(
            400,
            "Допустимая стоимость: от 1 до 10 000 000 ₽"
        );
    }

    return result;
}

function currentPrice(order) {
    const price = Number(order.finalPriceKopecks);

    if (Number.isSafeInteger(price) && price > 0) {
        return price;
    }

    return Math.round(Number(order.proposedSum || 0) * 100);
}

function assertParticipant(order, userId) {
    if (
        !order ||
        (
            Number(order.creatorId) !== userId &&
            Number(order.executorId) !== userId
        )
    ) {
        throw fail(404, "Заказ не найден");
    }
}

function assertEditable(order) {
    if (order.status !== "active") {
        throw fail(409, "Изменять можно только активный заказ");
    }

    if (order.paymentType !== "cash") {
        throw fail(
            409,
            "Изменение цены пока доступно только для наличной оплаты"
        );
    }

    if (
        Array.isArray(order.completedBy) &&
        order.completedBy.length > 0
    ) {
        throw fail(
            409,
            "Один из участников уже подтвердил завершение заказа"
        );
    }
}

async function assertNoActiveDispute(orderId, transaction) {
    const dispute = await Dispute.findOne({
        where: {
            orderId,
            orderType: "regular",
            status: {
                [Op.in]: ACTIVE_DISPUTE_STATUSES,
            },
        },
        transaction,
    });

    if (dispute) {
        throw fail(
            409,
            "По заказу есть активный спор. Изменения недоступны."
        );
    }
}

function notifyAndRefresh(req, order, recipientId, type, title, body) {
    const io = req.app.locals.io;

    if (io) {
        for (const id of new Set([
            Number(order.creatorId),
            Number(order.executorId),
        ])) {
            io.to(`user_${id}`).emit("activeOrdersUpdated", {
                orderId: order.id,
                orderType: "regular",
            });
        }
    }

    notifyUser({
        userId: recipientId,
        type,
        title,
        body,
        orderId: order.id,
        orderType: "regular",
        data: {
            creatorId: order.creatorId,
            executorId: order.executorId,
        },
    }).catch((error) => {
        console.error("Order change notification:", error);
    });
}

// Получение истории предложений по заказу
router.get("/order/:orderId", async (req, res) => {
    try {
        const orderId = parseId(req.params.orderId);
        const userId = Number(req.user.id);

        const order = await Order.findByPk(orderId);
        assertParticipant(order, userId);

        const changes = await OrderChangeRequest.findAll({
            where: { orderId },
            order: [["id", "DESC"]],
            limit: 30,
        });

        return res.json({
            success: true,
            changes,
        });
    } catch (error) {
        return respondError(res, error);
    }
});

// Предложение дополнительной работы и новой цены
router.post("/order/:orderId", async (req, res) => {
    try {
        const orderId = parseId(req.params.orderId);
        const userId = Number(req.user.id);

        const additionalWork =
            String(req.body?.additionalWork || "").trim();

        if (
            additionalWork.length < 10 ||
            additionalWork.length > 2000
        ) {
            throw fail(
                400,
                "Описание дополнительных работ: от 10 до 2000 символов"
            );
        }

        const proposedPriceKopecks =
            parsePriceRub(req.body?.newPriceRub);

        const result = await sequelize.transaction(
            async (transaction) => {
                const order = await Order.findByPk(orderId, {
                    transaction,
                    lock: transaction.LOCK.UPDATE,
                });

                assertParticipant(order, userId);
                assertEditable(order);

                await assertNoActiveDispute(orderId, transaction);

                const existing = await OrderChangeRequest.findOne({
                    where: {
                        orderId,
                        status: {
                            [Op.in]: PENDING_STATUSES,
                        },
                    },
                    transaction,
                });

                if (existing) {
                    throw fail(
                        409,
                        "Сначала завершите согласование предыдущего предложения"
                    );
                }

                const basePriceKopecks = currentPrice(order);

                if (
                    !Number.isSafeInteger(basePriceKopecks) ||
                    basePriceKopecks <= 0
                ) {
                    throw fail(409, "У заказа некорректная стоимость");
                }

                const change = await OrderChangeRequest.create(
                    {
                        orderId,
                        proposedById: userId,
                        basePriceKopecks,
                        proposedPriceKopecks,
                        additionalWork,
                        status: "pending",
                    },
                    { transaction }
                );

                return { order, change };
            }
        );

        const recipientId =
            Number(result.order.creatorId) === userId
                ? result.order.executorId
                : result.order.creatorId;

        notifyAndRefresh(
            req,
            result.order,
            recipientId,
            "order_change_proposed",
            "Предложены изменения заказа",
            `По заказу №${orderId} предложены дополнительные работы и новая стоимость`
        );

        return res.status(201).json({
            success: true,
            change: result.change,
        });
    } catch (error) {
        return respondError(res, error);
    }
});

// Ответ второй стороны или отмена своего предложения
router.post("/:changeId/respond", async (req, res) => {
    try {
        const changeId = parseId(req.params.changeId);
        const userId = Number(req.user.id);
        const decision = String(req.body?.decision || "");

        if (!["approve", "reject", "cancel"].includes(decision)) {
            throw fail(400, "Некорректное решение");
        }

        const initial = await OrderChangeRequest.findByPk(changeId);

        if (!initial) {
            throw fail(404, "Предложение не найдено");
        }

        const result = await sequelize.transaction(
            async (transaction) => {
                // Сначала блокируем заказ, затем предложение.
                const order = await Order.findByPk(initial.orderId, {
                    transaction,
                    lock: transaction.LOCK.UPDATE,
                });

                assertParticipant(order, userId);
                assertEditable(order);

                const change = await OrderChangeRequest.findByPk(
                    changeId,
                    {
                        transaction,
                        lock: transaction.LOCK.UPDATE,
                    }
                );

                if (!change || change.status !== "pending") {
                    throw fail(
                        409,
                        "Предложение уже обработано"
                    );
                }

                const isAuthor =
                    Number(change.proposedById) === userId;

                if (decision === "cancel" && !isAuthor) {
                    throw fail(
                        403,
                        "Отменить предложение может только автор"
                    );
                }

                if (decision !== "cancel" && isAuthor) {
                    throw fail(
                        403,
                        "На предложение должен ответить второй участник"
                    );
                }

                if (decision === "approve") {
                    await assertNoActiveDispute(order.id, transaction);

                    if (
                        currentPrice(order) !==
                        Number(change.basePriceKopecks)
                    ) {
                        throw fail(
                            409,
                            "Стоимость заказа изменилась. Создайте новое предложение."
                        );
                    }
                }

                change.status =
                    decision === "approve"
                        ? "approved_pending_agreement"
                        : decision === "reject"
                            ? "rejected"
                            : "cancelled";

                change.respondedById = userId;
                change.respondedAt = new Date();

                await change.save({ transaction });

                return { order, change };
            }
        );

        const recipientId =
            Number(result.order.creatorId) === userId
                ? result.order.executorId
                : result.order.creatorId;

        notifyAndRefresh(
            req,
            result.order,
            recipientId,
            `order_change_${decision}`,
            decision === "approve"
                ? "Изменения предварительно согласованы"
                : "Ответ на предложение по заказу",
            decision === "approve"
                ? `Предложение по заказу №${result.order.id} согласовано. Ожидается дополнительное соглашение.`
                : `Получен ответ на предложение по заказу №${result.order.id}`
        );

        return res.json({
            success: true,
            change: result.change,
        });
    } catch (error) {
        return respondError(res, error);
    }
});

module.exports = router;
