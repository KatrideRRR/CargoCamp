"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

const {
    buildGuaranteePreview,
} = require("../services/guaranteeQuoteService");

function createHarness(overrides = {}) {
    let stored = null;
    let createdCount = 0;

    const order = {
        id: 101,
        creatorId: 10,
        executorId: null,
        paymentType: "guarantee",
        status: "pending_payment",
        proposedSum: 10000,
        promotionRequested: {
            push: true,
        },
        ...overrides,
    };

    const transaction = {
        LOCK: { UPDATE: "UPDATE" },
    };

    const models = {
        sequelize: {
            async transaction(callback) {
                return callback(transaction);
            },
        },

        Order: {
            async findByPk(id, options) {
                assert.equal(options.transaction, transaction);
                return Number(id) === order.id
                    ? order
                    : null;
            },
        },

        GuaranteeFinancialSnapshot: {
            async findOne() {
                return stored;
            },

            async create(values, options) {
                assert.equal(options.transaction, transaction);
                createdCount++;

                stored = {
                    id: 1,
                    ...values,
                };

                return stored;
            },
        },
    };

    const service = loadIsolatedService(
        "guaranteeFinancialSnapshotService.js",
        {
            "../models": models,

            "./guaranteeQuoteService": {
                buildGuaranteePreview,
            },

            "./promotionPaymentService": {
                expectedPromotionKopecks(currentOrder) {
                    return currentOrder.promotionRequested?.push
                        ? 15000
                        : 0;
                },
            },
        }
    );

    const create = (provider = "tbank") =>
        service.createGuaranteePreviewSnapshot({
            orderId: 101,
            actorUserId: 10,
            provider,
        });

    return {
        order,
        create,
        get stored() {
            return stored;
        },
        get createdCount() {
            return createdCount;
        },
    };
}

test("Финансовый снимок правильно считает деньги", async () => {
    const h = createHarness();

    const result = await h.create();

    assert.equal(result.created, true);
    assert.equal(result.status, "quoted");
    assert.equal(result.availableForPayment, false);
    assert.equal(result.previewOnly, true);

    assert.equal(result.customerTotalKopecks, 1036600);
    assert.equal(result.executorPayoutKopecks, 949600);
    assert.equal(result.platformFeeKopecks, 72000);

    assert.equal(h.stored.lockedAt, null);
    assert.equal(h.stored.executorId, null);
    assert.equal(h.createdCount, 1);
});

test("Повторный запрос не создаёт второй снимок", async () => {
    const h = createHarness();

    const first = await h.create();
    const second = await h.create();

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(first.id, second.id);
    assert.equal(h.createdCount, 1);
});

test("Нельзя менять провайдера существующего снимка", async () => {
    const h = createHarness();

    await h.create("tbank");

    await assert.rejects(
        () => h.create("yookassa"),
        /другой финансовый расчёт/
    );
});

test("Нельзя менять сумму после создания снимка", async () => {
    const h = createHarness();

    await h.create();
    h.order.proposedSum = 12000;

    await assert.rejects(
        () => h.create(),
        /другой финансовый расчёт/
    );
});

test("Обычный заказ не создаёт гарантийный снимок", async () => {
    const h = createHarness({
        paymentType: "cash",
    });

    await assert.rejects(
        () => h.create(),
        /запрещён для обычной оплаты/
    );

    assert.equal(h.createdCount, 0);
});

test("Чужой пользователь не создаёт снимок", async () => {
    const h = createHarness({
        creatorId: 99,
    });

    await assert.rejects(
        () => h.create(),
        /Нет доступа/
    );
});

test("Завершённый заказ нельзя пересчитывать", async () => {
    const h = createHarness({
        status: "completed",
    });

    await assert.rejects(
        () => h.create(),
        /не находится на этапе/
    );
});