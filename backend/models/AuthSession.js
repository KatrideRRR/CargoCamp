module.exports = (sequelize, DataTypes) => {
    return sequelize.define(
        "AuthSession",
        {
            id: {
                type: DataTypes.BIGINT.UNSIGNED,
                primaryKey: true,
                autoIncrement: true,
            },

            userId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                field: "user_id",
            },

            scope: {
                type: DataTypes.STRING(20),
                allowNull: false,
            },

            tokenHash: {
                type: DataTypes.STRING(64),
                allowNull: false,
                unique: true,
                field: "token_hash",
            },

            expiresAt: {
                type: DataTypes.DATE,
                allowNull: false,
                field: "expires_at",
            },

            absoluteExpiresAt: {
                type: DataTypes.DATE,
                allowNull: false,
                field: "absolute_expires_at",
            },

            revokedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "revoked_at",
            },

            lastUsedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "last_used_at",
            },
        },
        {
            tableName: "auth_sessions",
            timestamps: true,
            underscored: true,
        }
    );
};