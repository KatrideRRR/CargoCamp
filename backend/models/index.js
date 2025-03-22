const { Sequelize, DataTypes } = require('sequelize');
const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
    host: process.env.DB_HOST,
    dialect: process.env.DB_DIALECT,
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

module.exports = db;
