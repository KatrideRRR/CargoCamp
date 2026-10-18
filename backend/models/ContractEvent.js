const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    class ContractEvent extends Model {
        static associate(models) {
            ContractEvent.belongsTo(
                models.Contract,
                {
                    foreignKey: "contractId",
                    as: "contract",
                }
            );

            ContractEvent.belongsTo(
                models.User,
                {
                    foreignKey: "actorUserId",
                    as: "actor",
                }
            );
        }
    }

    ContractEvent.init(
        {
            id: {
                type: DataTypes.BIGINT.UNSIGNED,
                primaryKey: true,
                autoIncrement: true,
            },

            contractId: {
                type: DataTypes.BIGINT.UNSIGNED,
                allowNull: false,
                field: "contract_id",
            },

            actorUserId: {
                type: DataTypes.INTEGER,
                allowNull: true,
                field: "actor_user_id",
            },

            actorRole: {
                type: DataTypes.STRING(32),
                allowNull: false,
                defaultValue: "system",
                field: "actor_role",
            },

            eventType: {
                type: DataTypes.STRING(80),
                allowNull: false,
                field: "event_type",
            },

            eventAt: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
                field: "event_at",
            },

            ipAddress: {
                type: DataTypes.STRING(64),
                allowNull: true,
                field: "ip_address",
            },

            userAgent: {
                type: DataTypes.TEXT,
                allowNull: true,
                field: "user_agent",
            },

            requestId: {
                type: DataTypes.STRING(64),
                allowNull: true,
                field: "request_id",
            },

            previousEventHash: {
                type: DataTypes.CHAR(64),
                allowNull: true,
                field: "previous_event_hash",
            },

            eventHash: {
                type: DataTypes.CHAR(64),
                allowNull: true,
                field: "event_hash",
            },

            metadata: {
                type: DataTypes.JSON,
                allowNull: true,
            },
        },
        {
            sequelize,
            modelName: "ContractEvent",
            tableName: "contract_events",
            timestamps: false,
        }
    );

    return ContractEvent;
};