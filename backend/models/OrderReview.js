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
        },
        {
            sequelize,
            modelName: 'OrderReview',
            tableName: 'order_reviews',
            timestamps: true, // createdAt / updatedAt
            indexes: [
                {
                    unique: true,
                    fields: ['orderId', 'fromUserId'], // 🔒 1 отзыв на заказ от пользователя
                },
                {
                    fields: ['toUserId'],
                },
                {
                    fields: ['orderId'],
                },
            ],
        }
    );

    return OrderReview;
};