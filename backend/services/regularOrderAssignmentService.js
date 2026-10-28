const { Op } = require("sequelize");

const {
    sequelize,
    Order,
    ExpressOrder,
    User,
} = require("../models");

const {
    accrueOrderCommissionOnce,
} = require("./orderCommissionService");

function fail(status, message) {
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

/**
 * Атомарное назначение наличного обычного заказа.
 *
 * Для бронирования:
 * reserved -> active только после завершения
 * предыдущего заказа.
 *
 * Для обычного одобрения:
 * pending -> active.
 *
 * Назначение и комиссия — одна транзакция.
 */
async function assignCashRegularOrder({
                                          orderId,
                                          actorUserId,
                                          executorId,
                                          activation = false,
                                      }) {
    const id = Number(orderId);
    const actorId = Number(actorUserId);
    const workerId = Number(executorId);

    if (
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        !Number.isSafeInteger(actorId) ||
        actorId <= 0 ||
        !Number.isSafeInteger(workerId) ||
        workerId <= 0
    ) {
        throw fail(400, "Некорректные данные назначения");
    }

    return sequelize.transaction(async (transaction) => {
        // Главная блокировка — исполнитель.
        // Все новые назначения наличных обычных
        // заказов проходят через неё.
        const executor = await User.findByPk(workerId, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (!executor) {
            throw fail(404, "Исполнитель не найден");
        }

        const order = await Order.findByPk(id, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (!order) {
            throw fail(404, "Заказ не найден");
        }

        if (order.paymentType !== "cash") {
            throw fail(
                409,
                "Этот способ назначения доступен только для наличных заказов"
            );
        }

        if (Number(order.creatorId) === workerId) {
            throw fail(
                403,
                "Нельзя выполнять собственный заказ"
            );
        }

        if (order.creatorHidden || order.adminDeleted) {
            throw fail(409, "Заказ недоступен");
        }

        if (activation) {
            if (actorId !== workerId) {
                throw fail(
                    403,
                    "Активировать бронь может только исполнитель"
                );
            }

            if (
                order.status !== "reserved" ||
                Number(order.executorId) !== workerId
            ) {
                throw fail(
                    409,
                    "Бронирование уже изменено или отменено"
                );
            }
        } else {
            if (Number(order.creatorId) !== actorId) {
                throw fail(
                    403,
                    "Назначить исполнителя может только заказчик"
                );
            }

            if (
                order.status !== "pending" ||
                order.executorId
            ) {
                throw fail(
                    409,
                    "Заказ уже назначен или недоступен"
                );
            }
        }

        const requested = asArray(
            order.requestedExecutors
        ).map(Number);

        const requests = asArray(order.requests);

        const matchedRequest = requests.find(
            (item) =>
                Number(item.executorId) === workerId
        );

        if (
            !requested.includes(workerId) ||
            !matchedRequest
        ) {
            throw fail(
                409,
                "Подтверждённый отклик исполнителя не найден"
            );
        }

        const price = Number(
            String(matchedRequest.proposedSum ?? "")
                .replace(",", ".")
                .trim()
        );

        if (
            !Number.isFinite(price) ||
            price <= 0
        ) {
            throw fail(
                409,
                "Некорректная стоимость заказа"
            );
        }

        const priceKopecks =
            Math.round(price * 100);

        if (
            !Number.isSafeInteger(priceKopecks) ||
            priceKopecks <= 0 ||
            priceKopecks > 2147483647
        ) {
            throw fail(
                409,
                "Стоимость заказа выходит за допустимые пределы"
            );
        }

        // Бронь обязана относиться к тому заказу,
        // который исполнитель выполнял ранее.
        if (activation) {
            const sourceId = Number(
                order.reservationSourceOrderId
            );

            if (
                !Number.isSafeInteger(sourceId) ||
                sourceId <= 0
            ) {
                throw fail(
                    409,
                    "Не найден предыдущий заказ"
                );
            }

            const sourceOrder = await Order.findByPk(
                sourceId,
                { transaction }
            );

            if (
                !sourceOrder ||
                sourceOrder.status !== "completed" ||
                Number(sourceOrder.executorId) !== workerId
            ) {
                throw fail(
                    409,
                    "Сначала полностью завершите предыдущий заказ"
                );
            }

            if (
                Number(order.finalPriceKopecks) !==
                priceKopecks
            ) {
                throw fail(
                    409,
                    "Стоимость бронирования изменилась"
                );
            }

            if (
                Number(matchedRequest.sourceOrderId) !==
                sourceId
            ) {
                throw fail(
                    409,
                    "Бронирование связано с другим заказом"
                );
            }
        }

        // Проверяем занятость ВНУТРИ транзакции
        // после блокировки исполнителя.
        const busyRegular = await Order.findOne({
            where: {
                executorId: workerId,
                id: { [Op.ne]: id },
                status: {
                    [Op.in]: ["active", "reserved"],
                },
            },
            transaction,
        });

        if (busyRegular) {
            throw fail(
                409,
                "У исполнителя уже есть активный или забронированный заказ"
            );
        }

        const busyExpress = await ExpressOrder.findOne({
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

        if (busyExpress) {
            throw fail(
                409,
                "Исполнитель занят экспресс-заказом"
            );
        }

        const isPremium =
            executor.subscription_type === "premium" &&
            executor.subscription_expires_at &&
            new Date(
                executor.subscription_expires_at
            ) > new Date();

        // При обычном назначении долг блокирует
        // нового исполнителя.
        //
        // Уже согласованную бронь отдельно не блокируем:
        // это ранее принятое обязательство.
        if (
            !activation &&
            !isPremium &&
            Number(executor.debt || 0) > 0
        ) {
            throw fail(
                409,
                "У исполнителя есть задолженность по комиссии"
            );
        }

        const creator = await User.findByPk(
            order.creatorId,
            {
                attributes: [
                    "id",
                    "userStatus",
                ],
                transaction,
            }
        );

        if (!creator) {
            throw fail(404, "Заказчик не найден");
        }

        const creatorStatus = String(
            creator.userStatus || ""
        ).trim().toLowerCase();

        const isPensionerCreator =
            creatorStatus === "pensioner";

        const baseCommissionKopecks =
            order.is_recommended
                ? 10000
                : 20000;

        const commissionKopecks =
            isPremium
                ? 0
                : isPensionerCreator
                    ? Math.round(
                        baseCommissionKopecks / 2
                    )
                    : baseCommissionKopecks;

        // Назначение исполнителя.
        order.executorId = workerId;
        order.status = "active";
        order.dealStatus = "none";

        order.proposedSum = Math.round(price);
        order.finalPriceKopecks = priceKopecks;

        order.requestedExecutors =
            JSON.stringify([]);

        order.requests =
            JSON.stringify([]);

        if (activation) {
            order.reservationReadyAt = new Date();
        }

        await order.save({ transaction });

        // Комиссия начисляется в этой же транзакции.
        // При любой ошибке откатятся и назначение,
        // и задолженность, и попытка автосписания.
        const commissionAccrual =
            await accrueOrderCommissionOnce({
                orderId: id,
                executorId: workerId,
                amountKopecks: commissionKopecks,
                transaction,
            });

        return {
            orderId: id,
            executorId: workerId,
            activatedFromReservation: activation,
            approvedSum: price,
            isPremium: Boolean(isPremium),
            isPensionerCreator,
            creatorStatus,
            commissionKopecks,
            commissionAccrual,
        };
    });
}

module.exports = {
    assignCashRegularOrder,
};