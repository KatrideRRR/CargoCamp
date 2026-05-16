module.exports = (sequelize, DataTypes) => {
    const Notification = sequelize.define(
        "Notification",
        {
            userId: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },

            type: {
                type: DataTypes.ENUM(
                    "new_message",
                    "order_request",
                    "order_request_approved",
                    "order_started",
                    "order_completion_requested",
                    "order_completed_by_other",
                    "order_completed",
                    "review_needed",
                    "dispute_opened",
                    "express_status_changed",
                    "express_arrived",
                    "express_completed",
                    "express_cancelled",
                    "debt_created",
                    "order_push",
                    "support_reply"
                ),
                allowNull: false,
            },

            title: {
                type: DataTypes.STRING,
                allowNull: true,
            },

            body: {
                type: DataTypes.TEXT,
                allowNull: true,
            },

            data: {
                type: DataTypes.JSON,
                allowNull: true,
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

            orderId: {
                type: DataTypes.INTEGER,
                allowNull: true,
            },

            isRead: {
                type: DataTypes.BOOLEAN,
                defaultValue: false,
            },
        },
        {
            tableName: "notifications",
            timestamps: true,
        }
    );

    Notification.associate = (models) => {
        Notification.belongsTo(models.User, {
            foreignKey: "userId",
            as: "user",
        });

        Notification.belongsTo(models.Message, {
            foreignKey: "messageId",
            as: "message",
        });
    };

    return Notification;
};