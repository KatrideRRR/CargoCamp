const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    class Service extends Model {
        static associate(models) {
            Service.belongsTo(models.Subcategory, {
                foreignKey: 'subcategoryId',
                as: 'subcategory',
            });
        }
    }

    Service.init(
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            name: {
                type: DataTypes.STRING(255),
                allowNull: false,
            },
            price: {
                type: DataTypes.INTEGER,
                allowNull: true,
            },
            subcategoryId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'subcategory',
                    key: 'id',
                },
            },
        },
        {
            sequelize,
            tableName: 'services',
            modelName: 'Service',
            timestamps: true,
            createdAt: 'created_at',
            updatedAt: 'updated_at',
        }
    );

    return Service;
};
