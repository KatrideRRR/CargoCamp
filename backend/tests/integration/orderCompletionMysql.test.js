const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const mysql = require("mysql2/promise");
const {
    Sequelize,
    DataTypes,
    Op,
} = require("sequelize");

const {
    loadIsolatedService,
} = require("../helpers/loadIsolatedService");

// Отдельная локальная MySQL, не рабочая БД.
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
    "cc_completion_test_corrections",
    "cc_completion_test_decisions",
    "cc_completion_test_orders",
];

async function verifyTestDatabase(connection) {
    const [[identity]] = await connection.query(`
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

async function createTestTables(connection) {
    // Эти таблицы принадлежат только данному тесту.
    for (const table of TABLES) {
        await connection.query(
            `DROP TABLE IF EXISTS ${table}`
        );
    }

    await connection.query(`
        CREATE TABLE cc_completion_test_orders (
            id INT NOT NULL PRIMARY KEY,
            creator_id INT NOT NULL,
            executor_id INT NOT NULL,
            status VARCHAR(30) NOT NULL,
            completed_by JSON NOT NULL,
            payment_type VARCHAR(30) NOT NULL,
            proposed_sum INT NOT NULL,
            final_price_kopecks INT DEFAULT 0,
            work_started_at DATETIME(3) NULL,
            work_ended_at DATETIME(3) NULL,
            work_ended_by INT NULL,
            completed_at DATETIME(3) NULL
        ) ENGINE=InnoDB
    `);

    await connection.query(`
        CREATE TABLE cc_completion_test_decisions (
            id BIGINT UNSIGNED NOT NULL
                AUTO_INCREMENT PRIMARY KEY,
            order_id INT NOT NULL,
            user_id INT NOT NULL,
            party_role VARCHAR(20) NOT NULL,
            quality_decision VARCHAR(20),
            remarks TEXT,
            cash_status VARCHAR(20),
            cash_amount_kopecks BIGINT UNSIGNED,
            payout_authorized BOOLEAN NOT NULL DEFAULT FALSE,
            confirmed_at DATETIME(3) NOT NULL,
            ip_address VARCHAR(64),
            user_agent TEXT,

            UNIQUE KEY uq_completion_test_order_user (
                order_id,
                user_id
            )
        ) ENGINE=InnoDB
    `);

    await connection.query(`
        CREATE TABLE cc_completion_test_corrections (
            id BIGINT UNSIGNED NOT NULL
                AUTO_INCREMENT PRIMARY KEY,
            order_id INT NOT NULL,
            round_number INT UNSIGNED NOT NULL,
            event_type VARCHAR(20) NOT NULL,
            actor_user_id INT NOT NULL,
            comment TEXT,
            event_at DATETIME(3) NOT NULL,

            KEY idx_completion_test_order (
                order_id,
                id
            )
        ) ENGINE=InnoDB
    `);
}

function createModels(sequelize) {
    const options = (tableName) => ({
        tableName,
        timestamps: false,
    });

    const Order = sequelize.define(
        "CompletionTestOrder",
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
            completedBy: {
                type: DataTypes.JSON,
                field: "completed_by",
            },
            paymentType: {
                type: DataTypes.STRING,
                field: "payment_type",
            },
            proposedSum: {
                type: DataTypes.INTEGER,
                field: "proposed_sum",
            },
            finalPriceKopecks: {
                type: DataTypes.INTEGER,
                field: "final_price_kopecks",
            },
            workStartedAt: {
                type: DataTypes.DATE,
                field: "work_started_at",
            },
            workEndedAt: {
                type: DataTypes.DATE,
                field: "work_ended_at",
            },
            workEndedBy: {
                type: DataTypes.INTEGER,
                field: "work_ended_by",
            },
            completedAt: {
                type: DataTypes.DATE,
                field: "completed_at",
            },
        },
        options("cc_completion_test_orders")
    );

    const OrderCompletionDecision = sequelize.define(
        "CompletionTestDecision",
        {
            id: {
                type: DataTypes.BIGINT.UNSIGNED,
                primaryKey: true,
                autoIncrement: true,
            },
            orderId: {
                type: DataTypes.INTEGER,
                field: "order_id",
            },
            userId: {
                type: DataTypes.INTEGER,
                field: "user_id",
            },
            partyRole: {
                type: DataTypes.STRING,
                field: "party_role",
            },
            qualityDecision: {
                type: DataTypes.STRING,
                field: "quality_decision",
            },
            remarks: DataTypes.TEXT,
            cashStatus: {
                type: DataTypes.STRING,
                field: "cash_status",
            },
            cashAmountKopecks: {
                type: DataTypes.BIGINT.UNSIGNED,
                field: "cash_amount_kopecks",
            },
            payoutAuthorized: {
                type: DataTypes.BOOLEAN,
                field: "payout_authorized",
            },
            confirmedAt: {
                type: DataTypes.DATE,
                field: "confirmed_at",
            },
            ipAddress: {
                type: DataTypes.STRING,
                field: "ip_address",
            },
            userAgent: {
                type: DataTypes.TEXT,
                field: "user_agent",
            },
        },
        options("cc_completion_test_decisions")
    );

    const OrderCompletionCorrection = sequelize.define(
        "CompletionTestCorrection",
        {
            id: {
                type: DataTypes.BIGINT.UNSIGNED,
                primaryKey: true,
                autoIncrement: true,
            },
            orderId: {
                type: DataTypes.INTEGER,
                field: "order_id",
            },
            roundNumber: {
                type: DataTypes.INTEGER,
                field: "round_number",
            },
            eventType: {
                type: DataTypes.STRING,
                field: "event_type",
            },
            actorUserId: {
                type: DataTypes.INTEGER,
                field: "actor_user_id",
            },
            comment: DataTypes.TEXT,
            eventAt: {
                type: DataTypes.DATE,
                field: "event_at",
            },
        },
        options("cc_completion_test_corrections")
    );

    return {
        Order,
        OrderCompletionDecision,
        OrderCompletionCorrection,
    };
}

test(
    "Завершение обычного заказа: реальная MySQL",
    async () => {
        let connection;
        let sequelize;
        let verified = false;

        try {
            connection = await mysql.createConnection(DB);

            // Сначала проверяем БД, затем разрешаем DDL.
            await verifyTestDatabase(connection);
            verified = true;

            // Проверяем ограничение в настоящей миграции.
            const migration = fs.readFileSync(
                path.resolve(
                    __dirname,
                    "../../migrations/010_order_completion_decisions.sql"
                ),
                "utf8"
            );

            assert.match(
                migration,
                /UNIQUE KEY uq_completion_order_user/
            );

            await createTestTables(connection);

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
                        acquire: 15000,
                    },
                }
            );

            const models = createModels(sequelize);

            // Только внешние зависимости, не относящиеся
            // к предмету этого теста, заменяем.
            const dependencies = {
                sequelize,
                ...models,

                Dispute: {
                    findOne: async () => null,
                },

                OrderChangeRequest: {
                    findOne: async () => null,
                },

                OrderSafeDeal: {
                    findOne: async () => null,
                },
            };

            const workflow = loadIsolatedService(
                "orderCompletionWorkflowService.js",
                {
                    sequelize: { Op },
                    "../models": dependencies,
                }
            );

            const payment = loadIsolatedService(
                "completionPaymentSnapshotService.js",
                {
                    "../models": dependencies,
                }
            );

            const {
                Order,
                OrderCompletionDecision: Decision,
                OrderCompletionCorrection: Correction,
            } = models;

            await Order.create({
                id: 101,
                creatorId: 2,
                executorId: 1,
                status: "active",
                completedBy: [],
                paymentType: "cash",
                proposedSum: 500,
                finalPriceKopecks: 50000,
                workStartedAt: new Date(),
            });

            // 1. Исполнитель подтверждает завершение.
            const executor = await workflow.submitInitialCompletion({
                orderId: 101,
                userId: 1,
                completion: {
                    workConfirmed: true,
                    qualityDecision: null,
                    cashStatus: "partial",
                    cashAmountKopecks: 15025,
                    payoutAuthorized: false,
                },
            });

            assert.equal(executor.changed, true);
            assert.equal(executor.completed, false);
            assert.equal(executor.phase, "awaiting_other");

            // 2. Заказчик обнаружил повреждение.
            const remarksText =
                "При перевозке повреждён корпус шкафа.";

            const customer = await workflow.submitInitialCompletion({
                orderId: 101,
                userId: 2,
                completion: {
                    workConfirmed: true,
                    qualityDecision: "remarks",
                    remarks: remarksText,
                    cashStatus: "partial",
                    cashAmountKopecks: 15025,
                    payoutAuthorized: false,
                },
            });

            assert.equal(customer.completed, false);
            assert.equal(customer.phase, "needs_correction");

            // Заказ должен остаться в работе.
            let storedOrder = await Order.findByPk(101);

            assert.equal(storedOrder.status, "active");
            assert.deepEqual(
                [...storedOrder.completedBy].sort(),
                [1, 2]
            );

            // В MySQL записаны ровно два решения.
            assert.equal(
                await Decision.count({
                    where: { orderId: 101 },
                }),
                2
            );

            // 3. Повторное подтверждение не создаёт дубль.
            const repeated = await workflow.submitInitialCompletion({
                orderId: 101,
                userId: 2,
                completion: {
                    workConfirmed: true,
                    qualityDecision: "remarks",
                    remarks: remarksText,
                    cashStatus: "partial",
                    cashAmountKopecks: 15025,
                    payoutAuthorized: false,
                },
            });

            assert.equal(repeated.changed, false);

            assert.equal(
                await Decision.count({
                    where: { orderId: 101 },
                }),
                2
            );

            // 4. Первый цикл исправлений.
            const firstFix = await workflow.submitCorrectionAction({
                orderId: 101,
                userId: 1,
                action: "submit",
                comment: "Повреждённая деталь шкафа заменена.",
            });

            assert.equal(firstFix.phase, "awaiting_review");

            // 5. Заказчик отклоняет исправления.
            const rejected = await workflow.submitCorrectionAction({
                orderId: 101,
                userId: 2,
                action: "review",
                decision: "rejected",
                comment:
                    "После ремонта дверца закрывается неправильно.",
            });

            assert.equal(rejected.phase, "needs_correction");

            // 6. Второй цикл исправлений.
            await workflow.submitCorrectionAction({
                orderId: 101,
                userId: 1,
                action: "submit",
                comment:
                    "Отрегулированы петли и проверена дверца.",
            });

            // 7. Окончательная приёмка.
            const accepted = await workflow.submitCorrectionAction({
                orderId: 101,
                userId: 2,
                action: "review",
                decision: "accepted",
                comment: "",
            });

            assert.equal(accepted.completed, true);
            assert.equal(accepted.phase, "completed");

            // Проверяем сохранённый статус после чтения из БД.
            storedOrder = await Order.findByPk(101);

            assert.equal(storedOrder.status, "completed");
            assert.ok(storedOrder.completedAt);

            const savedCorrections = await Correction.findAll({
                where: { orderId: 101 },
                order: [["id", "ASC"]],
            });

            assert.deepEqual(
                savedCorrections.map((item) => item.eventType),
                [
                    "submitted",
                    "rejected",
                    "submitted",
                    "accepted",
                ]
            );

            assert.deepEqual(
                savedCorrections.map(
                    (item) => Number(item.roundNumber)
                ),
                [1, 1, 2, 2]
            );

            // 8. Данные для будущего акта берутся
            // из реальных сохранённых решений.
            const evidence =
                await payment.buildCompletionPaymentSnapshot(
                    storedOrder
                );

            assert.equal(
                evidence.customer.originalQualityDecision,
                "remarks"
            );

            assert.equal(
                evidence.customer.qualityDecision,
                "accepted"
            );

            assert.equal(
                evidence.customer.originalRemarks,
                remarksText
            );

            assert.equal(evidence.corrections.length, 4);
            assert.equal(evidence.cashReconciled, true);

            assert.equal(
                evidence.customer.payoutAuthorized,
                false
            );

            assert.equal(
                new Date(
                    evidence.customer.acceptedAfterCorrectionsAt
                ).getTime(),
                new Date(
                    savedCorrections[3].eventAt
                ).getTime()
            );

            // 9. Проверяем реальный UNIQUE INDEX.
            await assert.rejects(
                Decision.create({
                    orderId: 101,
                    userId: 1,
                    partyRole: "executor",
                    qualityDecision: null,
                    cashStatus: "none",
                    cashAmountKopecks: 0,
                    payoutAuthorized: false,
                    confirmedAt: new Date(),
                }),
                (error) =>
                    error.name ===
                    "SequelizeUniqueConstraintError"
            );

            assert.equal(
                await Decision.count({
                    where: { orderId: 101 },
                }),
                2
            );

            // 10. Проверяем два одновременных запроса
            // подтверждения другого тестового заказа.
            await Order.create({
                id: 102,
                creatorId: 2,
                executorId: 1,
                status: "active",
                completedBy: [],
                paymentType: "cash",
                proposedSum: 500,
                finalPriceKopecks: 50000,
            });

            const confirm = () =>
                workflow.submitInitialCompletion({
                    orderId: 102,
                    userId: 1,
                    completion: {
                        workConfirmed: true,
                        cashStatus: "none",
                        payoutAuthorized: false,
                    },
                });

            const concurrent = await Promise.allSettled([
                confirm(),
                confirm(),
            ]);

            assert.equal(
                concurrent.filter(
                    (result) => result.status === "fulfilled"
                ).length,
                2,
                JSON.stringify(concurrent)
            );

            assert.deepEqual(
                concurrent
                    .map((result) => result.value.changed)
                    .sort(),
                [false, true]
            );

            assert.equal(
                await Decision.count({
                    where: { orderId: 102 },
                }),
                1
            );

            const secondOrder = await Order.findByPk(102);

            assert.deepEqual(secondOrder.completedBy, [1]);
            assert.equal(secondOrder.status, "active");

        } finally {
            if (sequelize) {
                await sequelize.close();
            }

            if (connection) {
                // Удаляем только наши тестовые таблицы,
                // и только после проверки идентичности БД.
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