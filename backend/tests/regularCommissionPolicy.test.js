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
            isPensioner: true,
        },
        expected: 10000,
    },
    {
        name: "Рекомендованный заказ пенсионера",
        input: {
            isRecommended: true,
            isPensioner: true,
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
            isPensioner: true,
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
            isPensioner: true,
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