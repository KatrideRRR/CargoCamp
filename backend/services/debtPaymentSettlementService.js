"use strict";

const { QueryTypes } = require("sequelize");

const {
    sequelize,
    User,
} = require("../models");

const {
    applyConfirmedPayment,
} = require("./paymentReceiptService");

const {
    finalizeDebtOrderRequest,
} = require("./debtOrderRequestService");

const {
    deliverDebtOrderRequestNotifications,
} = require("./debtOrderRequestDeliveryService");

async function settleConfirmedDebtPayment({
                                              provider,
                                              paymentId,
                                              userId,
                                              amountKopecks,
                                              intentId = null,
                                              bankOrderId = null,
                                          }) {
    const uid = Number(userId);
    const amount = Number(amountKopecks);
    const bankPaymentId = String(
        paymentId || ""
    ).trim();

    if (
        !["yookassa", "tbank"].includes(provider) ||
        !Number.isSafeInteger(uid) ||
        uid <= 0 ||
        !Number.isSafeInteger(amount) ||
        amount <= 0 ||
        amount > 2147483647 ||
        !bankPaymentId ||
        bankPaymentId.length > 128
    ) {
        throw new Error(
            "Некорректные данные подтверждённого платежа"
        );
    }

    const normalizedIntentId =
        intentId == null
            ? null
            : Number(intentId);

    if (
        normalizedIntentId !== null &&
        (
            !Number.isSafeInteger(
                normalizedIntentId
            ) ||
            normalizedIntentId <= 0
        )
    ) {
        throw new Error(
            "Некорректный ID платёжного намерения"
        );
    }

    // Сначала проверяем соответствие платежа
    // сохранённому намерению пользователя.

    const intent = await sequelize.transaction(
        async (transaction) => {
            const user = await User.findByPk(uid, {
                transaction,
                lock: transaction.LOCK.UPDATE,
            });

            if (!user) {
                throw new Error(
                    "Пользователь не найден"
                );
            }

            const rows = await sequelize.query(
                `
                SELECT *
                FROM debt_payment_intents
                WHERE user_id = :userId
                  AND provider = :provider
                  AND (
                      provider_payment_id = :paymentId
                      OR (
                          :intentId IS NOT NULL
                          AND id = :intentId
                      )
                      OR (
                          :bankOrderId IS NOT NULL
                          AND provider_order_id = :bankOrderId
                      )
                  )
                FOR UPDATE
                `,
                {
                    replacements: {
                        userId: uid,
                        provider,
                        paymentId: bankPaymentId,
                        intentId: normalizedIntentId,
                        bankOrderId:
                            bankOrderId || null,
                    },
                    transaction,
                    type: QueryTypes.SELECT,
                }
            );

            if (rows.length !== 1) {
                throw new Error(
                    "Не удалось однозначно определить " +
                    "платёжное намерение"
                );
            }

            const row = rows[0];

            if (
                Number(row.user_id) !== uid ||
                row.provider !== provider ||
                Number(row.amount_kopecks) !== amount ||
                (
                    normalizedIntentId !== null &&
                    Number(row.id) !== normalizedIntentId
                ) ||
                (
                    row.provider_payment_id &&
                    String(row.provider_payment_id) !==
                    bankPaymentId
                ) ||
                (
                    provider === "tbank" &&
                    (
                        !bankOrderId ||
                        String(row.provider_order_id) !==
                        String(bankOrderId)
                    )
                )
            ) {
                throw new Error(
                    "Платёж не соответствует намерению"
                );
            }

            await sequelize.query(
                `
                UPDATE debt_payment_intents
                SET provider_payment_id = :paymentId
                WHERE id = :id
                `,
                {
                    replacements: {
                        id: Number(row.id),
                        paymentId: bankPaymentId,
                    },
                    transaction,
                }
            );

            return row;
        }
    );

    // Используем действующий журнал платежей.
    // Повторный вызов не уменьшит долг второй раз.

    const paymentResult =
        await applyConfirmedPayment({
            provider,
            paymentId: bankPaymentId,
            userId: uid,
            purpose: "debt",
            amountKopecks: amount,
        });

    // Записываем подтверждение только после
    // успешного завершения учёта платежа.

    await sequelize.transaction(
        async (transaction) => {
            const receipts = await sequelize.query(
                `
                SELECT *
                FROM payment_receipts
                WHERE provider = :provider
                  AND payment_id = :paymentId
                  AND user_id = :userId
                  AND purpose = 'debt'
                LIMIT 1
                `,
                {
                    replacements: {
                        provider,
                        paymentId: bankPaymentId,
                        userId: uid,
                    },
                    transaction,
                    type: QueryTypes.SELECT,
                }
            );

            if (
                receipts.length !== 1 ||
                Number(receipts[0].amount_kopecks) !==
                amount
            ) {
                throw new Error(
                    "Платёж отсутствует в журнале"
                );
            }

            await sequelize.query(
                `
                UPDATE debt_payment_intents
                SET payment_status = 'succeeded'
                WHERE id = :id
                  AND user_id = :userId
                  AND provider = :provider
                  AND provider_payment_id = :paymentId
                `,
                {
                    replacements: {
                        id: Number(intent.id),
                        userId: uid,
                        provider,
                        paymentId: bankPaymentId,
                    },
                    transaction,
                }
            );
        }
    );

    // Даже при повторном webhook продолжаем
    // незавершённый автоматический отклик.

    const requestResult =
        await finalizeDebtOrderRequest({
            intentId: Number(intent.id),
            userId: uid,
        });

    if (requestResult.notifications?.length) {
        await deliverDebtOrderRequestNotifications(
            requestResult.notifications
        );
    }

    const freshUser = await User.findByPk(uid);

    return {
        ...paymentResult,

        intentId: Number(intent.id),

        paymentStatus: "succeeded",

        requestStatus:
        requestResult.requestStatus,

        requestError:
            requestResult.requestError || null,

        debtKopecks: Number(
            freshUser?.debt || 0
        ),
    };
}

module.exports = {
    settleConfirmedDebtPayment,
};