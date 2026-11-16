
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Op, QueryTypes } = require("sequelize");

const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

function createHarness() {
    const user = {
        id: 7,
        debt: 20000,
        commissionDebtOrderId: null,
        subscription_type: "standard",
        subscription_expires_at: null,
        premium_last_payment_id: null,

        async update(values, options) {
            assert.ok(options.transaction);
            Object.assign(this, values);
        },
    };

    const attempts = new Map([
        [1, {
            id: 1,
            provider: "yookassa",
            user_id: 7,
            amount_kopecks: 10000,
            provider_payment_id: null,
            source_type: "express",
            source_id: 101,
            status: "prepared",
        }],
        [2, {
            id: 2,
            provider: "yookassa",
            user_id: 7,
            amount_kopecks: 10000,
            provider_payment_id: null,
            source_type: "express",
            source_id: 102,
            status: "prepared",
        }],
    ]);

    const receipts = new Map();
    const logs = [];

    let failAudit = false;
    let expressUpdates = 0;

    function key(provider, paymentId) {
        return `${provider}:${paymentId}`;
    }

    const sequelize = {
        async transaction(callback) {
            const userBefore = Object.fromEntries(
                Object.entries(user).filter(
                    ([, value]) =>
                        typeof value !== "function"
                )
            );

            const receiptBefore = new Map(receipts);

            const attemptsBefore = new Map(
                [...attempts].map(
                    ([id, row]) => [id, { ...row }]
                )
            );

            const logCount = logs.length;
            const previousUpdates = expressUpdates;

            const transaction = {
                LOCK: {
                    UPDATE: "UPDATE",
                },
            };

            try {
                return await callback(transaction);
            } catch (error) {
                Object.assign(user, userBefore);

                receipts.clear();

                for (const [k, value] of receiptBefore) {
                    receipts.set(k, value);
                }

                attempts.clear();

                for (const [id, row] of attemptsBefore) {
                    attempts.set(id, row);
                }

                logs.length = logCount;
                expressUpdates = previousUpdates;

                throw error;
            }
        },

        async query(sql, options) {
            assert.ok(options.transaction);

            const p = options.replacements || {};

            if (/FROM\s+commission_charge_attempts/i.test(sql)) {
                const row = attempts.get(
                    Number(p.attemptId)
                );

                return row ? [{ ...row }] : [];
            }

            if (/UPDATE\s+commission_charge_attempts/i.test(sql)) {
                const row = attempts.get(
                    Number(p.attemptId)
                );

                assert.ok(row);

                row.status = "succeeded";
                row.provider_payment_id = p.paymentId;

                return [];
            }

            if (/FROM\s+payment_receipts/i.test(sql)) {
                const row = receipts.get(
                    key(p.provider, p.paymentId)
                );

                return row ? [{ ...row }] : [];
            }

            if (/INSERT\s+INTO\s+payment_receipts/i.test(sql)) {
                const receiptKey = key(
                    p.provider,
                    p.paymentId
                );

                assert.equal(
                    receipts.has(receiptKey),
                    false,
                    "Duplicate receipt INSERT"
                );

                receipts.set(receiptKey, {
                    provider: p.provider,
                    payment_id: p.paymentId,
                    user_id: p.userId,
                    purpose: p.purpose,
                    amount_kopecks: p.amount,
                    applied_kopecks: p.applied,
                });

                return [];
            }

            throw new Error(
                `Unexpected SQL in isolated test: ${sql}`
            );
        },
    };

    const service = loadIsolatedService(
        "paymentReceiptService.js",
        {
            sequelize: { Op, QueryTypes },

            "../models": {
                sequelize,

                User: {
                    async findByPk(id, options) {
                        assert.ok(options.transaction);

                        return Number(id) === 7
                            ? user
                            : null;
                    },
                },

                ActionLog: {
                    async findAll() {
                        return [];
                    },

                    async create(entry, options) {
                        assert.ok(options.transaction);

                        if (failAudit) {
                            throw new Error(
                                "ISOLATED_AUDIT_FAILURE"
                            );
                        }

                        logs.push(entry);
                    },
                },

                ExpressOrder: {
                    async update(values, options) {
                        assert.ok(options.transaction);
                        assert.equal(
                            values.commissionStatus,
                            "paid"
                        );

                        expressUpdates += 1;
                        return [1];
                    },
                },
            },
        }
    );

    async function pay({
                           provider = "yookassa",
                           paymentId = "payment-1",
                           purpose = "debt",
                           amountKopecks = 10000,
                           duration = null,
                           commissionAttemptId = null,
                       } = {}) {
        return service.applyConfirmedPayment({
            provider,
            paymentId,
            userId: 7,
            purpose,
            amountKopecks,
            duration,
            commissionAttemptId,
        });
    }

    return {
        user,
        attempts,
        receipts,
        logs,
        pay,

        setFailAudit(value) {
            failAudit = value;
        },

        get expressUpdates() {
            return expressUpdates;
        },
    };
}

test("Debt payment is applied only once", async () => {
    const h = createHarness();

    const first = await h.pay();

    assert.equal(first.duplicate, false);
    assert.equal(first.appliedKopecks, 10000);
    assert.equal(h.user.debt, 10000);

    const second = await h.pay();

    assert.equal(second.duplicate, true);
    assert.equal(h.user.debt, 10000);
    assert.equal(h.receipts.size, 1);
    assert.equal(h.logs.length, 1);
});

test(
    "Duplicate receipt cannot settle a different commission",
    async () => {
        const h = createHarness();

        await h.pay({
            commissionAttemptId: 1,
        });

        assert.equal(
            h.attempts.get(1).status,
            "succeeded"
        );

        assert.equal(h.expressUpdates, 1);

        const repeat = await h.pay({
            commissionAttemptId: 2,
        });

        assert.equal(repeat.duplicate, true);

        // Повторное уведомление не вправе
        // закрыть другую комиссию.
        assert.equal(
            h.attempts.get(2).status,
            "prepared"
        );

        assert.equal(
            h.attempts.get(2).provider_payment_id,
            null
        );

        assert.equal(h.expressUpdates, 1);
        assert.equal(h.user.debt, 10000);
        assert.equal(h.logs.length, 1);
    }
);

test(
    "Same payment ID from different providers is independent",
    async () => {
        const h = createHarness();

        await h.pay({
            provider: "yookassa",
            paymentId: "shared-id",
        });

        await h.pay({
            provider: "tbank",
            paymentId: "shared-id",
        });

        assert.equal(h.user.debt, 0);
        assert.equal(h.receipts.size, 2);
        assert.equal(h.logs.length, 2);
    }
);

test(
    "Conflicting replay data is rejected",
    async () => {
        const h = createHarness();

        await h.pay();

        await assert.rejects(
            h.pay({
                amountKopecks: 20000,
            }),
            /Конфликт данных/
        );

        assert.equal(h.receipts.size, 1);
        assert.equal(h.user.debt, 10000);
    }
);

test(
    "Premium activation does not extend twice",
    async () => {
        const h = createHarness();

        const payment = {
            provider: "tbank",
            paymentId: "premium-1",
            purpose: "premium",
            duration: "7d",
            amountKopecks: 250000,
        };

        const first = await h.pay(payment);

        assert.equal(first.duplicate, false);

        assert.equal(
            h.user.subscription_type,
            "premium"
        );

        const expiresAt = new Date(
            h.user.subscription_expires_at
        ).getTime();

        const second = await h.pay(payment);

        assert.equal(second.duplicate, true);

        assert.equal(
            new Date(
                h.user.subscription_expires_at
            ).getTime(),
            expiresAt
        );

        assert.equal(h.receipts.size, 1);
    }
);

test(
    "Failed audit rolls back payment accounting",
    async () => {
        const h = createHarness();

        h.setFailAudit(true);

        await assert.rejects(
            h.pay(),
            /ISOLATED_AUDIT_FAILURE/
        );

        assert.equal(h.user.debt, 20000);
        assert.equal(h.receipts.size, 0);
        assert.equal(h.logs.length, 0);

        h.setFailAudit(false);

        const retried = await h.pay();

        assert.equal(retried.duplicate, false);
        assert.equal(h.user.debt, 10000);
        assert.equal(h.receipts.size, 1);
    }
);

test(
    "Unknown providers and invalid amounts are rejected",
    async () => {
        const h = createHarness();

        await assert.rejects(
            h.pay({
                provider: "unknown",
            }),
            /Некорректные данные/
        );

        await assert.rejects(
            h.pay({
                amountKopecks: -1,
            }),
            /Некорректные данные/
        );

        await assert.rejects(
            h.pay({
                purpose: "premium",
                duration: "30d",
                amountKopecks: 250000,
            }),
            /не соответствует тарифу/
        );

        assert.equal(h.receipts.size, 0);
    }
);
