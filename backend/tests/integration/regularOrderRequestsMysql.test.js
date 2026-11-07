const test = require("node:test");
const assert = require("node:assert/strict");

const mysql = require("mysql2/promise");

const {
    Sequelize,
    DataTypes,
    Op,
} = require("sequelize");

const {
    loadIsolatedService,
} = require("../helpers/loadIsolatedService");

const TEST_DB = Object.freeze({
    host: "127.0.0.1",
    port: 13316,
    user: "cc_chat_test",
    password: "cc_chat_test_local_only",
    database: "cc_chat_test_only",
});

async function verifyDatabase(db) {
    const [rows] = await db.query(`
        SELECT
            @@hostname AS hostName,
            DATABASE() AS dbName,
            CURRENT_USER() AS loginName
    `);

    assert.equal(
        rows[0].hostName,
        "cc-chat-mysql-test"
    );

    assert.equal(
        rows[0].dbName,
        TEST_DB.database
    );

    assert.match(
        String(rows[0].loginName),
        /^cc_chat_test@/
    );
}

test("Обычные заказы: конкурентные отклики MySQL", async (t) => {
    const db = await mysql.createConnection(TEST_DB);

    let sequelize;
    let verified = false;

    try {
        await verifyDatabase(db);
        verified = true;

        await db.query(`
            CREATE TABLE IF NOT EXISTS cc_regular_test_users (
                id INT PRIMARY KEY,
                debt BIGINT NOT NULL DEFAULT 0,
                subscription_type VARCHAR(32),
                subscription_expires_at DATETIME(3)
            ) ENGINE=InnoDB
        `);

        await db.query(`
            CREATE TABLE IF NOT EXISTS cc_regular_test_orders (
                id INT PRIMARY KEY,
                creator_id INT NOT NULL,
                executor_id INT NULL,
                status VARCHAR(32) NOT NULL,
                payment_type VARCHAR(32) NOT NULL,
                requests LONGTEXT,
                requested_executors LONGTEXT,
                creator_hidden BOOLEAN DEFAULT FALSE,
                admin_deleted BOOLEAN DEFAULT FALSE
            ) ENGINE=InnoDB
        `);

        await db.query(`
            DELETE FROM cc_regular_test_orders
        `);

        await db.query(`
            DELETE FROM cc_regular_test_users
        `);

        await db.query(`
            INSERT INTO cc_regular_test_users (id)
            VALUES (11), (12)
        `);

        await db.query(`
            INSERT INTO cc_regular_test_orders (
                id,
                creator_id,
                status,
                payment_type,
                requests,
                requested_executors
            )
            VALUES
                (101, 100, 'pending', 'cash', '[]', '[]'),
                (102, 100, 'pending', 'cash', '[]', '[]')
        `);

        sequelize = new Sequelize(
            TEST_DB.database,
            TEST_DB.user,
            TEST_DB.password,
            {
                dialect: "mysql",
                host: TEST_DB.host,
                port: TEST_DB.port,
                logging: false,
                pool: {
                    max: 5,
                    min: 0,
                },
            }
        );

        const User = sequelize.define(
            "TestUser",
            {
                id: {
                    type: DataTypes.INTEGER,
                    primaryKey: true,
                },
                debt: DataTypes.BIGINT,
                subscription_type: DataTypes.STRING,
                subscription_expires_at: DataTypes.DATE,
            },
            {
                tableName: "cc_regular_test_users",
                timestamps: false,
            }
        );

        const Order = sequelize.define(
            "TestOrder",
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

                status: DataTypes.STRING,

                paymentType: {
                    type: DataTypes.STRING,
                    field: "payment_type",
                },

                requests: DataTypes.TEXT,

                requestedExecutors: {
                    type: DataTypes.TEXT,
                    field: "requested_executors",
                },

                creatorHidden: {
                    type: DataTypes.BOOLEAN,
                    field: "creator_hidden",
                },

                adminDeleted: {
                    type: DataTypes.BOOLEAN,
                    field: "admin_deleted",
                },
            },
            {
                tableName: "cc_regular_test_orders",
                timestamps: false,
            }
        );

        const service = loadIsolatedService(
            "regularOrderRequestService.js",
            {
                sequelize: { Op },

                "../models": {
                    sequelize,
                    User,
                    Order,

                    ExpressOrder: {
                        async findOne() {
                            return null;
                        },
                    },
                },
            }
        );

        await t.test(
            "Два разных исполнителя сохраняют оба отклика",
            async () => {
                const results = await Promise.all([
                    service.createRegularOrderRequest({
                        orderId: 101,
                        executorId: 11,
                        proposedSum: 1000,
                    }),

                    service.createRegularOrderRequest({
                        orderId: 101,
                        executorId: 12,
                        proposedSum: 1200,
                    }),
                ]);

                assert.equal(results.length, 2);

                const order = await Order.findByPk(101);

                const requests =
                    JSON.parse(order.requests);

                assert.equal(requests.length, 2);

                assert.deepEqual(
                    requests
                        .map((item) => Number(item.executorId))
                        .sort(),
                    [11, 12]
                );
            }
        );

        await t.test(
            "Два одинаковых отклика не создают дубль",
            async () => {
                const results = await Promise.allSettled([
                    service.createRegularOrderRequest({
                        orderId: 102,
                        executorId: 11,
                        proposedSum: 1000,
                    }),

                    service.createRegularOrderRequest({
                        orderId: 102,
                        executorId: 11,
                        proposedSum: 1000,
                    }),
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

                const order = await Order.findByPk(102);

                assert.equal(
                    JSON.parse(order.requests).length,
                    1
                );
            }
        );
    } finally {
        if (sequelize) {
            await sequelize.close();
        }

        if (verified) {
            await db.query(
                "DROP TABLE IF EXISTS cc_regular_test_orders"
            );

            await db.query(
                "DROP TABLE IF EXISTS cc_regular_test_users"
            );
        }

        await db.end();
    }
});