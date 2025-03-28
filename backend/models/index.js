require('dotenv').config(); // Загружаем переменные окружения

const { Sequelize, DataTypes } = require('sequelize');

if (!process.env.DB_NAME || !process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_HOST) {
    console.error("❌ Ошибка: Отсутствуют переменные окружения для БД!");
    process.exit(1);
}

const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_HOST,
    dialect: process.env.DB_DIALECT || 'mysql', // Принудительно ставим MySQL, если переменная пуста
    logging: false,
});

const db = {};

db.Sequelize = Sequelize;
db.sequelize = sequelize;

db.User = require('./User')(sequelize, DataTypes);
db.Order = require('./Order')(sequelize, DataTypes);
db.Message = require('./Message')(sequelize, DataTypes);
db.Category = require('./Category')(sequelize, DataTypes);
db.Subcategory = require('./Subcategory')(sequelize, DataTypes);
db.Notification = require('./Notification')(sequelize, DataTypes);

// Ассоциации
Object.values(db).forEach(model => {
    if (model.associate) {
        model.associate(db);
    }
});

// Проверяем подключение к БД
sequelize.authenticate()
    .then(() => console.log("✅ База данных подключена!"))
    .catch(err => {
        console.error("❌ Ошибка подключения к БД:", err);
        process.exit(1);
    });

module.exports = db;
