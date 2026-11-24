"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

const DB = {
    host: "127.0.0.1",
    port: 13316,
    user: "cc_chat_test",
    password: "cc_chat_test_local_only",
    database: "cc_chat_test_only",
    connectTimeout: 5000,
    multipleStatements: true,
};

const TABLES = [
    "cc_guarantee_test_attempts",
    "cc_guarantee_test_payouts",
    "cc_guarantee_test_snapshots",
    "cc_guarantee_test_orders",
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
        "cc_chat_test_only"
    );

    assert.match(
        String(identity.databaseUser),
        /^cc_chat_test@/
    );
}

async function cleanup(db) {
    for (const table of TABLES) {
        await db.query(
            `DROP TABLE IF EXISTS \`${table}\``
        );
    }
}

function isolatedSql() {
    const filename = path.resolve(
        __dirname,
        "../../migrations/026_guarantee_financial_ledger.sql"
    );

    let sql = fs.readFileSync(filename, "utf8");

    const replacements = [
        [
            /CREATE TABLE guarantee_financial_snapshots\b/g,
            "CREATE TABLE cc_guarantee_test_snapshots",
        ],
        [
            /CREATE TABLE guarantee_payouts\b/g,
            "CREATE TABLE cc_guarantee_test_payouts",
        ],
        [
            /CREATE TABLE guarantee_payout_attempts\b/g,
            "CREATE TABLE cc_guarantee_test_attempts",
        ],
        [
            /REFERENCES orders\(id\)/g,
            "REFERENCES cc_guarantee_test_orders(id)",
        ],
        [
            /REFERENCES guarantee_financial_snapshots\(id\)/g,
            "REFERENCES cc_guarantee_test_snapshots(id)",
        ],
        [
            /REFERENCES guarantee_payouts\(id\)/g,
            "REFERENCES cc_guarantee_test_payouts(id)",
        ],
    ];

    for (const [pattern, replacement] of replacements) {
        const count = [...sql.matchAll(pattern)].length;

        assert.equal(
            count,
            1,
            `Изменилась структура SQL: ${pattern}`
        );

        sql = sql.replace(pattern, replacement);
    }

    return sql;
}

function snapshotValues(orderId) {
    return [
        orderId,
        10,
        "guarantee-preview-v1",
        JSON.stringify({
            previewOnly: true,
        }),
        1000000,
        21600,
        50400,
        72000,
        15000,
        1036600,
        949600,
        "tbank",
        "quoted",
    ];
}

const INSERT_SNAPSHOT = `
    INSERT INTO cc_guarantee_test_snapshots (
        order_id,
        creator_id,
        pricing_version,
        pricing_parameters_json,
        work_price_kopecks,
        buyer_fee_kopecks,
        executor_fee_kopecks,
        platform_fee_kopecks,
        promotion_kopecks,
        customer_total_kopecks,
        executor_payout_kopecks,
        provider,
        status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const duplicateKey =
    (error) => error?.code === "ER_DUP_ENTRY";

const checkViolation =
    (error) =>
        error?.code === "ER_CHECK_CONSTRAINT_VIOLATED";

test(
    "Гарантийный реестр: реальная MySQL и миграция 026",
    async (t) => {
        const db = await mysql.createConnection(DB);
        let verified = false;
        let peer = null;

        try {
            // Ничего не изменяем до проверки изоляции.
            await verifyDatabase(db);
            verified = true;

            await cleanup(db);

            await db.query(`
                CREATE TABLE cc_guarantee_test_orders (
                    id INT NOT NULL PRIMARY KEY
                ) ENGINE=InnoDB
            `);

            await db.query(`
                INSERT INTO cc_guarantee_test_orders (id)
                VALUES (101), (102), (103)
            `);

            // Применяем фактическую миграцию 026,
            // меняя только названия тестовых таблиц.
            await db.query(isolatedSql());

            await t.test(
                "Снимок создаётся с правильными суммами",
                async () => {
                    const [result] = await db.execute(
                        INSERT_SNAPSHOT,
                        snapshotValues(101)
                    );

                    assert.ok(result.insertId > 0);

                    const [[row]] = await db.execute(`
                        SELECT *
                        FROM cc_guarantee_test_snapshots
                        WHERE order_id = 101
                    `);

                    assert.equal(
                        Number(row.customer_total_kopecks),
                        1036600
                    );

                    assert.equal(
                        Number(row.executor_payout_kopecks),
                        949600
                    );

                    assert.equal(row.status, "quoted");
                    assert.equal(row.locked_at, null);
                }
            );

            await t.test(
                "Повторный снимок запрещён",
                async () => {
                    await assert.rejects(
                        () => db.execute(
                            INSERT_SNAPSHOT,
                            snapshotValues(101)
                        ),
                        duplicateKey
                    );
                }
            );

            await t.test(
                "Некорректная комиссия запрещена",
                async () => {
                    const invalid = snapshotValues(102);
                    invalid[7] = 71999;

                    await assert.rejects(
                        () => db.execute(
                            INSERT_SNAPSHOT,
                            invalid
                        ),
                        checkViolation
                    );
                }
            );

            await t.test(
                "Некорректная сумма выплаты запрещена",
                async () => {
                    const invalid = snapshotValues(102);
                    invalid[10] = 949601;

                    await assert.rejects(
                        () => db.execute(
                            INSERT_SNAPSHOT,
                            invalid
                        ),
                        checkViolation
                    );
                }
            );

            await t.test(
                "Одновременно создаётся только один снимок",
                async () => {
                    peer = await mysql.createConnection(DB);
                    await verifyDatabase(peer);

                    const values = snapshotValues(102);

                    const results = await Promise.allSettled([
                        db.execute(INSERT_SNAPSHOT, values),
                        peer.execute(INSERT_SNAPSHOT, values),
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
                                duplicateKey(result.reason)
                        ).length,
                        1
                    );
                }
            );

            await t.test(
                "Дублирование выплаты запрещено",
                async () => {
                    const [[snapshot]] = await db.execute(`
                        SELECT id
                        FROM cc_guarantee_test_snapshots
                        WHERE order_id = 101
                    `);

                    const values = [
                        snapshot.id,
                        20,
                        949600,
                        "pending_acceptance",
                    ];

                    const sql = `
                        INSERT INTO cc_guarantee_test_payouts (
                            snapshot_id,
                            executor_id,
                            amount_kopecks,
                            status
                        )
                        VALUES (?, ?, ?, ?)
                    `;

                    await db.execute(sql, values);

                    await assert.rejects(
                        () => db.execute(sql, values),
                        duplicateKey
                    );
                }
            );

            await t.test(
                "Банковская попытка имеет уникальный ключ",
                async () => {
                    const [[payout]] = await db.execute(`
                        SELECT id
                        FROM cc_guarantee_test_payouts
                        LIMIT 1
                    `);

                    const sql = `
                        INSERT INTO cc_guarantee_test_attempts (
                            payout_id,
                            provider,
                            idempotency_key,
                            provider_transfer_id
                        )
                        VALUES (?, ?, ?, ?)
                    `;

                    const values = [
                        payout.id,
                        "tbank",
                        "11111111-1111-4111-8111-111111111111",
                        "test-transfer-1",
                    ];

                    await db.execute(sql, values);

                    await assert.rejects(
                        () => db.execute(sql, values),
                        duplicateKey
                    );

                    await assert.rejects(
                        () => db.execute(sql, [
                            payout.id,
                            "tbank",
                            "22222222-2222-4222-8222-222222222222",
                            "test-transfer-1",
                        ]),
                        duplicateKey
                    );
                }
            );

            await t.test(
                "Откат транзакции удаляет несохранённый снимок",
                async () => {
                    await db.beginTransaction();

                    try {
                        await db.execute(
                            INSERT_SNAPSHOT,
                            snapshotValues(103)
                        );
                    } finally {
                        await db.rollback();
                    }

                    const [[row]] = await db.execute(`
                        SELECT COUNT(*) AS total
                        FROM cc_guarantee_test_snapshots
                        WHERE order_id = 103
                    `);

                    assert.equal(Number(row.total), 0);
                }
            );

        } finally {
            if (peer) {
                await peer.end();
            }

            try {
                if (verified) {
                    await cleanup(db);
                }
            } finally {
                await db.end();
            }
        }
    }
);