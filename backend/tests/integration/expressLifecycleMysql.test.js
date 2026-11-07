const test = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");

const {
    Sequelize,
    DataTypes,
} = require("sequelize");

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

test("Экспресс-заказы: конкурентность MySQL", async (t) => {
    let connection;
    let sequelize;
    let verified = false;

    const table = "cc_express_flow_test_orders";

    try {
        connection = await mysql.createConnection(DB);

        const [[identity]] = await connection.query(`
            SELECT
                @@hostname AS hostname,
                DATABASE() AS dbName,
                CURRENT_USER() AS dbUser
        `);

        assert.equal(
            identity.hostname,
            "cc-chat-mysql-test"
        );

        assert.equal(
            identity.dbName,
            DB.database
        );

        assert.match(
            String(identity.dbUser),
            /^cc_chat_test@/
        );

        verified = true;

        await connection.query(`
            DROP TABLE IF EXISTS ${table}
        `);

        await connection.query(`
            CREATE TABLE ${table} (
                id INT PRIMARY KEY,
                creator_id INT NOT NULL,
                executor_id INT NULL,

                type VARCHAR(20) NOT NULL,
                status VARCHAR(40) NOT NULL,
                deal_status VARCHAR(40) DEFAULT 'none',

                arrived_at DATETIME(3),
                waiting_started_at DATETIME(3),
                picked_up_at DATETIME(3),
                started_at DATETIME(3)
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
                },
            }
        );

        const ExpressOrder = sequelize.define(
            "TestExpressOrder",
            {
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

                type: DataTypes.STRING,
                status: DataTypes.STRING,

                dealStatus: {
                    type: DataTypes.STRING,
                    field: "deal_status",
                },

                arrivedAt: {
                    type: DataTypes.DATE,
                    field: "arrived_at",
                },

                waitingStartedAt: {
                    type: DataTypes.DATE,
                    field: "waiting_started_at",
                },

                pickedUpAt: {
                    type: DataTypes.DATE,
                    field: "picked_up_at",
                },

                startedAt: {
                    type: DataTypes.DATE,
                    field: "started_at",
                },
            },
            {
                tableName: table,
                timestamps: false,
            }
        );

        const service = loadIsolatedService(
            "expressOrderLifecycleService.js",
            {
                "../models": {
                    sequelize,
                    ExpressOrder,
                },
            }
        );

        const advance = (id, from, to, field = null) =>
            service.advanceExpressOrder({
                orderId: id,
                executorId: 11,
                fromStatuses: [from],
                targetStatus: to,
                timestampField: field,
            });

        await ExpressOrder.bulkCreate([
            {
                id: 1,
                creatorId: 100,
                executorId: 11,
                type: "taxi",
                status: "accepted",
            },
            {
                id: 2,
                creatorId: 100,
                executorId: 11,
                type: "courier",
                status: "accepted",
            },
            {
                id: 3,
                creatorId: 100,
                executorId: 11,
                type: "taxi",
                status: "waiting_at_A",
            },
            {
                id: 4,
                creatorId: 100,
                executorId: 11,
                type: "taxi",
                status: "accepted",
            },
            {
                id: 5,
                creatorId: 100,
                executorId: 11,
                type: "taxi",
                status: "completed",
            },
            {
                id: 6,
                creatorId: 100,
                executorId: null,
                type: "courier",
                status: "created",
            },
        ]);

        await t.test(
            "Такси проходит все этапы последовательно",
            async () => {
                await advance(
                    1,
                    "accepted",
                    "on_the_way_to_A"
                );

                await advance(
                    1,
                    "on_the_way_to_A",
                    "arrived_at_A",
                    "arrivedAt"
                );

                await advance(
                    1,
                    "arrived_at_A",
                    "waiting_at_A",
                    "waitingStartedAt"
                );

                await advance(
                    1,
                    "waiting_at_A",
                    "in_progress",
                    "startedAt"
                );

                const order =
                    await ExpressOrder.findByPk(1);

                assert.equal(
                    order.status,
                    "in_progress"
                );

                assert.ok(order.arrivedAt);
                assert.ok(order.waitingStartedAt);
                assert.ok(order.startedAt);
            }
        );

        await t.test(
            "Курьер проходит этап получения посылки",
            async () => {
                await advance(
                    2,
                    "accepted",
                    "on_the_way_to_A"
                );

                await advance(
                    2,
                    "on_the_way_to_A",
                    "arrived_at_A",
                    "arrivedAt"
                );

                await service.advanceExpressOrder({
                    orderId: 2,
                    executorId: 11,
                    expressType: "courier",
                    fromStatuses: ["arrived_at_A"],
                    targetStatus: "picked_up",
                    timestampField: "pickedUpAt",
                });

                await service.advanceExpressOrder({
                    orderId: 2,
                    executorId: 11,

                    allowedStatusesByType: {
                        taxi: ["waiting_at_A"],
                        courier: ["picked_up"],
                    },

                    targetStatus: "in_progress",
                    timestampField: "startedAt",
                });

                const order =
                    await ExpressOrder.findByPk(2);

                assert.equal(
                    order.status,
                    "in_progress"
                );

                assert.ok(order.pickedUpAt);
            }
        );

        await t.test(
            "Два одинаковых перехода: успешен только один",
            async () => {
                const results = await Promise.allSettled([
                    advance(
                        4,
                        "accepted",
                        "on_the_way_to_A"
                    ),
                    advance(
                        4,
                        "accepted",
                        "on_the_way_to_A"
                    ),
                ]);

                assert.equal(
                    results.filter(
                        (item) =>
                            item.status === "fulfilled"
                    ).length,
                    1
                );

                assert.equal(
                    results.filter(
                        (item) =>
                            item.status === "rejected" &&
                            item.reason.httpStatus === 409
                    ).length,
                    1
                );
            }
        );

        await t.test(
            "Одновременная отмена и начало не перезаписывают друг друга",
            async () => {
                const results = await Promise.allSettled([
                    advance(
                        3,
                        "waiting_at_A",
                        "in_progress",
                        "startedAt"
                    ),

                    service.cancelExpressOrder({
                        orderId: 3,
                        userId: 100,
                    }),
                ]);

                assert.equal(
                    results.filter(
                        (item) =>
                            item.status === "fulfilled"
                    ).length,
                    1
                );

                assert.equal(
                    results.filter(
                        (item) =>
                            item.status === "rejected" &&
                            item.reason.httpStatus === 409
                    ).length,
                    1
                );

                const order =
                    await ExpressOrder.findByPk(3);

                assert.ok(
                    [
                        "in_progress",
                        "cancelled",
                    ].includes(order.status)
                );
            }
        );

        await t.test(
            "Чужой пользователь не может отменить заказ",
            async () => {
                await assert.rejects(
                    () => service.cancelExpressOrder({
                        orderId: 4,
                        userId: 999,
                    }),
                    (error) =>
                        error.httpStatus === 403
                );
            }
        );

        await t.test(
            "Завершённый заказ нельзя отменить",
            async () => {
                await assert.rejects(
                    () => service.cancelExpressOrder({
                        orderId: 5,
                        userId: 100,
                    }),
                    (error) =>
                        error.httpStatus === 409
                );
            }
        );

        await t.test(
            "Заказчик может отменить ещё не принятый заказ",
            async () => {
                const result =
                    await service.cancelExpressOrder({
                        orderId: 6,
                        userId: 100,
                    });

                assert.equal(
                    result.order.status,
                    "cancelled"
                );

                const saved =
                    await ExpressOrder.findByPk(6);

                assert.equal(
                    saved.status,
                    "cancelled"
                );
            }
        );

        await t.test(
            "Курьер не может выполнить шаг ожидания такси",
            async () => {
                await assert.rejects(
                    () => service.advanceExpressOrder({
                        orderId: 2,
                        executorId: 11,
                        expressType: "taxi",
                        fromStatuses: ["in_progress"],
                        targetStatus: "waiting_at_A",
                    }),
                    (error) =>
                        error.httpStatus === 409
                );
            }
        );
    } finally {
        if (sequelize) {
            await sequelize.close();
        }

        if (verified && connection) {
            await connection.query(
                `DROP TABLE IF EXISTS ${table}`
            );
        }

        if (connection) {
            await connection.end();
        }
    }
});