module.exports = (sequelize, DataTypes) => {
    const Subcategory = sequelize.define('subcategory', {
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
                model: 'category',
                key: 'id'
            },
            onDelete: 'CASCADE'
        },
        price: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },

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
