
const { Op } = require("sequelize");

const {
    sequelize,
    Order,
    Dispute,
    OrderChangeRequest,
    OrderCompletionDecision,
    OrderCompletionCorrection,
} = require("../models");

const ACTIVE_DISPUTES = [
    "open",
    "in_review",
    "waiting_creator",
    "waiting_executor",
];

function fail(status, message) {
    return Object.assign(
        new Error(message),
        { httpStatus: status }
    );
}

function completedIds(order) {
    const value = order.completedBy;

    if (Array.isArray(value)) {
        return value.map(Number);
    }

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);

            return Array.isArray(parsed)
                ? parsed.map(Number)
                : [];
        } catch {
            return [];
        }
    }

    return [];
}

function bothConfirmed(order) {
    const ids = completedIds(order);

    return (
        ids.includes(Number(order.creatorId)) &&
        ids.includes(Number(order.executorId))
    );
}

function roleOf(order, userId) {
    if (Number(order.creatorId) === userId) {
        return "creator";
    }

    if (Number(order.executorId) === userId) {
        return "executor";
    }

    throw fail(403, "Вы не участник заказа");
}

async function assertNoActiveDispute(orderId, transaction) {
    const dispute = await Dispute.findOne({
        where: {
            orderId,
            orderType: "regular",
            status: {
                [Op.in]: ACTIVE_DISPUTES,
            },
        },
        transaction,
    });

    if (dispute) {
        throw fail(
            409,
            "По заказу открыт спор. Приёмка без замечаний недоступна."
        );
    }
}

async function getCompletionPhase(order, transaction = null) {
    if (order.status === "completed") {
        return "completed";
    }

    if (!bothConfirmed(order)) {
        return completedIds(order).length
            ? "awaiting_other"
            : "in_progress";
    }

    const decision = await OrderCompletionDecision.findOne({
        where: {
            orderId: order.id,
            userId: order.creatorId,
        },
        transaction,
    });

    if (decision?.qualityDecision !== "remarks") {
        return "in_progress";
    }

    const last = await OrderCompletionCorrection.findOne({
        where: { orderId: order.id },
        order: [["id", "DESC"]],
        transaction,
    });

    return last?.eventType === "submitted"
        ? "awaiting_review"
        : "needs_correction";
}

function parseCash(order, completion) {
    if (order.paymentType !== "cash") {
        return {
            cashStatus: null,
            cashAmountKopecks: null,
        };
    }

    const cashStatus = completion.cashStatus;

    if (!["full", "partial", "none"].includes(cashStatus)) {
        throw fail(400, "Укажите состояние оплаты");
    }

    const fullAmount =
        Number(order.finalPriceKopecks) > 0
            ? Number(order.finalPriceKopecks)
            : Math.round(Number(order.proposedSum || 0) * 100);

    if (
        !Number.isSafeInteger(fullAmount) ||
        fullAmount <= 0
    ) {
        throw fail(409, "Некорректная стоимость заказа");
    }

    let amount = 0;

    if (cashStatus === "full") {
        amount = fullAmount;
    }

    if (cashStatus === "partial") {
        amount = completion.cashAmountKopecks;

        if (
            !Number.isSafeInteger(amount) ||
            amount <= 0 ||
            amount >= fullAmount
        ) {
            throw fail(400, "Некорректная сумма частичной оплаты");
        }
    }

    return {
        cashStatus,
        cashAmountKopecks: amount,
    };
}

async function submitInitialCompletion({
                                           orderId,
                                           userId,
                                           completion,
                                           ipAddress,
                                           userAgent,
                                       }) {
    return sequelize.transaction(async (transaction) => {
        const order = await Order.findByPk(orderId, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (!order) {
            throw fail(404, "Заказ не найден");
        }

        const role = roleOf(order, userId);

        const existing = await OrderCompletionDecision.findOne({
            where: { orderId, userId },
            transaction,
        });

        // Повторный запрос не создаёт новую запись.
        if (existing) {
            if (!completedIds(order).includes(userId)) {
                throw fail(
                    409,
                    "Обнаружено несогласованное состояние подтверждения"
                );
            }

            return {
                orderId,
                changed: false,
                completed: order.status === "completed",
                phase: await getCompletionPhase(order, transaction),
            };
        }

        if (order.status !== "active") {
            throw fail(409, "Заказ уже не находится в работе");
        }

        if (bothConfirmed(order)) {
            throw fail(
                409,
                "Первоначальное завершение уже подтверждено обеими сторонами"
            );
        }

        if (completion?.workConfirmed !== true) {
            throw fail(400, "Подтвердите завершение работы");
        }

        const pendingChange = await OrderChangeRequest.findOne({
            where: {
                orderId,
                status: {
                    [Op.in]: [
                        "pending",
                        "approved_pending_agreement",
                    ],
                },
            },
            transaction,
        });

        if (pendingChange) {
            throw fail(
                409,
                "Сначала завершите согласование дополнительных работ"
            );
        }

        const qualityDecision = role === "creator"
            ? completion.qualityDecision
            : null;

        if (
            role === "creator" &&
            !["accepted", "remarks"].includes(qualityDecision)
        ) {
            throw fail(400, "Выберите результат приёмки");
        }

        const remarks = role === "creator" &&
        qualityDecision === "remarks"
            ? String(completion.remarks || "").trim()
            : null;

        if (
            remarks !== null &&
            (remarks.length < 10 || remarks.length > 1500)
        ) {
            throw fail(
                400,
                "Опишите замечания: от 10 до 1500 символов"
            );
        }

        if (
            role === "creator" &&
            qualityDecision === "accepted"
        ) {
            await assertNoActiveDispute(orderId, transaction);
        }

        const cash = parseCash(order, completion);
        const now = new Date();

        // Гарантийные выплаты отключены.
        // Завершение заказа не разрешает и не
        // осуществляет финансовую операцию.
        if (completion.payoutAuthorized === true) {
            throw fail(
                409,
                "Гарантийные выплаты временно недоступны"
            );
        }

        await OrderCompletionDecision.create(
            {
                orderId,
                userId,
                partyRole: role,
                qualityDecision,
                remarks,
                ...cash,
                payoutAuthorized: false,
                confirmedAt: now,
                ipAddress: String(ipAddress || "").slice(0, 64),
                userAgent: String(userAgent || "").slice(0, 1000),
            },
            { transaction }
        );

        const ids = completedIds(order);

        order.completedBy = [...new Set([...ids, userId])];

        if (order.workStartedAt && !order.workEndedAt) {
            order.workEndedAt = now;
            order.workEndedBy = userId;
        }

        if (bothConfirmed(order)) {
            const customer = await OrderCompletionDecision.findOne({
                where: {
                    orderId,
                    userId: order.creatorId,
                },
                transaction,
            });

            if (customer?.qualityDecision === "accepted") {
                await assertNoActiveDispute(orderId, transaction);

                order.status = "completed";
                order.completedAt = now;
            }
        }

        await order.save({ transaction });

        return {
            orderId,
            changed: true,
            completed: order.status === "completed",
            phase: await getCompletionPhase(order, transaction),
        };
    });
}

async function submitCorrectionAction({
                                          orderId,
                                          userId,
                                          action,
                                          decision,
                                          comment,
                                      }) {
    return sequelize.transaction(async (transaction) => {
        const order = await Order.findByPk(orderId, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (!order) {
            throw fail(404, "Заказ не найден");
        }

        const role = roleOf(order, userId);

        if (
            order.status !== "active" ||
            !bothConfirmed(order)
        ) {
            throw fail(
                409,
                "Исправления недоступны на текущем этапе"
            );
        }

        const initial = await OrderCompletionDecision.findOne({
            where: {
                orderId,
                userId: order.creatorId,
                qualityDecision: "remarks",
            },
            transaction,
        });

        if (!initial) {
            throw fail(409, "Первоначальные замечания не найдены");
        }

        const last = await OrderCompletionCorrection.findOne({
            where: { orderId },
            order: [["id", "DESC"]],
            transaction,
        });

        const phase = last?.eventType === "submitted"
            ? "awaiting_review"
            : "needs_correction";

        const text = String(comment || "").trim();

        if (text.length > 1500) {
            throw fail(400, "Комментарий слишком длинный");
        }

        let eventType;
        let roundNumber;

        if (action === "submit") {
            if (role !== "executor" || phase !== "needs_correction") {
                throw fail(409, "Нельзя отправить исправления");
            }

            if (text.length < 10) {
                throw fail(400, "Опишите выполненные исправления");
            }

            eventType = "submitted";
            roundNumber = last
                ? Number(last.roundNumber) + 1
                : 1;
        } else if (action === "review") {
            if (role !== "creator" || phase !== "awaiting_review") {
                throw fail(409, "Исправления пока недоступны для проверки");
            }

            if (!["accepted", "rejected"].includes(decision)) {
                throw fail(400, "Укажите решение заказчика");
            }

            if (decision === "rejected" && text.length < 10) {
                throw fail(400, "Укажите оставшиеся замечания");
            }

            if (decision === "accepted") {
                await assertNoActiveDispute(orderId, transaction);
            }

            eventType = decision;
            roundNumber = Number(last.roundNumber);
        } else {
            throw fail(400, "Неизвестное действие");
        }

        await OrderCompletionCorrection.create(
            {
                orderId,
                roundNumber,
                eventType,
                actorUserId: userId,
                comment: text || null,
                eventAt: new Date(),
            },
            { transaction }
        );

        if (eventType === "accepted") {
            order.status = "completed";
            order.completedAt = new Date();
            await order.save({ transaction });
        }

        return {
            orderId,
            changed: true,
            completed: eventType === "accepted",
            phase: eventType === "submitted"
                ? "awaiting_review"
                : eventType === "rejected"
                    ? "needs_correction"
                    : "completed",
        };
    });
}

module.exports = {
    getCompletionPhase,
    submitInitialCompletion,
    submitCorrectionAction,
};
