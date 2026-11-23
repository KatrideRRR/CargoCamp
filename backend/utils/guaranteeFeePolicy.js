"use strict";

const BPS = 10000;

function ceilRate(amountKopecks, rateBps) {
    return Math.ceil(amountKopecks * rateBps / BPS);
}

function calculateGuaranteeFee({
    workPriceKopecks,
    buyerShareBps = 3000,
    acquiringBps,
    payoutBps,
    taxBps,
    targetMarginKopecks = 20000,
    feeStepKopecks = 1000,
}) {
    if (
        !Number.isSafeInteger(workPriceKopecks) ||
        workPriceKopecks <= 0 ||
        workPriceKopecks > 30000000
    ) {
        throw new RangeError("Некорректная цена работы");
    }

    for (const value of [
        buyerShareBps,
        acquiringBps,
        payoutBps,
        taxBps,
    ]) {
        if (
            !Number.isSafeInteger(value) ||
            value < 0 ||
            value > BPS
        ) {
            throw new RangeError("Некорректный тариф");
        }
    }

    if (
        !Number.isSafeInteger(targetMarginKopecks) ||
        targetMarginKopecks < 0 ||
        !Number.isSafeInteger(feeStepKopecks) ||
        feeStepKopecks <= 0
    ) {
        throw new RangeError("Некорректные настройки комиссии");
    }

    for (
        let feeKopecks = 0;
        feeKopecks <= workPriceKopecks;
        feeKopecks += feeStepKopecks
    ) {
        const buyerFeeKopecks = Math.floor(
            feeKopecks * buyerShareBps / BPS
        );

        const executorFeeKopecks =
            feeKopecks - buyerFeeKopecks;

        const customerTotalKopecks =
            workPriceKopecks + buyerFeeKopecks;

        const executorPayoutKopecks =
            workPriceKopecks - executorFeeKopecks;

        if (executorPayoutKopecks <= 0) {
            continue;
        }

        const acquiringCostKopecks = ceilRate(
            customerTotalKopecks,
            acquiringBps
        );

        const payoutCostKopecks = ceilRate(
            executorPayoutKopecks,
            payoutBps
        );

        const estimatedTaxKopecks = ceilRate(
            feeKopecks,
            taxBps
        );

        const estimatedMarginKopecks =
            feeKopecks -
            acquiringCostKopecks -
            payoutCostKopecks -
            estimatedTaxKopecks;

        if (
            estimatedMarginKopecks >=
            targetMarginKopecks
        ) {
            return {
                workPriceKopecks,
                feeKopecks,
                buyerFeeKopecks,
                executorFeeKopecks,
                customerTotalKopecks,
                executorPayoutKopecks,
                acquiringCostKopecks,
                payoutCostKopecks,
                estimatedTaxKopecks,
                estimatedMarginKopecks,
            };
        }
    }

    throw new RangeError(
        "Для этой цены безопасная сделка невыгодна"
    );
}

module.exports = {
    calculateGuaranteeFee,
};
