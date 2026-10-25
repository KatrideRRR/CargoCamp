module.exports = (sequelize, DataTypes) => {
    return sequelize.define(
        "OrderChangeRequest",
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
            proposedById: {
                type: DataTypes.INTEGER,
                allowNull: false,
                field: "proposed_by_id",
            },
            respondedById: {
                type: DataTypes.INTEGER,
                allowNull: true,
                field: "responded_by_id",
            },
            basePriceKopecks: {
                type: DataTypes.INTEGER,
                allowNull: false,
                field: "base_price_kopecks",
            },
            proposedPriceKopecks: {
                type: DataTypes.INTEGER,
                allowNull: false,
                field: "proposed_price_kopecks",
            },
            additionalWork: {
                type: DataTypes.TEXT,
                allowNull: false,
                field: "additional_work",
            },
            status: {
                type: DataTypes.STRING(40),
                allowNull: false,
                defaultValue: "pending",
            },
            agreementContractId: {
                type: DataTypes.BIGINT.UNSIGNED,
                allowNull: true,
                field: "agreement_contract_id",
            },
            createdAt: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
                field: "created_at",
            },
            respondedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "responded_at",
            },
            appliedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "applied_at",
            },
        },
        {
            tableName: "order_change_requests",
            timestamps: false,
        }
    );
};