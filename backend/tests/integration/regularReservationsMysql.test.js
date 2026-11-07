const test = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");

const { Sequelize, DataTypes, Op } = require("sequelize");

const {
    loadIsolatedService,
} = require("../helpers/loadIsolatedService");

const DB = Object.freeze({
    host: "127.0.0.1",
    port: 13316,
    user: "cc_chat_test",
    password: "cc_chat_test_local_only",
    database: "cc_chat_test_only",
    connectTimeout: 5000,
    multipleStatements: false,
});

const TABLES = [
    "cc_reservation_test_express",
    "cc_reservation_test_orders",
    "cc_reservation_test_users",
];

async function verifyDatabase(db) {
    const [[identity]] = await db.query(`
        SELECT
            @@hostname AS hostname,
            DATABASE() AS databaseName,
            CURRENT_USER() AS databaseUser
    `);

    assert.equal(
        identity.hostname,
        "cc-chat-mysql-test"
    );

    assert.equal(
        identity.databaseName,
        DB.database
    );

    assert.match(
        String(identity.databaseUser),
        /^cc_chat_test@/
    );
}

function arrayValue(value) {
    return Array.isArray(value)
        ? value
        : JSON.parse(value || "[]");
}

test("Бронирование обычных заказов: MySQL", async (t) => {
    let connection;
    let sequelize;
    let verified = false;

    try {
        connection = await mysql.createConnection(DB);

        await verifyDatabase(connection);
        verified = true;

        // Только тестовые таблицы после проверки БД.
        for (const table of TABLES) {
            await connection.query(
                `DROP TABLE IF EXISTS ${table}`
            );
        }

        await connection.query(`
            CREATE TABLE cc_reservation_test_users (
                id INT PRIMARY KEY,
                debt BIGINT NOT NULL DEFAULT 0,
                subscription_type VARCHAR(32),
                subscription_expires_at DATETIME(3)
            ) ENGINE=InnoDB
        `);

        await connection.query(`
            CREATE TABLE cc_reservation_test_orders (
                id INT PRIMARY KEY,
                creator_id INT NOT NULL,
                executor_id INT NULL,
                status VARCHAR(32) NOT NULL,
                payment_type VARCHAR(32) NOT NULL,
                requested_executors JSON,
                requests JSON,
                proposed_sum INT,
                final_price_kopecks INT DEFAULT 0,
                creator_hidden BOOLEAN DEFAULT FALSE,
                admin_deleted BOOLEAN DEFAULT FALSE,
                reservation_source_order_id INT,
                reservation_available_at DATETIME,
                reservation_approved_at DATETIME,
                reservation_ready_at DATETIME,
                is_recommended BOOLEAN DEFAULT FALSE,
                deal_status VARCHAR(32),
                commission_amount_kopecks INT DEFAULT 0,
                commission_accrued_at DATETIME(3)
            ) ENGINE=InnoDB
        `);

        await connection.query(`
            CREATE TABLE cc_reservation_test_express (
                id INT PRIMARY KEY,
                executor_id INT,
                status VARCHAR(32)
            ) ENGINE=InnoDB
        `);

        sequelize = new Sequelize(
            DB.database,
            DB.user,
            DB.password,
            {
                dialect: "mysql",
                host: DB.host,
                port: DB.port,
                logging: false,
                pool: {
                    max: 5,
                    min: 0,
                    acquire: 10000,
                },
            }
        );

        const User = sequelize.define("TestUser", {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
            },
            debt: DataTypes.BIGINT,
            subscription_type: DataTypes.STRING,
            subscription_expires_at: DataTypes.DATE,
        }, {
            tableName: "cc_reservation_test_users",
            timestamps: false,
        });

        const Order = sequelize.define("TestOrder", {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
            },
            creatorId: {
                type: DataTypes.INTEGER,
                field: "creator_id",
            },
            executorId: {
                type: DataTypes.INTEGER,
                field: "executor_id",
            },
            status: DataTypes.STRING,
            paymentType: {
                type: DataTypes.STRING,
                field: "payment_type",
            },
            requestedExecutors: {
                type: DataTypes.JSON,
                field: "requested_executors",
            },
            requests: DataTypes.JSON,
            proposedSum: {
                type: DataTypes.INTEGER,
                field: "proposed_sum",
            },
            finalPriceKopecks: {
                type: DataTypes.INTEGER,
                field: "final_price_kopecks",
            },
            creatorHidden: {
                type: DataTypes.BOOLEAN,
                field: "creator_hidden",
            },
            adminDeleted: {
                type: DataTypes.BOOLEAN,
                field: "admin_deleted",
            },
            reservationSourceOrderId: {
                type: DataTypes.INTEGER,
                field: "reservation_source_order_id",
            },
            reservationAvailableAt: {
                type: DataTypes.DATE,
                field: "reservation_available_at",
            },
            reservationApprovedAt: {
                type: DataTypes.DATE,
                field: "reservation_approved_at",
            },
            reservationReadyAt: {
                type: DataTypes.DATE,
                field: "reservation_ready_at",
            },
            is_recommended: DataTypes.BOOLEAN,
            dealStatus: {
                type: DataTypes.STRING,
                field: "deal_status",
            },
            commissionAmountKopecks: {
                type: DataTypes.INTEGER,
                field: "commission_amount_kopecks",
            },
            commissionAccruedAt: {
                type: DataTypes.DATE,
                field: "commission_accrued_at",
            },
        }, {
            tableName: "cc_reservation_test_orders",
            timestamps: false,
        });

        const ExpressOrder = sequelize.define(
            "TestExpress",
            {
                id: {
                    type: DataTypes.INTEGER,
                    primaryKey: true,
                },
                executorId: {
                    type: DataTypes.INTEGER,
                    field: "executor_id",
                },
                status: DataTypes.STRING,
            },
            {
                tableName: "cc_reservation_test_express",
                timestamps: false,
            }
        );

        const commission = loadIsolatedService(
            "orderCommissionService.js",
            {
                "../models": {
                    sequelize,
                    Order,
                    User,
                },
                "./commissionAutoChargeService": {
                    async prepareCommissionChargeAttempt() {
                        return null;
                    },
                },
            }
        );

        const reservation = loadIsolatedService(
            "regularReservationService.js",
            {
                sequelize: { Op },
                "../models": {
                    sequelize,
                    Order,
                    ExpressOrder,
                    User,
                },
            }
        );

        const assignment = loadIsolatedService(
            "regularOrderAssignmentService.js",
            {
                sequelize: { Op },
                "../models": {
                    sequelize,
                    Order,
                    ExpressOrder,
                    User,
                },
                "./orderCommissionService": commission,
                "./benefitService": {
                    async hasVerifiedBenefit() {
                        return false;
                    },
                },
                "../utils/regularCommissionPolicy":
                    require("../../utils/regularCommissionPolicy"),
            }
        );

        const availableAt = new Date(
            Date.now() + 60 * 60 * 1000
        ).toISOString();

        await User.bulkCreate([
            { id: 100, debt: 0 },
            { id: 11, debt: 0 },
            { id: 12, debt: 0 },
        ]);

        const request = (price) => [
            {
                executorId: 11,
                proposedSum: price,
                sourceOrderId: 1,
                availableAt,
            },
            {
                executorId: 12,
                proposedSum: 2000,
                sourceOrderId: null,
                availableAt: null,
            },
        ];

        await Order.bulkCreate([
            {
                id: 1,
                creatorId: 100,
                executorId: 11,
                status: "active",
                paymentType: "cash",
                requests: [],
                requestedExecutors: [],
            },
            ...[
                [2, 1500],
                [3, 1700],
                [4, 400001],
            ].map(([id, price]) => ({
                id,
                creatorId: 100,
                executorId: null,
                status: "pending",
                paymentType: "cash",
                requests: request(price),
                requestedExecutors: [11, 12],
                finalPriceKopecks: 0,
            })),
        ]);

        const reserve = (orderId) =>
            reservation.reserveRegularOrder({
                orderId,
                creatorId: 100,
                executorId: 11,
            });

        await t.test(
            "Два параллельных бронирования: только одно успешно",
            async () => {
                const results = await Promise.allSettled([
                    reserve(2),
                    reserve(3),
                ]);

                assert.equal(
                    results.filter(
                        (result) =>
                            result.status === "fulfilled"
                    ).length,
                    1
                );

                assert.equal(
                    results.filter(
                        (result) =>
                            result.status === "rejected" &&
                            result.reason.httpStatus === 409
                    ).length,
                    1
                );
            }
        );

        const order2 = await Order.findByPk(2);
        const bookedId =
            order2.status === "reserved" ? 2 : 3;

        const otherId = bookedId === 2 ? 3 : 2;

        await t.test(
            "Бронирование не начисляет комиссию",
            async () => {
                const booked = await Order.findByPk(bookedId);
                const worker = await User.findByPk(11);

                assert.equal(booked.status, "reserved");
                assert.equal(
                    Number(booked.finalPriceKopecks),
                    bookedId === 2 ? 150000 : 170000
                );

                assert.equal(
                    booked.commissionAccruedAt,
                    null
                );

                assert.equal(Number(worker.debt), 0);
            }
        );

        await t.test(
            "Отмена возвращает заказ и сохраняет чужие отклики",
            async () => {
                const result =
                    await reservation.cancelRegularReservation({
                        orderId: bookedId,
                        userId: 100,
                    });

                assert.equal(result.status, "pending");

                const order = await Order.findByPk(bookedId);

                assert.equal(order.executorId, null);

                assert.equal(
                    order.reservationSourceOrderId,
                    null
                );

                assert.equal(
                    order.reservationAvailableAt,
                    null
                );

                assert.deepEqual(
                    arrayValue(order.requestedExecutors)
                        .map(Number),
                    [12]
                );

                assert.equal(
                    arrayValue(order.requests).length,
                    1
                );
            }
        );

        await t.test(
            "Активный экспресс-заказ блокирует бронирование",
            async () => {
                await ExpressOrder.create({
                    id: 9,
                    executorId: 11,
                    status: "accepted",
                });

                try {
                    await assert.rejects(
                        () => reserve(otherId),
                        (error) =>
                            error.httpStatus === 409
                    );
                } finally {
                    await ExpressOrder.destroy({
                        where: { id: 9 },
                    });
                }
            }
        );

        await t.test(
            "Недопустимая цена из старого отклика блокируется",
            async () => {
                await assert.rejects(
                    () => reserve(4),
                    (error) =>
                        error.httpStatus === 409
                );
            }
        );

        await t.test(
            "Активировать можно только после предыдущего заказа",
            async () => {
                await reserve(otherId);

                await assert.rejects(
                    () => assignment.assignCashRegularOrder({
                        orderId: otherId,
                        actorUserId: 11,
                        executorId: 11,
                        activation: true,
                    }),
                    (error) =>
                        error.httpStatus === 409
                );
            }
        );

        await t.test(
            "После завершения активация начисляет одну комиссию",
            async () => {
                await Order.update(
                    { status: "completed" },
                    { where: { id: 1 } }
                );

                const result =
                    await assignment.assignCashRegularOrder({
                        orderId: otherId,
                        actorUserId: 11,
                        executorId: 11,
                        activation: true,
                    });

                assert.equal(
                    result.activatedFromReservation,
                    true
                );

                assert.equal(result.commissionKopecks, 20000);

                const order = await Order.findByPk(otherId);
                const worker = await User.findByPk(11);

                assert.equal(order.status, "active");
                assert.ok(order.reservationReadyAt);
                assert.ok(order.commissionAccruedAt);
                assert.equal(Number(worker.debt), 20000);

                const repeated =
                    await commission.accrueOrderCommissionOnce({
                        orderId: otherId,
                        executorId: 11,
                        amountKopecks: 20000,
                    });

                assert.equal(repeated.newlyAccrued, false);

                await assert.rejects(
                    () => assignment.assignCashRegularOrder({
                        orderId: otherId,
                        actorUserId: 11,
                        executorId: 11,
                        activation: true,
                    }),
                    (error) =>
                        error.httpStatus === 409
                );

                const finalWorker = await User.findByPk(11);

                assert.equal(
                    Number(finalWorker.debt),
                    20000
                );
            }
        );
    } finally {
        if (sequelize) {
            await sequelize.close();
        }

        if (verified && connection) {
            for (const table of TABLES) {
                await connection.query(
                    `DROP TABLE IF EXISTS ${table}`
                );
            }
        }

        if (connection) {
            await connection.end();
        }
    }
});