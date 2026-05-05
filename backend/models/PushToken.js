// backend/models/PushToken.js

module.exports = (sequelize, DataTypes) => {
    const PushToken = sequelize.define(
        "PushToken",
        {
            userId: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },

            token: {
                type: DataTypes.STRING(1024),
                allowNull: false,
            },

            platform: {
                type: DataTypes.ENUM("ios", "android", "web"),
                allowNull: false,
                defaultValue: "android",
            },

            deviceId: {
                type: DataTypes.STRING(255),
                allowNull: true,
            },

            appVersion: {
                type: DataTypes.STRING(50),
                allowNull: true,
            },

            isActive: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: true,
            },

            lastSeenAt: {
                type: DataTypes.DATE,
                allowNull: true,
            },
        },
        {
            tableName: "push_tokens",
            timestamps: true,
            indexes: [
                { fields: ["userId"] },
                { fields: ["platform"] },
                {
                    unique: true,
                    fields: ["token"],
                },
            ],
        }
    );

    PushToken.associate = (models) => {
        PushToken.belongsTo(models.User, {
            foreignKey: "userId",
            as: "user",
        });
    };

    return PushToken;
};