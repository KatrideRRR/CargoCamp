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
        code: {
            type: DataTypes.STRING(100),
            allowNull: true,
            unique: true,
        },

        formConfig: {
            type: DataTypes.JSON,
            allowNull: true,
            defaultValue: null,
        },

        pricingConfig: {
            type: DataTypes.JSON,
            allowNull: true,
            defaultValue: null,
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
        Subcategory.hasMany(models.Service, {
            foreignKey: 'subcategoryId',
            as: 'services',
        });
        Subcategory.hasMany(models.ServiceSearchAlias, {
            foreignKey: "subcategoryId",
            as: "searchAliases",
        });

    };

    return Subcategory;
};
