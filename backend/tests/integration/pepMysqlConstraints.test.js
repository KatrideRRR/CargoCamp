const test = require("node:test");
const assert = require("node:assert/strict");
const mysql = require("mysql2/promise");
const fs = require("node:fs");
const path = require("node:path");

// Только изолированная тестовая MySQL.
// Рабочее окружение и .env не используются.
const TEST_DB = Object.freeze({
    host: "127.0.0.1",
    port: 13316,
    user: "cc_chat_test",
    password: "cc_chat_test_local_only",
    database: "cc_chat_test_only",
    connectTimeout: 5000,
    multipleStatements: false,
});

async function connectTestDb() {
    const db = await mysql.createConnection(TEST_DB);

    try {
        const [rows] = await db.query(`
            SELECT
                @@hostname AS hostName,
                DATABASE() AS dbName,
                CURRENT_USER() AS loginName
        `);

        const row = rows[0];

        if (
            row?.hostName !== "cc-chat-mysql-test" ||
            row?.dbName !== "cc_chat_test_only" ||
            !String(row?.loginName || "")
                .startsWith("cc_chat_test@")
        ) {
            throw new Error(
                "ОПАСНО: подключение не является тестовой MySQL"
            );
        }

        await db.query(
            "SET SESSION innodb_lock_wait_timeout = 1"
        );

        return db;
    } catch (error) {
        await db.end();
        throw error;
    }
}

async function rollback(db) {
    if (!db) return;

    try {
        await db.query("ROLLBACK");
    } catch {
        // Соединение может быть закрыто.
    }
}

async function createTables(db) {
    await db.query(`
        DROP TABLE IF EXISTS cc_pep_test_signatures
    `);

    await db.query(`
        DROP TABLE IF EXISTS cc_pep_test_sessions
    `);

    await db.query(`
        DROP TABLE IF EXISTS cc_pep_test_enrollments
    `);

    await db.query(`
        CREATE TABLE cc_pep_test_enrollments (
            user_id INT NOT NULL PRIMARY KEY,
            revoked_at DATETIME(3) NULL,
            expires_at DATETIME(3) NOT NULL
        ) ENGINE=InnoDB
    `);

    await db.query(`
        CREATE TABLE cc_pep_test_sessions (
            id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
            user_id INT NOT NULL,
            revoked_at DATETIME(3) NULL
        ) ENGINE=InnoDB
    `);

    await db.query(`
        CREATE TABLE cc_pep_test_signatures (
            id BIGINT UNSIGNED NOT NULL
                AUTO_INCREMENT PRIMARY KEY,

            contract_id BIGINT UNSIGNED NOT NULL,
            user_id INT NOT NULL,
            party_role VARCHAR(32) NOT NULL,

            UNIQUE KEY uq_pep_test_signature (
                contract_id,
                user_id,
                party_role
            )
        ) ENGINE=InnoDB
    `);
}

test("ПЭП: реальные ограничения MySQL", async (t) => {
    let main;
    let signer;
    let admin;
    let verified = false;

    try {
        main = await connectTestDb();
        signer = await connectTestDb();
        admin = await connectTestDb();

        verified = true;

        // Проверяем, что реальные миграции содержат
        // ограничения уникальности.
        const migrations = path.resolve(
            __dirname,
            "../../migrations"
        );

        const pepMigration = fs.readFileSync(
            path.join(
                migrations,
                "009_pep_enrollments.sql"
            ),
            "utf8"
        );

        const contractsMigration = fs.readFileSync(
            path.join(
                migrations,
                "001_legal_identity_contract_foundation.sql"
            ),
            "utf8"
        );

        assert.match(
            pepMigration,
            /UNIQUE KEY uq_pep_user/
        );

        assert.match(
            contractsMigration,
            /UNIQUE KEY uq_contract_signature_party/
        );

        await createTables(main);

        await t.test(
            "Подписание блокирует одновременный отзыв ПЭП",
            async () => {
                await main.query(`
                    INSERT INTO cc_pep_test_enrollments
                    (user_id, expires_at)
                    VALUES (1, '2030-01-01 00:00:00.000')
                `);

                try {
                    await signer.query("START TRANSACTION");

                    const [rows] = await signer.query(`
                        SELECT *
                        FROM cc_pep_test_enrollments
                        WHERE user_id = 1
                        FOR UPDATE
                    `);

                    assert.equal(rows.length, 1);
                    assert.equal(rows[0].revoked_at, null);

                    await admin.query("START TRANSACTION");

                    // Отзыв не должен получить строку,
                    // пока подписывающая транзакция
                    // удерживает блокировку.
                    await assert.rejects(
                        () => admin.query(`
                            UPDATE cc_pep_test_enrollments
                            SET revoked_at = NOW(3)
                            WHERE user_id = 1
                        `),
                        (error) =>
                            error.code === "ER_LOCK_WAIT_TIMEOUT"
                    );

                    await admin.query("ROLLBACK");

                    await signer.query(`
                        INSERT INTO cc_pep_test_signatures
                        (contract_id, user_id, party_role)
                        VALUES (101, 1, 'creator')
                    `);

                    await signer.query("COMMIT");

                    // После фиксации подписи отзыв разрешён.
                    await admin.query(`
                        UPDATE cc_pep_test_enrollments
                        SET revoked_at = NOW(3)
                        WHERE user_id = 1
                    `);

                    const [saved] = await main.query(`
                        SELECT
                            COUNT(*) AS total
                        FROM cc_pep_test_signatures
                        WHERE user_id = 1
                    `);

                    const [enrollment] = await main.query(`
                        SELECT revoked_at
                        FROM cc_pep_test_enrollments
                        WHERE user_id = 1
                    `);

                    assert.equal(Number(saved[0].total), 1);
                    assert.ok(enrollment[0].revoked_at);
                } finally {
                    await rollback(signer);
                    await rollback(admin);
                }
            }
        );

        await t.test(
            "Отзыв первым запрещает последующее подписание",
            async () => {
                await main.query(`
                    INSERT INTO cc_pep_test_enrollments
                    (user_id, expires_at)
                    VALUES (2, '2030-01-01 00:00:00.000')
                `);

                try {
                    await admin.query("START TRANSACTION");

                    await admin.query(`
                        SELECT *
                        FROM cc_pep_test_enrollments
                        WHERE user_id = 2
                        FOR UPDATE
                    `);

                    await admin.query(`
                        UPDATE cc_pep_test_enrollments
                        SET revoked_at = NOW(3)
                        WHERE user_id = 2
                    `);

                    await signer.query("START TRANSACTION");

                    await assert.rejects(
                        () => signer.query(`
                            SELECT *
                            FROM cc_pep_test_enrollments
                            WHERE user_id = 2
                            FOR UPDATE
                        `),
                        (error) =>
                            error.code === "ER_LOCK_WAIT_TIMEOUT"
                    );

                    await signer.query("ROLLBACK");

                    await admin.query("COMMIT");

                    await signer.query("START TRANSACTION");

                    const [rows] = await signer.query(`
                        SELECT revoked_at
                        FROM cc_pep_test_enrollments
                        WHERE user_id = 2
                        FOR UPDATE
                    `);

                    assert.ok(rows[0].revoked_at);

                    // Подписывать нельзя.
                    await signer.query("ROLLBACK");

                    const [saved] = await main.query(`
                        SELECT COUNT(*) AS total
                        FROM cc_pep_test_signatures
                        WHERE user_id = 2
                    `);

                    assert.equal(Number(saved[0].total), 0);
                } finally {
                    await rollback(signer);
                    await rollback(admin);
                }
            }
        );

        await t.test(
            "Повторная подпись одного документа запрещена",
            async () => {
                await main.query(`
                    INSERT INTO cc_pep_test_signatures
                    (contract_id, user_id, party_role)
                    VALUES (200, 3, 'executor')
                `);

                await assert.rejects(
                    () => main.query(`
                        INSERT INTO cc_pep_test_signatures
                        (contract_id, user_id, party_role)
                        VALUES (200, 3, 'executor')
                    `),
                    (error) =>
                        error.code === "ER_DUP_ENTRY"
                );

                const [rows] = await main.query(`
                    SELECT COUNT(*) AS total
                    FROM cc_pep_test_signatures
                    WHERE contract_id = 200
                `);

                assert.equal(Number(rows[0].total), 1);
            }
        );

        await t.test(
            "Отозванная сессия не допускает подписание",
            async () => {
                await main.query(`
                    INSERT INTO cc_pep_test_sessions
                    (id, user_id)
                    VALUES (51, 4)
                `);

                try {
                    await admin.query("START TRANSACTION");

                    await admin.query(`
                        SELECT *
                        FROM cc_pep_test_sessions
                        WHERE id = 51
                        FOR UPDATE
                    `);

                    await admin.query(`
                        UPDATE cc_pep_test_sessions
                        SET revoked_at = NOW(3)
                        WHERE id = 51
                    `);

                    await signer.query("START TRANSACTION");

                    await assert.rejects(
                        () => signer.query(`
                            SELECT *
                            FROM cc_pep_test_sessions
                            WHERE id = 51
                            FOR UPDATE
                        `),
                        (error) =>
                            error.code === "ER_LOCK_WAIT_TIMEOUT"
                    );

                    await signer.query("ROLLBACK");
                    await admin.query("COMMIT");

                    const [sessions] = await signer.query(`
                        SELECT revoked_at
                        FROM cc_pep_test_sessions
                        WHERE id = 51
                    `);

                    assert.ok(sessions[0].revoked_at);
                } finally {
                    await rollback(signer);
                    await rollback(admin);
                }
            }
        );
    } finally {
        await rollback(signer);
        await rollback(admin);

        // Удаляем исключительно собственные тестовые таблицы.
        if (verified && main) {
            for (const table of [
                "cc_pep_test_signatures",
                "cc_pep_test_sessions",
                "cc_pep_test_enrollments",
            ]) {
                await main.query(
                    `DROP TABLE IF EXISTS ${table}`
                );
            }
        }

        for (const connection of [signer, admin, main]) {
            if (connection) {
                await connection.end();
            }
        }
    }
});