const { randomUUID } = require("node:crypto");
const { QueryTypes } = require("sequelize");

const {
    sequelize,
    Order,
} = require("../models");

const {
    expectedPromotionKopecks,
} = require("./promotionPaymentService");

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
        created: false,
        provider: row.provider,
        mode: row.payment_mode,
        state: row.state,
        amountKopecks: Number(row.amount_kopecks),
        idempotencyKey: row.idempotency_key,
        bankOrderId: row.bank_order_id,
        paymentId: row.payment_id || null,
        confirmationUrl: row.confirmation_url || null,
        bankStatus: row.payment_status || null,
    };
}

/**
 * Резервируем банковскую операцию ДО запроса к банку.
 *
 * Повторный вызов никогда не создаёт новую попытку,
 * пока судьба предыдущей не установлена.
 */
async function claimPromotionPaymentIntent({
                                               orderId,
                                               userId,
                                               provider,
                                               mode = "redirect",
                                           }) {
    const id = validId(orderId);
    const actorId = validId(userId);

    if (
        !id ||
        !actorId ||
        !["yookassa", "tbank"].includes(provider) ||
        !["saved", "redirect"].includes(mode)
    ) {
        throw fail("Некорректные параметры оплаты", 400);
    }

    return sequelize.transaction(async (transaction) => {
        const order = await Order.findByPk(id, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (!order) {
            throw fail("Заказ не найден", 404);
        }

        if (Number(order.creatorId) !== actorId) {
            throw fail("Нет доступа к заказу", 403);
        }

        if (
            order.status !== "pending_payment" ||
            order.promotionPaidAt
        ) {
            throw fail(
                "Заказ больше не ожидает оплату продвижения"
            );
        }

        const amountKopecks =
            expectedPromotionKopecks(order);

        if (
            !Number.isSafeInteger(amountKopecks) ||
            amountKopecks <= 0
        ) {
            throw fail("Некорректная стоимость продвижения");
        }

        const rows = await sequelize.query(
            `
            SELECT *
            FROM promotion_payment_intents
            WHERE order_id = :orderId
            FOR UPDATE
            `,
            {
                replacements: { orderId: id },
                transaction,
                type: QueryTypes.SELECT,
            }
        );

        if (rows.length) {
            const existing = viewIntent(rows[0]);

            if (
                existing.amountKopecks !== amountKopecks
            ) {
                throw fail(
                    "Параметры продвижения изменились после создания платежа"
                );
            }

            return existing;
        }

        /*
         * Старые платежи могли создаваться до
         * появления promotion_payment_intents.
         *
         * Не создаём второй платёж поверх
         * уже существующего.
         */
        if (order.promotionPaymentId) {
            return {
                created: false,
                legacy: true,
                provider:
                    order.promotionPaymentProvider || "yookassa",
                paymentId: order.promotionPaymentId,
            };
        }

        const idempotencyKey = randomUUID();

        // Формат совместим с действующим парсером
        // уведомлений Т-Банка.
        const bankOrderId =
            `promo_${id}_${Date.now()}`;

        await sequelize.query(
            `
            INSERT INTO promotion_payment_intents (
                order_id,
                user_id,
                provider,
                payment_mode,
                amount_kopecks,
                idempotency_key,
                bank_order_id,
                state
            )
            VALUES (
                :orderId,
                :userId,
                :provider,
                :mode,
                :amount,
                :idempotencyKey,
                :bankOrderId,
                'creating'
            )
            `,
            {
                replacements: {
                    orderId: id,
                    userId: actorId,
                    provider,
                    mode,
                    amount: amountKopecks,
                    idempotencyKey,
                    bankOrderId,
                },
                transaction,
            }
        );

        return {
            created: true,
            provider,
            mode,
            amountKopecks,
            idempotencyKey,
            bankOrderId,
        };
    });
}

/**
 * Банк вернул идентификатор операции.
 *
 * Сохраняем платёж в intent и заказе
 * одной транзакцией.
 */
async function recordPromotionPaymentIntent({
                                                orderId,
                                                provider,
                                                paymentId,
                                                confirmationUrl = null,
                                                paymentStatus = null,
                                            }) {
    const id = validId(orderId);
    const bankPaymentId = String(paymentId || "").trim();

    if (
        !id ||
        !["yookassa", "tbank"].includes(provider) ||
        !bankPaymentId ||
        bankPaymentId.length > 128 ||
        (
            confirmationUrl &&
            String(confirmationUrl).length > 4096
        )
    ) {
        throw fail("Некорректный ответ платёжного провайдера");
    }

    return sequelize.transaction(async (transaction) => {
        const order = await Order.findByPk(id, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (!order) {
            throw fail("Заказ не найден", 404);
        }

        const rows = await sequelize.query(
            `
            SELECT *
            FROM promotion_payment_intents
            WHERE order_id = :orderId
            FOR UPDATE
            `,
            {
                replacements: { orderId: id },
                transaction,
                type: QueryTypes.SELECT,
            }
        );

        const intent = rows[0];

        if (
            !intent ||
            intent.provider !== provider ||
            (
                intent.payment_id &&
                String(intent.payment_id) !== bankPaymentId
            ) ||
            (
                order.promotionPaymentId &&
                String(order.promotionPaymentId) !== bankPaymentId
            )
        ) {
            throw fail(
                "Конфликт банковской операции продвижения"
            );
        }

        const state =
            paymentStatus === "canceled" ||
            paymentStatus === "CANCELED" ||
            paymentStatus === "REJECTED"
                ? "failed"
                : "ready";

        await sequelize.query(
            `
            UPDATE promotion_payment_intents
            SET
                payment_id = :paymentId,
                confirmation_url = :confirmationUrl,
                payment_status = :paymentStatus,
                state = :state
            WHERE order_id = :orderId
            `,
            {
                replacements: {
                    orderId: id,
                    paymentId: bankPaymentId,
                    confirmationUrl:
                        confirmationUrl || null,
                    paymentStatus:
                        paymentStatus || null,
                    state,
                },
                transaction,
            }
        );

        await order.update(
            {
                promotionPaymentId: bankPaymentId,
                promotionPaymentProvider: provider,
            },
            { transaction }
        );

        return { state };
    });
}

function existingPromotionPaymentResponse(intent) {
    if (intent.legacy) {
        return {
            httpStatus: 409,
            body: {
                success: false,
                error:
                    "У заказа уже есть банковский платёж. " +
                    "Сначала необходимо проверить его состояние.",
                provider: intent.provider,
                paymentId: intent.paymentId,
            },
        };
    }

    if (intent.state === "failed") {
        return {
            httpStatus: 409,
            body: {
                success: false,
                error:
                    "Предыдущий платёж не прошёл. " +
                    "Перед новой попыткой требуется сверка с банком.",
                paymentId: intent.paymentId,
            },
        };
    }

    if (
        intent.mode === "redirect" &&
        !intent.confirmationUrl
    ) {
        return {
            httpStatus: 409,
            body: {
                success: false,
                error:
                    "Банковская операция уже начата, но ссылка " +
                    "на оплату пока неизвестна. " +
                    "Повторная операция заблокирована.",
                paymentId: intent.paymentId,
            },
        };
    }

    return {
        httpStatus: 200,
        body: {
            success: true,
            reused: true,
            provider: intent.provider,
            paymentId: intent.paymentId,
            confirmationUrl: intent.confirmationUrl,
            paidBySavedCard: intent.mode === "saved",
            paymentProcessing: true,
            paid: false,
            status: intent.bankStatus || "initiated",
        },
    };
}

module.exports = {
    claimPromotionPaymentIntent,
    recordPromotionPaymentIntent,
    existingPromotionPaymentResponse,
};