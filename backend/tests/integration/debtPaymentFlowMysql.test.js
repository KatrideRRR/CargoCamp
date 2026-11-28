"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const path = require("node:path");

const { randomUUID } = require("node:crypto");

const mysql = require("mysql2/promise");

const {
    Sequelize,
    DataTypes,
    QueryTypes,
    Op,
} = require("sequelize");

const {
    loadIsolatedService,
} = require("../helpers/loadIsolatedService");

const DB = {
    host: "127.0.0.1",
    port: 13316,
    user: "cc_chat_test",
    password: "cc_chat_test_local_only",
    database: "cc_chat_test_only",
};

test(
    "Debt payment and automatic order request: MySQL",
    async (t) => {
        const connection =
            await mysql.createConnection(DB);

        let sequelize;

        const createdTables = [];

        const tableNames = {
            users: "cc_debt_flow_users",
            orders: "cc_debt_flow_orders",
            expressOrders: "cc_debt_flow_express",
            notifications: "cc_debt_flow_notifications",
            logs: "cc_debt_flow_logs",
            intents: "debt_payment_intents",
            receipts: "payment_receipts",
            attempts: "commission_charge_attempts",
        };

        const createTable = async (
            name,
            sql
        ) => {
            await connection.query(sql);

            createdTables.push(name);
        };

        try {
            // Защита от случайного запуска
            // на production или другой базе.

            const [[identity]] =
                await connection.query(`
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

            // Проверяем, что таблицы теста
            // не пересекаются с оставшимися
            // таблицами другого сценария.

            for (const name of Object.values(
                tableNames
            )) {
                const [rows] =
                    await connection.query(
                        `
                        SELECT TABLE_NAME
                        FROM information_schema.TABLES
                        WHERE TABLE_SCHEMA = ?
                          AND TABLE_NAME = ?
                        `,
                        [DB.database, name]
                    );

                assert.equal(
                    rows.length,
                    0,
                    `Тестовая таблица уже существует: ${name}`
                );
            }

            // Используем реальную миграцию 030,
            // а не её упрощённую копию.

            const migration = fs.readFileSync(
                path.resolve(
                    __dirname,
                    "../../migrations/030_debt_payment_intents.sql"
                ),
                "utf8"
            );

            await createTable(
                tableNames.intents,
                migration
            );

            await createTable(
                tableNames.receipts,
                `
                CREATE TABLE payment_receipts (
                    id BIGINT UNSIGNED
                        AUTO_INCREMENT PRIMARY KEY,

                    provider VARCHAR(16) NOT NULL,
                    payment_id VARCHAR(128) NOT NULL,
                    user_id BIGINT UNSIGNED NOT NULL,

                    purpose VARCHAR(24) NOT NULL,

                    amount_kopecks INT NOT NULL,
                    applied_kopecks INT NOT NULL,

                    UNIQUE KEY uq_test_receipt (
                        provider,
                        payment_id
                    )
                ) ENGINE=InnoDB
                `
            );

            await createTable(
                tableNames.attempts,
                `
                CREATE TABLE commission_charge_attempts (
                    id BIGINT UNSIGNED
                        AUTO_INCREMENT PRIMARY KEY,

                    user_id BIGINT UNSIGNED NOT NULL,

                    status VARCHAR(24) NOT NULL,

                    KEY idx_test_attempt_user (
                        user_id,
                        status
                    )
                ) ENGINE=InnoDB
                `
            );

            sequelize = new Sequelize(
                DB.database,
                DB.user,
                DB.password,
                {
                    host: DB.host,
                    port: DB.port,
                    dialect: "mysql",
                    logging: false,

                    pool: {
                        max: 8,
                        min: 0,
                    },
                }
            );

            function define(
                modelName,
                tableName,
                fields
            ) {
                return sequelize.define(
                    modelName,
                    fields,
                    {
                        tableName,
                        timestamps: false,
                    }
                );
            }

            const User = define(
                "DebtFlowUser",
                tableNames.users,
                {
                    id: {
                        type: DataTypes.INTEGER,
                        primaryKey: true,
                    },

                    debt: {
                        type: DataTypes.INTEGER,
                        allowNull: false,
                        defaultValue: 0,
                    },

                    commissionDebtOrderId:
                    DataTypes.INTEGER,

                    subscription_type:
                    DataTypes.STRING,

                    subscription_expires_at:
                    DataTypes.DATE,

                    yookassa_payment_method_id:
                    DataTypes.STRING,

                    tbankRebillId:
                    DataTypes.STRING,

                    tbankCardId:
                    DataTypes.STRING,
                }
            );

            const Order = define(
                "DebtFlowOrder",
                tableNames.orders,
                {
                    id: {
                        type: DataTypes.INTEGER,
                        primaryKey: true,
                    },

                    creatorId:
                    DataTypes.INTEGER,

                    executorId:
                    DataTypes.INTEGER,

                    status:
                    DataTypes.STRING,

                    creatorHidden:
                    DataTypes.BOOLEAN,

                    adminDeleted:
                    DataTypes.BOOLEAN,

                    requests:
                    DataTypes.TEXT,

                    requestedExecutors:
                    DataTypes.TEXT,
                }
            );

            const ExpressOrder = define(
                "DebtFlowExpress",
                tableNames.expressOrders,
                {
                    id: {
                        type: DataTypes.INTEGER,
                        primaryKey: true,
                    },

                    executorId:
                    DataTypes.INTEGER,

                    status:
                    DataTypes.STRING,
                }
            );

            const Notification = define(
                "DebtFlowNotification",
                tableNames.notifications,
                {
                    userId:
                    DataTypes.INTEGER,

                    type:
                    DataTypes.STRING,

                    title:
                    DataTypes.STRING,

                    body:
                    DataTypes.TEXT,

                    orderId:
                    DataTypes.INTEGER,

                    orderType:
                    DataTypes.STRING,

                    isRead:
                    DataTypes.BOOLEAN,

                    data:
                    DataTypes.JSON,
                }
            );

            const ActionLog = define(
                "DebtFlowActionLog",
                tableNames.logs,
                {
                    actorUserId:
                    DataTypes.INTEGER,

                    actorRole:
                    DataTypes.STRING,

                    actionType:
                    DataTypes.STRING,

                    entityType:
                    DataTypes.STRING,

                    entityId:
                    DataTypes.STRING,

                    orderId:
                    DataTypes.INTEGER,

                    expressOrderId:
                    DataTypes.INTEGER,

                    paymentId:
                    DataTypes.STRING,

                    severity:
                    DataTypes.STRING,

                    success:
                    DataTypes.BOOLEAN,

                    meta:
                    DataTypes.JSON,
                }
            );

            for (const model of [
                User,
                Order,
                ExpressOrder,
                Notification,
                ActionLog,
            ]) {
                await model.sync();

                createdTables.push(
                    model.getTableName()
                );
            }

            const models = {
                sequelize,
                User,
                Order,
                ExpressOrder,
                Notification,
                ActionLog,
            };

            const intentService =
                loadIsolatedService(
                    "debtPaymentIntentService.js",
                    {
                        "node:crypto": {
                            randomUUID,
                        },

                        sequelize: {
                            QueryTypes,
                        },

                        "../models": models,
                    }
                );

            const regularRequestService =
                loadIsolatedService(
                    "regularOrderRequestService.js",
                    {
                        sequelize: {
                            Op,
                        },

                        "../models": models,
                    }
                );

            const receiptService =
                loadIsolatedService(
                    "paymentReceiptService.js",
                    {
                        sequelize: {
                            Op,
                            QueryTypes,
                        },

                        "../models": models,
                    }
                );

            const debtRequestService =
                loadIsolatedService(
                    "debtOrderRequestService.js",
                    {
                        sequelize: {
                            QueryTypes,
                        },

                        "../models": models,

                        "./regularOrderRequestService":
                        regularRequestService,
                    }
                );

            const delivered = [];

            const settlementService =
                loadIsolatedService(
                    "debtPaymentSettlementService.js",
                    {
                        sequelize: {
                            QueryTypes,
                        },

                        "../models": models,

                        "./paymentReceiptService":
                        receiptService,

                        "./debtOrderRequestService":
                        debtRequestService,

                        "./debtOrderRequestDeliveryService": {
                            async deliverDebtOrderRequestNotifications(
                                notifications
                            ) {
                                delivered.push(
                                    ...notifications
                                );
                            },
                        },
                    }
                );

            const {
                claimDebtPaymentIntent,
                getDebtPaymentIntent,
                recordDebtPaymentIntent,
            } = intentService;

            const {
                settleConfirmedDebtPayment,
            } = settlementService;

            const {
                finalizeDebtOrderRequest,
            } = debtRequestService;

            // Каждый сценарий получает
            // отдельного исполнителя и заказ.

            let sequence = 100;

            async function createScenario({
                                              debt = 25000,
                                          } = {}) {
                const userId =
                    ++sequence;

                const creatorId =
                    ++sequence;

                const orderId =
                    ++sequence;

                await User.bulkCreate([
                    {
                        id: userId,
                        debt,

                        subscription_type:
                            "standard",

                        yookassa_payment_method_id:
                            "test-yoo-card",

                        tbankRebillId:
                            "test-rebill",

                        tbankCardId:
                            "test-tbank-card",
                    },

                    {
                        id: creatorId,
                        debt: 0,

                        subscription_type:
                            "standard",
                    },
                ]);

                await Order.create({
                    id: orderId,

                    creatorId,
                    executorId: null,

                    status: "pending",

                    creatorHidden: false,
                    adminDeleted: false,

                    requests: "[]",
                    requestedExecutors: "[]",
                });

                const request = {
                    orderId,

                    proposedSum: 2500,

                    comment:
                        "Могу приехать вечером",

                    availableAt: null,
                };

                const claim = (
                    overrides = {}
                ) =>
                    claimDebtPaymentIntent({
                        userId,

                        provider: "yookassa",
                        paymentMode: "saved_card",

                        expectedAmountKopecks:
                        debt,

                        request,

                        ...overrides,
                    });

                const settle = (
                    intent,
                    overrides = {}
                ) =>
                    settleConfirmedDebtPayment({
                        provider:
                        intent.provider,

                        paymentId:
                            `test-payment-${intent.id}`,

                        userId,

                        amountKopecks:
                        intent.amountKopecks,

                        intentId: intent.id,

                        bankOrderId:
                        intent.bankOrderId,

                        ...overrides,
                    });

                return {
                    userId,
                    creatorId,
                    orderId,
                    request,
                    claim,
                    settle,
                };
            }

            async function getRequests(
                orderId
            ) {
                const order =
                    await Order.findByPk(
                        orderId
                    );

                return JSON.parse(
                    order.requests || "[]"
                );
            }

            async function receiptCount(
                userId
            ) {
                const [rows] =
                    await connection.query(
                        `
                        SELECT COUNT(*) AS total
                        FROM payment_receipts
                        WHERE user_id = ?
                        `,
                        [userId]
                    );

                return Number(
                    rows[0].total
                );
            }

            await t.test(
                "Parallel claims create exactly one intent",
                async () => {
                    const s =
                        await createScenario();

                    const results =
                        await Promise.all([
                            s.claim(),
                            s.claim(),
                            s.claim(),
                            s.claim(),
                        ]);

                    assert.equal(
                        results.filter(
                            (value) =>
                                value.created
                        ).length,
                        1
                    );

                    assert.equal(
                        new Set(
                            results.map(
                                (value) =>
                                    value.id
                            )
                        ).size,
                        1
                    );

                    assert.equal(
                        new Set(
                            results.map(
                                (value) =>
                                    value.idempotencyKey
                            )
                        ).size,
                        1
                    );

                    const [rows] =
                        await connection.query(
                            `
                            SELECT *
                            FROM debt_payment_intents
                            WHERE user_id = ?
                            `,
                            [s.userId]
                        );

                    assert.equal(
                        rows.length,
                        1
                    );

                    assert.equal(
                        Number(rows[0].order_id),
                        s.orderId
                    );

                    assert.equal(
                        Number(rows[0].proposed_sum),
                        2500
                    );

                    assert.equal(
                        rows[0].request_comment,
                        s.request.comment
                    );
                }
            );

            await t.test(
                "Cannot change provider or order during active payment",
                async () => {
                    const s =
                        await createScenario();

                    await s.claim();

                    await assert.rejects(
                        s.claim({
                            provider: "tbank",
                        }),

                        (error) =>
                            error.httpStatus === 409
                    );

                    await assert.rejects(
                        s.claim({
                            request: {
                                ...s.request,
                                orderId:
                                    s.orderId + 10000,
                            },
                        }),

                        (error) =>
                            error.httpStatus === 409
                    );

                    await assert.rejects(
                        s.claim({
                            request: {
                                ...s.request,
                                proposedSum: 9999,
                            },
                        }),

                        (error) =>
                            error.httpStatus === 409
                    );
                }
            );

            await t.test(
                "Another user cannot read payment intent",
                async () => {
                    const s =
                        await createScenario();

                    const intent =
                        await s.claim();

                    await assert.rejects(
                        getDebtPaymentIntent({
                            intentId: intent.id,
                            userId: s.creatorId,
                        }),

                        (error) =>
                            error.httpStatus === 404
                    );
                }
            );

            await t.test(
                "Changed debt requires a new confirmation",
                async () => {
                    const s =
                        await createScenario();

                    await assert.rejects(
                        s.claim({
                            expectedAmountKopecks:
                                10000,
                        }),

                        (error) =>
                            error.httpStatus === 409
                    );

                    const [rows] =
                        await connection.query(
                            `
                            SELECT id
                            FROM debt_payment_intents
                            WHERE user_id = ?
                            `,
                            [s.userId]
                        );

                    assert.equal(
                        rows.length,
                        0
                    );
                }
            );

            await t.test(
                "Pending payment cannot create an order request",
                async () => {
                    const s =
                        await createScenario();

                    const intent =
                        await s.claim();

                    const result =
                        await finalizeDebtOrderRequest({
                            intentId: intent.id,
                            userId: s.userId,
                        });

                    assert.equal(
                        result.completed,
                        false
                    );

                    assert.equal(
                        result.paymentPending,
                        true
                    );

                    assert.equal(
                        (await getRequests(
                            s.orderId
                        )).length,
                        0
                    );

                    const user =
                        await User.findByPk(
                            s.userId
                        );

                    assert.equal(
                        user.debt,
                        25000
                    );
                }
            );

            for (const provider of [
                "yookassa",
                "tbank",
            ]) {
                await t.test(
                    `${provider}: parallel confirmations settle once`,
                    async () => {
                        const s =
                            await createScenario();

                        const intent =
                            await s.claim({
                                provider,
                            });

                        const deliveredBefore =
                            delivered.length;

                        await Promise.all([
                            s.settle(intent),
                            s.settle(intent),
                            s.settle(intent),
                        ]);

                        const user =
                            await User.findByPk(
                                s.userId
                            );

                        assert.equal(
                            user.debt,
                            0
                        );

                        assert.equal(
                            await receiptCount(
                                s.userId
                            ),
                            1
                        );

                        const requests =
                            await getRequests(
                                s.orderId
                            );

                        assert.equal(
                            requests.length,
                            1
                        );

                        assert.equal(
                            requests[0].executorId,
                            s.userId
                        );

                        assert.equal(
                            requests[0].proposedSum,
                            2500
                        );

                        assert.equal(
                            requests[0].comment,
                            s.request.comment
                        );

                        const storedIntent =
                            await getDebtPaymentIntent({
                                intentId: intent.id,
                                userId: s.userId,
                            });

                        assert.equal(
                            storedIntent.paymentStatus,
                            "succeeded"
                        );

                        assert.equal(
                            storedIntent.requestStatus,
                            "sent"
                        );

                        assert.equal(
                            await Notification.count({
                                where: {
                                    orderId:
                                    s.orderId,
                                },
                            }),
                            2
                        );

                        assert.equal(
                            delivered.length -
                            deliveredBefore,
                            2
                        );

                        assert.equal(
                            await ActionLog.count({
                                where: {
                                    actionType:
                                        "order_request_create",

                                    orderId:
                                    s.orderId,
                                },
                            }),
                            1
                        );

                        await s.settle(intent);

                        assert.equal(
                            await receiptCount(
                                s.userId
                            ),
                            1
                        );

                        assert.equal(
                            (await getRequests(
                                s.orderId
                            )).length,
                            1
                        );
                    }
                );
            }

            await t.test(
                "Wrong payment amount does not change debt",
                async () => {
                    const s =
                        await createScenario();

                    const intent =
                        await s.claim();

                    await assert.rejects(
                        s.settle(intent, {
                            amountKopecks: 10000,
                        }),

                        /не соответствует/
                    );

                    const user =
                        await User.findByPk(
                            s.userId
                        );

                    assert.equal(
                        user.debt,
                        25000
                    );

                    assert.equal(
                        await receiptCount(
                            s.userId
                        ),
                        0
                    );
                }
            );

            await t.test(
                "Late pending response cannot overwrite confirmed payment",
                async () => {
                    const s =
                        await createScenario();

                    const intent =
                        await s.claim();

                    await s.settle(intent);

                    const result =
                        await recordDebtPaymentIntent({
                            intentId: intent.id,
                            userId: s.userId,

                            provider: "yookassa",

                            paymentId:
                                `test-payment-${intent.id}`,

                            status: "pending",
                        });

                    assert.equal(
                        result.paymentStatus,
                        "succeeded"
                    );
                }
            );

            await t.test(
                "Unavailable order does not lose confirmed payment",
                async () => {
                    const s =
                        await createScenario();

                    const intent =
                        await s.claim();

                    await Order.update(
                        {
                            status: "active",
                            executorId: 99999,
                        },
                        {
                            where: {
                                id: s.orderId,
                            },
                        }
                    );

                    const result =
                        await s.settle(intent);

                    assert.equal(
                        result.paymentStatus,
                        "succeeded"
                    );

                    assert.equal(
                        result.requestStatus,
                        "failed"
                    );

                    const user =
                        await User.findByPk(
                            s.userId
                        );

                    assert.equal(
                        user.debt,
                        0
                    );

                    assert.equal(
                        await receiptCount(
                            s.userId
                        ),
                        1
                    );

                    assert.equal(
                        (await getRequests(
                            s.orderId
                        )).length,
                        0
                    );
                }
            );

            await t.test(
                "Additional debt blocks automatic request",
                async () => {
                    const s =
                        await createScenario();

                    const intent =
                        await s.claim();

                    await User.update(
                        {
                            debt: 35000,
                        },
                        {
                            where: {
                                id: s.userId,
                            },
                        }
                    );

                    const result =
                        await s.settle(intent);

                    assert.equal(
                        result.paymentStatus,
                        "succeeded"
                    );

                    assert.equal(
                        result.requestStatus,
                        "failed"
                    );

                    assert.equal(
                        result.debtKopecks,
                        10000
                    );

                    assert.equal(
                        (await getRequests(
                            s.orderId
                        )).length,
                        0
                    );
                }
            );

            await t.test(
                "Expired intent accounts payment without sending request",
                async () => {
                    const s =
                        await createScenario();

                    const intent =
                        await s.claim();

                    await connection.query(
                        `
                        UPDATE debt_payment_intents
                        SET expires_at =
                            DATE_SUB(
                                CURRENT_TIMESTAMP(3),
                                INTERVAL 1 MINUTE
                            )
                        WHERE id = ?
                        `,
                        [intent.id]
                    );

                    const result =
                        await s.settle(intent);

                    assert.equal(
                        result.paymentStatus,
                        "succeeded"
                    );

                    assert.equal(
                        result.requestStatus,
                        "expired"
                    );

                    const user =
                        await User.findByPk(
                            s.userId
                        );

                    assert.equal(
                        user.debt,
                        0
                    );

                    assert.equal(
                        (await getRequests(
                            s.orderId
                        )).length,
                        0
                    );
                }
            );

            await t.test(
                "Active commission auto-charge blocks manual payment",
                async () => {
                    const s =
                        await createScenario();

                    await connection.query(
                        `
                        INSERT INTO commission_charge_attempts (
                            user_id,
                            status
                        )
                        VALUES (?, 'pending')
                        `,
                        [s.userId]
                    );

                    await assert.rejects(
                        s.claim(),

                        (error) =>
                            error.httpStatus === 409
                    );
                }
            );

            await t.test(
                "Receipt accounting can resume after interruption",
                async () => {
                    const s =
                        await createScenario();

                    const intent =
                        await s.claim();

                    const paymentId =
                        `test-payment-${intent.id}`;

                    await recordDebtPaymentIntent({
                        intentId: intent.id,
                        userId: s.userId,
                        provider: "yookassa",
                        paymentId,
                        status: "pending",
                    });

                    // Имитируем завершение backend
                    // после учёта платежа, но до
                    // создания автоматического отклика.

                    await receiptService.applyConfirmedPayment({
                        provider: "yookassa",
                        paymentId,

                        userId:
                        s.userId,

                        purpose: "debt",

                        amountKopecks:
                            25000,
                    });

                    assert.equal(
                        (await getRequests(
                            s.orderId
                        )).length,
                        0
                    );

                    // После восстановления
                    // сервер повторяет settlement.

                    const result =
                        await s.settle(intent);

                    assert.equal(
                        result.requestStatus,
                        "sent"
                    );

                    assert.equal(
                        await receiptCount(
                            s.userId
                        ),
                        1
                    );

                    assert.equal(
                        (await getRequests(
                            s.orderId
                        )).length,
                        1
                    );
                }
            );

        } finally {
            try {
                if (sequelize) {
                    await sequelize.close();
                }

                for (const name of createdTables.reverse()) {
                    await connection.query(
                        `DROP TABLE IF EXISTS \`${name}\``
                    );
                }

            } finally {
                await connection.end();
            }
        }
    }
);