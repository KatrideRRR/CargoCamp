const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const mysql = require("mysql2/promise");

const {
    Sequelize,
    DataTypes,
} = require("sequelize");

const {
    loadIsolatedService,
} = require("../helpers/loadIsolatedService");

// Только отдельная тестовая MySQL.
// Переменные DB_* и .env НЕ читаются.
const TEST_DB = Object.freeze({
    host: "127.0.0.1",
    port: 13316,

    user: "cc_chat_test",
    password: "cc_chat_test_local_only",
    database: "cc_chat_test_only",

    connectTimeout: 5000,
    multipleStatements: false,
});

const EXPECTED_HOST = "cc-chat-mysql-test";

const MIGRATION = path.resolve(
    __dirname,
    "../../migrations/019_auth_sms_code_states.sql"
);

const PHONE_1 = "79990000001";
const PHONE_2 = "79990000002";
const PHONE_3 = "79990000003";
const PHONE_4 = "79990000004";
const PHONE_5 = "79990000005";

async function verifyDatabase(connection) {
    const [rows] = await connection.query(`
        SELECT
            @@hostname AS hostName,
            DATABASE() AS dbName,
            CURRENT_USER() AS loginName
    `);

    const identity = rows[0];

    if (
        identity?.hostName !== EXPECTED_HOST ||
        identity?.dbName !== TEST_DB.database ||
        !String(identity?.loginName || "")
            .startsWith(`${TEST_DB.user}@`)
    ) {
        throw new Error(
            "ОПАСНО: подключение не соответствует " +
            "изолированной тестовой MySQL"
        );
    }

    return identity;
}

function createWorker() {
    // Отдельный пул соединений.
    // Никаких импортов backend/models/index.js.
    const sequelize = new Sequelize(
        TEST_DB.database,
        TEST_DB.user,
        TEST_DB.password,
        {
            dialect: "mysql",
            host: TEST_DB.host,
            port: TEST_DB.port,
            logging: false,

            timezone: "+00:00",

            pool: {
                max: 5,
                min: 0,
                acquire: 10000,
                idle: 1000,
            },

            dialectOptions: {
                connectTimeout: 5000,
            },
        }
    );

    const SmsCodeState = require(
        "../../models/SmsCodeState"
    )(sequelize, DataTypes);

    const store = loadIsolatedService(
        "smsCodeStore.js",
        {
            "node:crypto": crypto,

            "../models": {
                sequelize,
                SmsCodeState,
            },
        }
    );

    return {
        sequelize,
        store,
    };
}

test(
    "CargoCamp: SMS в изолированной MySQL",
    async (t) => {
        const connection =
            await mysql.createConnection(TEST_DB);

        const workers = [];

        const oldSecret =
            process.env.SMS_CODE_SECRET;

        let databaseVerified = false;

        try {
            // Никаких DDL до проверки базы!
            await verifyDatabase(connection);
            databaseVerified = true;

            await connection.query(
                "DROP TABLE IF EXISTS auth_sms_code_states"
            );

            await connection.query(
                fs.readFileSync(
                    MIGRATION,
                    "utf8"
                )
            );

            // Искусственный тестовый секрет.
            process.env.SMS_CODE_SECRET =
                "a".repeat(64);

            const workerA = createWorker();
            const workerB = createWorker();

            workers.push(workerA, workerB);

            await workerA.sequelize.authenticate();
            await workerB.sequelize.authenticate();

            const a = workerA.store;
            const b = workerB.store;

            await t.test(
                "миграция 019 создаёт таблицу",
                async () => {
                    const [rows] =
                        await connection.query(
                            "SHOW COLUMNS FROM auth_sms_code_states"
                        );

                    const columns =
                        rows.map((row) => row.Field);

                    for (const required of [
                        "phone",
                        "purpose",
                        "code_hash",
                        "status",
                        "attempts",
                        "send_count",
                        "expires_at",
                    ]) {
                        assert.ok(
                            columns.includes(required),
                            `Нет колонки: ${required}`
                        );
                    }
                }
            );

            await t.test(
                "два сервера не резервируют две SMS",
                async () => {
                    const results =
                        await Promise.allSettled([
                            a.reserveSmsCode({
                                phone: PHONE_1,
                                purpose: "login",
                            }),

                            b.reserveSmsCode({
                                phone: PHONE_1,
                                purpose: "login",
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
                                result.status === "rejected"
                        ).length,
                        1
                    );

                    const [rows] =
                        await connection.execute(
                            `
                            SELECT send_count
                            FROM auth_sms_code_states
                            WHERE phone = ?
                            `,
                            [PHONE_1]
                        );

                    assert.equal(
                        rows[0].send_count,
                        1
                    );
                }
            );

            await t.test(
                "код хранится как HMAC",
                async () => {
                    const [rows] =
                        await connection.execute(
                            `
                            SELECT code_hash, status
                            FROM auth_sms_code_states
                            WHERE phone = ?
                            `,
                            [PHONE_1]
                        );

                    assert.match(
                        rows[0].code_hash,
                        /^[a-f0-9]{64}$/
                    );

                    assert.equal(
                        rows[0].status,
                        "pending"
                    );
                }
            );

            await t.test(
                "два сервера не используют код дважды",
                async () => {
                    const reservation =
                        await a.reserveSmsCode({
                            phone: PHONE_2,
                            purpose: "login",
                        });

                    const activated =
                        await a.completeSmsSend({
                            phone: PHONE_2,
                            reservationId:
                            reservation.reservationId,
                            success: true,
                        });

                    assert.equal(activated, true);

                    const results = await Promise.all([
                        a.consumeSmsCode({
                            phone: PHONE_2,
                            purpose: "login",
                            code: reservation.code,
                        }),

                        b.consumeSmsCode({
                            phone: PHONE_2,
                            purpose: "login",
                            code: reservation.code,
                        }),
                    ]);

                    assert.equal(
                        results.filter(
                            (result) => result.ok
                        ).length,
                        1
                    );

                    assert.equal(
                        results.filter(
                            (result) => !result.ok
                        ).length,
                        1
                    );
                }
            );

            await t.test(
                "cooldown сохраняется после использования",
                async () => {
                    await assert.rejects(
                        () =>
                            b.reserveSmsCode({
                                phone: PHONE_2,
                                purpose: "login",
                            }),
                        (error) => {
                            assert.equal(
                                error.status,
                                429
                            );

                            return true;
                        }
                    );
                }
            );

            await t.test(
                "пять неправильных попыток блокируют код",
                async () => {
                    const reservation =
                        await a.reserveSmsCode({
                            phone: PHONE_3,
                            purpose: "login",
                        });

                    await a.completeSmsSend({
                        phone: PHONE_3,
                        reservationId:
                        reservation.reservationId,
                        success: true,
                    });

                    for (let i = 0; i < 5; i++) {
                        const result =
                            await b.consumeSmsCode({
                                phone: PHONE_3,
                                purpose: "login",
                                code: "000000",
                            });

                        assert.equal(
                            result.ok,
                            false
                        );
                    }

                    const actual =
                        await a.consumeSmsCode({
                            phone: PHONE_3,
                            purpose: "login",
                            code: reservation.code,
                        });

                    assert.equal(
                        actual.ok,
                        false
                    );

                    const [rows] =
                        await connection.execute(
                            `
                            SELECT status, attempts
                            FROM auth_sms_code_states
                            WHERE phone = ?
                            `,
                            [PHONE_3]
                        );

                    assert.equal(
                        rows[0].status,
                        "idle"
                    );

                    assert.equal(
                        rows[0].attempts,
                        5
                    );
                }
            );

            await t.test(
                "SMS-код нельзя использовать для другой цели",
                async () => {
                    const reservation =
                        await a.reserveSmsCode({
                            phone: PHONE_4,
                            purpose: "login",
                        });

                    await a.completeSmsSend({
                        phone: PHONE_4,
                        reservationId:
                        reservation.reservationId,
                        success: true,
                    });

                    const wrong =
                        await b.consumeSmsCode({
                            phone: PHONE_4,
                            purpose: "password_reset",
                            code: reservation.code,
                        });

                    assert.equal(
                        wrong.ok,
                        false
                    );

                    const correct =
                        await b.consumeSmsCode({
                            phone: PHONE_4,
                            purpose: "login",
                            code: reservation.code,
                        });

                    assert.equal(
                        correct.ok,
                        true
                    );
                }
            );

            await t.test(
                "неудачная отправка не снимает ограничения",
                async () => {
                    const reservation =
                        await a.reserveSmsCode({
                            phone: PHONE_5,
                            purpose: "login",
                        });

                    await a.completeSmsSend({
                        phone: PHONE_5,
                        reservationId:
                        reservation.reservationId,
                        success: false,
                    });

                    const result =
                        await b.consumeSmsCode({
                            phone: PHONE_5,
                            purpose: "login",
                            code: reservation.code,
                        });

                    assert.equal(
                        result.ok,
                        false
                    );

                    await assert.rejects(
                        () =>
                            b.reserveSmsCode({
                                phone: PHONE_5,
                                purpose: "login",
                            }),
                        (error) => {
                            assert.equal(
                                error.status,
                                429
                            );

                            return true;
                        }
                    );
                }
            );
        } finally {
            // Закрываем все пулы до удаления таблицы.
            await Promise.allSettled(
                workers.map((worker) =>
                    worker.sequelize.close()
                )
            );

            if (databaseVerified) {
                await connection.query(
                    "DROP TABLE IF EXISTS auth_sms_code_states"
                );
            }

            await connection.end();

            if (oldSecret === undefined) {
                delete process.env.SMS_CODE_SECRET;
            } else {
                process.env.SMS_CODE_SECRET =
                    oldSecret;
            }
        }
    }
);