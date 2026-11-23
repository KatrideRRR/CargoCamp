"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    buildGuaranteePreview,
} = require("../services/guaranteeQuoteService");

test("Расчёт 10 000 ₽ совпадает с политикой", () => {
    const result = buildGuaranteePreview(1000000);

    assert.equal(result.previewOnly, true);
    assert.equal(result.availableForPayment, false);
    assert.equal(result.bankTariffsConfirmed, false);

    assert.equal(result.quote.feeKopecks, 72000);
    assert.equal(result.quote.buyerFeeKopecks, 21600);
    assert.equal(result.quote.executorFeeKopecks, 50400);
    assert.equal(
        result.quote.customerTotalKopecks,
        1021600
    );
    assert.equal(
        result.quote.executorPayoutKopecks,
        949600
    );
    assert.equal(
        result.quote.estimatedMarginKopecks,
        20793
    );
});

test("Цена и выплаты сходятся", () => {
    const result = buildGuaranteePreview(350123);
    const quote = result.quote;

    assert.equal(
        quote.customerTotalKopecks -
        quote.executorPayoutKopecks,
        quote.feeKopecks
    );
});

test("Некорректные цены не принимаются", () => {
    for (const value of [
        0,
        -100,
        100.5,
        30000001,
        "1000000",
    ]) {
        assert.throws(
            () => buildGuaranteePreview(value),
            RangeError
        );
    }
});

test("Невыгодная маленькая сделка отклоняется", () => {
    assert.throws(
        () => buildGuaranteePreview(10000),
        RangeError
    );
});
