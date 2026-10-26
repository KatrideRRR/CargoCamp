
module.exports = (sequelize, DataTypes) => {
    return sequelize.define(
        "OrderCompletionDecision",
        {
            id: {
                type: DataTypes.BIGINT.UNSIGNED,
                primaryKey: true,
                autoIncrement: true,
            },
            orderId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                field: "order_id",
            },
            userId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                field: "user_id",
            },
            partyRole: {
                type: DataTypes.STRING(20),
                allowNull: false,
                field: "party_role",
            },
            qualityDecision: {
                type: DataTypes.STRING(20),
                field: "quality_decision",
            },
            remarks: {
                type: DataTypes.TEXT,
            },
            cashStatus: {
                type: DataTypes.STRING(20),
                field: "cash_status",
            },
            cashAmountKopecks: {
                type: DataTypes.BIGINT.UNSIGNED,
                field: "cash_amount_kopecks",
            },
            payoutAuthorized: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
                field: "payout_authorized",
            },
            confirmedAt: {
                type: DataTypes.DATE,
                allowNull: false,
                field: "confirmed_at",
            },
            ipAddress: {
                type: DataTypes.STRING(64),
                field: "ip_address",
            },
            userAgent: {
                type: DataTypes.TEXT,
                field: "user_agent",
            },
        },
        {
            tableName: "order_completion_decisions",
            timestamps: false,
        }
    );
};
