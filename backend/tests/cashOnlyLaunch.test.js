"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    isLaunchPaymentTypeAllowed,
} = require("../utils/launchPaymentPolicy");

test("В релизе разрешена прямая оплата", () => {
    assert.equal(
        isLaunchPaymentTypeAllowed("cash"),
        true
    );
});

test("Гарантия и рассрочка отключены", () => {
    for (const value of [
        "guarantee",
        "installment",
        "installments",
        "",
        null,
        undefined,
    ]) {
        assert.equal(
            isLaunchPaymentTypeAllowed(value),
            false
        );
    }
});

test("Обычный API содержит релизную блокировку", () => {
    const source = fs.readFileSync(
        path.resolve(__dirname, "../routes/orders.js"),
        "utf8"
    );

    assert.match(
        source,
        /!isLaunchPaymentTypeAllowed\(paymentType\)/
    );
});

test("Административные API содержат блокировки", () => {
    const source = fs.readFileSync(
        path.resolve(__dirname, "../routes/admin.js"),
        "utf8"
    );

    assert.match(
        source,
        /!isLaunchPaymentTypeAllowed\(paymentType\)/
    );

    assert.match(
        source,
        /!isLaunchPaymentTypeAllowed\(normalizedPaymentType\)/
    );
});
