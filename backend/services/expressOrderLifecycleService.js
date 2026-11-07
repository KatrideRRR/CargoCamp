const {
    sequelize,
    ExpressOrder,
} = require("../models");

function fail(status, message) {
    return Object.assign(new Error(message), {
        httpStatus: status,
    });
}

function validId(value) {
    const id = Number(value);

    return Number.isSafeInteger(id) && id > 0
        ? id
        : null;
}

/**
 * Безопасный переход между этапами выполнения.
 *
 * Блокировка строки действует до COMMIT.
 * Конкурентные запросы увидят актуальный статус
 * и не смогут перезаписать друг друга.
 */
async function advanceExpressOrder({
                                       orderId,
                                       executorId,
                                       fromStatuses = [],
                                       allowedStatusesByType = null,
                                       targetStatus,
                                       expressType = null,
                                       timestampField = null,
                                   }) {
    const id = validId(orderId);
    const userId = validId(executorId);

    if (!id || !userId) {
        throw fail(400, "Некорректные данные заказа");
    }

    return sequelize.transaction(async (transaction) => {
        const order = await ExpressOrder.findByPk(id, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (!order) {
            throw fail(404, "Заказ не найден");
        }

        if (Number(order.executorId) !== userId) {
            throw fail(
                403,
                "Изменять выполнение может только исполнитель"
            );
        }

        if (
            expressType &&
            order.type !== expressType
        ) {
            throw fail(
                409,
                "Этот этап недоступен для данного типа заказа"
            );
        }

        const allowed = allowedStatusesByType
            ? allowedStatusesByType[order.type]
            : fromStatuses;

        if (
            !Array.isArray(allowed) ||
            !allowed.includes(order.status)
        ) {
            throw fail(
                409,
                `Нельзя выполнить действие из статуса ${order.status}`
            );
        }

        const from = order.status;

        order.status = targetStatus;

        if (timestampField) {
            order[timestampField] = new Date();
        }

        await order.save({ transaction });

        return {
            order,
            from,
        };
    });
}

/**
 * Отмена заказа заказчиком или исполнителем.
 * Используем ту же блокировку строки,
 * что и при переходах статусов.
 */
async function cancelExpressOrder({
                                      orderId,
                                      userId,
                                  }) {
    const id = validId(orderId);
    const actorId = validId(userId);

    if (!id || !actorId) {
        throw fail(400, "Некорректные данные отмены");
    }

    return sequelize.transaction(async (transaction) => {
        const order = await ExpressOrder.findByPk(id, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (!order) {
            throw fail(404, "Заказ не найден");
        }

        const byCreator =
            Number(order.creatorId) === actorId;

        const byExecutor =
            Number(order.executorId) === actorId;

        if (!byCreator && !byExecutor) {
            throw fail(403, "Нет доступа к заказу");
        }

        if (
            order.status === "completed" ||
            order.status === "cancelled"
        ) {
            throw fail(
                409,
                "Заказ уже завершён или отменён"
            );
        }

        const creatorAllowed = [
            "created",
            "accepted",
            "on_the_way_to_A",
            "arrived_at_A",
            "waiting_at_A",
        ];

        const executorAllowed = [
            "accepted",
            "on_the_way_to_A",
            "arrived_at_A",
            "waiting_at_A",
        ];

        const allowed = byCreator
            ? creatorAllowed
            : executorAllowed;

        if (!allowed.includes(order.status)) {
            throw fail(
                409,
                `Отмена недоступна из статуса ${order.status}`
            );
        }

        const from = order.status;
        const cancelledAt = new Date();

        order.status = "cancelled";
        order.dealStatus = "cancelled";

        await order.save({ transaction });

        return {
            order,
            from,
            cancelledAt,
            cancelledByRole:
                byCreator ? "creator" : "executor",
        };
    });
}

module.exports = {
    advanceExpressOrder,
    cancelExpressOrder,
};