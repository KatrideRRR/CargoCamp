"use strict";

module.exports = (sequelize, DataTypes) => {
    const amount = (field) => ({
        type: DataTypes.BIGINT.UNSIGNED,
        allowNull: false,
        field,
    });

    const Model = sequelize.define(
        "GuaranteeFinancialSnapshot",
        {
            id: {
                type: DataTypes.BIGINT.UNSIGNED,
                primaryKey: true,
                autoIncrement: true,
            },

            orderId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                unique: true,
                field: "order_id",
            },

            creatorId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                field: "creator_id",
            },

            executorId: {
                type: DataTypes.INTEGER,
                field: "executor_id",
            },

            pricingVersion: {
                type: DataTypes.STRING(80),
                allowNull: false,
                field: "pricing_version",
            },

            pricingParameters: {
                type: DataTypes.JSON,
                allowNull: false,
                field: "pricing_parameters_json",
            },

            lockedAt: {
                type: DataTypes.DATE,
                field: "locked_at",
            },

            workPriceKopecks: amount("work_price_kopecks"),
            buyerFeeKopecks: amount("buyer_fee_kopecks"),
            executorFeeKopecks: amount("executor_fee_kopecks"),
            platformFeeKopecks: amount("platform_fee_kopecks"),

            promotionKopecks: {
                ...amount("promotion_kopecks"),
                defaultValue: 0,
            },

            customerTotalKopecks: amount("customer_total_kopecks"),
            executorPayoutKopecks: amount("executor_payout_kopecks"),

            provider: {
                type: DataTypes.STRING(40),
                allowNull: true,
            },

            status: {
                type: DataTypes.ENUM(
                    "quoted",
                    "awaiting_payment",
                    "paid",
                    "cancelled"
                ),
                allowNull: false,
                defaultValue: "quoted",
            },
        },
        {
            tableName: "guarantee_financial_snapshots",
            timestamps: true,
            underscored: true,
        }
    );

    Model.associate = (models) => {
        Model.belongsTo(models.Order, {
            foreignKey: "orderId",
            as: "order",
        });
    };

    return Model;
};