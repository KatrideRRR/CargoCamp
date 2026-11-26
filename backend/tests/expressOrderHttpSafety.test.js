
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { Op } = require("sequelize");

const {
    loadIsolatedRouter,
} = require("./helpers/loadIsolatedRouter");

const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

const {
    calculateExpressCommission,
} = require("../utils/expressCommissionPolicy");

function snapshot(record) {
    return Object.fromEntries(
        Object.entries(record)
            .filter(([, value]) =>
                typeof value !== "function"
            )
            .map(([key, value]) => [
                key,
                structuredClone(value),
            ])
    );
}

async function createHarness({
                                 type = "taxi",
                                 benefitAtCreation = true,
                                 currentBenefit = false,
                                 premium = false,
                                 autoPaid = false,
                             } = {}) {
    const flags = {
        busyRegular: false,
        failPrepare: false,
        failOrderSave: false,
    };

    const calls = {
        prepared: [],
        charged: [],
        logs: [],
        notifications: [],
        benefitLookups: 0,

        reservationActivations: [],
        reservationQueries: [],
    };

    const executor = {
        id: 20,
        debt: 0,

        subscription_type:
            premium ? "premium" : "standard",

        subscription_expires_at:
            premium
                ? new Date(Date.now() + 86400000)
                : null,

        vehicleBrand: "Toyota",
        vehicleModel: "Camry",
        vehicleColor: "Белый",
        vehiclePlate: "А123АА82",
        vehiclePhoto: "/test-car.jpg",
        vehicleVerificationStatus: "verified",

        async save({ transaction }) {
            assert.ok(transaction);
            return this;
        },
    };

    const order = {
        id: 101,
        type,
        creatorId: 10,
        executorId: null,

        status: "created",
        dealStatus: "none",
        totalPrice: 1000,

        creatorHidden: false,
        adminDeleted: false,

        creatorSocialBenefitAtCreation:
        benefitAtCreation,

        recommendedPrice: 1000,
        commissionStatus: "none",
        commissionKopecks: 0,
        commissionChargedAt: null,
        completedAt: null,

        async save({ transaction }) {
            assert.ok(transaction);

            if (flags.failOrderSave) {
                throw new Error(
                    "ISOLATED_EXPRESS_SAVE_FAILURE"
                );
            }

            return this;
        },
    };

    let queue = Promise.resolve();

    async function makeTransaction() {
        const previous = queue;
        let release;

        queue = new Promise((resolve) => {
            release = resolve;
        });

        await previous;

        const orderBefore = snapshot(order);
        const executorBefore = snapshot(executor);
        const preparedCount = calls.prepared.length;

        const reservationActivationsCount =
            calls.reservationActivations.length;

        const reservationQueriesCount =
            calls.reservationQueries.length;

        let finished = null;

        return {
            LOCK: {
                UPDATE: "UPDATE",
            },

            get finished() {
                return finished;
            },

            async commit() {
                assert.equal(finished, null);
                finished = "commit";
                release();
            },

            async rollback() {
                if (finished) return;

                Object.assign(order, orderBefore);
                Object.assign(executor, executorBefore);

                calls.prepared.length = preparedCount;

                calls.reservationActivations.length =
                    reservationActivationsCount;

                calls.reservationQueries.length =
                    reservationQueriesCount;

                finished = "rollback";
                release();
            },
        };
    }

    const sequelize = {
        async query(sql, options = {}) {
            const normalizedSql =
                String(sql)
                    .replace(/\s+/g, " ")
                    .trim();

            assert.ok(
                options.transaction,
                "SQL-запрос бронирования должен выполняться в транзакции"
            );

            if (
                /^UPDATE express_reservation_requests SET status = 'rejected', resolved_at = CURRENT_TIMESTAMP\(3\) WHERE order_id = :orderId AND status = 'pending'$/i
                    .test(normalizedSql)
            ) {
                assert.equal(
                    Number(options.replacements?.orderId),
                    order.id
                );

                calls.reservationQueries.push({
                    sql: normalizedSql,
                    orderId:
                    options.replacements.orderId,
                });

                return [undefined, 0];
            }

            throw new Error(
                `UNEXPECTED_SQL_QUERY: ${normalizedSql}`
            );
        },

        async transaction(callback) {
            const transaction =
                await makeTransaction();

            // expressorders.js использует
            // sequelize.transaction() с ручным COMMIT.
            if (typeof callback !== "function") {
                return transaction;
            }

            // Lifecycle service использует
            // sequelize.transaction(callback).
            try {
                const result =
                    await callback(transaction);

                await transaction.commit();
                return result;
            } catch (error) {
                await transaction.rollback();
                throw error;
            }
        },
    };

    const ExpressOrder = {
        async findByPk(id) {
            return Number(id) === order.id
                ? order
                : null;
        },

        async findOne({ where }) {
            if (
                Number(where.executorId) === 20 &&
                Number(order.executorId) === 20 &&
                ![
                    "completed",
                    "cancelled",
                ].includes(order.status)
            ) {
                return order;
            }

            return null;
        },
    };

    const models = {
        sequelize,
        ExpressOrder,

        ExpressSavedAddress: {},

        User: {
            async findByPk(id) {
                if (Number(id) === 20) {
                    return executor;
                }

                if (Number(id) === 10) {
                    return { id: 10 };
                }

                if (Number(id) === 30) {
                    return { id: 30 };
                }

                return null;
            },
        },

        Order: {
            async findOne() {
                return flags.busyRegular
                    ? { id: 999, status: "active" }
                    : null;
            },
        },
    };

    const lifecycle = loadIsolatedService(
        "expressOrderLifecycleService.js",
        {
            "../models": models,
        }
    );

    const router = loadIsolatedRouter(
        "expressorders.js",
        {
            express,
            sequelize: { Op },

            "../middlewares/userAuth": (
                req,
                res,
                next
            ) => {
                const actor = Number(
                    req.headers["x-test-actor"]
                );

                if (!Number.isSafeInteger(actor) ||
                    actor <= 0) {
                    return res.status(401).json({
                        success: false,
                    });
                }

                req.user = { id: actor };
                next();
            },

            "../models": models,

            "../services/commissionAutoChargeService": {
                async prepareCommissionChargeAttempt({
                                                         transaction,
                                                         sourceType,
                                                         sourceId,
                                                         amountKopecks,
                                                     }) {
                    assert.ok(transaction);

                    if (flags.failPrepare) {
                        throw new Error(
                            "ISOLATED_PREPARE_FAILURE"
                        );
                    }

                    const id =
                        calls.prepared.length + 1;

                    calls.prepared.push({
                        id,
                        sourceType,
                        sourceId,
                        amountKopecks,
                    });

                    return id;
                },

                async startCommissionAutoCharge(id) {
                    calls.charged.push(id);

                    return {
                        autoPaymentPaid: autoPaid,
                    };
                },
            },

            "../services/notificationService": {
                async notifyUser(data) {
                    calls.notifications.push(data);
                },

                async notifyMany(ids, data) {
                    calls.notifications.push({
                        ids,
                        ...data,
                    });
                },
            },

            "../services/expressPushService": {
                async notifyNearbyExpressExecutors() {
                    return null;
                },
            },

            "../services/expressOrderLifecycleService":
            lifecycle,

            "../services/expressReservationService": {
                async requestExpressReservation() {
                    throw new Error(
                        "UNEXPECTED_RESERVATION_REQUEST"
                    );
                },

                async listExpressReservationRequests() {
                    throw new Error(
                        "UNEXPECTED_RESERVATION_LIST"
                    );
                },

                async approveExpressReservation() {
                    throw new Error(
                        "UNEXPECTED_RESERVATION_APPROVAL"
                    );
                },

                async rejectExpressReservation() {
                    throw new Error(
                        "UNEXPECTED_RESERVATION_REJECTION"
                    );
                },

                async cancelExpressReservation() {
                    throw new Error(
                        "UNEXPECTED_RESERVATION_CANCELLATION"
                    );
                },

                async activateNextExpressOrder({
                                                   sourceOrder,
                                                   executorId,
                                                   transaction,
                                               }) {
                    assert.ok(transaction);

                    assert.equal(
                        sourceOrder.status,
                        "completed"
                    );

                    assert.equal(
                        Number(sourceOrder.executorId),
                        Number(executorId)
                    );

                    calls.reservationActivations.push({
                        sourceOrderId: sourceOrder.id,
                        executorId,
                    });

                    return null;
                },
            },

            "../services/benefitService": {
                async hasSocialCommissionBenefit() {
                    calls.benefitLookups += 1;
                    return currentBenefit;
                },
            },

            "../utils/expressCommissionPolicy": {
                calculateExpressCommission,
            },
        }
    );

    const app = express();

    app.use(express.json());

    app.use((req, res, next) => {
        req.logAction = async (data) => {
            calls.logs.push(data);
        };

        next();
    });

    app.use(router);

    const server = await new Promise(
        (resolve, reject) => {
            const instance = app.listen(
                0,
                "127.0.0.1",
                () => resolve(instance)
            );

            instance.once("error", reject);
        }
    );

    const base =
        `http://127.0.0.1:${server.address().port}`;

    async function post(action, actor = 20) {
        const response = await fetch(
            `${base}/express-orders/101/${action}`,
            {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/json",
                    "x-test-actor": String(actor),
                },
                body: "{}",
            }
        );

        return {
            status: response.status,
            body: await response.json(),
        };
    }

    async function beginWork() {
        const steps = type === "taxi"
            ? [
                "accept",
                "on-the-way",
                "arrived",
                "start-waiting",
                "start",
            ]
            : [
                "accept",
                "on-the-way",
                "arrived",
                "pick-up",
                "start",
            ];

        for (const action of steps) {
            const result = await post(action);

            assert.equal(
                result.status,
                200,
                `Failed step: ${action}`
            );
        }

        assert.equal(
            order.status,
            "in_progress"
        );
    }

    async function close() {
        const closed = new Promise(
            (resolve, reject) => {
                server.close((error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });
            }
        );

        server.closeAllConnections?.();

        await closed;
    }

    return {
        executor,
        order,
        flags,
        calls,
        post,
        beginWork,
        close,
    };
}

test(
    "Taxi requires a verified vehicle and freezes its details",
    async (t) => {
        const h = await createHarness();
        t.after(() => h.close());

        h.executor.vehicleVerificationStatus =
            "pending";

        let result = await h.post("accept");

        assert.equal(result.status, 403);
        assert.equal(
            result.body.code,
            "TAXI_VEHICLE_PENDING"
        );

        h.executor.vehicleVerificationStatus =
            "rejected";

        result = await h.post("accept");

        assert.equal(result.status, 403);
        assert.equal(
            result.body.code,
            "TAXI_VEHICLE_REJECTED"
        );

        h.executor.vehicleVerificationStatus =
            "verified";

        result = await h.post("accept");

        assert.equal(result.status, 200);
        assert.equal(h.order.status, "accepted");

        assert.equal(
            h.order.executorVehiclePlate,
            "А123АА82"
        );

        assert.equal(
            h.order.executorVehicleBrand,
            "Toyota"
        );

        // Редактирование профиля не должно
        // переписывать историю принятого заказа.
        h.executor.vehiclePlate = "В999ВВ82";

        assert.equal(
            h.order.executorVehiclePlate,
            "А123АА82"
        );

        assert.equal(h.calls.prepared.length, 0);
        assert.equal(h.calls.charged.length, 0);
        assert.equal(h.executor.debt, 0);

        assert.equal(
            (await h.post("accept")).status,
            409
        );
    }
);

test(
    "Courier does not require a verified car",
    async (t) => {
        const h = await createHarness({
            type: "courier",
        });

        t.after(() => h.close());

        h.executor.vehicleBrand = null;
        h.executor.vehicleModel = null;
        h.executor.vehicleColor = null;
        h.executor.vehiclePlate = null;

        h.executor.vehicleVerificationStatus =
            "unverified";

        const result = await h.post("accept");

        assert.equal(result.status, 200);
        assert.equal(h.order.status, "accepted");
        assert.equal(h.order.executorId, 20);
    }
);

test(
    "Busy regular order prevents express acceptance",
    async (t) => {
        const h = await createHarness();
        t.after(() => h.close());

        h.flags.busyRegular = true;

        assert.equal(
            (await h.post("accept")).status,
            409
        );

        assert.equal(h.order.status, "created");
        assert.equal(h.order.executorId, null);

        h.flags.busyRegular = false;

        assert.equal(
            (await h.post("accept")).status,
            200
        );
    }
);

test(
    "Own express order cannot be accepted",
    async (t) => {
        const h = await createHarness();
        t.after(() => h.close());

        assert.equal(
            (await h.post("accept", 10)).status,
            409
        );

        assert.equal(h.order.executorId, null);
        assert.equal(h.order.status, "created");
    }
);

test(
    "Concurrent acceptance produces one winner",
    async (t) => {
        const h = await createHarness();
        t.after(() => h.close());

        const results = await Promise.all([
            h.post("accept"),
            h.post("accept"),
        ]);

        assert.deepEqual(
            results.map((r) => r.status).sort(),
            [200, 409]
        );

        assert.equal(h.order.status, "accepted");
        assert.equal(h.order.executorId, 20);

        assert.equal(
            h.calls.logs.filter((entry) =>
                entry.actionType ===
                "express_order_accept"
            ).length,
            1
        );
    }
);

test(
    "Taxi completes once and accrues commission once",
    async (t) => {
        const h = await createHarness({
            benefitAtCreation: true,
            currentBenefit: false,
        });

        t.after(() => h.close());

        await h.beginWork();

        const results = await Promise.all([
            h.post("complete"),
            h.post("complete"),
        ]);

        assert.deepEqual(
            results.map((r) => r.status).sort(),
            [200, 409]
        );

        assert.equal(h.order.status, "completed");

        // Стоимость 1000 ₽.
        // Стандартная комиссия 100 ₽,
        // со льготой заказчика — 50 ₽.
        assert.equal(
            h.order.commissionKopecks,
            5000
        );

        assert.equal(h.executor.debt, 5000);

        assert.equal(h.order.commissionStatus, "debt");

        assert.equal(h.calls.prepared.length, 1);
        assert.equal(h.calls.charged.length, 1);

        assert.equal(
            h.calls.prepared[0].sourceType,
            "express"
        );

        assert.equal(
            h.calls.prepared[0].sourceId,
            101
        );

        assert.equal(h.calls.benefitLookups, 0);

        assert.equal(
            (await h.post("complete")).status,
            409
        );
    }
);

test(
    "Courier passes pickup stage before completing",
    async (t) => {
        const h = await createHarness({
            type: "courier",
            benefitAtCreation: false,
            currentBenefit: true,
        });

        t.after(() => h.close());

        assert.equal(
            (await h.post("accept")).status,
            200
        );

        // Нельзя начинать доставку,
        // не забрав посылку.
        assert.equal(
            (await h.post("start")).status,
            409
        );

        for (const action of [
            "on-the-way",
            "arrived",
            "pick-up",
            "start",
        ]) {
            assert.equal(
                (await h.post(action)).status,
                200
            );
        }

        assert.ok(h.order.pickedUpAt);

        assert.equal(
            (await h.post("complete")).status,
            200
        );

        // В заказе на момент создания
        // льготы не было — комиссия 10%.
        assert.equal(
            h.order.commissionKopecks,
            10000
        );

        assert.equal(h.calls.benefitLookups, 0);
        assert.equal(h.calls.prepared.length, 1);
    }
);

test(
    "Premium completion does not create a charge",
    async (t) => {
        const h = await createHarness({
            premium: true,
        });

        t.after(() => h.close());

        await h.beginWork();

        assert.equal(
            (await h.post("complete")).status,
            200
        );

        assert.equal(
            h.order.commissionStatus,
            "waived"
        );

        assert.equal(h.order.commissionKopecks, 0);
        assert.equal(h.executor.debt, 0);
        assert.equal(h.calls.prepared.length, 0);
        assert.equal(h.calls.charged.length, 0);
    }
);

test(
    "Failed commission preparation rolls back completion",
    async (t) => {
        const h = await createHarness({
            benefitAtCreation: false,
        });

        t.after(() => h.close());

        await h.beginWork();

        h.flags.failPrepare = true;

        const failure = await h.post("complete");

        assert.equal(failure.status, 500);
        assert.equal(h.order.status, "in_progress");
        assert.equal(h.order.commissionStatus, "none");
        assert.equal(h.executor.debt, 0);
        assert.equal(h.calls.prepared.length, 0);
        assert.equal(h.calls.charged.length, 0);

        h.flags.failPrepare = false;

        assert.equal(
            (await h.post("complete")).status,
            200
        );

        assert.equal(h.order.status, "completed");
        assert.equal(h.executor.debt, 10000);
        assert.equal(h.calls.prepared.length, 1);
    }
);

test(
    "Successful saved-card payment returns consistent status",
    async (t) => {
        const h = await createHarness({
            benefitAtCreation: false,
            autoPaid: true,
        });

        t.after(() => h.close());

        await h.beginWork();

        const result = await h.post("complete");

        assert.equal(result.status, 200);

        assert.equal(
            result.body.commission.status,
            "paid"
        );

        assert.equal(
            result.body.order.commissionStatus,
            "paid"
        );

        assert.equal(h.calls.charged.length, 1);

        // Реальное списание и применение платежа
        // отдельно проверяются платёжными тестами.
    }
);

test(
    "Legacy order without benefit snapshot checks current status",
    async (t) => {
        const h = await createHarness({
            benefitAtCreation: null,
            currentBenefit: true,
        });

        t.after(() => h.close());

        await h.beginWork();

        assert.equal(
            (await h.post("complete")).status,
            200
        );

        assert.equal(h.calls.benefitLookups, 1);
        assert.equal(h.order.commissionKopecks, 5000);
    }
);

test(
    "Cancellation blocks further transitions and commissions",
    async (t) => {
        const h = await createHarness();
        t.after(() => h.close());

        assert.equal(
            (await h.post("accept")).status,
            200
        );

        assert.equal(
            (await h.post("cancel", 30)).status,
            403
        );

        assert.equal(
            (await h.post("cancel", 10)).status,
            200
        );

        assert.equal(h.order.status, "cancelled");

        assert.equal(
            (await h.post("cancel", 10)).status,
            409
        );

        assert.equal(
            (await h.post("on-the-way")).status,
            409
        );

        assert.equal(
            (await h.post("complete")).status,
            409
        );

        assert.equal(h.executor.debt, 0);
        assert.equal(h.calls.prepared.length, 0);
        assert.equal(h.calls.charged.length, 0);
    }
);

test(
    "Express acceptance closes pending reservation requests",
    async () => {
        const h = await createHarness();

        try {
            const result =
                await h.post("accept");

            assert.equal(
                result.status,
                200
            );

            assert.equal(
                h.calls.reservationQueries.length,
                1
            );

            assert.equal(
                Number(
                    h.calls.reservationQueries[0].orderId
                ),
                h.order.id
            );
        } finally {
            await h.close();
        }
    }
);

test(
    "Express completion invokes reservation activation only once",
    async () => {
        const h = await createHarness();

        try {
            await h.beginWork();

            const first =
                await h.post("complete");

            assert.equal(
                first.status,
                200
            );

            assert.equal(
                first.body.nextOrder,
                null
            );

            assert.equal(
                h.calls.reservationActivations.length,
                1
            );

            assert.equal(
                h.calls.reservationActivations[0].sourceOrderId,
                h.order.id
            );

            const second =
                await h.post("complete");

            assert.equal(
                second.status,
                409
            );

            assert.equal(
                h.calls.reservationActivations.length,
                1
            );
        } finally {
            await h.close();
        }
    }
);

test(
    "Failed commission preparation does not activate reservation",
    async () => {
        const h = await createHarness();

        try {
            await h.beginWork();

            h.flags.failPrepare = true;

            const result =
                await h.post("complete");

            assert.equal(
                result.status,
                500
            );

            assert.equal(
                h.order.status,
                "in_progress"
            );

            assert.equal(
                h.calls.reservationActivations.length,
                0
            );
        } finally {
            await h.close();
        }
    }
);