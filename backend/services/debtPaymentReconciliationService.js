"use strict";

const { QueryTypes } = require("sequelize");

const {
    sequelize,
} = require("../models");

const yooKassa = require("../config/yookassaClient");

const {
    requestTBank,
} = require("../config/tbankClient");

const {
    getDebtPaymentIntent,
    recordDebtPaymentIntent,
    publicDebtPaymentIntent,
} = require("./debtPaymentIntentService");

const {
    settleConfirmedDebtPayment,
} = require("./debtPaymentSettlementService");

const {
    finalizeDebtOrderRequest,
} = require("./debtOrderRequestService");

const {
    deliverDebtOrderRequestNotifications,
} = require("./debtOrderRequestDeliveryService");

const FAILED_TBANK_STATUSES = [
    "CANCELED",
    "REJECTED",
    "AUTH_FAIL",
];

async function reconcileDebtPayment({
                                        intentId,
                                        userId,
                                    }) {
    const intent = await getDebtPaymentIntent({
        intentId,
        userId,
    });

    if (intent.paymentStatus === "failed") {
        return publicDebtPaymentIntent(intent);
    }

    // Если платёж уже учтён, повторно
    // обращаться к банку не требуется.
    //
    // Но незавершённый отклик необходимо
    // восстановить.

    if (intent.paymentStatus === "succeeded") {
        if (intent.requestStatus === "pending") {
            const result =
                await finalizeDebtOrderRequest({
                    intentId: intent.id,
                    userId,
                });

            if (result.notifications?.length) {
                await deliverDebtOrderRequestNotifications(
                    result.notifications
                );
            }
        }

        return publicDebtPaymentIntent(
            await getDebtPaymentIntent({
                intentId,
                userId,
            })
        );
    }

    // Отсутствие PaymentId не означает,
    // что банк не получил запрос.
    //
    // Новую операцию не создаём.

    if (!intent.paymentId) {
        return {
            ...publicDebtPaymentIntent(intent),

            needsReview: true,

            reason: "payment_id_missing",
        };
    }

    let confirmed = false;
    let failed = false;

    if (intent.provider === "yookassa") {
        const payment =
            await yooKassa.getPayment(
                intent.paymentId
            );

        if (
            String(payment?.id) !==
            String(intent.paymentId) ||

            payment?.amount?.currency !==
            "RUB" ||

            Math.round(
                Number(payment.amount.value) * 100
            ) !== intent.amountKopecks ||

            payment.metadata?.type !==
            "debt" ||

            String(payment.metadata?.userId) !==
            String(intent.userId) ||

            String(
                payment.metadata?.debtIntentId
            ) !== String(intent.id)
        ) {
            throw new Error(
                "Ответ ЮKassa не соответствует " +
                "платёжному намерению"
            );
        }

        confirmed =
            payment.status === "succeeded";

        failed =
            payment.status === "canceled";

    } else if (intent.provider === "tbank") {
        const payment = await requestTBank(
            "GetState",
            {
                PaymentId: intent.paymentId,
            }
        );

        if (
            String(payment?.PaymentId) !==
            String(intent.paymentId) ||

            String(payment?.OrderId) !==
            String(intent.bankOrderId) ||

            Number(payment?.Amount) !==
            intent.amountKopecks ||

            !process.env.TBANK_TERMINAL_KEY ||

            String(payment?.TerminalKey) !==
            String(
                process.env.TBANK_TERMINAL_KEY
            )
        ) {
            throw new Error(
                "Ответ Т-Банка не соответствует " +
                "платёжному намерению"
            );
        }

        confirmed =
            payment.Status === "CONFIRMED";

        failed =
            FAILED_TBANK_STATUSES.includes(
                payment.Status
            );

    } else {
        throw new Error(
            "Неизвестный платёжный провайдер"
        );
    }

    if (confirmed) {
        await settleConfirmedDebtPayment({
            provider: intent.provider,

            paymentId: intent.paymentId,

            userId: intent.userId,

            amountKopecks:
            intent.amountKopecks,

            intentId: intent.id,

            bankOrderId: intent.bankOrderId,
        });

        return publicDebtPaymentIntent(
            await getDebtPaymentIntent({
                intentId,
                userId,
            })
        );
    }

    if (failed) {
        const updated =
            await recordDebtPaymentIntent({
                intentId: intent.id,

                userId: intent.userId,

                provider: intent.provider,

                paymentId: intent.paymentId,

                status: "failed",
            });

        return publicDebtPaymentIntent(
            updated
        );
    }

    // Операция пока не завершена.
    // Никаких новых списаний не выполняем.

    return publicDebtPaymentIntent(intent);
}

let recoveryRunning = false;

async function recoverDebtPayments({
                                       limit = 30,
                                   } = {}) {
    if (recoveryRunning) {
        return {
            skipped: true,
        };
    }

    recoveryRunning = true;

    try {
        const safeLimit = Math.min(
            100,
            Math.max(
                1,
                Math.trunc(Number(limit)) || 30
            )
        );

        const rows = await sequelize.query(
            `
            SELECT
                id,
                user_id
            FROM debt_payment_intents

            WHERE (
                payment_status = 'succeeded'
                AND request_status = 'pending'
            )
            OR (
                payment_status IN (
                    'creating',
                    'pending',
                    'unknown'
                )
                AND provider_payment_id IS NOT NULL
            )

            ORDER BY
                updated_at ASC,
                id ASC

            LIMIT ${safeLimit}
            `,
            {
                type: QueryTypes.SELECT,
            }
        );

        let processed = 0;
        let errors = 0;

        for (const row of rows) {
            try {
                await reconcileDebtPayment({
                    intentId: Number(row.id),
                    userId: Number(row.user_id),
                });

                processed++;

            } catch (error) {
                errors++;

                console.error(
                    "Debt payment recovery failed:",
                    {
                        intentId: Number(row.id),

                        errorCode:
                            error?.code ||
                            error?.name ||
                            "Error",
                    }
                );

            } finally {
                // Перемещаем проверенную операцию
                // в конец очереди, чтобы старый
                // pending-платёж не блокировал
                // обработку остальных.

                await sequelize.query(
                    `
                    UPDATE debt_payment_intents
                    SET updated_at =
                        CURRENT_TIMESTAMP(3)
                    WHERE id = :id
                    `,
                    {
                        replacements: {
                            id: Number(row.id),
                        },
                    }
                );
            }
        }

        return {
            processed,
            errors,
        };

    } finally {
        recoveryRunning = false;
    }
}

module.exports = {
    reconcileDebtPayment,
    recoverDebtPayments,
};