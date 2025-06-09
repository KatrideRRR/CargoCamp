const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    class Order extends Model {
        static associate(models) {

            Order.belongsTo(models.User, { foreignKey: 'userId', as: 'users' });
            Order.belongsTo(models.Category, { foreignKey: 'categoryId', as: 'category' });
            Order.belongsTo(models.Subcategory, { foreignKey: 'subcategoryId', as: 'subcategory' });
            Order.belongsTo(models.User, { as: 'creator', foreignKey: 'creatorId' });
            Order.belongsTo(models.User, { as: 'executor', foreignKey: 'executorId' });
            Order.belongsTo(models.Service, { foreignKey: 'serviceId', as: 'service' });
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
            userId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'users', key: 'id' } },
            status: { type: DataTypes.ENUM('pending', 'active', 'completed', 'expired', 'pending_payment'), defaultValue: 'pending' },
            executorId: { type: DataTypes.INTEGER, allowNull: true },
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
            categoryId: { type: DataTypes.INTEGER, allowNull: false, references: { model: 'category', key: 'id' } },
            subcategoryId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'subcategory', key: 'id' } },
            requestedExecutors: {type: DataTypes.JSON, allowNull: false, defaultValue: []},
            paymentStatus: { // Добавлен новый статус для оплаты
                type: DataTypes.ENUM('paid', 'pending', 'unpaid'),
                defaultValue: 'pending', // Статус по умолчанию
            },
            paymentType: {
                type: DataTypes.ENUM('cash', 'guarantee', 'installment'),
                allowNull: false
            },
            requests: {
                type: DataTypes.JSON,
                allowNull: true,
                defaultValue: [],
            },
            contractPath: {
                type: DataTypes.STRING,
                allowNull: true
            },
            is_highlighted: {
                type: DataTypes.BOOLEAN,
                defaultValue: false,
            },
            is_recommended: {
                type: DataTypes.BOOLEAN,
                defaultValue: false,
            },
            is_push_notified: {
                type: DataTypes.BOOLEAN,
                defaultValue: false,
            },
            taxi_courier: {
                type: DataTypes.BOOLEAN,
                defaultValue: false,
            },
            serviceId: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: { model: 'services', key: 'id' }
            },
            promotionCost: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },

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
