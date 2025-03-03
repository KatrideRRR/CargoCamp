module.exports = (sequelize, DataTypes) => {
    const Subcategory = sequelize.define('Subcategory', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false
        },
        categoryId: {
            type: DataTypes.INTEGER,
            allowNull: false,
            references: {
                model: 'Category',
                key: 'id'
            },
            onDelete: 'CASCADE'
        }
    }, {
        tableName: 'subcategory',
        timestamps: true,
    });

    Subcategory.associate = (models) => {
        Subcategory.belongsTo(models.Category, {
            foreignKey: 'categoryId',
            as: 'category'
        });
    };

    return Subcategory;
};
