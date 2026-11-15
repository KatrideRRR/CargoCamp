
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

const { Sequelize, DataTypes } = require("sequelize");

const DB = Object.freeze({
    host: "127.0.0.1",
    port: 13316,
    user: "cc_chat_test",
    password: "cc_chat_test_local_only",
    database: "cc_chat_test_only",
    connectTimeout: 5000,
    multipleStatements: true,
});

const TABLES = Object.freeze({
    users: "cc_stage3_users",
    orders: "cc_stage3_orders",
    express_orders: "cc_stage3_express_orders",
    payment_receipts: "cc_stage3_payment_receipts",
    commission_charge_attempts:
        "cc_stage3_commission_charge_attempts",
    tbank_card_bind_attempts:
        "cc_stage3_tbank_card_bind_attempts",
    promotion_payment_intents:
        "cc_stage3_promotion_payment_intents",
    promotion_payment_retry_history:
        "cc_stage3_promotion_payment_retry_history",
});

const MIGRATIONS = [
    ["013_order_commission_guard.sql", 1],
    ["014_unified_payment_foundation.sql", 4],
    ["022_promotion_payment_intents.sql", 1],
    ["023_promotion_payment_retry_history.sql", 1],
    ["025_order_creator_social_benefit.sql", 2],
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

async function cleanTables(db) {
    // Только фиксированный список таблиц этапа №3.
    // Никаких DROP DATABASE или общих таблиц.
    for (const name of Object.values(TABLES).reverse()) {
        await db.query(
            `DROP TABLE IF EXISTS \`${name}\``
        );
    }
}

async function applyIsolatedMigration(db, file, expected) {
    const source = fs.readFileSync(
        path.resolve(
            __dirname,
            "../../migrations",
            file
        ),
        "utf8"
    );

    let replacements = 0;

    const sql = source.replace(
        /\b(ALTER TABLE|CREATE TABLE)\s+([A-Za-z_][A-Za-z0-9_]*)\b/g,
        (match, operation, name) => {
            const isolatedName = TABLES[name];

            if (!isolatedName) {
                throw new Error(
                    `Unexpected migration table: ${name}`
                );
            }

            replacements += 1;

            return `${operation} \`${isolatedName}\``;
        }
    );

    assert.equal(
        replacements,
        expected,
        `Unexpected SQL structure in ${file}`
    );

    await db.query(sql);
}

async function countRows(db, table, where, params = []) {
    const [[row]] = await db.execute(
        `SELECT COUNT(*) AS total FROM \`${table}\` WHERE ${where}`,
        params
    );

    return Number(row.total);
}

function duplicateKey(error) {
    return error?.code === "ER_DUP_ENTRY";
}

test("CargoCamp: migrations, MySQL consistency and rollback", async (t) => {
    const db = await mysql.createConnection(DB);

    let verified = false;
    let peer = null;

    try {
        // Ничего не изменяем до проверки
        // фактической идентичности MySQL.
        await verifyDatabase(db);
        verified = true;

        await cleanTables(db);

        // Минимальная базовая схема для ALTER TABLE.
        await db.query(`
            CREATE TABLE cc_stage3_users (
                id INT PRIMARY KEY
            ) ENGINE=InnoDB
        `);

        await db.query(`
            CREATE TABLE cc_stage3_orders (
                id INT PRIMARY KEY
            ) ENGINE=InnoDB
        `);

        await db.query(`
            CREATE TABLE cc_stage3_express_orders (
                id INT PRIMARY KEY
            ) ENGINE=InnoDB
        `);

        for (const [file, count] of MIGRATIONS) {
            await applyIsolatedMigration(
                db,
                file,
                count
            );
        }

        await t.test(
            "Migration columns match Sequelize model fields",
            async () => {
                const orm = new Sequelize(
                    "unused_schema",
                    "unused_user",
                    "unused_password",
                    {
                        dialect: "mysql",
                        logging: false,
                    }
                );

                try {
                    const User =
                        require("../../models/User")(orm);

                    const Order =
                        require("../../models/Order")(orm);

                    const ExpressOrder =
                        require("../../models/ExpressOrder")(
                            orm,
                            DataTypes
                        );

                    const checks = [
                        [User, "tbankRebillId",
                            TABLES.users, "tbank_rebill_id"],
                        [User, "tbankCardId",
                            TABLES.users, "tbank_card_id"],
                        [User, "autoCommissionProvider",
                            TABLES.users, "auto_commission_provider"],
                        [Order, "commissionAmountKopecks",
                            TABLES.orders, "commission_amount_kopecks"],
                        [Order, "commissionAccruedAt",
                            TABLES.orders, "commission_accrued_at"],
                        [Order, "creatorSocialBenefitAtCreation",
                            TABLES.orders, "creator_social_benefit_at_creation"],
                        [ExpressOrder, "creatorSocialBenefitAtCreation",
                            TABLES.express_orders,
                            "creator_social_benefit_at_creation"],
                    ];

                    for (const [
                        model,
                        attribute,
                        table,
                        column,
                    ] of checks) {
                        assert.equal(
                            model.getAttributes()[attribute]?.field,
                            column
                        );

                        const [[result]] = await db.execute(`
                            SELECT COUNT(*) AS total
                            FROM information_schema.COLUMNS
                            WHERE TABLE_SCHEMA = DATABASE()
                              AND TABLE_NAME = ?
                              AND COLUMN_NAME = ?
                        `, [table, column]);

                        assert.equal(
                            Number(result.total),
                            1,
                            `Missing ${table}.${column}`
                        );
                    }
                } finally {
                    await orm.close();
                }
            }
        );

        await t.test(
            "Payment receipt cannot be applied twice",
            async () => {
                const table = TABLES.payment_receipts;

                const sql = `
                    INSERT INTO \`${table}\`
                    (provider, payment_id, user_id,
                     purpose, amount_kopecks)
                    VALUES (?, ?, ?, ?, ?)
                `;

                await db.execute(sql, [
                    "yookassa", "payment-101", 11,
                    "debt", 20000,
                ]);

                await assert.rejects(
                    () => db.execute(sql, [
                        "yookassa", "payment-101", 11,
                        "debt", 20000,
                    ]),
                    duplicateKey
                );

                // Одинаковый ID у разных провайдеров
                // является независимой записью.
                await db.execute(sql, [
                    "tbank", "payment-101", 11,
                    "debt", 20000,
                ]);

                assert.equal(
                    await countRows(
                        db, table, "payment_id = ?",
                        ["payment-101"]
                    ),
                    2
                );
            }
        );

        await t.test(
            "Concurrent commission attempts create one record",
            async () => {
                peer = await mysql.createConnection(DB);
                await verifyDatabase(peer);

                const table =
                    TABLES.commission_charge_attempts;

                const sql = `
                    INSERT INTO \`${table}\`
                    (source_type, source_id, user_id,
                     provider, amount_kopecks, idempotency_key)
                    VALUES (?, ?, ?, ?, ?, ?)
                `;

                const results = await Promise.allSettled([
                    db.execute(sql, [
                        "regular", 800, 42, "yookassa",
                        20000,
                        "11111111-1111-4111-8111-111111111111",
                    ]),
                    peer.execute(sql, [
                        "regular", 800, 42, "tbank",
                        20000,
                        "22222222-2222-4222-8222-222222222222",
                    ]),
                ]);

                assert.equal(
                    results.filter(
                        (r) => r.status === "fulfilled"
                    ).length,
                    1
                );

                assert.equal(
                    results.filter(
                        (r) =>
                            r.status === "rejected" &&
                            duplicateKey(r.reason)
                    ).length,
                    1
                );

                assert.equal(
                    await countRows(
                        db, table,
                        "source_type = ? AND source_id = ?",
                        ["regular", 800]
                    ),
                    1
                );

                const [[winner]] = await db.execute(`
                    SELECT idempotency_key
                    FROM \`${table}\`
                    WHERE source_type = 'regular'
                      AND source_id = 800
                `);

                await assert.rejects(
                    () => db.execute(sql, [
                        "regular", 801, 42, "yookassa",
                        20000, winner.idempotency_key,
                    ]),
                    duplicateKey
                );
            }
        );

        await t.test(
            "Failed transaction rolls back payment changes",
            async () => {
                const table = TABLES.payment_receipts;

                const sql = `
                    INSERT INTO \`${table}\`
                    (provider, payment_id, user_id,
                     purpose, amount_kopecks)
                    VALUES (?, ?, ?, ?, ?)
                `;

                await db.beginTransaction();

                try {
                    await db.execute(sql, [
                        "yookassa", "rollback-payment",
                        11, "premium", 900000,
                    ]);

                    // Повторная вставка вызывает SQL-ошибку.
                    await assert.rejects(
                        () => db.execute(sql, [
                            "yookassa", "rollback-payment",
                            11, "premium", 900000,
                        ]),
                        duplicateKey
                    );
                } finally {
                    await db.rollback();
                }

                assert.equal(
                    await countRows(
                        db, table, "payment_id = ?",
                        ["rollback-payment"]
                    ),
                    0
                );
            }
        );

        await t.test(
            "Promotion migration enforces idempotency",
            async () => {
                const table =
                    TABLES.promotion_payment_intents;

                const sql = `
                    INSERT INTO \`${table}\`
                    (order_id, user_id, provider,
                     payment_mode, amount_kopecks,
                     idempotency_key, bank_order_id)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `;

                const key =
                    "33333333-3333-4333-8333-333333333333";

                await db.execute(sql, [
                    100, 42, "yookassa", "redirect",
                    5000, key, "bank-order-100",
                ]);

                await assert.rejects(
                    () => db.execute(sql, [
                        101, 42, "yookassa", "redirect",
                        5000, key, "bank-order-101",
                    ]),
                    duplicateKey
                );

                await assert.rejects(
                    () => db.execute(sql, [
                        102, 42, "tbank", "redirect",
                        5000,
                        "44444444-4444-4444-8444-444444444444",
                        "bank-order-100",
                    ]),
                    duplicateKey
                );
            }
        );

        await t.test(
            "Retry history rejects duplicate idempotency keys",
            async () => {
                const table =
                    TABLES.promotion_payment_retry_history;

                const sql = `
                    INSERT INTO \`${table}\`
                    (order_id, user_id, provider,
                     payment_mode, amount_kopecks,
                     idempotency_key, bank_order_id,
                     payment_id, previous_state,
                     verified_terminal_status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `;

                const values = [
                    100, 42, "yookassa", "redirect",
                    5000,
                    "55555555-5555-4555-8555-555555555555",
                    "bank-order-old",
                    "payment-old",
                    "failed",
                    "canceled",
                ];

                await db.execute(sql, values);

                await assert.rejects(
                    () => db.execute(sql, [
                        101,
                        ...values.slice(1),
                    ]),
                    duplicateKey
                );
            }
        );
    } finally {
        if (peer) {
            await peer.end();
        }

        try {
            if (verified) {
                await cleanTables(db);
            }
        } finally {
            await db.end();
        }
    }
});
