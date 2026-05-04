module.exports = (sequelize, DataTypes) => {
    const Notification = sequelize.define(
        'Notification',
        {
            userId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'users',
                    key: 'id',
                },
                onDelete: 'CASCADE',
            },
            type: {
                type: DataTypes.ENUM(
                    "new_message",
                    "order_request",
                    "order_request_approved",
                    "order_started",
                    "order_completed_by_other",
                    "order_completed",
                    "review_needed",
                    "dispute_opened",
                    "express_status_changed",
                    "debt_created"
                ),
                allowNull: false,
            },
            orderType: {
                type: DataTypes.ENUM("regular", "express"),
                allowNull: false,
                defaultValue: "regular",
            },
            messageId: {
                type: DataTypes.INTEGER,
                allowNull: true,
            },
            orderId: {  // ✅ Добавляем поле orderId
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'orders',
                    key: 'id',
                },
                onDelete: 'CASCADE',
            },
            isRead: {
                type: DataTypes.BOOLEAN,
                defaultValue: false,
            },
        },
        {
            tableName: 'notifications',
            timestamps: true,
        }
    );

    Notification.associate = (models) => {
        Notification.belongsTo(models.User, { foreignKey: 'id' });
        Notification.belongsTo(models.Message, { foreignKey: 'id' });
        Notification.belongsTo(models.Order, { foreignKey: 'orderId' }); // ✅ Добавляем связь с Order
    };

    return Notification;
};
