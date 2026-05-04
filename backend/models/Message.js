/// models/Message.js
module.exports = (sequelize, DataTypes) => {
    const Message = sequelize.define('Message', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        content: { type: DataTypes.TEXT, allowNull: false },
        senderId: { type: DataTypes.INTEGER, allowNull: false },
        receiverId: { type: DataTypes.INTEGER, allowNull: false },
        orderId: { type: DataTypes.INTEGER, allowNull: false },
        orderType: {
            type: DataTypes.ENUM("regular", "express"),
            allowNull: false,
            defaultValue: "regular",
        },
    }, {
        tableName: 'messages',  // ✅ Указываем имя существующей таблицы
        freezeTableName: true,  // ✅ Запрещаем Sequelize менять имя
        timestamps: true        // ✅ Убедись, что timestamps включены, если нужны
    });

    Message.associate = (models) => {
        Message.belongsTo(models.User, { as: 'sender', foreignKey: 'senderId' });
        Message.belongsTo(models.User, { as: 'receiver', foreignKey: 'receiverId' });
    };

    return Message;
};