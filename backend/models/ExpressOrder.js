module.exports = (sequelize, DataTypes) => {
    const ExpressOrder = sequelize.define(
        'ExpressOrder',
        {
            id: {
                type: DataTypes.INTEGER.UNSIGNED,
                primaryKey: true,
                autoIncrement: true,
            },

            /* === Участники === */
            creatorId: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: false,
                field: 'creator_id',
            },

            executorId: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: true,
                field: 'executor_id',
            },

            /* === Тип заказа === */
            type: {
                type: DataTypes.ENUM('taxi', 'courier'),
                allowNull: false,
            },

            /* === Точка А (откуда) === */
            fromAddress: {
                type: DataTypes.STRING(255),
                allowNull: false,
                field: 'from_address',
            },
            fromLat: {
                type: DataTypes.DECIMAL(10, 7),
                allowNull: false,
                field: 'from_lat',
            },
            fromLng: {
                type: DataTypes.DECIMAL(10, 7),
                allowNull: false,
                field: 'from_lng',
            },

            /* === Точка Б (куда) === */
            toAddress: {
                type: DataTypes.STRING(255),
                allowNull: false,
                field: 'to_address',
            },
            toLat: {
                type: DataTypes.DECIMAL(10, 7),
                allowNull: false,
                field: 'to_lat',
            },
            toLng: {
                type: DataTypes.DECIMAL(10, 7),
                allowNull: false,
                field: 'to_lng',
            },

            /* === Расчёты маршрута === */
            distanceKm: {
                type: DataTypes.DECIMAL(6, 2),
                allowNull: true,
                field: 'distance_km',
            },
            estimatedTimeMin: {
                type: DataTypes.INTEGER,
                allowNull: true,
                field: 'estimated_time_min',
            },

            /* === Ценообразование === */
            basePrice: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
                field: 'base_price',
            },
            pricePerKm: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
                field: 'price_per_km',
            },
            totalPrice: {
                type: DataTypes.INTEGER,
                allowNull: false,
                field: 'total_price',
            },

            /* === Оплата === */
            paymentType: {
                type: DataTypes.ENUM('cash', 'guarantee'),
                allowNull: false,
                field: 'payment_type',
            },

            dealStatus: {
                type: DataTypes.ENUM('none', 'funds_held', 'captured', 'cancelled'),
                allowNull: false,
                defaultValue: 'none',
                field: 'deal_status',
            },

            /* === Статусы поездки === */
            status: {
                type: DataTypes.ENUM(
                    'created',
                    'accepted',
                    'on_the_way_to_A',
                    'arrived_at_A',
                    'waiting_at_A',
                    'picked_up',
                    'in_progress',
                    'completed',
                    'cancelled'
                ),
                allowNull: false,
                defaultValue: 'created',
            },

            /* === Детали === */
            subcategory: {
                type: DataTypes.STRING(100),
                allowNull: true,
            },

            description: {
                type: DataTypes.TEXT,
                allowNull: true,
            },

            /* === Тайминги === */
            waitingStartedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: 'waiting_started_at',
            },
            pickedUpAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: 'picked_up_at',
            },
            arrivedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: 'arrived_at',
            },
            startedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: 'started_at',
            },
            completedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: 'completed_at',
            },
            creatorHidden: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            creatorHiddenAt: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            adminDeleted: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
            },
            adminDeletedAt: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            adminDeletedById: {
                type: DataTypes.INTEGER,
                allowNull: true,
            },
        },
        {
            tableName: 'express_orders',
            underscored: true,
            timestamps: true,
            createdAt: 'created_at',
            updatedAt: 'updated_at',
            indexes: [
                { fields: ['creator_id'] },
                { fields: ['executor_id'] },
                { fields: ['status'] },
                { fields: ['type'] },
            ],
        }
    );

    /* === Ассоциации === */
    ExpressOrder.associate = (models) => {
        ExpressOrder.belongsTo(models.User, {
            foreignKey: 'creatorId',
            as: 'creator',
            onDelete: 'CASCADE',
        });

        ExpressOrder.belongsTo(models.User, {
            foreignKey: 'executorId',
            as: 'executor',
            onDelete: 'SET NULL',
        });
    };

    return ExpressOrder;
};