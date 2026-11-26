"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

function createHarness() {
    const calls = {
        adminQueries: 0,
        notifications: [],
        socket: [],
    };

    const source = fs.readFileSync(
        path.resolve(
            __dirname,
            "../services/orderPublicationService.js"
        ),
        "utf8"
    );

    const isolatedModule = {
        exports: {},
    };

    const dependencies = {
        "../models": {
            User: {
                async findAll() {
                    calls.adminQueries++;

                    return [
                        { id: 10 },
                        { id: 20 },
                    ];
                },
            },
        },

        "./notificationService": {
            async notifyMany(userIds, notification) {
                calls.notifications.push({
                    userIds,
                    notification,
                });
            },
        },
    };

    const factory = new Function(
        "require",
        "module",
        "exports",
        source
    );

    factory(
        (name) => {
            if (
                !Object.prototype.hasOwnProperty.call(
                    dependencies,
                    name
                )
            ) {
                throw new Error(
                    `Незамокированный импорт: ${name}`
                );
            }

            return dependencies[name];
        },
        isolatedModule,
        isolatedModule.exports
    );

    const io = {
        emit(event, payload) {
            calls.socket.push({
                event,
                payload,
            });
        },
    };

    const createDb = (order) => ({
        Order: {
            async findByPk() {
                return order;
            },
        },
        Category: {},
        Subcategory: {},
    });

    return {
        ...isolatedModule.exports,
        calls,
        io,
        createDb,
    };
}

function createOrder(overrides = {}) {
    return {
        id: 101,
        creatorId: 7,
        categoryId: 1,
        status: "pending",
        paymentType: "cash",
        promotionCost: 0,
        promotionRequested: {},
        promotionPaidAt: null,
        creatorHidden: false,
        adminDeleted: false,
        proposedSum: 1500,
        address: "Симферополь",
        ...overrides,
    };
}

test(
    "обычный заказ без продвижения можно публиковать",
    () => {
        const h = createHarness();

        assert.equal(
            h.canPublishOrder(createOrder()),
            true
        );
    }
);

test(
    "заказ pending_payment нельзя публиковать",
    () => {
        const h = createHarness();

        assert.equal(
            h.canPublishOrder(
                createOrder({
                    status: "pending_payment",
                    promotionCost: 100,
                })
            ),
            false
        );
    }
);

test(
    "статус pending не позволяет обойти оплату продвижения",
    () => {
        const h = createHarness();

        assert.equal(
            h.canPublishOrder(
                createOrder({
                    promotionCost: 100,
                    promotionRequested: {
                        recommended: true,
                    },
                })
            ),
            false
        );
    }
);

test(
    "выбранное продвижение требует оплаты даже при ошибочной нулевой стоимости",
    () => {
        const h = createHarness();

        assert.equal(
            h.canPublishOrder(
                createOrder({
                    promotionCost: 0,
                    promotionRequested: {
                        push: true,
                    },
                })
            ),
            false
        );
    }
);

test(
    "оплаченный заказ можно публиковать",
    () => {
        const h = createHarness();

        assert.equal(
            h.canPublishOrder(
                createOrder({
                    promotionCost: 150,
                    promotionPaidAt: new Date(),
                    is_push_notified: true,
                })
            ),
            true
        );
    }
);

test(
    "гарантийный заказ не публикуется",
    () => {
        const h = createHarness();

        assert.equal(
            h.canPublishOrder(
                createOrder({
                    paymentType: "guarantee",
                })
            ),
            false
        );
    }
);

test(
    "скрытый или удалённый заказ не публикуется",
    () => {
        const h = createHarness();

        for (const field of [
            "creatorHidden",
            "adminDeleted",
        ]) {
            assert.equal(
                h.canPublishOrder(
                    createOrder({
                        [field]: true,
                    })
                ),
                false
            );
        }
    }
);

test(
    "неоплаченный заказ не отправляет уведомления администраторам",
    async () => {
        const h = createHarness();

        const result =
            await h.notifyAdminsAboutNewOrder({
                order: createOrder({
                    status: "pending_payment",
                    promotionCost: 100,
                }),
            });

        assert.equal(result, false);
        assert.equal(h.calls.adminQueries, 0);
        assert.equal(
            h.calls.notifications.length,
            0
        );
    }
);

test(
    "неоплаченный заказ не отправляет событие публикации",
    async () => {
        const h = createHarness();

        const order = createOrder({
            status: "pending_payment",
            promotionCost: 100,
        });

        const result =
            await h.publishPaidOrder({
                db: h.createDb(order),
                io: h.io,
                orderId: order.id,
            });

        assert.equal(result, false);
        assert.equal(h.calls.socket.length, 0);

        assert.equal(
            h.calls.notifications.length,
            0
        );
    }
);

test(
    "оплаченный заказ отправляет Socket.IO и уведомление администраторам",
    async () => {
        const h = createHarness();

        const order = createOrder({
            promotionCost: 150,
            promotionPaidAt: new Date(),
            is_push_notified: true,
        });

        const result =
            await h.publishPaidOrder({
                db: h.createDb(order),
                io: h.io,
                orderId: order.id,
            });

        assert.equal(result, true);

        assert.equal(
            h.calls.socket.length,
            1
        );

        assert.equal(
            h.calls.socket[0].event,
            "orderUpdated"
        );

        assert.equal(
            h.calls.notifications.length,
            1
        );

        assert.deepEqual(
            h.calls.notifications[0].userIds,
            [10, 20]
        );

        assert.equal(
            h.calls.notifications[0]
                .notification.type,
            "admin_new_order"
        );

        assert.equal(
            h.calls.notifications[0]
                .notification.data.paidPromotionPush,
            true
        );
    }
);
