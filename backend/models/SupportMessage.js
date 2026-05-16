module.exports = (sequelize, DataTypes) => {
    const SupportMessage = sequelize.define(
        "SupportMessage",
        {
            userId: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },

            senderId: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },

            senderRole: {
                type: DataTypes.ENUM("user", "admin", "system"),
                allowNull: false,
                defaultValue: "user",
            },

            text: {
                type: DataTypes.TEXT,
                allowNull: true,
            },

            attachments: {
                type: DataTypes.JSON,
                allowNull: true,
            },

            isReadByUser: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },

            isReadByAdmin: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
        },
        {
            tableName: "SupportMessages",
        }
    );

    SupportMessage.associate = (models) => {
        SupportMessage.belongsTo(models.User, {
            foreignKey: "userId",
            as: "user",
        });

        SupportMessage.belongsTo(models.User, {
            foreignKey: "senderId",
            as: "sender",
        });
    };

    return SupportMessage;
};