"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { QueryTypes } = require("sequelize");

const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

function createHarness({
                           provider = "yookassa",
                           amount = 20000,
                       } = {}) {
    const user = {
        id: 7,
        debt: amount,
    };

    const intent = {
        id: 11,
        user_id: 7,
        order_id: 25,
        provider,
        amount_kopecks: amount,
        provider_payment_id: null,

        provider_order_id:
            provider === "tbank"
                ? "debt_7_28e07f49882140709e429ae59eb1965a"
                : null,

        payment_status: "pending",
        request_status: "pending",
    };

    const receipts = new Map();

    let paymentApplications = 0;
    let requestCreations = 0;
    let notificationDeliveries = 0;

    let failFinalization = false;

    const sequelize = {
        async transaction(callback) {
            return callback({
                LOCK: {
                    UPDATE: "UPDATE",
                },
            });
        },

        async query(sql, options) {
            const p = options.replacements;

            if (
                /SELECT \*/i.test(sql) &&
                /FROM debt_payment_intents/i.test(sql)
            ) {
                if (
                    Number(p.userId) !== user.id ||
                    p.provider !== intent.provider
                ) {
                    return [];
                }

                const matches =
                    (
                        intent.provider_payment_id &&
                        intent.provider_payment_id ===
                        p.paymentId
                    ) ||
                    (
                        p.intentId !== null &&
                        Number(p.intentId) === intent.id
                    ) ||
                    (
                        p.bankOrderId !== null &&
                        p.bankOrderId ===
                        intent.provider_order_id
                    );

                return matches
                    ? [{ ...intent }]
                    : [];
            }

            if (
                /SET provider_payment_id/i.test(sql)
            ) {
                intent.provider_payment_id =
                    p.paymentId;

                return [];
            }

            if (
                /FROM payment_receipts/i.test(sql)
            ) {
                const row = receipts.get(
                    `${p.provider}:${p.paymentId}`
                );

                return row ? [row] : [];
            }

            if (
                /SET payment_status = 'succeeded'/i
                    .test(sql)
            ) {
                intent.payment_status =
                    "succeeded";

                return [];
            }

            throw new Error(
                `Unexpected SQL: ${sql}`
            );
        },
    };

    const service = loadIsolatedService(
        "debtPaymentSettlementService.js",
        {
            sequelize: {
                QueryTypes,
            },

            "../models": {
                sequelize,

                User: {
                    async findByPk(id) {
                        return Number(id) === user.id
                            ? user
                            : null;
                    },
                },
            },

            "./paymentReceiptService": {
                async applyConfirmedPayment(payment) {
                    const key =
                        `${payment.provider}:${payment.paymentId}`;

                    if (receipts.has(key)) {
                        return {
                            duplicate: true,
                        };
                    }

                    paymentApplications++;

                    user.debt = Math.max(
                        0,
                        user.debt -
                        payment.amountKopecks
                    );

                    receipts.set(key, {
                        amount_kopecks:
                        payment.amountKopecks,
                    });

                    return {
                        duplicate: false,
                        appliedKopecks:
                        payment.amountKopecks,
                    };
                },
            },

            "./debtOrderRequestService": {
                async finalizeDebtOrderRequest() {
                    if (failFinalization) {
                        throw new Error(
                            "SIMULATED_CRASH"
                        );
                    }

                    assert.equal(
                        intent.payment_status,
                        "succeeded"
                    );

                    if (
                        intent.request_status !==
                        "pending"
                    ) {
                        return {
                            duplicate: true,
                            requestStatus:
                            intent.request_status,
                        };
                    }

                    requestCreations++;

                    intent.request_status = "sent";

                    return {
                        requestStatus: "sent",
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
                    notificationDeliveries +=
                        notifications.length;
                },
            },
        }
    );

    const pay = (overrides = {}) =>
        service.settleConfirmedDebtPayment({
            provider,

            paymentId: "bank-payment-1",

            userId: user.id,

            amountKopecks: amount,

            intentId:
                provider === "yookassa"
                    ? intent.id
                    : null,

            bankOrderId:
            intent.provider_order_id,

            ...overrides,
        });

    return {
        user,
        intent,
        pay,

        setFailFinalization(value) {
            failFinalization = value;
        },

        get paymentApplications() {
            return paymentApplications;
        },

        get requestCreations() {
            return requestCreations;
        },

        get notificationDeliveries() {
            return notificationDeliveries;
        },
    };
}

for (const provider of [
    "yookassa",
    "tbank",
]) {
    test(
        `${provider}: confirmed payment creates one request`,
        async () => {
            const h = createHarness({
                provider,
            });

            const result = await h.pay();

            assert.equal(
                result.paymentStatus,
                "succeeded"
            );

            assert.equal(
                result.requestStatus,
                "sent"
            );

            assert.equal(h.user.debt, 0);

            assert.equal(
                h.paymentApplications,
                1
            );

            assert.equal(
                h.requestCreations,
                1
            );

            assert.equal(
                h.notificationDeliveries,
                2
            );
        }
    );

    test(
        `${provider}: repeated confirmation is idempotent`,
        async () => {
            const h = createHarness({
                provider,
            });

            await h.pay();
            await h.pay();
            await h.pay();

            assert.equal(
                h.paymentApplications,
                1
            );

            assert.equal(
                h.requestCreations,
                1
            );

            assert.equal(
                h.notificationDeliveries,
                2
            );
        }
    );

    test(
        `${provider}: interrupted request can be resumed`,
        async () => {
            const h = createHarness({
                provider,
            });

            h.setFailFinalization(true);

            await assert.rejects(
                h.pay(),
                /SIMULATED_CRASH/
            );

            assert.equal(h.user.debt, 0);

            assert.equal(
                h.requestCreations,
                0
            );

            h.setFailFinalization(false);

            const result = await h.pay();

            assert.equal(
                result.requestStatus,
                "sent"
            );

            assert.equal(
                h.paymentApplications,
                1
            );

            assert.equal(
                h.requestCreations,
                1
            );
        }
    );

    test(
        `${provider}: mismatched amount is rejected`,
        async () => {
            const h = createHarness({
                provider,
            });

            await assert.rejects(
                h.pay({
                    amountKopecks: 10000,
                }),
                /не соответствует/
            );

            assert.equal(
                h.paymentApplications,
                0
            );

            assert.equal(
                h.requestCreations,
                0
            );

            assert.equal(
                h.user.debt,
                20000
            );
        }
    );

    test(
        `${provider}: different payment cannot reuse intent`,
        async () => {
            const h = createHarness({
                provider,
            });

            await h.pay();

            await assert.rejects(
                h.pay({
                    paymentId: "different-payment",
                }),
                /не соответствует/
            );

            assert.equal(
                h.paymentApplications,
                1
            );

            assert.equal(
                h.requestCreations,
                1
            );
        }
    );
}

test(
    "TBank: wrong bank order ID is rejected",
    async () => {
        const h = createHarness({
            provider: "tbank",
        });

        await assert.rejects(
            h.pay({
                bankOrderId: "wrong-order",
            }),
            /платёжное намерение/
        );

        assert.equal(
            h.paymentApplications,
            0
        );
    }
);