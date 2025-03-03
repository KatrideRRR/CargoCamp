module.exports = (sequelize, DataTypes) => {
    const Category = sequelize.define('Category', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
            allowNull: false
        },
        name: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        }
    }, {
        tableName: 'category',
        timestamps: true,
    });

    Category.associate = (models) => {
        Category.hasMany(models.Subcategory, {
            foreignKey: 'categoryId',
            as: 'subcategory',
            onDelete: 'CASCADE'
        });
    };

    return Category;
};
