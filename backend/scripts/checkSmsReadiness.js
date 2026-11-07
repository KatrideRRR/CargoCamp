const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const dotenv = require("dotenv");
const mysql = require("mysql2/promise");

const root = path.resolve(__dirname, "..");

const envFile = fs.existsSync(
    path.join(root, ".env.local")
)
    ? ".env.local"
    : ".env";

dotenv.config({
    path: path.join(root, envFile),
});

const requiredVariables = [
    "DB_HOST",
    "DB_PORT",
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
    "SMS_RU_API_ID",
    "SMS_CODE_SECRET",
];

const requiredColumns = [
    "phone",
    "purpose",
    "code_hash",
    "status",
    "attempts",
    "reservation_id",
    "pending_until",
    "expires_at",
    "last_sent_at",
    "window_started_at",
    "send_count",
];

async function main() {
    console.log(
        `Проверяем конфигурацию: ${envFile}`
    );

    const missing = requiredVariables.filter(
        (name) => !process.env[name]
    );

    if (missing.length) {
        throw new Error(
            `Не настроены переменные: ${missing.join(", ")}`
        );
    }

    if (
        !/^[a-f0-9]{64}$/i.test(
            process.env.SMS_CODE_SECRET
        )
    ) {
        throw new Error(
            "SMS_CODE_SECRET должен содержать 64 hex-символа"
        );
    }

    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT),
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        connectTimeout: 5000,
        multipleStatements: false,
    });

    try {
        const [database] = await connection.query(
            "SELECT DATABASE() AS name"
        );

        console.log(
            `База данных: ${database[0].name}`
        );

        const [columns] = await connection.execute(
            `
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
            `,
            ["auth_sms_code_states"]
        );

        const existing = new Set(
            columns.map((row) => row.COLUMN_NAME)
        );

        const missingColumns = requiredColumns.filter(
            (column) => !existing.has(column)
        );

        const migrationDirectory = path.join(
            root,
            "migrations"
        );

        const migrationFiles = fs
            .readdirSync(migrationDirectory)
            .filter((file) =>
                /^\d+_[a-zA-Z0-9_-]+\.sql$/.test(file)
            )
            .sort((a, b) =>
                a.localeCompare(b, undefined, {
                    numeric: true,
                })
            );

        const [migrationTables] =
            await connection.execute(
                `
                SELECT TABLE_NAME
                FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = ?
                `,
                ["schema_migrations"]
            );

        const applied = new Map();

        if (migrationTables.length) {
            const [rows] = await connection.query(
                `
                SELECT migration, checksum
                FROM schema_migrations
                `
            );

            for (const row of rows) {
                applied.set(
                    row.migration,
                    row.checksum
                );
            }
        }

        const pending = [];
        const checksumErrors = [];

        for (const file of migrationFiles) {
            const sql = fs.readFileSync(
                path.join(migrationDirectory, file),
                "utf8"
            );

            const checksum = crypto
                .createHash("sha256")
                .update(sql)
                .digest("hex");

            if (!applied.has(file)) {
                pending.push(file);
            } else if (
                applied.get(file) !== checksum
            ) {
                checksumErrors.push(file);
            }
        }

        console.log(
            `Таблица SMS: ${
                missingColumns.length
                    ? "НЕ ГОТОВА"
                    : "OK"
            }`
        );

        console.log(
            `SMS_CODE_SECRET: OK`
        );

        console.log(
            `SMS_RU_API_ID: настроен`
        );

        console.log(
            `Неприменённых миграций: ${pending.length}`
        );

        if (missingColumns.length) {
            console.log(
                "Отсутствуют колонки:",
                missingColumns.join(", ")
            );
        }

        if (pending.length) {
            console.log(
                "Ожидают применения:",
                pending.join(", ")
            );
        }

        if (checksumErrors.length) {
            console.log(
                "Несовпадение контрольных сумм:",
                checksumErrors.join(", ")
            );
        }

        if (
            missingColumns.length ||
            pending.length ||
            checksumErrors.length
        ) {
            process.exitCode = 1;

            console.log(
                "SMS-хранилище требует подготовки."
            );
        } else {
            console.log(
                "SMS-хранилище готово по результатам проверки схемы."
            );
        }
    } finally {
        await connection.end();
    }
}

main().catch((error) => {
    console.error(
        "Проверка не пройдена:",
        error.message
    );

    process.exitCode = 1;
});