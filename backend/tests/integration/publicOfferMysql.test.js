
const test = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const fs = require("node:fs");
const path = require("node:path");

const DB = {
    host: "127.0.0.1",
    port: 13316,
    user: "cc_chat_test",
    password: "cc_chat_test_local_only",
    database: "cc_chat_test_only",
    connectTimeout: 5000,
    multipleStatements: false,
};

test("Оферта: ограничения и конкурентность MySQL", async () => {
    let first;
    let second;
    let verified = false;

    try {
        first = await mysql.createConnection(DB);

        const [[identity]] = await first.query(`
            SELECT
                @@hostname AS hostname,
                DATABASE() AS dbName,
                CURRENT_USER() AS loginName
        `);

        assert.equal(
            identity.hostname,
            "cc-chat-mysql-test"
        );

        assert.equal(
            identity.dbName,
            "cc_chat_test_only"
        );

        assert.match(
            String(identity.loginName),
            /^cc_chat_test@/
        );

        verified = true;

        second = await mysql.createConnection(DB);

        await first.query(
            "DROP TABLE IF EXISTS cc_offer_test_acceptances"
        );

        await first.query(
            "DROP TABLE IF EXISTS cc_offer_test_users"
        );

        await first.query(`
            CREATE TABLE cc_offer_test_users (
                id INT NOT NULL PRIMARY KEY
            ) ENGINE=InnoDB
        `);

        await first.query(`
            INSERT INTO cc_offer_test_users (id)
            VALUES (1), (2)
        `);

        const migration = fs.readFileSync(
            path.resolve(
                __dirname,
                "../../migrations/024_public_offer_acceptances.sql"
            ),
            "utf8"
        );

        const isolatedSql = migration
            .replaceAll(
                "user_public_offer_acceptances",
                "cc_offer_test_acceptances"
            )
            .replace(
                "REFERENCES users (id)",
                "REFERENCES cc_offer_test_users (id)"
            );

        await first.query(isolatedSql);

        const insert = (connection) =>
            connection.query(
                `
                INSERT INTO cc_offer_test_acceptances
                (
                    user_id,
                    offer_version,
                    offer_sha256,
                    source
                )
                VALUES (?, ?, ?, ?)
                `,
                [
                    1,
                    "2026-11-09",
                    "a".repeat(64),
                    "existing_user",
                ]
            );

        // Одновременно пытаемся принять
        // одну редакцию два раза.
        const results = await Promise.allSettled([
            insert(first),
            insert(second),
        ]);

        assert.equal(
            results.filter(
                (r) => r.status === "fulfilled"
            ).length,
            1
        );

        const failure = results.find(
            (r) => r.status === "rejected"
        );

        assert.equal(
            failure.reason.code,
            "ER_DUP_ENTRY"
        );

        const [[count]] = await first.query(`
            SELECT COUNT(*) AS total
            FROM cc_offer_test_acceptances
        `);

        assert.equal(Number(count.total), 1);

        // Другой пользователь может принять
        // ту же редакцию.
        await first.query(
            `
            INSERT INTO cc_offer_test_acceptances
            (user_id, offer_version, offer_sha256, source)
            VALUES (?, ?, ?, ?)
            `,
            [
                2,
                "2026-11-09",
                "a".repeat(64),
                "existing_user",
            ]
        );

        // Один пользователь может принять
        // новую редакцию.
        await first.query(
            `
            INSERT INTO cc_offer_test_acceptances
            (user_id, offer_version, offer_sha256, source)
            VALUES (?, ?, ?, ?)
            `,
            [
                1,
                "2027-01-01",
                "b".repeat(64),
                "existing_user",
            ]
        );

        const [[finalCount]] = await first.query(`
            SELECT COUNT(*) AS total
            FROM cc_offer_test_acceptances
        `);

        assert.equal(Number(finalCount.total), 3);

        // Несуществующий пользователь
        // не может создать запись акцепта.
        await assert.rejects(
            first.query(
                `
                INSERT INTO cc_offer_test_acceptances
                (user_id, offer_version, offer_sha256, source)
                VALUES (?, ?, ?, ?)
                `,
                [
                    999,
                    "2026-11-09",
                    "a".repeat(64),
                    "existing_user",
                ]
            ),
            (error) =>
                error.code === "ER_NO_REFERENCED_ROW_2"
        );
    } finally {
        if (verified && first) {
            await first.query(
                "DROP TABLE IF EXISTS cc_offer_test_acceptances"
            );

            await first.query(
                "DROP TABLE IF EXISTS cc_offer_test_users"
            );
        }

        await first?.end();
        await second?.end();
    }
});
