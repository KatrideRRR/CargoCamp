const test = require("node:test");
const assert = require("node:assert/strict");

const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

function createService({
                           order = null,
                           intent = null,
                           yooPayment = null,
                           tbankPayment = null,
                           applyResult = {
                               duplicate: false,
                               sendPush: true,
                           },
                       } = {}) {
    const applied = [];

    const actualOrder = order || {
        id: 10,
        creatorId: 5,
        promotionPaymentId: "payment-1",
        promotionPaymentProvider: "yookassa",
    };

    const service = loadIsolatedService(
        "promotionPaymentReconciliationService.js",
        {
            sequelize: {
                QueryTypes: {
                    SELECT: "SELECT",
                },
            },

            "../models": {
                sequelize: {
                    async query() {
                        return intent ? [intent] : [];
                    },
                },

                Order: {
                    async findByPk() {
                        return actualOrder;
                    },
                },
            },

            "../config/yookassaClient": {
                async getPayment() {
                    return yooPayment;
                },
            },

            "../config/tbankClient": {
                async requestTBank() {
                    return tbankPayment;
                },
            },

            "./promotionPaymentService": {
                expectedPromotionKopecks() {
                    return 5000;
                },

                verifyYooPromotion(payment) {
                    if (
                        payment.status !== "succeeded" ||
                        payment.amount.value !== "50.00"
                    ) {
                        throw new Error(
                            "Invalid Yoo payment"
                        );
                    }
                },

                verifyTBankPromotion(payment) {
                    if (payment.Status !== "CONFIRMED") {
                        throw new Error(
                            "Invalid TBank payment"
                        );
                    }
                },

                async applyVerifiedPromotion(data) {
                    applied.push(data);

                    return applyResult;
                },
            },
        }
    );

    return {
        service,
        applied,
    };
}

test("ЮKassa: подтверждённый платёж применяется", async () => {
    const { service, applied } = createService({
        yooPayment: {
            id: "payment-1",
            status: "succeeded",

            amount: {
                value: "50.00",
                currency: "RUB",
            },
        },
    });

    const result =
        await service.reconcilePromotionPayment({
            orderId: 10,
        });

    assert.equal(result.status, "succeeded");
    assert.equal(result.newlyApplied, true);
    assert.equal(applied.length, 1);
});

test("ЮKassa: pending не активирует продвижение", async () => {
    const { service, applied } = createService({
        yooPayment: {
            id: "payment-1",
            status: "pending",
        },
    });

    const result =
        await service.reconcilePromotionPayment({
            orderId: 10,
        });

    assert.equal(result.status, "pending");
    assert.equal(applied.length, 0);
});

test("ЮKassa: чужой PaymentId отклоняется", async () => {
    const { service, applied } = createService({
        yooPayment: {
            id: "another-payment",
            status: "succeeded",
        },
    });

    await assert.rejects(
        () => service.reconcilePromotionPayment({
            orderId: 10,
        })
    );

    assert.equal(applied.length, 0);
});

test("Повторное подтверждение не требует повторного применения", async () => {
    const { service, applied } = createService({
        yooPayment: {
            id: "payment-1",
            status: "succeeded",
            amount: {
                value: "50.00",
                currency: "RUB",
            },
        },

        applyResult: {
            duplicate: true,
            sendPush: false,
        },
    });

    const result =
        await service.reconcilePromotionPayment({
            orderId: 10,
        });

    assert.equal(result.newlyApplied, false);
    assert.equal(result.sendPush, false);
    assert.equal(applied.length, 1);
});

test("Нет PaymentId — новая оплата не создаётся", async () => {
    const { service, applied } = createService({
        order: {
            id: 10,
            creatorId: 5,
            promotionPaymentId: null,
            promotionPaymentProvider: "yookassa",
        },
    });

    const result =
        await service.reconcilePromotionPayment({
            orderId: 10,
        });

    assert.equal(result.needsReview, true);
    assert.equal(applied.length, 0);
});

test("Т-Банк без сохранённого intent требует сверки", async () => {
    const { service, applied } = createService({
        order: {
            id: 10,
            creatorId: 5,
            promotionPaymentId: "12345",
            promotionPaymentProvider: "tbank",
        },
    });

    const result =
        await service.reconcilePromotionPayment({
            orderId: 10,
        });

    assert.equal(result.needsReview, true);
    assert.equal(applied.length, 0);
});