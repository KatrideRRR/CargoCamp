const test = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");

const {
    Sequelize,
    DataTypes,
    QueryTypes,
} = require("sequelize");

const { randomUUID } = require("node:crypto");

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

test("Защита создания платежа продвижения: MySQL", async (t) => {
    const connection = await mysql.createConnection(DB);

    let sequelize;
    let verified = false;

    try {
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

        verified = true;

        await connection.query(`
            DROP TABLE IF EXISTS promotion_payment_intents
        `);

        await connection.query(`
            DROP TABLE IF EXISTS cc_payment_intent_test_orders
        `);

        await connection.query(`
            CREATE TABLE cc_payment_intent_test_orders (
                id INT PRIMARY KEY,
                creator_id INT NOT NULL,
                status VARCHAR(40) NOT NULL,
                promotion_requested JSON NOT NULL,
                promotion_payment_id VARCHAR(128),
                promotion_payment_provider VARCHAR(40),
                promotion_paid_at DATETIME(3)
            ) ENGINE=InnoDB
        `);

        await connection.query(`
            CREATE TABLE promotion_payment_intents (
                order_id INT PRIMARY KEY,
                user_id INT NOT NULL,
                provider VARCHAR(40) NOT NULL,
                payment_mode VARCHAR(40) NOT NULL,
                amount_kopecks INT NOT NULL,
                idempotency_key CHAR(36) NOT NULL,
                bank_order_id VARCHAR(128) NOT NULL,
                payment_id VARCHAR(128),
                confirmation_url TEXT,
                payment_status VARCHAR(40),
                state VARCHAR(40) NOT NULL,
                created_at DATETIME(3)
                    DEFAULT CURRENT_TIMESTAMP(3),

                updated_at DATETIME(3)
                    DEFAULT CURRENT_TIMESTAMP(3),

                UNIQUE KEY uq_test_promotion_key (
                    idempotency_key
                )
            ) ENGINE=InnoDB
        `);

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
                    max: 5,
                    min: 0,
                },
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
                status: DataTypes.STRING,
                promotionRequested: {
                    type: DataTypes.JSON,
                    field: "promotion_requested",
                },
                promotionPaymentId: {
                    type: DataTypes.STRING,
                    field: "promotion_payment_id",
                },
                promotionPaymentProvider: {
                    type: DataTypes.STRING,
                    field: "promotion_payment_provider",
                },
                promotionPaidAt: {
                    type: DataTypes.DATE,
                    field: "promotion_paid_at",
                },
            },
            {
                tableName: "cc_payment_intent_test_orders",
                timestamps: false,
            }
        );

        await Order.create({
            id: 101,
            creatorId: 5,
            status: "pending_payment",
            promotionRequested: {
                highlight: true,
                recommended: false,
                push: false,
            },
        });

        const service = loadIsolatedService(
            "promotionPaymentIntentService.js",
            {
                "node:crypto": { randomUUID },

                sequelize: { QueryTypes },

                "../models": {
                    sequelize,
                    Order,
                },

                "./promotionPaymentService": {
                    expectedPromotionKopecks(order) {
                        const options =
                            order.promotionRequested;

                        return options.highlight
                            ? 5000
                            : 0;
                    },
                },
            }
        );

        const claim = (provider = "yookassa") =>
            service.claimPromotionPaymentIntent({
                orderId: 101,
                userId: 5,
                provider,
                mode: "redirect",
            });

        await t.test(
            "Два параллельных запроса создают одну попытку",
            async () => {
                const results = await Promise.all([
                    claim(),
                    claim(),
                ]);

                assert.equal(
                    results.filter(
                        (item) => item.created
                    ).length,
                    1
                );

                const [rows] = await connection.query(`
                    SELECT COUNT(*) AS total
                    FROM promotion_payment_intents
                `);

                assert.equal(
                    Number(rows[0].total),
                    1
                );
            }
        );

        await t.test(
            "Записываем первый банковский платёж",
            async () => {
                await service.recordPromotionPaymentIntent({
                    orderId: 101,
                    provider: "yookassa",
                    paymentId: "test-payment-1",
                    confirmationUrl:
                        "https://example.test/pay/1",
                    paymentStatus: "pending",
                });

                const order = await Order.findByPk(101);

                assert.equal(
                    order.promotionPaymentId,
                    "test-payment-1"
                );
            }
        );

        await t.test(
            "Повторный запрос возвращает существующий платёж",
            async () => {
                const result = await claim();

                assert.equal(result.created, false);
                assert.equal(
                    result.paymentId,
                    "test-payment-1"
                );

                assert.equal(
                    result.confirmationUrl,
                    "https://example.test/pay/1"
                );
            }
        );

        await t.test(
            "Переключение на другой банк не создаёт вторую попытку",
            async () => {
                const result = await claim("tbank");

                assert.equal(result.created, false);
                assert.equal(
                    result.provider,
                    "yookassa"
                );
            }
        );

        await t.test(
            "Подмена банковского PaymentId запрещена",
            async () => {
                await assert.rejects(
                    () =>
                        service.recordPromotionPaymentIntent({
                            orderId: 101,
                            provider: "yookassa",
                            paymentId: "test-payment-2",
                        }),
                    (error) =>
                        error.httpStatus === 409
                );
            }
        );

        await t.test(
            "Чужой пользователь не может начать оплату",
            async () => {
                await assert.rejects(
                    () =>
                        service.claimPromotionPaymentIntent({
                            orderId: 101,
                            userId: 999,
                            provider: "yookassa",
                        }),
                    (error) =>
                        error.httpStatus === 403
                );
            }
        );
    } finally {
        if (sequelize) {
            await sequelize.close();
        }

        if (verified) {
            await connection.query(`
                DROP TABLE IF EXISTS promotion_payment_intents
            `);

            await connection.query(`
                DROP TABLE IF EXISTS cc_payment_intent_test_orders
            `);
        }

        await connection.end();
    }
});