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
                type: DataTypes.TEXT,
                allowNull: false,
            },

            tokenHash: {
                type: DataTypes.STRING(64),
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
                type: DataTypes.STRING(100),
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
                {
                    name: "push_tokens_user_id",
                    fields: ["userId"],
                },
                {
                    name: "push_tokens_platform",
                    fields: ["platform"],
                },
                {
                    name: "push_tokens_token_hash",
                    unique: true,
                    fields: ["tokenHash"],
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