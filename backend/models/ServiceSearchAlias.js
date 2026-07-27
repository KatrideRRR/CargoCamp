const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    class ServiceSearchAlias extends Model {
        static associate(models) {
            ServiceSearchAlias.belongsTo(models.Category, {
                foreignKey: "categoryId",
                as: "category",
            });

            ServiceSearchAlias.belongsTo(models.Subcategory, {
                foreignKey: "subcategoryId",
                as: "subcategory",
            });
        }
    }

    ServiceSearchAlias.init(
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },

            phrase: {
                type: DataTypes.STRING(255),
                allowNull: false,
            },

            normalizedPhrase: {
                type: DataTypes.STRING(255),
                allowNull: false,
            },

            categoryId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: "category",
                    key: "id",
                },
            },

            subcategoryId: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: "subcategory",
                    key: "id",
                },
            },

            priority: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 100,
            },

            isActive: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: true,
            },
        },
        {
            sequelize,
            tableName: "service_search_aliases",
            modelName: "ServiceSearchAlias",
            timestamps: true,
        }
    );

    return ServiceSearchAlias;
};