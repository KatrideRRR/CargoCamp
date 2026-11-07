const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const mysql = require("mysql2/promise");

const TEST_DB = Object.freeze({
    host: "127.0.0.1",
    port: 13316,
    user: "cc_chat_test",
    password: "cc_chat_test_local_only",
    database: "cc_chat_test_only",
    connectTimeout: 5000,
    multipleStatements: false,
});

const MIGRATIONS = path.resolve(
    __dirname,
    "../../migrations"
);

async function verifyTestDatabase(db) {
    const [rows] = await db.query(`
        SELECT
            @@hostname AS hostName,
            DATABASE() AS dbName,
            CURRENT_USER() AS loginName
    `);

    const identity = rows[0];

    if (
        identity.hostName !== "cc-chat-mysql-test" ||
        identity.dbName !== "cc_chat_test_only" ||
        !String(identity.loginName)
            .startsWith("cc_chat_test@")
    ) {
        throw new Error(
            "ОПАСНО: подключение не является тестовой MySQL"
        );
    }
}

test("Миграция пенсионных льгот в отдельной MySQL", async (t) => {
    const db = await mysql.createConnection(TEST_DB);
    let verified = false;

    try {
        await verifyTestDatabase(db);
        verified = true;

        // Только в проверенной тестовой базе.
        await db.query(
            "DROP TABLE IF EXISTS user_benefit_verifications"
        );

        await db.query(
            "DROP TABLE IF EXISTS users"
        );

        await db.query(`
            CREATE TABLE users (
                id INT PRIMARY KEY,
                userStatus VARCHAR(32) NOT NULL
            ) ENGINE=InnoDB
        `);

        await db.query(`
            CREATE TABLE user_benefit_verifications (
                id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                country_code CHAR(2) NOT NULL,
                benefit_code VARCHAR(64) NOT NULL,
                status VARCHAR(32) NOT NULL,
                provider VARCHAR(64) NOT NULL,
                verification_method VARCHAR(64) NOT NULL,
                submitted_at DATETIME(3),
                verified_at DATETIME(3),
                expires_at DATETIME(3),
                decision_reason VARCHAR(500),
                metadata JSON,
                created_at DATETIME(3),
                updated_at DATETIME(3)
            ) ENGINE=InnoDB
        `);

        await db.query(`
            INSERT INTO users (id, userStatus)
            VALUES
                (1, 'pensioner'),
                (2, 'pensioner'),
                (3, 'verified'),
                (4, 'unverified')
        `);

        // У второго пользователя новая система
        // уже отозвала льготу.
        await db.query(`
            INSERT INTO user_benefit_verifications (
                user_id,
                country_code,
                benefit_code,
                status,
                provider,
                verification_method
            )
            VALUES (
                2,
                'RU',
                'pension_recipient',
                'revoked',
                'manual',
                'document_review'
            )
        `);

        const migration020 = fs.readFileSync(
            path.join(
                MIGRATIONS,
                "020_legacy_pension_benefits.sql"
            ),
            "utf8"
        );

        await db.query(migration020);

        await t.test(
            "старый пенсионер получает запись переходной льготы",
            async () => {
                const [rows] = await db.query(`
                    SELECT *
                    FROM user_benefit_verifications
                    WHERE user_id = 1
                `);

                assert.equal(rows.length, 1);
                assert.equal(rows[0].status, "verified");
                assert.equal(
                    rows[0].benefit_code,
                    "pension_recipient"
                );
                assert.equal(
                    rows[0].provider,
                    "legacy_admin_status"
                );
                assert.ok(rows[0].expires_at);
            }
        );

        await t.test(
            "отозванная льгота не восстанавливается",
            async () => {
                const [rows] = await db.query(`
                    SELECT status
                    FROM user_benefit_verifications
                    WHERE user_id = 2
                `);

                assert.equal(rows.length, 1);
                assert.equal(rows[0].status, "revoked");
            }
        );

        await t.test(
            "обычная верификация не создаёт пенсионную льготу",
            async () => {
                const [rows] = await db.query(`
                    SELECT *
                    FROM user_benefit_verifications
                    WHERE user_id IN (3, 4)
                `);

                assert.equal(rows.length, 0);
            }
        );

        // Проверяем повторный запуск INSERT.
        await db.query(migration020);

        await t.test(
            "перенос не создаёт дубликатов",
            async () => {
                const [rows] = await db.query(`
                    SELECT COUNT(*) AS count
                    FROM user_benefit_verifications
                    WHERE user_id = 1
                `);

                assert.equal(Number(rows[0].count), 1);
            }
        );

        const migration021 = fs.readFileSync(
            path.join(
                MIGRATIONS,
                "021_remove_legacy_user_status.sql"
            ),
            "utf8"
        );

        await db.query(migration021);

        await t.test(
            "старое поле удаляется после переноса",
            async () => {
                const [rows] = await db.query(`
                    SHOW COLUMNS FROM users
                    LIKE 'userStatus'
                `);

                assert.equal(rows.length, 0);
            }
        );
    } finally {
        if (verified) {
            await db.query(
                "DROP TABLE IF EXISTS user_benefit_verifications"
            );

            await db.query(
                "DROP TABLE IF EXISTS users"
            );
        }

        await db.end();
    }
});