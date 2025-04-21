const { Model, DataTypes } = require('sequelize');
const Sequelize = require('sequelize'); // Добавляем импорт Sequelize

module.exports = (sequelize) => {
    class User extends Model {
        static associate(models) {
            // Связь с моделью Order
            User.hasMany(models.Order, { foreignKey: 'userId', as: 'orders' });
        }
    }
    User.init(
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            username: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            phone: {
                type: DataTypes.STRING,
                allowNull: false,
                unique: true,
                validate: {
                    notEmpty: true,
                    is: /^[0-9]{10,15}$/, // Допускаем номера от 10 до 15 цифр
                },
            },
            password: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            rating: {
                type: DataTypes.FLOAT,
                defaultValue: 0,
            },
            ratingCount: {
                type: DataTypes.INTEGER,
                defaultValue: 0,
            },
            complaintsCount: {
                type: DataTypes.INTEGER,
                defaultValue: 0,
            },
            complaints: {
                type: DataTypes.JSON,
                defaultValue: [],
            },
            documentPhotos: {
                type: DataTypes.JSON, // Массив изображений
                allowNull: true,
                defaultValue: []
            },
            role: {
                type: DataTypes.ENUM('user', 'admin', 'banned'),
                defaultValue: 'user' // по умолчанию обычный пользователь
            },
            userStatus: {
                type: DataTypes.STRING,
                defaultValue: 'unverified',
                allowNull: false
            },
            cardNumber: {
                type: DataTypes.STRING,
                allowNull: true, // Пользователь может не привязывать карту
            },
            cardLastFour: {
                type: DataTypes.STRING(4),
                allowNull: true,
            },
            cardType: {
                type: DataTypes.STRING,
                allowNull: true,
            },
            RebillId: {
                type: DataTypes.STRING,
                allowNull: true
            }

        },
        {
            sequelize,
            modelName: 'User',
            tableName: 'users',
        }
    );

    return User;
};
