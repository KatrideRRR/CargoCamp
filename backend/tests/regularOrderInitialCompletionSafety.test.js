
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Op } = require("sequelize");

const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

function createHarness() {
    const decisions = [];

    let activeDispute = false;
    let pendingChange = false;
    let failSave = false;

    const order = {
        id: 101,
        creatorId: 10,
        executorId: 20,
        status: "active",
        paymentType: "cash",
        proposedSum: 125,
        finalPriceKopecks: 12500,
        completedBy: [],
        completedAt: null,
        workStartedAt: new Date(),
        workEndedAt: null,
        workEndedBy: null,

        async save({ transaction }) {
            assert.ok(transaction);

            if (failSave) {
                throw new Error(
                    "ISOLATED_ORDER_SAVE_FAILURE"
                );
            }

            return this;
        },
    };

    let queue = Promise.resolve();

    const models = {
        sequelize: {
            async transaction(callback) {
                // Имитируем последовательное получение
                // блокировки строки заказа.
                const previous = queue;
                let release;

                queue = new Promise((resolve) => {
                    release = resolve;
                });

                await previous;

                const snapshot = {
                    status: order.status,
                    completedBy: [...order.completedBy],
                    completedAt: order.completedAt,
                    workEndedAt: order.workEndedAt,
                    workEndedBy: order.workEndedBy,
                };

                const decisionCount = decisions.length;

                try {
                    return await callback({
                        LOCK: {
                            UPDATE: "UPDATE",
                        },
                    });
                } catch (error) {
                    Object.assign(order, snapshot);
                    decisions.length = decisionCount;

                    throw error;
                } finally {
                    release();
                }
            },
        },

        Order: {
            async findByPk(id, options) {
                assert.equal(
                    options.lock,
                    options.transaction.LOCK.UPDATE
                );

                return Number(id) === 101
                    ? order
                    : null;
            },
        },

        Dispute: {
            async findOne() {
                return activeDispute
                    ? { id: 900 }
                    : null;
            },
        },

        OrderChangeRequest: {
            async findOne() {
                return pendingChange
                    ? { id: 901 }
                    : null;
            },
        },

        OrderCompletionDecision: {
            async findOne({ where }) {
                return decisions.find((item) =>
                    Number(item.orderId) ===
                    Number(where.orderId) &&
                    Number(item.userId) ===
                    Number(where.userId) &&
                    (
                        where.qualityDecision === undefined ||
                        item.qualityDecision ===
                        where.qualityDecision
                    )
                ) || null;
            },

            async create(values, options) {
                assert.ok(options.transaction);

                const saved = {
                    id: decisions.length + 1,
                    ...values,
                };

                decisions.push(saved);
                return saved;
            },
        },

        OrderCompletionCorrection: {
            async findOne() {
                return null;
            },
        },
    };

    const workflow = loadIsolatedService(
        "orderCompletionWorkflowService.js",
        {
            sequelize: { Op },
            "../models": models,
        }
    );

    function submit(
        userId,
        completion = {
            workConfirmed: true,
            cashStatus: "full",
            qualityDecision: "accepted",
        }
    ) {
        return workflow.submitInitialCompletion({
            orderId: 101,
            userId,
            completion,
            ipAddress: "127.0.0.1",
            userAgent: "CargoCamp-Test",
        });
    }

    return {
        order,
        decisions,
        submit,

        setDispute(value) {
            activeDispute = value;
        },

        setPendingChange(value) {
            pendingChange = value;
        },

        setFailSave(value) {
            failSave = value;
        },
    };
}

test(
    "Two participants complete a regular order exactly once",
    async () => {
        const h = createHarness();

        const executor = await h.submit(20);

        assert.equal(executor.changed, true);
        assert.equal(executor.completed, false);
        assert.equal(executor.phase, "awaiting_other");
        assert.equal(h.order.status, "active");

        const customer = await h.submit(10);

        assert.equal(customer.changed, true);
        assert.equal(customer.completed, true);
        assert.equal(customer.phase, "completed");

        assert.equal(h.order.status, "completed");
        assert.ok(h.order.completedAt);
        assert.ok(h.order.workEndedAt);

        assert.deepEqual(
            h.order.completedBy,
            [20, 10]
        );

        assert.equal(h.decisions.length, 2);

        assert.equal(
            h.decisions[0].partyRole,
            "executor"
        );

        assert.equal(
            h.decisions[1].partyRole,
            "creator"
        );

        for (const decision of h.decisions) {
            assert.equal(
                decision.payoutAuthorized,
                false
            );

            assert.equal(
                decision.cashAmountKopecks,
                12500
            );
        }

        const repeatCustomer = await h.submit(10);
        const repeatExecutor = await h.submit(20);

        assert.equal(repeatCustomer.changed, false);
        assert.equal(repeatExecutor.changed, false);
        assert.equal(h.decisions.length, 2);
    }
);

test(
    "Concurrent confirmations from one actor do not duplicate decisions",
    async () => {
        const h = createHarness();

        const results = await Promise.all([
            h.submit(20),
            h.submit(20),
        ]);

        assert.deepEqual(
            results.map((result) => result.changed).sort(),
            [false, true]
        );

        assert.equal(h.decisions.length, 1);

        assert.deepEqual(
            h.order.completedBy,
            [20]
        );

        assert.equal(h.order.status, "active");
    }
);

test(
    "Active dispute blocks customer acceptance",
    async () => {
        const h = createHarness();

        await h.submit(20);

        h.setDispute(true);

        await assert.rejects(
            h.submit(10),
            { httpStatus: 409 }
        );

        assert.equal(h.order.status, "active");
        assert.deepEqual(
            h.order.completedBy,
            [20]
        );

        assert.equal(h.decisions.length, 1);

        h.setDispute(false);

        const result = await h.submit(10);

        assert.equal(result.completed, true);
        assert.equal(h.decisions.length, 2);
    }
);

test(
    "Pending additional work blocks completion",
    async () => {
        const h = createHarness();

        h.setPendingChange(true);

        await assert.rejects(
            h.submit(20),
            { httpStatus: 409 }
        );

        assert.equal(h.decisions.length, 0);
        assert.equal(h.order.status, "active");
    }
);

test(
    "Third party cannot confirm an order",
    async () => {
        const h = createHarness();

        await assert.rejects(
            h.submit(30),
            { httpStatus: 403 }
        );

        assert.equal(h.decisions.length, 0);
    }
);

test(
    "Remarks keep the order active until corrections",
    async () => {
        const h = createHarness();

        await h.submit(10, {
            workConfirmed: true,
            cashStatus: "partial",
            cashAmountKopecks: 2500,
            qualityDecision: "remarks",
            remarks:
                "Исполнитель повредил часть мебели.",
        });

        const result = await h.submit(20);

        assert.equal(result.completed, false);
        assert.equal(result.phase, "needs_correction");
        assert.equal(h.order.status, "active");

        const customerDecision = h.decisions.find(
            (item) => item.userId === 10
        );

        assert.equal(
            customerDecision.cashAmountKopecks,
            2500
        );

        assert.equal(
            customerDecision.payoutAuthorized,
            false
        );
    }
);

test(
    "Invalid partial cash amounts are rejected",
    async () => {
        for (const amount of [
            0,
            -1,
            12500,
            12501,
            "2500",
            NaN,
        ]) {
            const h = createHarness();

            await assert.rejects(
                h.submit(10, {
                    workConfirmed: true,
                    cashStatus: "partial",
                    cashAmountKopecks: amount,
                    qualityDecision: "accepted",
                }),
                { httpStatus: 400 }
            );

            assert.equal(h.decisions.length, 0);
            assert.equal(h.order.status, "active");
        }
    }
);

test(
    "Completion never authorizes guarantee payout",
    async () => {
        const h = createHarness();

        await assert.rejects(
            h.submit(10, {
                workConfirmed: true,
                cashStatus: "full",
                qualityDecision: "accepted",
                payoutAuthorized: true,
            }),
            { httpStatus: 409 }
        );

        assert.equal(h.decisions.length, 0);
    }
);

test(
    "Failed order save rolls back completion decision",
    async () => {
        const h = createHarness();

        h.setFailSave(true);

        await assert.rejects(
            h.submit(20),
            /ISOLATED_ORDER_SAVE_FAILURE/
        );

        assert.equal(h.decisions.length, 0);
        assert.deepEqual(h.order.completedBy, []);
        assert.equal(h.order.workEndedAt, null);
        assert.equal(h.order.status, "active");

        h.setFailSave(false);

        const retry = await h.submit(20);

        assert.equal(retry.changed, true);
        assert.equal(h.decisions.length, 1);
    }
);
