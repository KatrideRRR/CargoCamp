const {
    sequelize,
    Order,
} = require("../models");

const PROMOTION_PRICES = {
    highlight: 5000,
    recommended: 10000,
    push: 15000,
};

function fail(message) {
    return Object.assign(new Error(message), {
        httpStatus: 409,
    });
}

function promotionOptions(order) {
    let value = order?.promotionRequested || {};

    if (typeof value === "string") {
        try {
            value = JSON.parse(value);
        } catch {
            throw fail("Повреждены параметры продвижения");
        }
    }

    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value)
    ) {
        throw fail("Некорректные параметры продвижения");
    }

    return {
        highlight: value.highlight === true,
        recommended: value.recommended === true,
        push: value.push === true,
    };
}

function expectedPromotionKopecks(order) {
    const options = promotionOptions(order);

    return Object.entries(PROMOTION_PRICES)
        .reduce(
            (sum, [key, price]) =>
                sum + (options[key] ? price : 0),
            0
        );
}

function verifyYooPromotion(payment, order) {
    const expected = expectedPromotionKopecks(order);

    const actualAmount = Number(
        payment?.amount?.value
    );

    if (
        !payment?.id ||
        payment.status !== "succeeded" ||
        payment.amount?.currency !== "RUB" ||
        payment.metadata?.type !== "order_promotion" ||
        String(payment.metadata?.orderId) !==
        String(order.id) ||
        String(payment.metadata?.userId) !==
        String(order.creatorId) ||
        !Number.isFinite(actualAmount) ||
        Math.round(actualAmount * 100) !== expected ||
        expected <= 0
    ) {
        throw fail(
            "ЮKassa не подтвердила оплату продвижения"
        );
    }

    return true;
}

function verifyTBankPromotion(
    payment,
    order,
    expectedPaymentId,
    expectedOrderId
) {
    const expected = expectedPromotionKopecks(order);

    if (
        !expectedPaymentId ||
        !/^promo_[1-9]\d*_\d+$/.test(
            String(expectedOrderId || "")
        ) ||
        !String(expectedOrderId)
            .startsWith(`promo_${order.id}_`) ||
        String(payment?.PaymentId) !==
        String(expectedPaymentId) ||
        String(payment?.OrderId) !==
        String(expectedOrderId) ||
        payment?.Status !== "CONFIRMED" ||
        String(payment?.TerminalKey) !==
        String(process.env.TBANK_TERMINAL_KEY) ||
        !Number.isSafeInteger(Number(payment?.Amount)) ||
        Number(payment.Amount) !== expected ||
        expected <= 0
    ) {
        throw fail(
            "Т-Банк не подтвердил оплату продвижения"
        );
    }

    return true;
}

async function applyVerifiedPromotion({
                                          provider,
                                          paymentId,
                                          orderId,
                                          amountKopecks,
                                      }) {
    if (
        !["yookassa", "tbank"].includes(provider) ||
        !paymentId ||
        !Number.isSafeInteger(Number(orderId)) ||
        Number(orderId) <= 0
    ) {
        throw fail("Некорректные данные платежа");
    }

    return sequelize.transaction(async (transaction) => {
        const order = await Order.findByPk(orderId, {
            transaction,
            lock: transaction.LOCK.UPDATE,
        });

        if (!order) {
            throw fail("Заказ не найден");
        }

        const expected = expectedPromotionKopecks(order);

        if (
            expected <= 0 ||
            !Number.isSafeInteger(Number(amountKopecks)) ||
            Number(amountKopecks) !== expected
        ) {
            throw fail(
                "Сумма платежа не соответствует продвижению"
            );
        }

        if (
            String(order.promotionPaymentId || "") !==
            String(paymentId) ||
            order.promotionPaymentProvider !== provider
        ) {
            throw fail(
                "Платёж не соответствует сохранённому платежу заказа"
            );
        }

        // Повторное уведомление банка ничего не меняет.
        if (order.promotionPaidAt) {
            return {
                duplicate: true,
                sendPush: false,
                orderId: order.id,
            };
        }

        if (order.status !== "pending_payment") {
            throw fail(
                "Заказ больше не ожидает оплату продвижения"
            );
        }

        const options = promotionOptions(order);

        await order.update(
            {
                status:
                    order.paymentType === "guarantee"
                        ? order.status
                        : "pending",

                is_highlighted: options.highlight,
                is_recommended: options.recommended,
                is_push_notified: options.push,
                promotionPaidAt: new Date(),
            },
            { transaction }
        );

        return {
            duplicate: false,
            sendPush: options.push,
            orderId: order.id,
        };
    });
}

module.exports = {
    expectedPromotionKopecks,
    verifyYooPromotion,
    verifyTBankPromotion,
    applyVerifiedPromotion,
};