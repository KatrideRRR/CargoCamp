const { randomUUID } = require("crypto");
const { QueryTypes } = require("sequelize");

const {
    sequelize,
    User,
} = require("../models");

const yooKassa = require("../config/yookassaClient");

const {
    requestTBank,
} = require("../config/tbankClient");

const {
    applyConfirmedPayment,
} = require("./paymentReceiptService");

const {
    customerKey,
} = require("./tbankCardBindingService");

const EMPTY_RESULT = {
    autoPaymentTried: false,
    autoPaymentPaid: false,
    autoPaymentProcessing: false,
    autoPaymentStatus: null,
    paymentId: null,
};

function hasSelectedCard(user) {
    if (user.autoCommissionProvider === "yookassa") {
        return Boolean(user.yookassa_payment_method_id);
    }

    if (user.autoCommissionProvider === "tbank") {
        return Boolean(user.tbankRebillId);
    }

    return false;
}

function buildTBankOrderId(attempt) {
    return `debt_${attempt.user_id}_auto${attempt.id}`;
}

function buildTBankReceipt(user, attempt) {
    const amount = Number(attempt.amount_kopecks);

    return {
        Taxation: "usn_income",
        Phone: String(user.phone || "").replace(/\D/g, ""),
        Items: [
            {
                Name: "Комиссия CargoCamp",
                Price: amount,
                Quantity: 1,
                Amount: amount,
                Tax: "none",
                PaymentMethod: "full_payment",
                PaymentObject: "service",
            },
        ],
    };
}

async function getAttempt(id) {
    const rows = await sequelize.query(
        `
        SELECT *
        FROM commission_charge_attempts
        WHERE id = :id
        LIMIT 1
        `,
        {
            replacements: { id },
            type: QueryTypes.SELECT,
        }
    );

    return rows[0] || null;
}

/**
 * Вызывается внутри транзакции начисления комиссии.
 *
 * Если пользователь не включил автосписание или
 * карта выбранного банка отсутствует, попытка
 * не создаётся. Комиссия остаётся задолженностью.
 */
async function prepareCommissionChargeAttempt({
                                                  transaction,
                                                  user,
                                                  sourceType,
                                                  sourceId,
                                                  amountKopecks,
                                              }) {
    if (
        !["regular", "express"].includes(sourceType) ||
        !Number.isSafeInteger(Number(sourceId)) ||
        Number(sourceId) <= 0 ||
        !Number.isSafeInteger(Number(amountKopecks)) ||
        Number(amountKopecks) <= 0
    ) {
        throw new Error("Некорректные данные комиссии");
    }

    if (!hasSelectedCard(user)) {
        return null;
    }

    const existing = await sequelize.query(
        `
        SELECT id
        FROM commission_charge_attempts
        WHERE source_type = :sourceType
          AND source_id = :sourceId
        LIMIT 1
        `,
        {
            replacements: { sourceType, sourceId },
            transaction,
            type: QueryTypes.SELECT,
        }
    );

    if (existing.length) {
        return Number(existing[0].id);
    }

    await sequelize.query(
        `
        INSERT INTO commission_charge_attempts (
            source_type,
            source_id,
            user_id,
            provider,
            amount_kopecks,
            idempotency_key,
            status
        )
        VALUES (
            :sourceType,
            :sourceId,
            :userId,
            :provider,
            :amount,
            :idempotencyKey,
            'prepared'
        )
        `,
        {
            replacements: {
                sourceType,
                sourceId,
                userId: user.id,
                provider: user.autoCommissionProvider,
                amount: amountKopecks,
                idempotencyKey: randomUUID(),
            },
            transaction,
        }
    );

    const created = await sequelize.query(
        `
        SELECT id
        FROM commission_charge_attempts
        WHERE source_type = :sourceType
          AND source_id = :sourceId
        LIMIT 1
        `,
        {
            replacements: { sourceType, sourceId },
            transaction,
            type: QueryTypes.SELECT,
        }
    );

    return Number(created[0].id);
}

/**
 * Перед обращением к банку атомарно
 * переводим попытку prepared -> initiated.
 *
 * Только один процесс может выполнить
 * этот переход.
 */
async function claimAttempt(id) {
    return sequelize.transaction(async (transaction) => {
        const rows = await sequelize.query(
            `
            SELECT *
            FROM commission_charge_attempts
            WHERE id = :id
            FOR UPDATE
            `,
            {
                replacements: { id },
                transaction,
                type: QueryTypes.SELECT,
            }
        );

        const attempt = rows[0];

        if (!attempt || attempt.status !== "prepared") {
            return null;
        }

        await sequelize.query(
            `
            UPDATE commission_charge_attempts
            SET status = 'initiated'
            WHERE id = :id
            `,
            {
                replacements: { id },
                transaction,
            }
        );

        return attempt;
    });
}

async function updateAttempt({
                                 id,
                                 status,
                                 paymentId = null,
                             }) {
    await sequelize.query(
        `
        UPDATE commission_charge_attempts
        SET
            status = CASE
                WHEN status = 'succeeded'
                    THEN status
                ELSE :status
            END,
            provider_payment_id = COALESCE(
                provider_payment_id,
                :paymentId
            )
        WHERE id = :id
          AND (
              provider_payment_id IS NULL
              OR provider_payment_id = :paymentId
              OR :paymentId IS NULL
          )
        `,
        {
            replacements: {
                id,
                status,
                paymentId,
            },
        }
    );
}

async function settleConfirmedAttempt({
                                          attempt,
                                          paymentId,
                                      }) {
    await applyConfirmedPayment({
        provider: attempt.provider,
        paymentId: String(paymentId),
        userId: attempt.user_id,
        purpose: "debt",
        amountKopecks: Number(attempt.amount_kopecks),
        commissionAttemptId: Number(attempt.id),
    });
}

function resultFor({
                       status,
                       paymentId = null,
                   }) {
    return {
        autoPaymentTried: true,
        autoPaymentPaid: status === "succeeded",
        autoPaymentProcessing: [
            "initiated",
            "pending",
            "unknown",
        ].includes(status),
        autoPaymentStatus: status,
        paymentId,
    };
}

/**
 * Единственная точка создания автоматического
 * платежа по комиссии.
 */
async function startCommissionAutoCharge(attemptId) {
    const id = Number(attemptId);

    if (!Number.isSafeInteger(id) || id <= 0) {
        return EMPTY_RESULT;
    }

    const attempt = await claimAttempt(id);

    if (!attempt) {
        // Уже отправлен либо обработан.
        // Второго запроса к банку не делаем.
        const existing = await getAttempt(id);

        return existing
            ? {
                ...EMPTY_RESULT,
                autoPaymentStatus: existing.status,
                autoPaymentPaid:
                    existing.status === "succeeded",
                autoPaymentProcessing: [
                    "initiated",
                    "pending",
                    "unknown",
                ].includes(existing.status),
                paymentId:
                existing.provider_payment_id,
            }
            : EMPTY_RESULT;
    }

    let paymentId = null;

    try {
        const user = await User.findByPk(
            attempt.user_id
        );

        // Выбор банка мог измениться после создания
        // заказа. Без действующего разрешения
        // автосписание не выполняем.
        if (
            !user ||
            user.autoCommissionProvider !==
            attempt.provider ||
            !hasSelectedCard(user)
        ) {
            await updateAttempt({
                id,
                status: "failed",
            });

            return resultFor({
                status: "failed",
            });
        }

        const amount = Number(
            attempt.amount_kopecks
        );

        const description =
            `Комиссия CargoCamp за ${attempt.source_type} ` +
            `заказ #${attempt.source_id}`;

        if (attempt.provider === "yookassa") {
            const payment = await yooKassa.createPayment(
                {
                    amount: {
                        value: (amount / 100).toFixed(2),
                        currency: "RUB",
                    },
                    capture: true,
                    payment_method_id:
                    user.yookassa_payment_method_id,
                    description,
                    metadata: {
                        type: "debt",
                        userId: String(user.id),
                        expectedKopecks: String(amount),
                        autoAttemptId: String(attempt.id),
                        source: "commission_auto",
                    },
                    receipt: {
                        customer: {
                            phone: String(
                                user.phone || ""
                            ).replace(/[^\d+]/g, ""),
                        },
                        items: [
                            {
                                description,
                                quantity: 1,
                                amount: {
                                    value:
                                        (amount / 100).toFixed(2),
                                    currency: "RUB",
                                },
                                vat_code: 1,
                                payment_mode: "full_payment",
                                payment_subject: "service",
                            },
                        ],
                        tax_system_code: 2,
                    },
                },
                attempt.idempotency_key
            );

            paymentId = String(payment.id);

            if (payment.status === "succeeded") {
                await settleConfirmedAttempt({
                    attempt,
                    paymentId,
                });

                return resultFor({
                    status: "succeeded",
                    paymentId,
                });
            }

            const status =
                payment.status === "canceled"
                    ? "failed"
                    : "pending";

            await updateAttempt({
                id,
                status,
                paymentId,
            });

            return resultFor({
                status,
                paymentId,
            });
        }

        if (attempt.provider === "tbank") {
            // Сначала создаём операцию.
            const payment = await requestTBank(
                "Init",
                {
                    Amount: amount,
                    OrderId: buildTBankOrderId(
                        attempt
                    ),
                    Description: description,
                    CustomerKey: customerKey(
                        user.id
                    ),
                    OperationInitiatorType: "R",
                    PayType: "O",
                    NotificationURL:
                        `${process.env.BACKEND_URL}` +
                        `/api/tbank-payments/webhook`,
                    Receipt: buildTBankReceipt(
                        user,
                        attempt
                    ),
                }
            );

            paymentId = String(
                payment.PaymentId || ""
            );

            if (!paymentId) {
                throw new Error(
                    "Т-Банк не вернул PaymentId"
                );
            }

            // Запоминаем PaymentId до Charge.
            await updateAttempt({
                id,
                status: "initiated",
                paymentId,
            });

            const charged = await requestTBank(
                "Charge",
                {
                    PaymentId: paymentId,
                    RebillId: user.tbankRebillId,
                }
            );

            if (charged.Status === "CONFIRMED") {
                const verified = await requestTBank(
                    "GetState",
                    {
                        PaymentId: paymentId,
                    }
                );

                if (
                    verified.Status === "CONFIRMED" &&
                    String(verified.PaymentId) ===
                    paymentId &&
                    String(verified.OrderId) ===
                    buildTBankOrderId(attempt) &&
                    Number(verified.Amount) === amount
                ) {
                    await settleConfirmedAttempt({
                        attempt,
                        paymentId,
                    });

                    return resultFor({
                        status: "succeeded",
                        paymentId,
                    });
                }
            }

            await updateAttempt({
                id,
                status: "pending",
                paymentId,
            });

            return resultFor({
                status: "pending",
                paymentId,
            });
        }

        throw new Error(
            "Неизвестный платёжный провайдер"
        );
    } catch (error) {
        console.error(
            "Commission auto charge error:",
            {
                attemptId: id,
                provider: attempt.provider,
                paymentId,
                error: error.message,
            }
        );

        // Неизвестный результат — НЕ повторяем
        // списание автоматически.
        await updateAttempt({
            id,
            status: "unknown",
            paymentId,
        });

        return resultFor({
            status: "unknown",
            paymentId,
        });
    }
}

module.exports = {
    prepareCommissionChargeAttempt,
    startCommissionAutoCharge,
};