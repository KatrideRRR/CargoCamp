const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const mysql = require("mysql2/promise");

/*
 * ВНИМАНИЕ!
 *
 * Здесь намеренно НЕ используются:
 * process.env,
 * .env,
 * .env.local,
 * backend/models,
 * backend/config/database.
 *
 * Подключение разрешено только к отдельной
 * тестовой MySQL на 127.0.0.1:13316.
 */

const TEST_DB = Object.freeze({
    host: "127.0.0.1",
    port: 13316,

    user: "cc_chat_test",
    password: "cc_chat_test_local_only",

    database: "cc_chat_test_only",

    connectTimeout: 5000,
    multipleStatements: false,
});

const EXPECTED_HOSTNAME = "cc-chat-mysql-test";

const migrationsPath = path.resolve(
    __dirname,
    "../../migrations"
);

function readMigration(filename) {
    return fs.readFileSync(
        path.join(migrationsPath, filename),
        "utf8"
    );
}

function newUUID() {
    return crypto.randomUUID();
}

/*
 * Защита от случайного подключения
 * к другой базе данных.
 *
 * Выполняется ДО CREATE/DROP/ALTER.
 */
async function verifyTestDatabase(db) {
    const [rows] = await db.query(`
        SELECT
            @@hostname AS hostName,
            DATABASE() AS dbName,
            CURRENT_USER() AS loginName
    `);

    const identity = rows[0];

    const isCorrectHost =
        identity?.hostName === EXPECTED_HOSTNAME;

    const isCorrectDatabase =
        identity?.dbName === TEST_DB.database;

    const isCorrectUser =
        String(identity?.loginName || "")
            .startsWith(`${TEST_DB.user}@`);

    if (
        !isCorrectHost ||
        !isCorrectDatabase ||
        !isCorrectUser
    ) {
        throw new Error(
            [
                "ОПАСНО: подключение не соответствует",
                "изолированной тестовой базе.",
                "Изменения таблиц заблокированы.",
            ].join(" ")
        );
    }

    return identity;
}

/*
 * Создаём минимальную исходную схему.
 *
 * Именно к ней применяются настоящие
 * SQL-миграции из репозитория.
 *
 * Это не полная production-схема.
 */
async function createBaseTables(db) {
    // Повторный запуск начинается с чистых таблиц.
    // Удаление допустимо только после проверки
    // hostname, имени базы и MySQL-пользователя.

    await db.query(`
        DROP TABLE IF EXISTS messages
    `);

    await db.query(`
        DROP TABLE IF EXISTS SupportMessages
    `);

    await db.query(`
        CREATE TABLE messages (
            id BIGINT UNSIGNED NOT NULL
                AUTO_INCREMENT PRIMARY KEY,

            content TEXT NOT NULL,

            senderId INT NOT NULL,
            receiverId INT NOT NULL,

            orderId INT NOT NULL,

            orderType ENUM(
                'regular',
                'express'
            ) NOT NULL DEFAULT 'regular'
        )
        ENGINE=InnoDB
        DEFAULT CHARSET=utf8mb4
    `);

    await db.query(`
        CREATE TABLE SupportMessages (
            id BIGINT UNSIGNED NOT NULL
                AUTO_INCREMENT PRIMARY KEY,

            userId INT NOT NULL,
            senderId INT NOT NULL,

            senderRole ENUM(
                'user',
                'admin',
                'system'
            ) NOT NULL,

            text TEXT,

            isReadByUser BOOLEAN NOT NULL
                DEFAULT FALSE,

            isReadByAdmin BOOLEAN NOT NULL
                DEFAULT FALSE
        )
        ENGINE=InnoDB
        DEFAULT CHARSET=utf8mb4
    `);
}

async function insertChatMessage(
    db,
    senderId,
    clientMessageId
) {
    return db.execute(
        `
        INSERT INTO messages (
            content,
            senderId,
            receiverId,
            orderId,
            orderType,
            clientMessageId
        )
        VALUES (?, ?, ?, ?, ?, ?)
        `,
        [
            "Тестовое сообщение",
            senderId,
            200,
            101,
            "regular",
            clientMessageId,
        ]
    );
}

async function insertSupportMessage(
    db,
    {
        userId = 101,
        senderId = 101,
        senderRole = "user",
        clientMessageId = null,
    } = {}
) {
    return db.execute(
        `
        INSERT INTO SupportMessages (
            userId,
            senderId,
            senderRole,
            text,
            clientMessageId
        )
        VALUES (?, ?, ?, ?, ?)
        `,
        [
            userId,
            senderId,
            senderRole,
            "Тестовое обращение",
            clientMessageId,
        ]
    );
}

function expectDuplicateKey(error) {
    return error?.code === "ER_DUP_ENTRY";
}

/*
 * Один главный тест с подчинёнными проверками.
 *
 * Все операции выполняются последовательно
 * на одном проверенном соединении.
 */
test("CargoCamp: ограничения сообщений в изолированной MySQL", async (t) => {
    const db = await mysql.createConnection(
        TEST_DB
    );

    try {
        // Никаких изменений до этой проверки.
        const identity =
            await verifyTestDatabase(db);

        await t.test(
            "подключение ведёт только к тестовой MySQL",
            () => {
                assert.equal(
                    identity.hostName,
                    EXPECTED_HOSTNAME
                );

                assert.equal(
                    identity.dbName,
                    TEST_DB.database
                );
            }
        );

        await createBaseTables(db);

        /*
         * Применяем именно SQL из репозитория.
         * Тексты миграций не переписываем.
         */
        await db.query(
            readMigration(
                "015_chat_message_idempotency.sql"
            )
        );

        await db.query(
            readMigration(
                "018_support_message_idempotency.sql"
            )
        );

        await t.test(
            "настоящие миграции 015 и 018 применяются успешно",
            async () => {
                const [chatIndexes] =
                    await db.query(`
                        SHOW INDEX FROM messages
                        WHERE Key_name =
                        'uq_messages_sender_client_message'
                    `);

                const [supportIndexes] =
                    await db.query(`
                        SHOW INDEX FROM SupportMessages
                        WHERE Key_name =
                        'uq_support_sender_client_message'
                    `);

                assert.equal(
                    chatIndexes.length,
                    2
                );

                assert.equal(
                    supportIndexes.length,
                    2
                );

                assert.deepEqual(
                    chatIndexes
                        .sort(
                            (a, b) =>
                                a.Seq_in_index -
                                b.Seq_in_index
                        )
                        .map((row) => row.Column_name),
                    [
                        "senderId",
                        "clientMessageId",
                    ]
                );

                assert.deepEqual(
                    supportIndexes
                        .sort(
                            (a, b) =>
                                a.Seq_in_index -
                                b.Seq_in_index
                        )
                        .map((row) => row.Column_name),
                    [
                        "senderId",
                        "clientMessageId",
                    ]
                );

                assert.ok(
                    chatIndexes.every(
                        (index) =>
                            Number(index.Non_unique) === 0
                    )
                );

                assert.ok(
                    supportIndexes.every(
                        (index) =>
                            Number(index.Non_unique) === 0
                    )
                );
            }
        );

        /*
         * Обычные сообщения.
         */
        await t.test(
            "один отправитель не может повторить UUID",
            async () => {
                const uuid = newUUID();

                await insertChatMessage(
                    db,
                    101,
                    uuid
                );

                await assert.rejects(
                    () => insertChatMessage(
                        db,
                        101,
                        uuid
                    ),
                    expectDuplicateKey
                );
            }
        );

        await t.test(
            "разные отправители могут использовать одинаковый UUID",
            async () => {
                const uuid = newUUID();

                await insertChatMessage(
                    db,
                    101,
                    uuid
                );

                await insertChatMessage(
                    db,
                    202,
                    uuid
                );

                const [rows] = await db.execute(
                    `
                    SELECT COUNT(*) AS count
                    FROM messages
                    WHERE clientMessageId = ?
                    `,
                    [uuid]
                );

                assert.equal(
                    Number(rows[0].count),
                    2
                );
            }
        );

        await t.test(
            "старые сообщения без UUID разрешены",
            async () => {
                await insertChatMessage(
                    db,
                    303,
                    null
                );

                await insertChatMessage(
                    db,
                    303,
                    null
                );

                const [rows] = await db.query(`
                    SELECT COUNT(*) AS count
                    FROM messages
                    WHERE senderId = 303
                      AND clientMessageId IS NULL
                `);

                assert.equal(
                    Number(rows[0].count),
                    2
                );
            }
        );

        /*
         * Сообщения поддержки.
         */
        await t.test(
            "поддержка запрещает повтор UUID одного отправителя",
            async () => {
                const uuid = newUUID();

                await insertSupportMessage(
                    db,
                    {
                        userId: 101,
                        senderId: 101,
                        clientMessageId: uuid,
                    }
                );

                await assert.rejects(
                    () => insertSupportMessage(
                        db,
                        {
                            userId: 101,
                            senderId: 101,
                            clientMessageId: uuid,
                        }
                    ),
                    expectDuplicateKey
                );
            }
        );

        await t.test(
            "администратор не переиспользует UUID в другом диалоге",
            async () => {
                const uuid = newUUID();

                await insertSupportMessage(
                    db,
                    {
                        userId: 101,
                        senderId: 1,
                        senderRole: "admin",
                        clientMessageId: uuid,
                    }
                );

                await assert.rejects(
                    () => insertSupportMessage(
                        db,
                        {
                            userId: 202,
                            senderId: 1,
                            senderRole: "admin",
                            clientMessageId: uuid,
                        }
                    ),
                    expectDuplicateKey
                );
            }
        );

        await t.test(
            "поддержка принимает сообщения без UUID",
            async () => {
                await insertSupportMessage(
                    db,
                    {
                        userId: 101,
                        senderId: 404,
                    }
                );

                await insertSupportMessage(
                    db,
                    {
                        userId: 101,
                        senderId: 404,
                    }
                );

                const [rows] = await db.query(`
                    SELECT COUNT(*) AS count
                    FROM SupportMessages
                    WHERE senderId = 404
                      AND clientMessageId IS NULL
                `);

                assert.equal(
                    Number(rows[0].count),
                    2
                );
            }
        );

    } finally {
        await db.end();
    }
});