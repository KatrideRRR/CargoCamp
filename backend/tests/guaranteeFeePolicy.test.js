"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    calculateGuaranteeFee,
} = require("../utils/guaranteeFeePolicy");

const rates = {
    acquiringBps: 366,
    payoutBps: 100,
    taxBps: 600,
    buyerShareBps: 3000,
};

test("Гарантийный заказ 10 000 ₽", () => {
    const result = calculateGuaranteeFee({
        workPriceKopecks: 1000000,
        ...rates,
    });

    assert.equal(result.feeKopecks, 72000);
    assert.equal(result.buyerFeeKopecks, 21600);
    assert.equal(result.executorFeeKopecks, 50400);

    assert.equal(
        result.customerTotalKopecks,
        1021600
    );

    assert.equal(
        result.executorPayoutKopecks,
        949600
    );

    assert.equal(
        result.estimatedMarginKopecks,
        20793
    );
});

test("Деньги сходятся до копейки", () => {
    const result = calculateGuaranteeFee({
        workPriceKopecks: 350123,
        ...rates,
    });

    assert.equal(
        result.feeKopecks,
        result.buyerFeeKopecks +
        result.executorFeeKopecks
    );

    assert.equal(
        result.customerTotalKopecks -
        result.executorPayoutKopecks,
        result.feeKopecks
    );

    assert.ok(
        result.estimatedMarginKopecks >= 20000
    );
});

test("Неизвестные тарифы запрещены", () => {
    assert.throws(
        () => calculateGuaranteeFee({
            workPriceKopecks: 1000000,
        }),
        RangeError
    );
});

test("Убыточная маленькая сделка запрещена", () => {
    assert.throws(
        () => calculateGuaranteeFee({
            workPriceKopecks: 10000,
            ...rates,
        }),
        RangeError
    );
});
