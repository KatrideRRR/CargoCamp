const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dotenv = require("dotenv");
const mysql = require("mysql2/promise");

const backendRoot = path.resolve(__dirname, "..");

const envFile = fs.existsSync(
    path.join(backendRoot, ".env.local")
)
    ? ".env.local"
    : ".env";

dotenv.config({
    path: path.join(backendRoot, envFile),
});

const migrationsDir = path.join(
    backendRoot,
    "migrations"
);

const isStatusMode =
    process.argv.includes("--status");

function requireEnv(name) {
    const value = process.env[name];

    if (
        value === undefined ||
        value === null ||
        String(value).trim() === ""
    ) {
        throw new Error(
            `Отсутствует обязательная переменная окружения ${name}`
        );
    }

    return value;
}

function sha256(value) {
    return crypto
        .createHash("sha256")
        .update(value)
        .digest("hex");
}

function getMigrationFiles() {
    if (!fs.existsSync(migrationsDir)) {
        return [];
    }

    return fs
        .readdirSync(migrationsDir)
        .filter((file) =>
            /^\d+_[a-zA-Z0-9_-]+\.sql$/.test(file)
        )
        .sort((a, b) =>
            a.localeCompare(
                b,
                undefined,
                {
                    numeric: true,
                }
            )
        );
}

async function main() {
    const connection = await mysql.createConnection({
        host: requireEnv("DB_HOST"),
        port: Number(
            requireEnv("DB_PORT")
        ),
        user: requireEnv("DB_USER"),
        password: requireEnv("DB_PASSWORD"),
        database: requireEnv("DB_NAME"),

        multipleStatements: true,

        charset: "utf8mb4",
    });

    let lockAcquired = false;

    try {
        console.log(
            `✅ Загружен файл окружения: ${envFile}`
        );

        console.log(
            `✅ Подключение к MySQL: ${process.env.DB_NAME}`
        );

        await connection.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations
            (
                id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                migration  VARCHAR(255)    NOT NULL,
                checksum   CHAR(64)        NOT NULL,
                applied_at DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

                PRIMARY KEY (id),

                UNIQUE KEY uq_schema_migrations_migration
                    (migration)
            )
            ENGINE = InnoDB
            DEFAULT CHARSET = utf8mb4
            COLLATE = utf8mb4_unicode_ci;
        `);

        const [lockRows] =
            await connection.query(
                `
                    SELECT GET_LOCK(
                        'cargocamp_schema_migrations',
                        30
                    ) AS acquired
                `
            );

        if (
            Number(
                lockRows?.[0]?.acquired
            ) !== 1
        ) {
            throw new Error(
                "Не удалось получить блокировку миграций"
            );
        }

        lockAcquired = true;

        const [appliedRows] =
            await connection.query(`
                SELECT
                    migration,
                    checksum,
                    applied_at
                FROM schema_migrations
                ORDER BY id ASC
            `);

        const applied =
            new Map(
                appliedRows.map((row) => [
                    row.migration,
                    row,
                ])
            );

        const files =
            getMigrationFiles();

        if (files.length === 0) {
            console.log(
                "ℹ️ SQL-миграции не найдены"
            );

            return;
        }

        let appliedCount = 0;

        for (const file of files) {
            const fullPath =
                path.join(
                    migrationsDir,
                    file
                );

            const sql =
                fs.readFileSync(
                    fullPath,
                    "utf8"
                );

            const checksum =
                sha256(sql);

            const existing =
                applied.get(file);

            if (existing) {
                if (
                    existing.checksum !==
                    checksum
                ) {
                    throw new Error(
                        [
                            `Миграция ${file} уже применена,`,
                            "но её содержимое было изменено.",
                            "Применённые миграции изменять нельзя.",
                        ].join(" ")
                    );
                }

                if (isStatusMode) {
                    console.log(
                        `✅ ${file} — applied`
                    );
                }

                continue;
            }

            if (isStatusMode) {
                console.log(
                    `⏳ ${file} — pending`
                );

                continue;
            }

            console.log(
                `▶️ Применяем ${file}...`
            );

            /*
             * MySQL DDL может делать implicit COMMIT,
             * поэтому не создаём ложное ощущение
             * полностью атомарной транзакции.
             *
             * Миграция записывается в schema_migrations
             * только после успешного выполнения SQL.
             */
            await connection.query(sql);

            await connection.query(
                `
                    INSERT INTO schema_migrations
                    (
                        migration,
                        checksum
                    )
                    VALUES (?, ?)
                `,
                [
                    file,
                    checksum,
                ]
            );

            appliedCount += 1;

            console.log(
                `✅ ${file} применена`
            );
        }

        if (isStatusMode) {
            return;
        }

        if (appliedCount === 0) {
            console.log(
                "✅ Новых миграций нет"
            );
        } else {
            console.log(
                `✅ Применено миграций: ${appliedCount}`
            );
        }
    } finally {
        if (lockAcquired) {
            try {
                await connection.query(`
                    SELECT RELEASE_LOCK(
                        'cargocamp_schema_migrations'
                    )
                `);
            } catch (error) {
                console.error(
                    "⚠️ Не удалось освободить migration lock:",
                    error.message
                );
            }
        }

        await connection.end();
    }
}

main().catch((error) => {
    console.error(
        "❌ Ошибка миграции:"
    );

    console.error(
        error
    );

    process.exitCode = 1;
});