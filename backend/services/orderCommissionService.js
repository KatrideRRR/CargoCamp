const {
    sequelize,
    Order,
    User,
} = require("../models");

async function accrueOrderCommissionOnce({
                                             orderId,
                                             executorId,
                                             amountKopecks,
                                         }) {
    const normalizedOrderId = Number(orderId);
    const normalizedExecutorId = Number(executorId);
    const normalizedAmount = Number(amountKopecks);

    if (
        !Number.isSafeInteger(normalizedOrderId) ||
        normalizedOrderId <= 0 ||
        !Number.isSafeInteger(normalizedExecutorId) ||
        normalizedExecutorId <= 0 ||
        !Number.isSafeInteger(normalizedAmount) ||
        normalizedAmount < 0
    ) {
        throw new Error("Некорректные данные комиссии");
    }

    return sequelize.transaction(async (transaction) => {
        // Блокируем исполнителя, чтобы два начисления
        // не перезаписали друг другу сумму задолженности.
        const executor = await User.findByPk(
            normalizedExecutorId,
            {
                transaction,
                lock: transaction.LOCK.UPDATE,
            }
        );

        if (!executor) {
            throw new Error("Исполнитель не найден");
        }

        // Блокируем заказ до завершения проверки.
        const order = await Order.findByPk(
            normalizedOrderId,
            {
                transaction,
                lock: transaction.LOCK.UPDATE,
            }
        );

        if (
            !order ||
            order.status !== "active" ||
            Number(order.executorId) !== normalizedExecutorId
        ) {
            throw new Error(
                "Невозможно начислить комиссию: заказ неактивен или исполнитель изменился"
            );
        }

        // Комиссия уже начислялась.
        // Второй раз долг не увеличиваем.
        if (order.commissionAccruedAt) {
            return {
                newlyAccrued: false,
                amountKopecks: Number(
                    order.commissionAmountKopecks || 0
                ),
                debtKopecks: Number(executor.debt || 0),
            };
        }

        const currentDebt = Number(executor.debt || 0);

        const newDebt =
            currentDebt + normalizedAmount;

        if (
            !Number.isSafeInteger(newDebt) ||
            newDebt < 0
        ) {
            throw new Error(
                "Некорректный итоговый размер задолженности"
            );
        }

        if (normalizedAmount > 0) {
            await executor.update(
                {
                    debt: newDebt,
                },
                { transaction }
            );
        }

        // Помечаем заказ как обработанный в той же
        // транзакции, в которой начисляется долг.
        await order.update(
            {
                commissionAmountKopecks: normalizedAmount,
                commissionAccruedAt: new Date(),
            },
            { transaction }
        );

        return {
            newlyAccrued: true,
            amountKopecks: normalizedAmount,
            debtKopecks: newDebt,
        };
    });
}

module.exports = {
    accrueOrderCommissionOnce,
};