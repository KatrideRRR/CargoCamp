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
                field: "token_hash",
            },

            platform: {
                type: DataTypes.ENUM("ios", "android", "web"),
                allowNull: false,
                defaultValue: "android",
            },

            deviceId: {
                type: DataTypes.STRING(255),
                allowNull: true,
                field: "device_id",
            },

            appVersion: {
                type: DataTypes.STRING(50),
                allowNull: true,
                field: "app_version",
            },

            isActive: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: true,
                field: "is_active",
            },

            lastSeenAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "last_seen_at",
            },
        },
        {
            tableName: "push_tokens",
            timestamps: true,
            underscored: true,
            indexes: [
                { fields: ["user_id"] },
                { fields: ["platform"] },
                {
                    unique: true,
                    fields: ["token_hash"],
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