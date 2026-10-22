
module.exports = (sequelize, DataTypes) => {
    const OrderSafeDeal = sequelize.define(
        "OrderSafeDeal",
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

            provider: {
                type: DataTypes.STRING(40),
                allowNull: false,
                defaultValue: "yookassa",
            },

            providerDealId: {
                type: DataTypes.STRING(100),
                field: "provider_deal_id",
            },

            providerPaymentId: {
                type: DataTypes.STRING(100),
                field: "provider_payment_id",
            },

            dealIdempotenceKey: {
                type: DataTypes.UUID,
                allowNull: false,
                field: "deal_idempotence_key",
            },

            paymentIdempotenceKey: {
                type: DataTypes.UUID,
                allowNull: false,
                field: "payment_idempotence_key",
            },

            expectedAmountKopecks: {
                type: DataTypes.BIGINT.UNSIGNED,
                allowNull: false,
                field: "expected_amount_kopecks",
            },

            sellerPayoutKopecks: {
                type: DataTypes.BIGINT.UNSIGNED,
                allowNull: false,
                field: "seller_payout_kopecks",
            },

            platformFeeKopecks: {
                type: DataTypes.BIGINT.UNSIGNED,
                allowNull: false,
                field: "platform_fee_kopecks",
            },

            fundedAmountKopecks: {
                type: DataTypes.BIGINT.UNSIGNED,
                allowNull: false,
                defaultValue: 0,
                field: "funded_amount_kopecks",
            },

            status: {
                type: DataTypes.STRING(40),
                allowNull: false,
                defaultValue: "initialized",
            },

            providerPaymentStatus: {
                type: DataTypes.STRING(40),
                field: "provider_payment_status",
            },

            providerDealStatus: {
                type: DataTypes.STRING(40),
                field: "provider_deal_status",
            },

            feeMoment: {
                type: DataTypes.STRING(40),
                allowNull: false,
                defaultValue: "deal_closed",
                field: "fee_moment",
            },

            expiresAt: {
                type: DataTypes.DATE,
                field: "expires_at",
            },

            fundedAt: {
                type: DataTypes.DATE,
                field: "funded_at",
            },

            lastVerifiedAt: {
                type: DataTypes.DATE,
                field: "last_verified_at",
            },

            lastErrorCode: {
                type: DataTypes.STRING(100),
                field: "last_error_code",
            },
        },
        {
            tableName: "order_safe_deals",
            timestamps: true,
            underscored: true,
        }
    );

    OrderSafeDeal.associate = (models) => {
        OrderSafeDeal.belongsTo(models.Order, {
            foreignKey: "orderId",
            as: "order",
        });
    };

    return OrderSafeDeal;
};
