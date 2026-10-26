
module.exports = (sequelize, DataTypes) => {
    return sequelize.define(
        "OrderCompletionCorrection",
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
            roundNumber: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: false,
                field: "round_number",
            },
            eventType: {
                type: DataTypes.STRING(20),
                allowNull: false,
                field: "event_type",
            },
            actorUserId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                field: "actor_user_id",
            },
            comment: {
                type: DataTypes.TEXT,
                allowNull: true,
            },
            eventAt: {
                type: DataTypes.DATE,
                allowNull: false,
                field: "event_at",
            },
        },
        {
            tableName: "order_completion_corrections",
            timestamps: false,
        }
    );
};
