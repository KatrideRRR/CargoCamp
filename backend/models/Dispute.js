const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    class Dispute extends Model {
        static associate(models) {

            Dispute.belongsTo(models.User, {
                foreignKey: 'openedById',
                as: 'openedBy'
            });

            Dispute.belongsTo(models.User, {
                foreignKey: 'creatorId',
                as: 'creator'
            });

            Dispute.belongsTo(models.User, {
                foreignKey: 'executorId',
                as: 'executor'
            });

            Dispute.belongsTo(models.User, {
                foreignKey: 'resolvedById',
                as: 'resolvedBy'
            });

            Dispute.belongsTo(models.Order, {
                foreignKey: 'orderId',
                as: 'relatedOrder'
            });
        }
    }

    Dispute.init(
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true
            },

            orderId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'orders',
                    key: 'id'
                }
            },

            openedById: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'users',
                    key: 'id'
                }
            },

            openedByRole: {
                type: DataTypes.ENUM('creator', 'executor'),
                allowNull: false
            },

            creatorId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                references: {
                    model: 'users',
                    key: 'id'
                }
            },

            executorId: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: 'users',
                    key: 'id'
                }
            },

            reasonCode: {
                type: DataTypes.ENUM(
                    'work_not_done',
                    'poor_quality',
                    'missed_deadline',
                    'wrong_price',
                    'rude_behavior',
                    'other'
                ),
                allowNull: false
            },

            reason: {
                type: DataTypes.STRING,
                allowNull: false
            },

            description: {
                type: DataTypes.TEXT,
                allowNull: true
            },

            status: {
                type: DataTypes.ENUM(
                    'open',
                    'in_review',
                    'waiting_creator',
                    'waiting_executor',
                    'resolved',
                    'closed'
                ),
                allowNull: false,
                defaultValue: 'open'
            },

            resolution: {
                type: DataTypes.TEXT,
                allowNull: true
            },

            resolvedById: {
                type: DataTypes.INTEGER,
                allowNull: true,
                references: {
                    model: 'users',
                    key: 'id'
                }
            },

            resolvedAt: {
                type: DataTypes.DATE,
                allowNull: true
            },

            createdAt: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW
            }

        },
        {
            sequelize,
            modelName: 'Dispute',
            tableName: 'disputes',
            updatedAt: false
        }
    );

    return Dispute;
};