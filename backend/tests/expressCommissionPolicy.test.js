const test = require("node:test");
const assert = require("node:assert/strict");

const {
    calculateExpressCommission,
} = require("../utils/expressCommissionPolicy");

const now = new Date("2026-11-07T12:00:00Z");

test("Экспресс-комиссия составляет 10%", () => {
    const result = calculateExpressCommission({
        totalPriceRub: 1000,
        subscriptionType: "free",
        now,
    });

    assert.equal(result.feeKopecks, 10000);
    assert.equal(result.premiumActive, false);
});

test("Действующий Premium обнуляет комиссию", () => {
    const result = calculateExpressCommission({
        totalPriceRub: 1000,
        subscriptionType: "premium",
        subscriptionExpiresAt:
            "2026-12-01T00:00:00Z",
        now,
    });

    assert.equal(result.feeKopecks, 0);
    assert.equal(result.premiumActive, true);
});

test("Истёкший Premium не освобождает от комиссии", () => {
    const result = calculateExpressCommission({
        totalPriceRub: 1000,
        subscriptionType: "premium",
        subscriptionExpiresAt:
            "2026-11-01T00:00:00Z",
        now,
    });

    assert.equal(result.feeKopecks, 10000);
});

test("Premium без срока действия не считается активным", () => {
    const result = calculateExpressCommission({
        totalPriceRub: 1000,
        subscriptionType: "premium",
        subscriptionExpiresAt: null,
        now,
    });

    assert.equal(result.feeKopecks, 10000);
});

test("Комиссия округляется до копейки", () => {
    const result = calculateExpressCommission({
        totalPriceRub: 351.23,
        subscriptionType: "free",
        now,
    });

    assert.equal(result.totalKopecks, 35123);
    assert.equal(result.feeKopecks, 3512);
});

test("Нулевая стоимость отклоняется", () => {
    assert.throws(
        () => calculateExpressCommission({
            totalPriceRub: 0,
            now,
        }),
        RangeError
    );
});

test("Стоимость выше лимита отклоняется", () => {
    assert.throws(
        () => calculateExpressCommission({
            totalPriceRub: 300001,
            now,
        }),
        RangeError
    );
});