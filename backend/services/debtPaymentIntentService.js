"use strict";

const { randomUUID } = require("node:crypto");
const { QueryTypes } = require("sequelize");

const {
    sequelize,
    User,
    Order,
} = require("../models");

const ACTIVE_STATUSES = [
    "creating",
    "pending",
    "unknown",
];

function fail(message, status = 409) {
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

function viewIntent(row) {
    return {
        id: Number(row.id),
        userId: Number(row.user_id),
        orderId: row.order_id
            ? Number(row.order_id)
            : null,
        provider: row.provider,
        paymentMode: row.payment_mode,
        amountKopecks: Number(row.amount_kopecks),
        idempotencyKey: row.idempotency_key,
        paymentId: row.provider_payment_id || null,
        bankOrderId: row.provider_order_id || null,
        confirmationUrl: row.confirmation_url || null,
        paymentStatus: row.payment_status,
        requestStatus: row.request_status,
        requestError: row.request_error || null,
    };
}

function normalizeRequest(request) {
    if (request == null) {
        return {
            orderId: null,
            proposedSum: null,
            comment: null,
            availableAt: null,
        };
    }

    const orderId = validId(request.orderId);

    const proposedSum = Math.round(
        Number(request.proposedSum)
    );

    if (
        !orderId ||
        !Number.isSafeInteger(proposedSum) ||
        proposedSum < 1 ||
        proposedSum > 300000
    ) {
        throw fail(
            "Некорректные данные отклика",
            400
        );
    }

    const comment = String(
        request.comment || ""
    )
        .trim()
        .slice(0, 1000);

    const availableAt = request.availableAt
        ? new Date(request.availableAt)
        : null;

    if (
        availableAt &&
        (
            !Number.isFinite(
                availableAt.getTime()
            ) ||
            availableAt.getTime() <= Date.now() ||
            availableAt.getTime() >
            Date.now() + 7 * 86400000
        )
    ) {
        throw fail(
            "Некорректное время выполнения",
            400
        );
    }

    return {
        orderId,
        proposedSum,
        comment,
        availableAt,
    };
}

async function claimDebtPaymentIntent({
                                          userId,
                                          provider,
                                          paymentMode,
                                          request = null,
                                          expectedAmountKopecks,
                                      }) {
    const uid = validId(userId);

    if (
        !uid ||
        !["yookassa", "tbank"].includes(provider) ||
        !["saved_card", "redirect"].includes(
            paymentMode
        )
    ) {
        throw fail(
            "Некорректные параметры оплаты",
            400
        );
    }

    const orderRequest =
        normalizeRequest(request);

    return sequelize.transaction(
        async (transaction) => {
            const user = await User.findByPk(uid, {
                transaction,
                lock: transaction.LOCK.UPDATE,
            });

            if (!user) {
                throw fail(
                    "Пользователь не найден",
                    404
                );
            }

            // Не создаём новый платёж,
            // если предыдущий ещё не завершён.
            const existing = await sequelize.query(
                `
                SELECT *
                FROM debt_payment_intents
                WHERE user_id = :userId
                  AND payment_status IN (
                      'creating',
                      'pending',
                      'unknown'
                  )
                ORDER BY id DESC
                LIMIT 1
                FOR UPDATE
                `,
                {
                    replacements: {
                        userId: uid,
                    },
                    transaction,
                    type: QueryTypes.SELECT,
                }
            );

            if (existing.length) {
                const row = existing[0];

                const existingOrderId = row.order_id
                    ? Number(row.order_id)
                    : null;

                const existingAvailableAt = row.available_at
                    ? new Date(row.available_at).getTime()
                    : null;

                const requestedAvailableAt = orderRequest.availableAt
                    ? orderRequest.availableAt.getTime()
                    : null;

                if (
                    existingOrderId !== orderRequest.orderId ||
                    row.provider !== provider ||
                    row.payment_mode !== paymentMode ||
                    (
                        existingOrderId !== null &&
                        (
                            Number(row.proposed_sum) !==
                            orderRequest.proposedSum ||
                            String(row.request_comment || "") !==
                            String(orderRequest.comment || "") ||
                            existingAvailableAt !== requestedAvailableAt
                        )
                    )
                ) {
                    throw fail(
                        "У вас уже есть незавершённый платёж. " +
                        "Сначала необходимо проверить его состояние."
                    );
                }

                return {
                    created: false,
                    ...viewIntent(row),
                };
            }

            const amount = Number(
                user.debt || 0
            );

            if (
                !Number.isSafeInteger(amount) ||
                amount < 0 ||
                amount > 2147483647
            ) {
                throw fail(
                    "Некорректная задолженность"
                );
            }

            if (amount === 0) {
                return {
                    created: false,
                    noDebt: true,
                };
            }

            if (
                Number(expectedAmountKopecks) !==
                amount
            ) {
                throw fail(
                    "Сумма задолженности изменилась. " +
                    "Подтвердите новую сумму."
                );
            }

            if (paymentMode === "saved_card") {
                const hasCard =
                    provider === "yookassa"
                        ? Boolean(
                            user.yookassa_payment_method_id
                        )
                        : Boolean(
                            user.tbankRebillId &&
                            user.tbankCardId
                        );

                if (!hasCard) {
                    throw fail(
                        "Сохранённая карта недоступна"
                    );
                }
            }

            // Не запускаем ручную оплату поверх
            // незавершённого автосписания комиссии.
            const autoCharges =
                await sequelize.query(
                    `
                    SELECT id
                    FROM commission_charge_attempts
                    WHERE user_id = :userId
                      AND status IN (
                          'prepared',
                          'initiated',
                          'pending',
                          'unknown'
                      )
                    LIMIT 1
                    FOR UPDATE
                    `,
                    {
                        replacements: {
                            userId: uid,
                        },
                        transaction,
                        type: QueryTypes.SELECT,
                    }
                );

            if (autoCharges.length) {
                throw fail(
                    "Предыдущая оплата комиссии " +
                    "ещё проверяется"
                );
            }

            if (orderRequest.orderId) {
                const order = await Order.findByPk(
                    orderRequest.orderId,
                    {
                        transaction,
                        lock: transaction.LOCK.UPDATE,
                    }
                );

                if (!order) {
                    throw fail(
                        "Заказ не найден",
                        404
                    );
                }

                if (
                    order.status !== "pending" ||
                    order.executorId ||
                    order.creatorHidden ||
                    order.adminDeleted
                ) {
                    throw fail(
                        "Заказ больше не принимает отклики"
                    );
                }

                if (
                    Number(order.creatorId) === uid
                ) {
                    throw fail(
                        "Нельзя откликаться на свой заказ",
                        403
                    );
                }
            }

            const idempotencyKey =
                randomUUID();

            const bankOrderId =
                provider === "tbank"
                    ? `debt_${uid}_${randomUUID()
                        .replace(/-/g, "")}`
                    : null;

            await sequelize.query(
                `
                INSERT INTO debt_payment_intents (
                    user_id,
                    order_id,
                    proposed_sum,
                    request_comment,
                    available_at,
                    provider,
                    payment_mode,
                    amount_kopecks,
                    idempotency_key,
                    provider_order_id,
                    payment_status,
                    request_status,
                    expires_at
                )
                VALUES (
                    :userId,
                    :orderId,
                    :proposedSum,
                    :comment,
                    :availableAt,
                    :provider,
                    :paymentMode,
                    :amount,
                    :idempotencyKey,
                    :bankOrderId,
                    'creating',
                    :requestStatus,
                    DATE_ADD(
                        CURRENT_TIMESTAMP(3),
                        INTERVAL 30 MINUTE
                    )
                )
                `,
                {
                    replacements: {
                        userId: uid,
                        ...orderRequest,
                        provider,
                        paymentMode,
                        amount,
                        idempotencyKey,
                        bankOrderId,
                        requestStatus:
                            orderRequest.orderId
                                ? "pending"
                                : "not_required",
                    },
                    transaction,
                }
            );

            const rows = await sequelize.query(
                `
                SELECT *
                FROM debt_payment_intents
                WHERE idempotency_key = :key
                LIMIT 1
                `,
                {
                    replacements: {
                        key: idempotencyKey,
                    },
                    transaction,
                    type: QueryTypes.SELECT,
                }
            );

            if (!rows.length) {
                throw new Error(
                    "Платёжное намерение не сохранено"
                );
            }

            return {
                created: true,
                ...viewIntent(rows[0]),
            };
        }
    );
}

async function getDebtPaymentIntent({
                                        intentId,
                                        userId,
                                    }) {
    const id = validId(intentId);
    const uid = validId(userId);

    if (!id || !uid) {
        throw fail(
            "Некорректный идентификатор",
            400
        );
    }

    const rows = await sequelize.query(
        `
        SELECT *
        FROM debt_payment_intents
        WHERE id = :id
          AND user_id = :userId
        LIMIT 1
        `,
        {
            replacements: {
                id,
                userId: uid,
            },
            type: QueryTypes.SELECT,
        }
    );

    if (!rows.length) {
        throw fail(
            "Платёж не найден",
            404
        );
    }

    return viewIntent(rows[0]);
}

async function recordDebtPaymentIntent({
                                           intentId,
                                           userId,
                                           provider,
                                           paymentId = null,
                                           confirmationUrl = null,
                                           status = "pending",
                                       }) {
    const id = validId(intentId);
    const uid = validId(userId);

    const bankPaymentId = paymentId
        ? String(paymentId)
        : null;

    if (
        !id ||
        !uid ||
        !["yookassa", "tbank"].includes(provider) ||
        !["pending", "unknown", "failed"].includes(
            status
        ) ||
        (bankPaymentId &&
            bankPaymentId.length > 128) ||
        (confirmationUrl &&
            String(confirmationUrl).length > 4096)
    ) {
        throw fail(
            "Некорректные данные платежа",
            400
        );
    }

    return sequelize.transaction(
        async (transaction) => {
            const rows = await sequelize.query(
                `
                SELECT *
                FROM debt_payment_intents
                WHERE id = :id
                  AND user_id = :userId
                FOR UPDATE
                `,
                {
                    replacements: {
                        id,
                        userId: uid,
                    },
                    transaction,
                    type: QueryTypes.SELECT,
                }
            );

            const intent = rows[0];

            if (
                !intent ||
                intent.provider !== provider ||
                (
                    intent.provider_payment_id &&
                    bankPaymentId &&
                    String(
                        intent.provider_payment_id
                    ) !== bankPaymentId
                )
            ) {
                throw fail(
                    "Конфликт платёжной операции"
                );
            }

            // Поздний ответ банка не должен
            // перезаписывать финальный результат.
            if (
                !ACTIVE_STATUSES.includes(
                    intent.payment_status
                )
            ) {
                return viewIntent(intent);
            }

            await sequelize.query(
                `
                UPDATE debt_payment_intents
                SET
                    provider_payment_id =
                        COALESCE(
                            :paymentId,
                            provider_payment_id
                        ),
                    confirmation_url =
                        COALESCE(
                            :confirmationUrl,
                            confirmation_url
                        ),
                    payment_status = :status
                WHERE id = :id
                `,
                {
                    replacements: {
                        id,
                        paymentId: bankPaymentId,
                        confirmationUrl:
                            confirmationUrl || null,
                        status,
                    },
                    transaction,
                }
            );

            const updated = await sequelize.query(
                `
                SELECT *
                FROM debt_payment_intents
                WHERE id = :id
                `,
                {
                    replacements: { id },
                    transaction,
                    type: QueryTypes.SELECT,
                }
            );

            return viewIntent(updated[0]);
        }
    );
}

function publicDebtPaymentIntent(intent) {
    return {
        success: intent.paymentStatus !== "failed",

        error: intent.paymentStatus === "failed"
            ? "Платёж не прошёл. Выберите другой способ оплаты."
            : null,
        intentId: intent.id,
        provider: intent.provider,
        orderId: intent.orderId,
        amountKopecks: intent.amountKopecks,
        paymentId: intent.paymentId,
        confirmationUrl: intent.confirmationUrl,
        paymentStatus: intent.paymentStatus,
        requestStatus: intent.requestStatus,
        requestError: intent.requestError,

        paidBySavedCard:
            intent.paymentMode === "saved_card",

        paymentProcessing:
            ACTIVE_STATUSES.includes(
                intent.paymentStatus
            ),

        paid:
            intent.paymentStatus === "succeeded",

        noDebt:
            intent.noDebt === true,
    };
}

async function getActiveDebtPaymentIntent({
                                              userId,
                                          }) {
    const uid = validId(userId);

    if (!uid) {
        throw fail(
            "Некорректный пользователь",
            400
        );
    }

    const rows = await sequelize.query(
        `
        SELECT *
        FROM debt_payment_intents
        WHERE user_id = :userId
          AND (
              payment_status IN (
                  'creating',
                  'pending',
                  'unknown'
              )
              OR (
                  payment_status = 'succeeded'
                  AND request_status = 'pending'
              )
          )
        ORDER BY id DESC
        LIMIT 1
        `,
        {
            replacements: {
                userId: uid,
            },
            type: QueryTypes.SELECT,
        }
    );

    return rows.length
        ? viewIntent(rows[0])
        : null;
}

module.exports = {
    claimDebtPaymentIntent,
    getDebtPaymentIntent,
    getActiveDebtPaymentIntent,
    recordDebtPaymentIntent,
    publicDebtPaymentIntent,
};