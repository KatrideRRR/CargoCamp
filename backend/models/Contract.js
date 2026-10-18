const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    class Contract extends Model {
        static associate(models) {
            Contract.belongsTo(
                models.Order,
                {
                    foreignKey: "orderId",
                    as: "order",
                }
            );

            Contract.belongsTo(
                models.Contract,
                {
                    foreignKey: "parentContractId",
                    as: "parentContract",
                }
            );

            Contract.hasMany(
                models.Contract,
                {
                    foreignKey: "parentContractId",
                    as: "childContracts",
                }
            );

            Contract.hasMany(
                models.ContractSignature,
                {
                    foreignKey: "contractId",
                    as: "signatures",
                }
            );

            Contract.hasMany(
                models.ContractEvent,
                {
                    foreignKey: "contractId",
                    as: "events",
                }
            );
            Contract.hasMany(
                models.SignatureChallenge,
                {
                    foreignKey: "contractId",
                    as: "signatureChallenges",
                }
            );
        }
    }

    Contract.init(
        {
            id: {
                type: DataTypes.BIGINT.UNSIGNED,
                primaryKey: true,
                autoIncrement: true,
            },

            orderId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                field: "order_id",
            },

            parentContractId: {
                type: DataTypes.BIGINT.UNSIGNED,
                allowNull: true,
                field: "parent_contract_id",
            },

            type: {
                type: DataTypes.STRING(50),
                allowNull: false,
                defaultValue: "service_contract",
            },

            version: {
                type: DataTypes.INTEGER.UNSIGNED,
                allowNull: false,
                defaultValue: 1,
            },

            status: {
                type: DataTypes.STRING(50),
                allowNull: false,
                defaultValue: "draft",
            },

            documentNumber: {
                type: DataTypes.STRING(100),
                allowNull: false,
                unique: true,
                field: "document_number",
            },

            jurisdiction: {
                type: DataTypes.STRING(16),
                allowNull: false,
                defaultValue: "RU",
            },

            templateCode: {
                type: DataTypes.STRING(100),
                allowNull: false,
                defaultValue:
                    "service_contract_default",
                field: "template_code",
            },

            templateVersion: {
                type: DataTypes.STRING(30),
                allowNull: false,
                defaultValue: "1",
                field: "template_version",
            },

            storageKey: {
                type: DataTypes.STRING(500),
                allowNull: true,
                field: "storage_key",
            },

            documentHash: {
                type: DataTypes.CHAR(64),
                allowNull: true,
                field: "document_hash",
            },

            finalizedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "finalized_at",
            },

            fullySignedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "fully_signed_at",
            },

            supersededAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "superseded_at",
            },

            metadata: {
                type: DataTypes.JSON,
                allowNull: true,
            },
        },
        {
            sequelize,
            modelName: "Contract",
            tableName: "contracts",
            timestamps: true,
            underscored: true,
        }
    );

    return Contract;
};