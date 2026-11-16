
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { Op } = require("sequelize");

const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

const {
    calculateRegularCommissionKopecks,
} = require("../utils/regularCommissionPolicy");

function createHarness({
                           benefitAtCreation = true,
                           currentBenefit = false,
                           premium = false,
                           recommended = false,
                       } = {}) {
    let benefitLookups = 0;
    const accruals = [];

    const executor = {
        id: 20,
        debt: 0,
        subscription_type:
            premium ? "premium" : "standard",
        subscription_expires_at:
            premium
                ? new Date(Date.now() + 86400000)
                : null,
    };

    const creator = { id: 10 };

    const order = {
        id: 101,
        creatorId: 10,
        executorId: null,
        paymentType: "cash",
        status: "pending",

        creatorSocialBenefitAtCreation:
        benefitAtCreation,

        is_recommended: recommended,
        creatorHidden: false,
        adminDeleted: false,

        requestedExecutors:
            JSON.stringify([20]),

        requests: JSON.stringify([
            {
                executorId: 20,
                proposedSum: 500,
            },
        ]),

        async save({ transaction }) {
            assert.ok(transaction);
        },
    };

    const models = {
        sequelize: {
            async transaction(callback) {
                return callback({
                    LOCK: {
                        UPDATE: "UPDATE",
                    },
                });
            },
        },

        User: {
            async findByPk(id) {
                if (Number(id) === 20) {
                    return executor;
                }

                if (Number(id) === 10) {
                    return creator;
                }

                return null;
            },
        },

        Order: {
            async findByPk(id) {
                return Number(id) === 101
                    ? order
                    : null;
            },

            async findOne() {
                return null;
            },
        },

        ExpressOrder: {
            async findOne() {
                return null;
            },
        },
    };

    const service = loadIsolatedService(
        "regularOrderAssignmentService.js",
        {
            sequelize: { Op },

            "../models": models,

            "./orderCommissionService": {
                async accrueOrderCommissionOnce(data) {
                    accruals.push(data);

                    return {
                        newlyAccrued: true,
                        amountKopecks:
                        data.amountKopecks,
                        debtKopecks:
                        data.amountKopecks,
                        chargeAttemptId: null,
                    };
                },
            },

            "./benefitService": {
                async hasSocialCommissionBenefit() {
                    benefitLookups++;
                    return currentBenefit;
                },
            },

            "../utils/regularCommissionPolicy": {
                calculateRegularCommissionKopecks,
            },
        }
    );

    return {
        order,
        accruals,

        get benefitLookups() {
            return benefitLookups;
        },

        assign() {
            return service.assignCashRegularOrder({
                orderId: 101,
                actorUserId: 10,
                executorId: 20,
            });
        },
    };
}

const scenarios = [
    {
        name: "Льгота была при создании, потом отозвана",
        atCreation: true,
        current: false,
        expected: 10000,
        lookups: 0,
    },
    {
        name: "Льготы не было, потом появилась",
        atCreation: false,
        current: true,
        expected: 20000,
        lookups: 0,
    },
    {
        name: "Старый заказ без снимка использует текущий статус",
        atCreation: null,
        current: true,
        expected: 10000,
        lookups: 1,
    },
    {
        name: "Рекомендованный заказ со льготой",
        atCreation: true,
        current: false,
        recommended: true,
        expected: 5000,
        lookups: 0,
    },
    {
        name: "Premium освобождён от комиссии",
        atCreation: false,
        current: true,
        premium: true,
        expected: 0,
        lookups: 0,
    },
];

for (const scenario of scenarios) {
    test(
        `Regular order benefit snapshot: ${scenario.name}`,
        async () => {
            const h = createHarness({
                benefitAtCreation:
                scenario.atCreation,
                currentBenefit:
                scenario.current,
                premium: scenario.premium,
                recommended: scenario.recommended,
            });

            const result = await h.assign();

            assert.equal(
                result.commissionKopecks,
                scenario.expected
            );

            assert.equal(
                h.accruals.length,
                1
            );

            assert.equal(
                h.accruals[0].amountKopecks,
                scenario.expected
            );

            assert.equal(
                h.benefitLookups,
                scenario.lookups
            );

            assert.equal(
                h.order.status,
                "active"
            );

            assert.equal(
                h.order.executorId,
                20
            );
        }
    );
}
