const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    class UserBenefitVerification extends Model {
        static associate(models) {
            this.belongsTo(models.User, {
                foreignKey: "userId",
                as: "user",
            });

            this.belongsTo(models.User, {
                foreignKey: "reviewedBy",
                as: "reviewer",
            });

            this.hasMany(
                models.BenefitVerificationDocument,
                {
                    foreignKey: "benefitVerificationId",
                    as: "documents",
                }
            );
        }
    }

    UserBenefitVerification.init(
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
            countryCode: {
                type: DataTypes.CHAR(2),
                allowNull: false,
                defaultValue: "RU",
                field: "country_code",
            },
            benefitCode: {
                type: DataTypes.STRING(64),
                allowNull: false,
                field: "benefit_code",
            },
            status: {
                type: DataTypes.STRING(32),
                allowNull: false,
                defaultValue: "pending",
            },
            provider: {
                type: DataTypes.STRING(64),
                allowNull: false,
                defaultValue: "manual",
            },
            verificationMethod: {
                type: DataTypes.STRING(64),
                allowNull: false,
                defaultValue: "document_review",
                field: "verification_method",
            },
            providerReference: {
                type: DataTypes.STRING(191),
                allowNull: true,
                field: "provider_reference",
            },
            submittedAt: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
                field: "submitted_at",
            },
            reviewedBy: {
                type: DataTypes.INTEGER,
                allowNull: true,
                field: "reviewed_by",
            },
            reviewedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "reviewed_at",
            },
            verifiedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "verified_at",
            },
            expiresAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "expires_at",
            },
            revokedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "revoked_at",
            },
            decisionReason: {
                type: DataTypes.STRING(500),
                allowNull: true,
                field: "decision_reason",
            },
            metadata: {
                type: DataTypes.JSON,
                allowNull: true,
            },
        },
        {
            sequelize,
            modelName: "UserBenefitVerification",
            tableName: "user_benefit_verifications",
            timestamps: true,
            underscored: true,
        }
    );

    return UserBenefitVerification;
};