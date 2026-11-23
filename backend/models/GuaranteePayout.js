"use strict";

module.exports = (sequelize, DataTypes) => {
    const Model = sequelize.define(
        "GuaranteePayout",
        {
            id: {
                type: DataTypes.BIGINT.UNSIGNED,
                primaryKey: true,
                autoIncrement: true,
            },

            snapshotId: {
                type: DataTypes.BIGINT.UNSIGNED,
                allowNull: false,
                unique: true,
                field: "snapshot_id",
            },

            executorId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                field: "executor_id",
            },

            amountKopecks: {
                type: DataTypes.BIGINT.UNSIGNED,
                allowNull: false,
                field: "amount_kopecks",
            },

            status: {
                type: DataTypes.ENUM(
                    "pending_acceptance",
                    "awaiting_requisites",
                    "ready",
                    "processing",
                    "paid",
                    "failed",
                    "suspended",
                    "cancelled"
                ),
                allowNull: false,
                defaultValue: "pending_acceptance",
            },

            paidAt: {
                type: DataTypes.DATE,
                field: "paid_at",
            },
        },
        {
            tableName: "guarantee_payouts",
            timestamps: true,
            underscored: true,
        }
    );

    Model.associate = (models) => {
        Model.belongsTo(models.GuaranteeFinancialSnapshot, {
            foreignKey: "snapshotId",
            as: "snapshot",
        });
    };

    return Model;
};