module.exports = (sequelize, DataTypes) => {
    const Notification = sequelize.define(
        "Notification",
        {
            userId: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },

            type: {
                type: DataTypes.STRING,
                allowNull: false,
            },

            title: {
                type: DataTypes.STRING,
                allowNull: true,
            },

            body: {
                type: DataTypes.TEXT,
                allowNull: true,
            },

            data: {
                type: DataTypes.JSON,
                allowNull: true,
            },

            orderType: {
                type: DataTypes.ENUM("regular", "express"),
                allowNull: false,
                defaultValue: "regular",
            },

            messageId: {
                type: DataTypes.INTEGER,
                allowNull: true,
            },

            orderId: {
                type: DataTypes.INTEGER,
                allowNull: true,
            },

            isRead: {
                type: DataTypes.BOOLEAN,
                defaultValue: false,
            },
        },
        {
            tableName: "notifications",
            timestamps: true,
        }
    );

    Notification.associate = (models) => {
        Notification.belongsTo(models.User, {
            foreignKey: "userId",
            as: "user",
        });

        Notification.belongsTo(models.Message, {
            foreignKey: "messageId",
            as: "message",
        });
    };

    return Notification;
};