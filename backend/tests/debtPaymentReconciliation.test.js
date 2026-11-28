"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { QueryTypes } = require("sequelize");

const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

function createHarness({
                           provider = "yookassa",
                           paymentStatus = "pending",
                           bankStatus,
                           paymentId = "payment-101",
                           requestStatus = "pending",
                       } = {}) {
    const terminalKey =
        "CARGOCAMP_TEST_TERMINAL";

    const intent = {
        id: 11,
        userId: 7,
        orderId: 25,

        provider,
        paymentId,

        bankOrderId:
            "debt_7_test",

        amountKopecks: 20000,
        paymentStatus,
        requestStatus,
    };

    const calls = {
        bank: 0,
        settlement: 0,
        record: 0,
        finalize: 0,
        deliver: 0,
    };

    const bank = {
        status:
            bankStatus ||
            (
                provider === "yookassa"
                    ? "pending"
                    : "NEW"
            ),

        amount: 20000,
        userId: 7,
        intentId: 11,

        paymentId:
        intent.paymentId,

        bankOrderId:
        intent.bankOrderId,

        fail: false,
    };

    const service = loadIsolatedService(
        "debtPaymentReconciliationService.js",
        {
            sequelize: {
                QueryTypes,
            },

            "../models": {
                sequelize: {},
            },

            "../config/yookassaClient": {
                async getPayment(id) {
                    calls.bank++;

                    assert.equal(
                        id,
                        intent.paymentId
                    );

                    if (bank.fail) {
                        throw new Error(
                            "BANK_UNAVAILABLE"
                        );
                    }

                    return {
                        id: bank.paymentId,

                        status: bank.status,

                        amount: {
                            currency: "RUB",

                            value: (
                                bank.amount / 100
                            ).toFixed(2),
                        },

                        metadata: {
                            type: "debt",

                            userId:
                                String(bank.userId),

                            debtIntentId:
                                String(bank.intentId),
                        },
                    };
                },
            },

            "../config/tbankClient": {
                async requestTBank(
                    method,
                    params
                ) {
                    calls.bank++;

                    assert.equal(
                        method,
                        "GetState"
                    );

                    assert.equal(
                        params.PaymentId,
                        intent.paymentId
                    );

                    if (bank.fail) {
                        throw new Error(
                            "BANK_UNAVAILABLE"
                        );
                    }

                    return {
                        PaymentId:
                        bank.paymentId,

                        OrderId:
                        bank.bankOrderId,

                        Amount:
                        bank.amount,

                        Status:
                        bank.status,

                        TerminalKey:
                        terminalKey,
                    };
                },
            },

            "./debtPaymentIntentService": {
                async getDebtPaymentIntent({
                                               intentId,
                                               userId,
                                           }) {
                    assert.equal(intentId, 11);
                    assert.equal(userId, 7);

                    return { ...intent };
                },

                async recordDebtPaymentIntent(
                    data
                ) {
                    calls.record++;

                    intent.paymentStatus =
                        data.status;

                    return { ...intent };
                },

                publicDebtPaymentIntent(value) {
                    return { ...value };
                },
            },

            "./debtPaymentSettlementService": {
                async settleConfirmedDebtPayment(
                    data
                ) {
                    calls.settlement++;

                    assert.equal(
                        data.paymentId,
                        intent.paymentId
                    );

                    assert.equal(
                        data.amountKopecks,
                        intent.amountKopecks
                    );

                    intent.paymentStatus =
                        "succeeded";

                    intent.requestStatus =
                        "sent";
                },
            },

            "./debtOrderRequestService": {
                async finalizeDebtOrderRequest() {
                    calls.finalize++;

                    intent.requestStatus = "sent";

                    return {
                        notifications: [
                            { id: 1 },
                            { id: 2 },
                        ],
                    };
                },
            },

            "./debtOrderRequestDeliveryService": {
                async deliverDebtOrderRequestNotifications(
                    notifications
                ) {
                    calls.deliver +=
                        notifications.length;
                },
            },
        }
    );

    return {
        intent,
        calls,
        bank,
        terminalKey,

        reconcile() {
            return service.reconcileDebtPayment({
                intentId: 11,
                userId: 7,
            });
        },
    };
}

for (const provider of [
    "yookassa",
    "tbank",
]) {
    function configureTerminal(t) {
        const previous =
            process.env.TBANK_TERMINAL_KEY;

        process.env.TBANK_TERMINAL_KEY =
            "CARGOCAMP_TEST_TERMINAL";

        t.after(() => {
            if (previous === undefined) {
                delete process.env.TBANK_TERMINAL_KEY;
            } else {
                process.env.TBANK_TERMINAL_KEY =
                    previous;
            }
        });
    }

    test(
        `${provider}: confirmed payment is settled`,
        async (t) => {
            configureTerminal(t);

            const h = createHarness({
                provider,

                bankStatus:
                    provider === "yookassa"
                        ? "succeeded"
                        : "CONFIRMED",
            });

            const result =
                await h.reconcile();

            assert.equal(
                result.paymentStatus,
                "succeeded"
            );

            assert.equal(
                result.requestStatus,
                "sent"
            );

            assert.equal(
                h.calls.settlement,
                1
            );
        }
    );

    test(
        `${provider}: canceled payment becomes failed`,
        async (t) => {
            configureTerminal(t);

            const h = createHarness({
                provider,

                bankStatus:
                    provider === "yookassa"
                        ? "canceled"
                        : "CANCELED",
            });

            const result =
                await h.reconcile();

            assert.equal(
                result.paymentStatus,
                "failed"
            );

            assert.equal(
                h.calls.settlement,
                0
            );

            assert.equal(
                h.calls.record,
                1
            );
        }
    );

    test(
        `${provider}: pending payment stays pending`,
        async (t) => {
            configureTerminal(t);

            const h = createHarness({
                provider,
            });

            const result =
                await h.reconcile();

            assert.equal(
                result.paymentStatus,
                "pending"
            );

            assert.equal(
                h.calls.settlement,
                0
            );

            assert.equal(
                h.calls.record,
                0
            );
        }
    );

    test(
        `${provider}: wrong amount cannot be applied`,
        async (t) => {
            configureTerminal(t);

            const h = createHarness({
                provider,
            });

            h.bank.amount = 10000;

            await assert.rejects(
                h.reconcile(),
                /не соответствует/
            );

            assert.equal(
                h.calls.settlement,
                0
            );

            assert.equal(
                h.calls.record,
                0
            );
        }
    );

    test(
        `${provider}: unavailable bank does not unlock payment`,
        async (t) => {
            configureTerminal(t);

            const h = createHarness({
                provider,
            });

            h.bank.fail = true;

            await assert.rejects(
                h.reconcile(),
                /BANK_UNAVAILABLE/
            );

            assert.equal(
                h.intent.paymentStatus,
                "pending"
            );

            assert.equal(
                h.calls.record,
                0
            );

            assert.equal(
                h.calls.settlement,
                0
            );
        }
    );
}

test(
    "Missing PaymentId requires review",
    async () => {
        const h = createHarness({
            paymentId: null,
            paymentStatus: "unknown",
        });

        const result =
            await h.reconcile();

        assert.equal(
            result.needsReview,
            true
        );

        assert.equal(
            result.reason,
            "payment_id_missing"
        );

        assert.equal(h.calls.bank, 0);
        assert.equal(h.calls.record, 0);
    }
);

test(
    "Accounted payment resumes unfinished order request",
    async () => {
        const h = createHarness({
            paymentStatus: "succeeded",
            requestStatus: "pending",
        });

        const result =
            await h.reconcile();

        assert.equal(
            result.requestStatus,
            "sent"
        );

        assert.equal(h.calls.bank, 0);

        assert.equal(
            h.calls.settlement,
            0
        );

        assert.equal(
            h.calls.finalize,
            1
        );

        assert.equal(
            h.calls.deliver,
            2
        );
    }
);

test(
    "Completed order request is not recreated",
    async () => {
        const h = createHarness({
            paymentStatus: "succeeded",
            requestStatus: "sent",
        });

        await h.reconcile();
        await h.reconcile();

        assert.equal(h.calls.bank, 0);

        assert.equal(
            h.calls.finalize,
            0
        );

        assert.equal(
            h.calls.deliver,
            0
        );
    }
);

test(
    "YooKassa: another user's payment is rejected",
    async () => {
        const h = createHarness();

        h.bank.userId = 99;

        await assert.rejects(
            h.reconcile(),
            /не соответствует/
        );

        assert.equal(
            h.calls.settlement,
            0
        );
    }
);