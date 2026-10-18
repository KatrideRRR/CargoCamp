const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    class ContractSignature extends Model {
        static associate(models) {
            ContractSignature.belongsTo(
                models.Contract,
                {
                    foreignKey: "contractId",
                    as: "contract",
                }
            );

            ContractSignature.belongsTo(
                models.User,
                {
                    foreignKey: "userId",
                    as: "user",
                }
            );

            ContractSignature.belongsTo(
                models.IdentityVerification,
                {
                    foreignKey: "verificationId",
                    as: "verification",
                }
            );
        }
    }

    ContractSignature.init(
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

            userId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                field: "user_id",
            },

            partyRole: {
                type: DataTypes.STRING(32),
                allowNull: false,
                field: "party_role",
            },

            method: {
                type: DataTypes.STRING(50),
                allowNull: false,
                defaultValue: "otp_sms",
            },

            documentHash: {
                type: DataTypes.CHAR(64),
                allowNull: false,
                field: "document_hash",
            },

            signedAt: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
                field: "signed_at",
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

            verificationId: {
                type: DataTypes.BIGINT.UNSIGNED,
                allowNull: true,
                field: "verification_id",
            },

            verificationSnapshot: {
                type: DataTypes.JSON,
                allowNull: true,
                field: "verification_snapshot",
            },

            signaturePolicyCode: {
                type: DataTypes.STRING(100),
                allowNull: true,
                field: "signature_policy_code",
            },

            signaturePolicyVersion: {
                type: DataTypes.STRING(30),
                allowNull: true,
                field: "signature_policy_version",
            },

            externalReference: {
                type: DataTypes.STRING(191),
                allowNull: true,
                field: "external_reference",
            },

            evidence: {
                type: DataTypes.JSON,
                allowNull: true,
            },
        },
        {
            sequelize,
            modelName: "ContractSignature",
            tableName: "contract_signatures",
            timestamps: true,
            underscored: true,
        }
    );

    return ContractSignature;
};