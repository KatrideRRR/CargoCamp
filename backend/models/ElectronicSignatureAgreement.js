const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    class ElectronicSignatureAgreement extends Model {
        static associate(models) {
            this.belongsTo(models.User, {
                foreignKey: "userId",
                as: "user",
            });

            this.hasMany(models.SignatureChallenge, {
                foreignKey: "agreementId",
                as: "challenges",
            });
        }
    }

    ElectronicSignatureAgreement.init(
        {
            id: {
                type: DataTypes.BIGINT.UNSIGNED,
                primaryKey: true,
                autoIncrement: true,
            },
            userId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                field: "user_id",
            },
            jurisdiction: {
                type: DataTypes.STRING(16),
                allowNull: false,
                defaultValue: "RU",
            },
            policyCode: {
                type: DataTypes.STRING(100),
                allowNull: false,
                field: "policy_code",
            },
            policyVersion: {
                type: DataTypes.STRING(30),
                allowNull: false,
                field: "policy_version",
            },
            policySha256: {
                type: DataTypes.CHAR(64),
                allowNull: false,
                field: "policy_sha256",
            },
            acceptedAt: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
                field: "accepted_at",
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
            evidence: {
                type: DataTypes.JSON,
                allowNull: true,
            },
            createdAt: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
                field: "created_at",
            },
        },
        {
            sequelize,
            modelName: "ElectronicSignatureAgreement",
            tableName: "electronic_signature_agreements",
            timestamps: false,
        }
    );

    return ElectronicSignatureAgreement;
};