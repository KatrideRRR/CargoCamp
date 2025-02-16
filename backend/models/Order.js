const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    class Order extends Model {
        static associate(models) {

            Order.belongsTo(models.User, { foreignKey: 'userId', as: 'user' });
            Order.belongsTo(models.Category, { foreignKey: 'categoryId', as: 'category' });
            Order.belongsTo(models.Subcategory, { foreignKey: 'subcategoryId', as: 'subcategory' });
        }
    }

    Order.init(
        {
            id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
            address: { type: DataTypes.STRING(255), allowNull: false },
            description: { type: DataTypes.STRING, allowNull: true },
            workTime: { type: DataTypes.DATE, allowNull: true },
            proposedSum: { type: DataTypes.INTEGER, allowNull: true },
            coordinates: { type: DataTypes.STRING, allowNull: true },
            userId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Users', key: 'id' } },
            status: { type: DataTypes.ENUM('pending', 'active', 'completed'), defaultValue: 'pending' },
            executorId: { type: DataTypes.INTEGER, allowNull: true },
            type: { type: DataTypes.STRING, allowNull: false },
            creatorId: { type: DataTypes.INTEGER, allowNull: false },
            completedBy: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
            images: {
                type: DataTypes.TEXT,
                allowNull: true,
                get() {
                    const value = this.getDataValue("images");
                    return value ? JSON.parse(value) : [];
                },
                set(value) {
                    this.setDataValue("images", JSON.stringify(value));
                },
            },
            completedAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
            createdAt: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
            categoryId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'Category', key: 'id' } },
            subcategoryId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'Subcategory', key: 'id' } },
            requestedExecutors: {type: DataTypes.JSON, allowNull: false, defaultValue: []
            }
        },
        {
            sequelize,
            tableName: 'orders',
            modelName: 'Order',
            updatedAt: false,
        }
    );



    return Order;
};
