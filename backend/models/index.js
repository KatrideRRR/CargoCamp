require("dotenv").config(); // Загружаем переменные окружения

const { DataTypes } = require("sequelize");
const sequelize = require("../config/database");

if (
    !process.env.DB_NAME ||
    !process.env.DB_USER ||
    !process.env.DB_PASSWORD ||
    !process.env.DB_HOST ||
    !process.env.DB_PORT
) {
    console.error("❌ Ошибка: Отсутствуют переменные окружения для БД!");
    process.exit(1);
}

const db = {};
db.Sequelize = sequelize.constructor;
db.sequelize = sequelize;

// ✅ Основные модели
db.User = require("./User")(sequelize, DataTypes);
db.Order = require("./Order")(sequelize, DataTypes);
db.Message = require("./Message")(sequelize, DataTypes);
db.Category = require("./Category")(sequelize, DataTypes);
db.Subcategory = require("./Subcategory")(sequelize, DataTypes);
db.Service = require("./Service")(sequelize, DataTypes);
db.Notification = require("./Notification")(sequelize, DataTypes);
db.OrderReview = require("./OrderReview")(sequelize, DataTypes);
db.ActionLog = require("./ActionLog")(sequelize, DataTypes);
db.Dispute = require("./Dispute")(sequelize, DataTypes);
db.PushToken = require("./PushToken")(sequelize, DataTypes);
// ✅ Express (такси/курьер)
db.ExpressOrder = require("./ExpressOrder")(sequelize, DataTypes);
db.ExpressSavedAddress = require("./ExpressSavedAddress")(sequelize, DataTypes);

// ✅ Ассоциации
Object.values(db).forEach((model) => {
    if (model && typeof model.associate === "function") {
        model.associate(db);
    }
});

// Проверяем подключение к БД
sequelize
    .authenticate()
    .then(() => console.log("✅ База данных подключена!"))
    .catch((err) => {
        console.error("❌ Ошибка подключения к БД:", err);
        process.exit(1);
    });

module.exports = db;