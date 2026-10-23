const { Sequelize } = require("sequelize");

const requiredEnv = [
    "DB_NAME",
    "DB_USER",
    "DB_PASSWORD",
    "DB_HOST",
    "DB_PORT",
    "DB_DIALECT",
];

const missing = requiredEnv.filter(
    (name) => !process.env[name]
);

if (missing.length) {
    throw new Error(
        `Отсутствуют переменные БД: ${missing.join(", ")}`
    );
}

if (process.env.DB_DIALECT !== "mysql") {
    throw new Error(
        "CargoCamp backend ожидает DB_DIALECT=mysql"
    );
}

const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
        host: process.env.DB_HOST,
        port: process.env.DB_PORT,
        dialect: process.env.DB_DIALECT,
        logging: false,
    }
);

module.exports = sequelize;