module.exports = (sequelize, DataTypes) => {
    const Notification = sequelize.define(
        'Notification',
        {
            userId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'users',
                    key: 'id',
                },
                onDelete: 'CASCADE',
            },
            type: {
                type: DataTypes.ENUM('new_message'),
                allowNull: false,
            },
            messageId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'messages',
                    key: 'id',
                },
                onDelete: 'CASCADE',
            },
            isRead: {
                type: DataTypes.BOOLEAN,
                defaultValue: false,
            },
        },
        {
            tableName: 'notifications',
            timestamps: true,
        }
    );

    Notification.associate = (models) => {
        Notification.belongsTo(models.User, { foreignKey: 'id' });
        Notification.belongsTo(models.Message, { foreignKey: 'id' });
    };

    return Notification;
};
