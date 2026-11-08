const { QueryTypes } = require("sequelize");

const {
    sequelize,
    Order,
} = require("../models");

const yooKassa = require("../config/yookassaClient");

const {
    requestTBank,
} = require("../config/tbankClient");

const {
    expectedPromotionKopecks,
    verifyYooPromotion,
    verifyTBankPromotion,
    applyVerifiedPromotion,
} = require("./promotionPaymentService");

function fail(message, status = 409) {
    return Object.assign(
        new Error(message),
        { httpStatus: status }
    );
}

function validId(value) {
    const id = Number(value);

    return Number.isSafeInteger(id) && id > 0
        ? id
        : null;
}

/**
 * Только проверяет существующую банковскую операцию.
 *
 * Не создаёт платежи.
 * Не списывает деньги.
 * Не выполняет возвраты.
 */
async function reconcilePromotionPayment({
                                             orderId,
                                         }) {
    const id = validId(orderId);

    if (!id) {
        throw fail("Некорректный номер заказа", 400);
    }

    const order = await Order.findByPk(id);

    if (!order) {
        throw fail("Заказ не найден", 404);
    }

    const provider =
        order.promotionPaymentProvider ||
        "yookassa";

    const paymentId =
        String(order.promotionPaymentId || "");

    if (!paymentId) {
        return {
            status: "unknown",
            provider,
            needsReview: true,
            reason: "payment_id_missing",
            newlyApplied: false,
        };
    }

    if (
        !["yookassa", "tbank"].includes(provider)
    ) {
        throw fail(
            "Неизвестный платёжный провайдер"
        );
    }

    let amountKopecks;
    let occurredAt = null;

    if (provider === "yookassa") {
        const payment = await yooKassa.getPayment(
            paymentId
        );

        if (String(payment?.id) !== paymentId) {
            throw fail(
                "ЮKassa вернула другой PaymentId"
            );
        }

        if (payment.status !== "succeeded") {
            return {
                status: payment.status || "unknown",
                provider,
                needsReview:
                    payment.status === "canceled",
                newlyApplied: false,
            };
        }

        verifyYooPromotion(payment, order);

        amountKopecks = Math.round(
            Number(payment.amount.value) * 100
        );

        occurredAt =
            payment.captured_at ||
            payment.created_at ||
            null;
    } else {
        /*
         * Для Т-Банка нужно знать исходный OrderId.
         * Он сохраняется в promotion_payment_intents.
         */
        const intents = await sequelize.query(
            `
            SELECT
                provider,
                payment_id,
                bank_order_id,
                amount_kopecks
            FROM promotion_payment_intents
            WHERE order_id = :orderId
            LIMIT 1
            `,
            {
                replacements: { orderId: id },
                type: QueryTypes.SELECT,
            }
        );

        const intent = intents[0];

        if (
            !intent ||
            intent.provider !== "tbank" ||
            String(intent.payment_id) !== paymentId
        ) {
            return {
                status: "unknown",
                provider,
                needsReview: true,
                reason: "missing_tbank_intent",
                newlyApplied: false,
            };
        }

        const payment = await requestTBank(
            "GetState",
            {
                PaymentId: paymentId,
            }
        );

        /*
         * Даже если платёж ещё не подтверждён,
         * проверяем принадлежность ответа банка.
         */
        if (
            String(payment.PaymentId) !== paymentId ||
            String(payment.OrderId) !==
            String(intent.bank_order_id) ||
            String(payment.TerminalKey) !==
            String(process.env.TBANK_TERMINAL_KEY) ||
            Number(payment.Amount) !==
            Number(intent.amount_kopecks)
        ) {
            throw fail(
                "Ответ Т-Банка не соответствует платежу"
            );
        }

        if (payment.Status !== "CONFIRMED") {
            return {
                status: payment.Status || "unknown",
                provider,
                needsReview: [
                    "REJECTED",
                    "CANCELED",
                    "REVERSED",
                    "REFUNDED",
                    "PARTIAL_REFUNDED",
                ].includes(payment.Status),
                newlyApplied: false,
            };
        }

        verifyTBankPromotion(
            payment,
            order,
            paymentId,
            intent.bank_order_id
        );

        amountKopecks = Number(payment.Amount);
    }

    const expected =
        expectedPromotionKopecks(order);

    if (amountKopecks !== expected) {
        throw fail(
            "Сумма подтверждённого платежа не совпадает с заказом"
        );
    }

    const result = await applyVerifiedPromotion({
        provider,
        paymentId,
        orderId: id,
        amountKopecks,
    });

    return {
        status: "succeeded",
        provider,
        paymentId,
        orderId: id,
        userId: order.creatorId,
        amountKopecks,
        occurredAt,

        needsReview: false,

        newlyApplied:
            result.duplicate !== true,

        sendPush:
            result.duplicate !== true &&
            result.sendPush === true,
    };
}

module.exports = {
    reconcilePromotionPayment,
};