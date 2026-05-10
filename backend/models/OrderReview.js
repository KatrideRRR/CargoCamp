const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    class OrderReview extends Model {
        static associate(models) {
            OrderReview.belongsTo(models.Order, {
                foreignKey: 'orderId',
                as: 'order',
                onDelete: 'CASCADE',
            });

            OrderReview.belongsTo(models.User, {
                foreignKey: 'fromUserId',
                as: 'fromUser',
                onDelete: 'CASCADE',
            });

            OrderReview.belongsTo(models.User, {
                foreignKey: 'toUserId',
                as: 'toUser',
                onDelete: 'CASCADE',
            });
        }
    }

    OrderReview.init(
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },

            orderId: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },

            fromUserId: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },

            toUserId: {
                type: DataTypes.INTEGER,
                allowNull: false,
            },

            rating: {
                type: DataTypes.TINYINT,
                allowNull: false,
                validate: {
                    min: 1,
                    max: 5,
                },
            },

            text: {
                type: DataTypes.TEXT,
                allowNull: true,
            },

            orderType: {
                type: DataTypes.ENUM("regular", "express"),
                allowNull: false,
                defaultValue: "regular",
            }
        },
        {
            sequelize,
            modelName: 'OrderReview',
            tableName: 'order_reviews',
            timestamps: true, // createdAt / updatedAt
            indexes: [
                {
                    unique: true,
                    name: "order_reviews_type_order_from_user_unique",
                    fields: ["orderType", "orderId", "fromUserId"], // 🔒 1 отзыв на один тип заказа от пользователя
                },
                {
                    fields: ["toUserId"],
                },
                {
                    fields: ["orderId"],
                },
                {
                    fields: ["orderType"],
                },
            ],
        }
    );

    return OrderReview;
};