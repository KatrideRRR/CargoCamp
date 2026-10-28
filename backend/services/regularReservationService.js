const { Op } = require("sequelize");

const {
    sequelize,
    Order,
    ExpressOrder,
    User,
} = require("../models");

function reservationError(status, message) {
    const error = new Error(message);
    error.httpStatus = status;
    return error;
}

function asArray(value) {
    if (Array.isArray(value)) return value;

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    return [];
}

async function reserveRegularOrder({
                                       orderId,
                                       creatorId,
                                       executorId,
                                   }) {
    if (
        !Number.isSafeInteger(Number(orderId)) ||
        !Number.isSafeInteger(Number(executorId)) ||
        Number(orderId) <= 0 ||
        Number(executorId) <= 0
    ) {
        throw reservationError(400, "Некорректные данные заказа");
    }

    return sequelize.transaction(async (transaction) => {
        // Блокировка исполнителя защищает от двух
        // одновременных предварительных бронирований.
        const executor = await User.findByPk(executorId, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (!executor) {
            throw reservationError(404, "Исполнитель не найден");
        }

        const order = await Order.findByPk(orderId, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (!order) {
            throw reservationError(404, "Заказ не найден");
        }

        if (Number(order.creatorId) !== Number(creatorId)) {
            throw reservationError(403, "Вы не заказчик");
        }

        if (
            order.status !== "pending" ||
            order.executorId ||
            order.creatorHidden ||
            order.adminDeleted
        ) {
            throw reservationError(
                409,
                "Заказ уже недоступен для бронирования"
            );
        }

        if (order.paymentType !== "cash") {
            throw reservationError(
                409,
                "Предварительное бронирование пока доступно только для оплаты наличными"
            );
        }

        const hasPremium =
            executor.subscription_type === "premium" &&
            executor.subscription_expires_at &&
            new Date(executor.subscription_expires_at) > new Date();

        if (!hasPremium && Number(executor.debt || 0) > 0) {
            throw reservationError(
                409,
                "У исполнителя есть задолженность по комиссии"
            );
        }

        const activeOrders = await Order.findAll({
            where: {
                executorId,
                status: "active",
            },
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (activeOrders.length !== 1) {
            throw reservationError(
                409,
                "У исполнителя нет ровно одного текущего обычного заказа"
            );
        }

        const activeOrder = activeOrders[0];

        const existingReservation = await Order.findOne({
            where: {
                executorId,
                status: "reserved",
            },
            transaction,
        });

        if (existingReservation) {
            throw reservationError(
                409,
                "У исполнителя уже забронирован следующий заказ"
            );
        }

        const activeExpress = await ExpressOrder.findOne({
            where: {
                executorId,
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
            throw reservationError(
                409,
                "Нельзя бронировать обычный заказ при активном экспресс-заказе"
            );
        }

        const requestedIds = asArray(order.requestedExecutors);
        const requests = asArray(order.requests);

        const request = requests.find(
            (item) =>
                Number(item.executorId) === Number(executorId)
        );

        if (
            !requestedIds.map(Number).includes(Number(executorId)) ||
            !request
        ) {
            throw reservationError(
                409,
                "Предложение исполнителя не найдено"
            );
        }

        if (
            Number(request.sourceOrderId) !==
            Number(activeOrder.id)
        ) {
            throw reservationError(
                409,
                "Данные о текущем заказе исполнителя устарели"
            );
        }

        const availableAt = request.availableAt
            ? new Date(request.availableAt)
            : null;

        if (
            !availableAt ||
            !Number.isFinite(availableAt.getTime()) ||
            availableAt.getTime() <= Date.now() ||
            availableAt.getTime() >
            Date.now() + 7 * 24 * 60 * 60 * 1000
        ) {
            throw reservationError(
                409,
                "Указанное исполнителем время уже неактуально"
            );
        }

        const price = Number(request.proposedSum);

        if (!Number.isFinite(price) || price <= 0) {
            throw reservationError(
                400,
                "Некорректная цена предложения"
            );
        }

        order.executorId = Number(executorId);
        order.status = "reserved";
        order.finalPriceKopecks = Math.round(price * 100);

        order.reservationSourceOrderId = activeOrder.id;
        order.reservationAvailableAt = availableAt;
        order.reservationApprovedAt = new Date();
        order.reservationReadyAt = null;

        await order.save({ transaction });

        return {
            id: order.id,
            status: order.status,
            creatorId: order.creatorId,
            executorId: order.executorId,
            reservationSourceOrderId:
            order.reservationSourceOrderId,
            reservationAvailableAt:
            order.reservationAvailableAt,
        };
    });
}

async function cancelRegularReservation({
                                            orderId,
                                            userId,
                                        }) {
    return sequelize.transaction(async (transaction) => {
        const snapshot = await Order.findByPk(orderId, {
            transaction,
        });

        if (!snapshot) {
            throw reservationError(404, "Заказ не найден");
        }

        if (!snapshot.executorId) {
            throw reservationError(
                409,
                "У заказа нет забронированного исполнителя"
            );
        }

        await User.findByPk(snapshot.executorId, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        const order = await Order.findByPk(orderId, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (
            !order ||
            order.status !== "reserved"
        ) {
            throw reservationError(
                409,
                "Этот заказ уже не забронирован"
            );
        }

        if (
            Number(userId) !== Number(order.creatorId) &&
            Number(userId) !== Number(order.executorId)
        ) {
            throw reservationError(
                403,
                "Отменить бронь может только участник заказа"
            );
        }

        const previousExecutorId = order.executorId;
        const creatorId = order.creatorId;

// Убираем отклик исполнителя, чья бронь отменена.
// Предложения остальных исполнителей сохраняем.
        const remainingRequests = asArray(order.requests).filter(
            (item) =>
                Number(item.executorId) !==
                Number(previousExecutorId)
        );

        const remainingExecutors = asArray(
            order.requestedExecutors
        ).filter(
            (id) =>
                Number(id) !==
                Number(previousExecutorId)
        );

        order.status = "pending";
        order.executorId = null;
        order.finalPriceKopecks = 0;

        order.reservationSourceOrderId = null;
        order.reservationAvailableAt = null;
        order.reservationApprovedAt = null;
        order.reservationReadyAt = null;

        order.requests = JSON.stringify(remainingRequests);
        order.requestedExecutors = JSON.stringify(
            remainingExecutors
        );

        await order.save({ transaction });

        return {
            id: order.id,
            status: order.status,
            creatorId,
            executorId: previousExecutorId,
        };
    });
}

async function assertReservationActivationAllowed({
                                                      order,
                                                      executorId,
                                                      approvedSum,
                                                  }) {
    if (
        order.status !== "reserved" ||
        Number(order.executorId) !== Number(executorId)
    ) {
        throw reservationError(
            409,
            "Заказ не забронирован за вами"
        );
    }

    if (order.paymentType !== "cash") {
        throw reservationError(
            409,
            "Активация этой брони недоступна"
        );
    }

    const sourceOrderId = Number(
        order.reservationSourceOrderId
    );

    if (
        !Number.isSafeInteger(sourceOrderId) ||
        sourceOrderId <= 0
    ) {
        throw reservationError(
            409,
            "Не найден предыдущий заказ исполнителя"
        );
    }

    const sourceOrder = await Order.findByPk(sourceOrderId, {
        attributes: [
            "id",
            "status",
            "executorId",
        ],
    });

    if (
        !sourceOrder ||
        Number(sourceOrder.executorId) !==
        Number(executorId) ||
        sourceOrder.status !== "completed"
    ) {
        throw reservationError(
            409,
            "Сначала полностью завершите предыдущий заказ"
        );
    }

    if (
        Math.round(Number(approvedSum) * 100) !==
        Number(order.finalPriceKopecks)
    ) {
        throw reservationError(
            409,
            "Цена бронирования отличается от согласованной"
        );
    }

    return true;
}

module.exports = {
    reserveRegularOrder,
    cancelRegularReservation,
    assertReservationActivationAllowed,
};