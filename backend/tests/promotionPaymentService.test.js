const test = require("node:test");
const assert = require("node:assert/strict");

const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

const service = loadIsolatedService(
    "promotionPaymentService.js",
    {
        "../models": {
            sequelize: {},
            Order: {},
        },
    }
);

const {
    expectedPromotionKopecks,
    verifyYooPromotion,
    verifyTBankPromotion,
} = service;

function order() {
    return {
        id: 123,
        creatorId: 5,
        promotionRequested: {
            highlight: true,
            recommended: true,
            push: false,
        },
    };
}

function yooPayment() {
    return {
        id: "payment-1",
        status: "succeeded",
        amount: {
            value: "150.00",
            currency: "RUB",
        },
        metadata: {
            type: "order_promotion",
            orderId: "123",
            userId: "5",
        },
    };
}

function tbankPayment() {
    return {
        PaymentId: "98765",
        OrderId: "promo_123_1770000000000",
        Status: "CONFIRMED",
        TerminalKey: "TEST_TERMINAL",
        Amount: 15000,
    };
}

test("Стоимость продвижения вычисляется в копейках", () => {
    assert.equal(
        expectedPromotionKopecks(order()),
        15000
    );
});

test("Подтверждённый платёж ЮKassa принимается", () => {
    assert.equal(
        verifyYooPromotion(yooPayment(), order()),
        true
    );
});

test("ЮKassa: неверная сумма отклоняется", () => {
    const payment = yooPayment();

    payment.amount.value = "100.00";

    assert.throws(
        () => verifyYooPromotion(payment, order())
    );
});

test("ЮKassa: чужой пользователь отклоняется", () => {
    const payment = yooPayment();

    payment.metadata.userId = "999";

    assert.throws(
        () => verifyYooPromotion(payment, order())
    );
});

test("ЮKassa: неподтверждённый платёж отклоняется", () => {
    const payment = yooPayment();

    payment.status = "pending";

    assert.throws(
        () => verifyYooPromotion(payment, order())
    );
});

test("Т-Банк: подтверждённый платёж принимается", () => {
    const original = process.env.TBANK_TERMINAL_KEY;

    process.env.TBANK_TERMINAL_KEY =
        "TEST_TERMINAL";

    try {
        assert.equal(
            verifyTBankPromotion(
                tbankPayment(),
                order(),
                "98765",
                "promo_123_1770000000000"
            ),
            true
        );
    } finally {
        if (original === undefined) {
            delete process.env.TBANK_TERMINAL_KEY;
        } else {
            process.env.TBANK_TERMINAL_KEY = original;
        }
    }
});

test("Т-Банк: чужой заказ отклоняется", () => {
    const payment = tbankPayment();

    assert.throws(
        () => verifyTBankPromotion(
            payment,
            order(),
            "98765",
            "promo_999_1770000000000"
        )
    );
});

test("Т-Банк: несовпадающая сумма отклоняется", () => {
    const payment = tbankPayment();

    payment.Amount = 10000;

    assert.throws(
        () => verifyTBankPromotion(
            payment,
            order(),
            "98765",
            payment.OrderId
        )
    );
});

test("Т-Банк: неподтверждённый платёж отклоняется", () => {
    const payment = tbankPayment();

    payment.Status = "AUTHORIZED";

    assert.throws(
        () => verifyTBankPromotion(
            payment,
            order(),
            "98765",
            payment.OrderId
        )
    );
});