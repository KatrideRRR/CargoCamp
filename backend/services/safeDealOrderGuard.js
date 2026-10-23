
const {
    OrderSafeDeal,
} = require("../models");

const {
    isSafeDealOperational,
} = require("./guaranteeEligibilityService");

const {
    getDeal,
    getPayment,
} = require("./yooSafeDealClient");

const {
    verifySafeDealFunding,
} = require("./safeDealFundingVerifier");

function fail(status, message) {
    return Object.assign(
        new Error(message),
        { httpStatus: status }
    );
}

async function assertSafeDealFunded(
    order,
    { requiredAmountKopecks = null } = {}
) {
    if (order.paymentType !== "guarantee") {
        return null;
    }

    /*
     * Нельзя открыть гарантию простым
     * включением переменной окружения.
     */
    if (!isSafeDealOperational()) {
        throw fail(
            503,
            "Гарантийные сделки пока не подключены"
        );
    }

    const record = await OrderSafeDeal.findOne({
        where: {
            orderId: order.id,
            creatorId: order.creatorId,
            provider: "yookassa",
        },
    });

    if (
        !record ||
        record.status !== "funded" ||
        !record.fundedAt ||
        !record.providerDealId ||
        !record.providerPaymentId
    ) {
        throw fail(
            409,
            "Оплата гарантийной сделки не подтверждена"
        );
    }

    const expectedAmount =
        Number(record.expectedAmountKopecks);

    const fundedAmount =
        Number(record.fundedAmountKopecks);

    const payoutAmount =
        Number(record.sellerPayoutKopecks);

    const platformFee =
        Number(record.platformFeeKopecks);

    if (
        !Number.isSafeInteger(expectedAmount) ||
        expectedAmount <= 0 ||
        fundedAmount !== expectedAmount ||
        !Number.isSafeInteger(payoutAmount) ||
        payoutAmount <= 0 ||
        !Number.isSafeInteger(platformFee) ||
        platformFee <= 0 ||
        payoutAmount + platformFee !== expectedAmount
    ) {
        throw fail(
            409,
            "Некорректное финансовое обеспечение заказа"
        );
    }

    /*
     * Первая версия: согласованная цена
     * должна совпадать с оплаченной.
     *
     * Повышение и уменьшение стоимости
     * появятся через order_changes.
     */
    if (requiredAmountKopecks !== null) {
        const amount = Number(
            requiredAmountKopecks
        );

        if (
            !Number.isSafeInteger(amount) ||
            amount !== expectedAmount
        ) {
            throw fail(
                409,
                "Предложенная цена отличается от обеспеченной суммы. Изменение стоимости пока недоступно."
            );
        }
    }

    let providerDeal;
    let payment;

    try {
        [providerDeal, payment] =
            await Promise.all([
                getDeal(record.providerDealId),
                getPayment(record.providerPaymentId),
            ]);

    } catch (error) {
        console.error(
            "Safe Deal provider verification failed:",
            {
                orderId: order.id,
                message: error.message,
            }
        );

        throw fail(
            503,
            "Не удалось проверить обеспечение у платёжного партнёра"
        );
    }

    /*
     * Во время разработки исключаем
     * смешивание тестовых и реальных денег.
     */
    if (
        process.env.CARGOCAMP_SAFE_DEAL_MODE !==
        "sandbox" ||
        payment?.test !== true ||
        providerDeal?.test !== true
    ) {
        throw fail(
            503,
            "Режим гарантийной сделки не подтверждён"
        );
    }

    const check = verifySafeDealFunding({
        localDeal: record,
        providerDeal,
        payment,
    });

    if (!check.funded) {
        throw fail(
            409,
            "Средства больше не подтверждены платёжным партнёром"
        );
    }

    return {
        safeDealId: record.id,
        amountKopecks: expectedAmount,
        expiresAt: check.expiresAt,
    };
}

module.exports = {
    assertSafeDealFunded,
};
