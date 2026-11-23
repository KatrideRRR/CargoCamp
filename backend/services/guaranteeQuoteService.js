"use strict";

const {
    calculateGuaranteeFee,
} = require("../utils/guaranteeFeePolicy");

// Временные расчётные параметры.
// Это НЕ согласованные тарифы банков.
const PREVIEW_RATES = Object.freeze({
    buyerShareBps: 3000,
    acquiringBps: 366,
    payoutBps: 100,
    taxBps: 600,
    targetMarginKopecks: 20000,
    feeStepKopecks: 1000,
});

function buildGuaranteePreview(workPriceKopecks) {
    if (
        !Number.isSafeInteger(workPriceKopecks) ||
        workPriceKopecks <= 0 ||
        workPriceKopecks > 30000000
    ) {
        throw new RangeError(
            "Некорректная стоимость работы"
        );
    }

    const quote = calculateGuaranteeFee({
        workPriceKopecks,
        ...PREVIEW_RATES,
    });

    return {
        previewOnly: true,
        availableForPayment: false,
        bankTariffsConfirmed: false,
        pricingVersion: "guarantee-preview-v1",
        quote,
        assumptions: { ...PREVIEW_RATES },
    };
}

module.exports = {
    buildGuaranteePreview,
};
