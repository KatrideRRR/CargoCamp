const { Op } = require("sequelize");

const {
    sequelize,
    Order,
    ExpressOrder,
    User,
} = require("../models");

function fail(status, message) {
    return Object.assign(new Error(message), {
        httpStatus: status,
    });
}

function readArray(value) {
    if (Array.isArray(value)) {
        return value;
    }

    if (value == null || value === "") {
        return [];
    }

    try {
        const result = JSON.parse(value);

        if (Array.isArray(result)) {
            return result;
        }
    } catch {
        // Повреждённые данные не перезаписываем.
    }

    throw fail(
        409,
        "История откликов повреждена. Обратитесь в поддержку."
    );
}

async function createRegularOrderRequest({
                                             orderId,
                                             executorId,
                                             proposedSum,
                                             comment,
                                             availableAt,
                                         }) {
    const id = Number(orderId);
    const workerId = Number(executorId);

    if (
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        !Number.isSafeInteger(workerId) ||
        workerId <= 0
    ) {
        throw fail(400, "Некорректные данные заказа");
    }

    const rawPrice = Number(
        String(proposedSum ?? "")
            .replace(",", ".")
            .trim()
    );

    if (
        !Number.isFinite(rawPrice) ||
        rawPrice <= 0 ||
        rawPrice > 300000
    ) {
        throw fail(
            400,
            "Предложите стоимость от 1 до 300 000 ₽"
        );
    }

    // Сохраняем существующую модель:
    // предложение исполнителя — целые рубли.
    const safePrice = Math.round(rawPrice);

    if (safePrice < 1) {
        throw fail(400, "Минимальное предложение — 1 ₽");
    }

    const safeComment = String(comment || "")
        .trim()
        .slice(0, 1000);

    const rawAvailableAt =
        typeof availableAt === "string"
            ? availableAt.trim()
            : "";

    const parsedAvailableAt = rawAvailableAt
        ? new Date(rawAvailableAt)
        : null;

    if (
        parsedAvailableAt &&
        (
            !Number.isFinite(parsedAvailableAt.getTime()) ||
            parsedAvailableAt.getTime() <= Date.now() ||
            parsedAvailableAt.getTime() >
            Date.now() + 7 * 24 * 60 * 60 * 1000
        )
    ) {
        throw fail(
            400,
            "Укажите время начала в пределах следующих 7 дней"
        );
    }

    return sequelize.transaction(async (transaction) => {
        /*
         * Сначала блокируем исполнителя.
         *
         * Такой же порядок используется
         * при назначении и бронировании:
         * User -> Order.
         */
        const executor = await User.findByPk(workerId, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (!executor) {
            throw fail(404, "Исполнитель не найден");
        }

        const isPremium =
            executor.subscription_type === "premium" &&
            executor.subscription_expires_at &&
            new Date(executor.subscription_expires_at) >
            new Date();

        if (
            !isPremium &&
            Number(executor.debt || 0) > 0
        ) {
            throw fail(
                409,
                "Погасите задолженность по комиссии"
            );
        }

        const order = await Order.findByPk(id, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (!order) {
            throw fail(404, "Заказ не найден");
        }

        if (
            order.status !== "pending" ||
            order.executorId ||
            order.creatorHidden ||
            order.adminDeleted
        ) {
            throw fail(
                409,
                "Заказ больше не принимает отклики"
            );
        }

        if (Number(order.creatorId) === workerId) {
            throw fail(
                403,
                "Нельзя откликаться на собственный заказ"
            );
        }

        const activeRegular = await Order.findOne({
            where: {
                executorId: workerId,
                status: "active",
            },
            transaction,
        });

        const reservedRegular = await Order.findOne({
            where: {
                executorId: workerId,
                status: "reserved",
            },
            transaction,
        });

        if (reservedRegular) {
            throw fail(
                409,
                "У вас уже забронирован следующий заказ"
            );
        }

        const activeExpress = await ExpressOrder.findOne({
            where: {
                executorId: workerId,
                status: {
                    [Op.notIn]: [
                        "created",
                        "completed",
                        "cancelled",
                    ],
                },
            },
            transaction,
        });

        if (activeExpress) {
            throw fail(
                409,
                "Пока выполняется экспресс-заказ, откликнуться нельзя"
            );
        }

        if (activeRegular && !parsedAvailableAt) {
            throw fail(
                409,
                "Укажите время начала следующего заказа"
            );
        }

        const requests = readArray(order.requests);

        if (
            requests.some(
                (item) =>
                    Number(item.executorId) === workerId
            )
        ) {
            throw fail(
                409,
                "Вы уже откликнулись на этот заказ"
            );
        }

        const requestedExecutors = readArray(
            order.requestedExecutors
        );

        requests.push({
            executorId: workerId,
            proposedSum: safePrice,
            comment: safeComment,

            availableAt: parsedAvailableAt
                ? parsedAvailableAt.toISOString()
                : null,

            sourceOrderId: activeRegular?.id || null,
            createdAt: new Date().toISOString(),
        });

        if (
            !requestedExecutors
                .map(Number)
                .includes(workerId)
        ) {
            requestedExecutors.push(workerId);
        }

        order.requests = JSON.stringify(requests);

        order.requestedExecutors =
            JSON.stringify(requestedExecutors);

        await order.save({ transaction });

        return {
            order,
            proposedSum: safePrice,
            comment: safeComment,
            sourceOrderId: activeRegular?.id || null,
        };
    });
}

module.exports = {
    createRegularOrderRequest,
};