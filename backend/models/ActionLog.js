const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    class ActionLog extends Model {}

    ActionLog.init(
        {
            id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
            ts: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },

            actorUserId: { type: DataTypes.INTEGER, allowNull: true },
            actorRole: {
                type: DataTypes.ENUM("user", "admin", "system", "webhook"),
                allowNull: false,
                defaultValue: "user",
            },

            actionType: { type: DataTypes.STRING(80), allowNull: false },

            entityType: {
                type: DataTypes.ENUM("order", "express_order", "payment", "message", "user", "admin"),
                allowNull: false,
            },
            entityId: { type: DataTypes.BIGINT, allowNull: true },

            orderId: { type: DataTypes.INTEGER, allowNull: true },
            expressOrderId: { type: DataTypes.INTEGER, allowNull: true },

            paymentId: { type: DataTypes.STRING(64), allowNull: true },

            severity: {
                type: DataTypes.ENUM("info", "warn", "error", "security"),
                allowNull: false,
                defaultValue: "info",
            },

            success: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
            reason: { type: DataTypes.STRING(255), allowNull: true },

            ip: { type: DataTypes.STRING(64), allowNull: true },
            ua: { type: DataTypes.TEXT, allowNull: true },

            meta: { type: DataTypes.JSON, allowNull: true },
        },
        {
            sequelize,
            modelName: "ActionLog",
            tableName: "action_logs",
            timestamps: false,
            indexes: [
                { fields: ["ts"] },
                { fields: ["orderId"] },
                { fields: ["expressOrderId"] },
                { fields: ["actorUserId"] },
                { fields: ["actionType"] },
                { fields: ["paymentId"] },
                { fields: ["orderId", "actionType"] },
            ],
        }
    );

    return ActionLog;
};