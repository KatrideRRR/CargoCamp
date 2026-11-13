const test = require("node:test");
const assert = require("node:assert/strict");

const {
    calculateRegularCommissionKopecks,
} = require("../utils/regularCommissionPolicy");

const scenarios = [
    {
        name: "Обычный заказ без льготы",
        input: {},
        expected: 20000,
    },
    {
        name: "Рекомендованный заказ без льготы",
        input: {
            isRecommended: true,
        },
        expected: 10000,
    },
    {
        name: "Обычный заказ пенсионера",
        input: {
            hasSocialBenefit: true,
        },
        expected: 10000,
    },
    {
        name: "Рекомендованный заказ пенсионера",
        input: {
            isRecommended: true,
            hasSocialBenefit: true,
        },
        expected: 5000,
    },
    {
        name: "Premium без льготы",
        input: {
            isPremium: true,
        },
        expected: 0,
    },
    {
        name: "Premium с пенсионной льготой",
        input: {
            isPremium: true,
            hasSocialBenefit: true,
        },
        expected: 0,
    },
    {
        name: "Безналичная гарантийная сделка",
        input: {
            isCash: false,
        },
        expected: 0,
    },
    {
        name: "Гарантийная сделка пенсионера",
        input: {
            isCash: false,
            hasSocialBenefit: true,
        },
        expected: 0,
    },
];

for (const scenario of scenarios) {
    test(
        `Комиссия: ${scenario.name}`,
        () => {
            assert.equal(
                calculateRegularCommissionKopecks(
                    scenario.input
                ),
                scenario.expected
            );
        }
    );
}