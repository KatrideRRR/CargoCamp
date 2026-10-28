const { Op, QueryTypes } = require("sequelize");

const {
    sequelize,
    User,
    ActionLog,
    ExpressOrder,
} = require("../models");

const PREMIUM_PRICES = {
    "7d": 250000,
    "30d": 900000,
};

async function applyConfirmedPayment({
                                         provider,
                                         paymentId,
                                         userId,
                                         purpose,
                                         amountKopecks,
                                         duration = null,
                                         commissionAttemptId = null,
                                     }) {
    const id = String(paymentId || "").trim();
    const uid = Number(userId);
    const amount = Number(amountKopecks);

    if (
        !["yookassa", "tbank"].includes(provider) ||
        !["debt", "premium"].includes(purpose) ||
        !id ||
        id.length > 128 ||
        !Number.isSafeInteger(uid) ||
        uid <= 0 ||
        !Number.isSafeInteger(amount) ||
        amount <= 0 ||
        amount > 2147483647
    ) {
        throw new Error("Некорректные данные платежа");
    }

    if (
        purpose === "premium" &&
        PREMIUM_PRICES[duration] !== amount
    ) {
        throw new Error(
            "Сумма Premium не соответствует тарифу"
        );
    }

    return sequelize.transaction(async (transaction) => {
        // Все платежи пользователя обрабатываются
        // последовательно благодаря блокировке строки.
        const user = await User.findByPk(uid, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (!user) {
            throw new Error("Пользователь не найден");
        }

        async function markCommissionAttemptPaid() {
            if (
                purpose !== "debt" ||
                !commissionAttemptId
            ) {
                return;
            }

            const attemptId = Number(
                commissionAttemptId
            );

            if (
                !Number.isSafeInteger(attemptId) ||
                attemptId <= 0
            ) {
                throw new Error(
                    "Некорректный ID попытки списания"
                );
            }

            const attempts = await sequelize.query(
                `
        SELECT *
        FROM commission_charge_attempts
        WHERE id = :attemptId
        FOR UPDATE
        `,
                {
                    replacements: { attemptId },
                    transaction,
                    type: QueryTypes.SELECT,
                }
            );

            const attempt = attempts[0];

            if (
                !attempt ||
                attempt.provider !== provider ||
                Number(attempt.user_id) !== uid ||
                Number(attempt.amount_kopecks) !== amount ||
                (
                    attempt.provider_payment_id &&
                    String(attempt.provider_payment_id) !== id
                )
            ) {
                throw new Error(
                    "Платёж не соответствует попытке списания"
                );
            }

            await sequelize.query(
                `
        UPDATE commission_charge_attempts
        SET
            status = 'succeeded',
            provider_payment_id = :paymentId
        WHERE id = :attemptId
        `,
                {
                    replacements: {
                        attemptId,
                        paymentId: id,
                    },
                    transaction,
                }
            );

            if (attempt.source_type === "express") {
                await ExpressOrder.update(
                    {
                        commissionStatus: "paid",
                    },
                    {
                        where: {
                            id: attempt.source_id,
                            executorId: uid,
                            status: "completed",
                            commissionStatus: "debt",
                            commissionKopecks: amount,
                        },
                        transaction,
                    }
                );
            }
        }

        const receipts = await sequelize.query(
            `
            SELECT user_id, purpose, amount_kopecks
            FROM payment_receipts
            WHERE provider = :provider
              AND payment_id = :paymentId
            LIMIT 1
            `,
            {
                replacements: {
                    provider,
                    paymentId: id,
                },
                transaction,
                type: QueryTypes.SELECT,
            }
        );

        if (receipts.length) {
            const previous = receipts[0];

            if (
                Number(previous.user_id) !== uid ||
                previous.purpose !== purpose ||
                Number(previous.amount_kopecks) !== amount
            ) {
                throw new Error(
                    "Конфликт данных ранее обработанного платежа"
                );
            }

            await markCommissionAttemptPaid();

            return { duplicate: true };
        }

        // Совместимость с платежами, которые
        // были обработаны до введения общего журнала.
        const legacyActions =
            purpose === "premium"
                ? ["premium_activated"]
                : ["debt_payment_succeeded", "debt_paid"];

        const oldLogs = await ActionLog.findAll({
            where: {
                paymentId: id,
                actionType: {
                    [Op.in]: legacyActions,
                },
            },
            transaction,
        });

        const previouslyProcessed = oldLogs.some(
            (log) =>
                !log.meta?.provider ||
                log.meta.provider === provider
        ) || (
            purpose === "premium" &&
            user.premium_last_payment_id === id
        );

        let appliedKopecks = 0;
        let subscriptionExpiresAt = null;

        if (!previouslyProcessed) {
            if (purpose === "debt") {
                const debt = Number(user.debt || 0);

                if (
                    !Number.isSafeInteger(debt) ||
                    debt < 0
                ) {
                    throw new Error(
                        "Некорректная задолженность"
                    );
                }

                appliedKopecks = Math.min(
                    debt,
                    amount
                );

                const newDebt =
                    debt - appliedKopecks;

                await user.update(
                    {
                        debt: newDebt,
                        commissionDebtOrderId:
                            newDebt === 0
                                ? null
                                : user.commissionDebtOrderId,
                    },
                    { transaction }
                );
            } else {
                const days =
                    duration === "7d" ? 7 : 30;

                const now = new Date();

                const currentExpiration =
                    user.subscription_expires_at
                        ? new Date(
                            user.subscription_expires_at
                        )
                        : null;

                const base =
                    currentExpiration &&
                    currentExpiration > now
                        ? currentExpiration
                        : now;

                subscriptionExpiresAt = new Date(
                    base.getTime() +
                    days * 24 * 60 * 60 * 1000
                );

                await user.update(
                    {
                        subscription_type: "premium",
                        subscription_expires_at:
                        subscriptionExpiresAt,
                        premium_last_payment_id: id,
                    },
                    { transaction }
                );
            }
        }

        // Запись в журнале и изменение баланса /
        // подписки сохраняются одной транзакцией.
        await sequelize.query(
            `
            INSERT INTO payment_receipts (
                provider,
                payment_id,
                user_id,
                purpose,
                amount_kopecks,
                applied_kopecks
            )
            VALUES (
                :provider,
                :paymentId,
                :userId,
                :purpose,
                :amount,
                :applied
            )
            `,
            {
                replacements: {
                    provider,
                    paymentId: id,
                    userId: uid,
                    purpose,
                    amount,
                    applied: appliedKopecks,
                },
                transaction,
            }
        );

        await markCommissionAttemptPaid();

        return {
            duplicate: previouslyProcessed,
            appliedKopecks,
            subscriptionExpiresAt,
            debtKopecks: Number(user.debt || 0),
        };
    });
}

module.exports = {
    applyConfirmedPayment,
};