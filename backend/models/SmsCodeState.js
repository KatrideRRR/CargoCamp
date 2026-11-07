module.exports = (sequelize, DataTypes) => {
    return sequelize.define(
        "SmsCodeState",
        {
            phone: {
                type: DataTypes.STRING(20),
                primaryKey: true,
            },

            purpose: {
                type: DataTypes.STRING(20),
                allowNull: true,
            },

            codeHash: {
                type: DataTypes.STRING(64),
                allowNull: true,
                field: "code_hash",
            },

            status: {
                type: DataTypes.ENUM(
                    "idle",
                    "pending",
                    "active"
                ),
                allowNull: false,
                defaultValue: "idle",
            },

            attempts: {
                type: DataTypes.TINYINT.UNSIGNED,
                allowNull: false,
                defaultValue: 0,
            },

            reservationId: {
                type: DataTypes.STRING(36),
                allowNull: true,
                field: "reservation_id",
            },

            pendingUntil: {
                type: DataTypes.DATE(3),
                allowNull: true,
                field: "pending_until",
            },

            expiresAt: {
                type: DataTypes.DATE(3),
                allowNull: true,
                field: "expires_at",
            },

            lastSentAt: {
                type: DataTypes.DATE(3),
                allowNull: true,
                field: "last_sent_at",
            },

            windowStartedAt: {
                type: DataTypes.DATE(3),
                allowNull: true,
                field: "window_started_at",
            },

            sendCount: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: false,
                defaultValue: 0,
                field: "send_count",
            },
        },
        {
            tableName: "auth_sms_code_states",
            timestamps: true,
            underscored: true,
        }
    );
};