const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    class SignatureChallenge extends Model {
        static associate(models) {
            this.belongsTo(models.Contract, {
                foreignKey: "contractId",
                as: "contract",
            });

            this.belongsTo(models.User, {
                foreignKey: "userId",
                as: "user",
            });

            this.belongsTo(
                models.ElectronicSignatureAgreement,
                {
                    foreignKey: "agreementId",
                    as: "agreement",
                }
            );
        }
    }

    SignatureChallenge.init(
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
            agreementId: {
                type: DataTypes.BIGINT.UNSIGNED,
                allowNull: false,
                field: "agreement_id",
            },
            partyRole: {
                type: DataTypes.STRING(32),
                allowNull: false,
                field: "party_role",
            },
            method: {
                type: DataTypes.STRING(32),
                allowNull: false,
                defaultValue: "otp_sms",
            },
            documentHash: {
                type: DataTypes.CHAR(64),
                allowNull: false,
                field: "document_hash",
            },
            codeHash: {
                type: DataTypes.CHAR(64),
                allowNull: false,
                field: "code_hash",
            },
            codeSalt: {
                type: DataTypes.CHAR(32),
                allowNull: false,
                field: "code_salt",
            },
            recipientFingerprint: {
                type: DataTypes.CHAR(64),
                allowNull: true,
                field: "recipient_fingerprint",
            },
            recipientMasked: {
                type: DataTypes.STRING(60),
                allowNull: true,
                field: "recipient_masked",
            },
            status: {
                type: DataTypes.STRING(32),
                allowNull: false,
                defaultValue: "pending",
            },
            attemptsCount: {
                type: DataTypes.SMALLINT.UNSIGNED,
                allowNull: false,
                defaultValue: 0,
                field: "attempts_count",
            },
            maxAttempts: {
                type: DataTypes.SMALLINT.UNSIGNED,
                allowNull: false,
                defaultValue: 5,
                field: "max_attempts",
            },
            expiresAt: {
                type: DataTypes.DATE,
                allowNull: false,
                field: "expires_at",
            },
            verifiedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "verified_at",
            },
            consumedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "consumed_at",
            },
            providerReference: {
                type: DataTypes.STRING(191),
                allowNull: true,
                field: "provider_reference",
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
            modelName: "SignatureChallenge",
            tableName: "signature_challenges",
            timestamps: false,
        }
    );

    return SignatureChallenge;
};