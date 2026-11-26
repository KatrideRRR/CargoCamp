"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const mysql = require("mysql2/promise");

const {
    Sequelize,
    DataTypes,
    Op,
    QueryTypes,
} = require("sequelize");

const {
    loadIsolatedService,
} = require("../helpers/loadIsolatedService");

const {
    checkExpressReservationEligibility,
    REQUEST_TTL_SECONDS,
} = require("../../utils/expressReservationPolicy");

const DB = {
    host: "127.0.0.1",
    port: 13316,
    user: "cc_chat_test",
    password: "cc_chat_test_local_only",
    database: "cc_chat_test_only",
};

const OFFER = {
    version: "test-version",
    sha256: "a".repeat(64),
};

const TABLES = [
    "cc_next_test_requests",
    "cc_next_test_orders",
    "cc_next_test_users",
];

test(
    "Express reservations: MySQL concurrency and activation",
    async (t) => {
        let connection;
        let sequelize;
        let verified = false;

        try {
            connection =
                await mysql.createConnection(DB);

            const [[identity]] =
                await connection.query(`
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
                identity.dbUser,
                /^cc_chat_test@/
            );

            verified = true;

            for (const table of TABLES) {
                await connection.query(
                    `DROP TABLE IF EXISTS ${table}`
                );
            }

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

            const User = sequelize.define(
                "NextTestUser",
                {
                    id: {
                        type:
                        DataTypes.INTEGER,
                        primaryKey: true,
                    },

                    role: DataTypes.STRING,
                    debt: DataTypes.INTEGER,
                    username: DataTypes.STRING,
                    rating: DataTypes.FLOAT,
                    ratingCount: DataTypes.INTEGER,

                    vehicleBrand: DataTypes.STRING,
                    vehicleModel: DataTypes.STRING,
                    vehicleColor: DataTypes.STRING,
                    vehiclePlate: DataTypes.STRING,
                    vehiclePhoto: DataTypes.STRING,

                    vehicleVerificationStatus:
                    DataTypes.STRING,
                },
                {
                    tableName:
                        "cc_next_test_users",

                    timestamps: false,
                }
            );

            const ExpressOrder =
                sequelize.define(
                    "NextTestOrder",
                    {
                        id: {
                            type:
                            DataTypes.INTEGER,
                            primaryKey: true,
                        },

                        creatorId: {
                            type:
                            DataTypes.INTEGER,
                            field: "creator_id",
                        },

                        executorId: {
                            type:
                            DataTypes.INTEGER,
                            field: "executor_id",
                        },

                        status:
                        DataTypes.STRING,

                        type:
                        DataTypes.STRING,

                        paymentType:
                        DataTypes.STRING,

                        dealStatus:
                        DataTypes.STRING,

                        toLat:
                            DataTypes.DECIMAL(10, 7),

                        toLng:
                            DataTypes.DECIMAL(10, 7),

                        creatorHidden:
                        DataTypes.BOOLEAN,

                        adminDeleted:
                        DataTypes.BOOLEAN,

                        reservationSourceOrderId:
                        DataTypes.INTEGER,

                        reservationApprovedAt:
                            DataTypes.DATE(3),

                        reservationActivatedAt:
                            DataTypes.DATE(3),

                        executorVehicleBrand:
                        DataTypes.STRING,

                        executorVehicleModel:
                        DataTypes.STRING,

                        executorVehicleColor:
                        DataTypes.STRING,

                        executorVehiclePlate:
                        DataTypes.STRING,

                        executorVehiclePhoto:
                        DataTypes.STRING,
                    },
                    {
                        tableName:
                            "cc_next_test_orders",

                        timestamps: false,
                    }
                );

            await User.sync();
            await ExpressOrder.sync();

            await connection.query(`
                CREATE TABLE cc_next_test_requests (
                    id BIGINT UNSIGNED
                        NOT NULL AUTO_INCREMENT,

                    order_id INT NOT NULL,

                    source_order_id INT NOT NULL,

                    executor_id INT NOT NULL,

                    status VARCHAR(20) NOT NULL,

                    distance_to_destination_m
                        INT NOT NULL,

                    created_at DATETIME(3)
                        DEFAULT CURRENT_TIMESTAMP(3),

                    expires_at DATETIME(3) NOT NULL,

                    resolved_at DATETIME(3) NULL,

                    PRIMARY KEY (id),

                    INDEX idx_executor (
                        executor_id,
                        status
                    ),

                    INDEX idx_order (
                        order_id,
                        status
                    )
                ) ENGINE=InnoDB
            `);

            /*
             * Настоящие SQL-запросы сервиса
             * направляем только в тестовые таблицы.
             */
            const serviceDatabase = {
                transaction:
                    sequelize.transaction
                        .bind(sequelize),

                query(sql, options) {
                    const isolatedSql =
                        String(sql)
                            .replace(
                                /\bexpress_reservation_requests\b/g,
                                "cc_next_test_requests"
                            )
                            .replace(
                                /\bexpress_orders\b/g,
                                "cc_next_test_orders"
                            );

                    return sequelize.query(
                        isolatedSql,
                        options
                    );
                },
            };

            const audit = [];

            const service =
                loadIsolatedService(
                    "expressReservationService.js",
                    {
                        sequelize: {
                            Op,
                            QueryTypes,
                        },

                        "../models": {
                            sequelize:
                            serviceDatabase,

                            User,

                            ExpressOrder,

                            Order: {
                                async findOne() {
                                    return null;
                                },
                            },

                            ActionLog: {
                                async create(
                                    data,
                                    { transaction }
                                ) {
                                    assert.ok(
                                        transaction
                                    );

                                    audit.push(
                                        data
                                    );
                                },
                            },

                            PublicOfferAcceptance: {
                                async findOne() {
                                    return {
                                        id: 1,
                                    };
                                },
                            },
                        },

                        "./publicOfferConsentService": {
                            CURRENT_OFFER:
                            OFFER,
                        },

                        "../utils/expressReservationPolicy": {
                            checkExpressReservationEligibility,

                            REQUEST_TTL_SECONDS,
                        },
                    }
                );

            await User.bulkCreate(
                [10, 11, 20, 21].map(
                    (id) => ({
                        id,
                        role: "user",
                        debt: 0,

                        username:
                            `User ${id}`,

                        rating: 5,
                        ratingCount: 1,

                        vehicleBrand:
                            "Toyota",

                        vehicleModel:
                            "Camry",

                        vehicleColor:
                            "White",

                        vehiclePlate:
                            "TEST",

                        vehicleVerificationStatus:
                            "verified",
                    })
                )
            );

            async function reset() {
                await connection.query(
                    "DELETE FROM cc_next_test_requests"
                );

                await ExpressOrder.destroy({
                    where: {},
                });

                await User.update(
                    { debt: 0 },
                    { where: {} }
                );

                const common = {
                    type: "taxi",
                    paymentType: "cash",
                    dealStatus: "none",

                    toLat: 44.9521,
                    toLng: 34.1024,

                    creatorHidden: false,
                    adminDeleted: false,
                };

                await ExpressOrder.bulkCreate([
                    {
                        ...common,
                        id: 101,
                        creatorId: 10,
                        executorId: 20,
                        status: "in_progress",
                    },

                    {
                        ...common,
                        id: 102,
                        creatorId: 10,
                        executorId: 21,
                        status: "in_progress",
                    },

                    {
                        ...common,
                        id: 201,
                        creatorId: 11,
                        status: "created",
                    },

                    {
                        ...common,
                        id: 202,
                        creatorId: 11,
                        status: "created",
                    },
                ]);
            }

            function request(
                orderId = 201,
                executorId = 20,
                sourceOrderId = 101
            ) {
                return service
                    .requestExpressReservation({
                        orderId,
                        executorId,
                        sourceOrderId,

                        latitude:
                            44.9521,

                        longitude:
                            34.1024,
                    });
            }

            function approve(
                orderId,
                requestId
            ) {
                return service
                    .approveExpressReservation({
                        orderId,
                        requestId,

                        creatorId: 11,
                    });
            }

            await t.test(
                "Only one pending request per executor",
                async () => {
                    await reset();

                    const results =
                        await Promise.allSettled([
                            request(201),
                            request(202),
                        ]);

                    assert.equal(
                        results.filter(
                            (r) =>
                                r.status ===
                                "fulfilled"
                        ).length,
                        1
                    );

                    const [[row]] =
                        await connection.query(`
                            SELECT COUNT(*) AS total
                            FROM cc_next_test_requests
                            WHERE status = 'pending'
                        `);

                    assert.equal(
                        Number(row.total),
                        1
                    );
                }
            );

            await t.test(
                "Two drivers cannot reserve one order",
                async () => {
                    await reset();

                    const first =
                        await request(
                            201, 20, 101
                        );

                    const second =
                        await request(
                            201, 21, 102
                        );

                    const results =
                        await Promise.allSettled([
                            approve(
                                201,
                                first.requestId
                            ),

                            approve(
                                201,
                                second.requestId
                            ),
                        ]);

                    assert.equal(
                        results.filter(
                            (r) =>
                                r.status ===
                                "fulfilled"
                        ).length,
                        1
                    );

                    const order =
                        await ExpressOrder.findByPk(
                            201
                        );

                    assert.equal(
                        order.status,
                        "reserved"
                    );
                }
            );

            await t.test(
                "Expired request cannot be approved",
                async () => {
                    await reset();

                    const result =
                        await request();

                    await connection.query(
                        `
                        UPDATE cc_next_test_requests
                        SET expires_at =
                            DATE_SUB(
                                NOW(),
                                INTERVAL 1 MINUTE
                            )
                        WHERE id = ?
                        `,
                        [result.requestId]
                    );

                    await assert.rejects(
                        () =>
                            approve(
                                201,
                                result.requestId
                            ),

                        {
                            httpStatus: 409,
                        }
                    );
                }
            );

            await t.test(
                "Only creator may approve",
                async () => {
                    await reset();

                    const result =
                        await request();

                    await assert.rejects(
                        () =>
                            service
                                .approveExpressReservation({
                                    orderId: 201,

                                    requestId:
                                    result.requestId,

                                    creatorId: 10,
                                }),

                        {
                            httpStatus: 403,
                        }
                    );
                }
            );

            await t.test(
                "Reservation activates after completion",
                async () => {
                    await reset();

                    const result =
                        await request();

                    await approve(
                        201,
                        result.requestId
                    );

                    await sequelize.transaction(
                        async (transaction) => {
                            await User.findByPk(
                                20,
                                {
                                    transaction,

                                    lock:
                                    transaction.LOCK.UPDATE,
                                }
                            );

                            const source =
                                await ExpressOrder.findByPk(
                                    101,
                                    {
                                        transaction,

                                        lock:
                                        transaction.LOCK.UPDATE,
                                    }
                                );

                            source.status =
                                "completed";

                            await source.save({
                                transaction,
                            });

                            const next =
                                await service
                                    .activateNextExpressOrder({
                                        sourceOrder:
                                        source,

                                        executorId: 20,

                                        transaction,
                                    });

                            assert.equal(
                                next.id,
                                201
                            );

                            assert.equal(
                                next.status,
                                "accepted"
                            );
                        }
                    );

                    const next =
                        await ExpressOrder.findByPk(
                            201
                        );

                    assert.equal(
                        next.status,
                        "accepted"
                    );

                    assert.ok(
                        next.reservationActivatedAt
                    );
                }
            );

            await t.test(
                "Cancellation returns order to available list",
                async () => {
                    await reset();

                    const result =
                        await request();

                    await approve(
                        201,
                        result.requestId
                    );

                    await service
                        .cancelExpressReservation({
                            orderId: 201,
                            userId: 20,
                        });

                    const order =
                        await ExpressOrder.findByPk(
                            201
                        );

                    assert.equal(
                        order.status,
                        "created"
                    );

                    assert.equal(
                        order.executorId,
                        null
                    );

                    assert.equal(
                        order.reservationSourceOrderId,
                        null
                    );
                }
            );

            await t.test(
                "Activation is rolled back with transaction",
                async () => {
                    await reset();

                    const result =
                        await request();

                    await approve(
                        201,
                        result.requestId
                    );

                    await assert.rejects(
                        () =>
                            sequelize.transaction(
                                async (transaction) => {
                                    await User.findByPk(
                                        20,
                                        {
                                            transaction,

                                            lock:
                                            transaction.LOCK.UPDATE,
                                        }
                                    );

                                    const source =
                                        await ExpressOrder.findByPk(
                                            101,
                                            {
                                                transaction,

                                                lock:
                                                transaction.LOCK.UPDATE,
                                            }
                                        );

                                    source.status =
                                        "completed";

                                    await source.save({
                                        transaction,
                                    });

                                    await service
                                        .activateNextExpressOrder({
                                            sourceOrder:
                                            source,

                                            executorId: 20,

                                            transaction,
                                        });

                                    throw new Error(
                                        "FORCED_ROLLBACK"
                                    );
                                }
                            ),

                        /FORCED_ROLLBACK/
                    );

                    const source =
                        await ExpressOrder.findByPk(
                            101
                        );

                    const next =
                        await ExpressOrder.findByPk(
                            201
                        );

                    assert.equal(
                        source.status,
                        "in_progress"
                    );

                    assert.equal(
                        next.status,
                        "reserved"
                    );
                }
            );

        } finally {
            if (sequelize) {
                await sequelize.close();
            }

            if (connection) {
                try {
                    if (verified) {
                        for (const table of TABLES) {
                            await connection.query(
                                `DROP TABLE IF EXISTS ${table}`
                            );
                        }
                    }
                } finally {
                    await connection.end();
                }
            }
        }
    }
);