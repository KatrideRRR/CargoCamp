"use strict";

module.exports = (sequelize, DataTypes) => {
    const Model = sequelize.define(
        "GuaranteePayoutAttempt",
        {
            id: {
                type: DataTypes.BIGINT.UNSIGNED,
                primaryKey: true,
                autoIncrement: true,
            },

            payoutId: {
                type: DataTypes.BIGINT.UNSIGNED,
                allowNull: false,
                field: "payout_id",
            },

            provider: {
                type: DataTypes.STRING(40),
                allowNull: false,
            },

            idempotencyKey: {
                type: DataTypes.UUID,
                allowNull: false,
                unique: true,
                field: "idempotency_key",
            },

            providerTransferId: {
                type: DataTypes.STRING(128),
                field: "provider_transfer_id",
            },

            status: {
                type: DataTypes.ENUM(
                    "prepared",
                    "processing",
                    "succeeded",
                    "failed",
                    "unknown"
                ),
                allowNull: false,
                defaultValue: "prepared",
            },

            errorCode: {
                type: DataTypes.STRING(100),
                field: "error_code",
            },
        },
        {
            tableName: "guarantee_payout_attempts",
            timestamps: true,
            underscored: true,
        }
    );

    Model.associate = (models) => {
        Model.belongsTo(models.GuaranteePayout, {
            foreignKey: "payoutId",
            as: "payout",
        });
    };

    return Model;
};