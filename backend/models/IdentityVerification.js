const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    class IdentityVerification extends Model {
        static associate(models) {
            IdentityVerification.belongsTo(
                models.User,
                {
                    foreignKey: "userId",
                    as: "user",
                }
            );

            IdentityVerification.belongsTo(
                models.User,
                {
                    foreignKey: "reviewedBy",
                    as: "reviewer",
                }
            );

            IdentityVerification.hasMany(
                models.VerificationDocument,
                {
                    foreignKey: "verificationId",
                    as: "documents",
                }
            );

            IdentityVerification.hasMany(
                models.ContractSignature,
                {
                    foreignKey: "verificationId",
                    as: "contractSignatures",
                }
            );
        }
    }

    IdentityVerification.init(
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

            countryCode: {
                type: DataTypes.CHAR(2),
                allowNull: false,
                defaultValue: "RU",
                field: "country_code",
            },

            assuranceLevel: {
                type: DataTypes.STRING(32),
                allowNull: false,
                defaultValue: "basic",
                field: "assurance_level",
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

            reviewedBy: {
                type: DataTypes.INTEGER,
                allowNull: true,
                field: "reviewed_by",
            },

            rejectionReason: {
                type: DataTypes.TEXT,
                allowNull: true,
                field: "rejection_reason",
            },

            metadata: {
                type: DataTypes.JSON,
                allowNull: true,
            },
        },
        {
            sequelize,
            modelName: "IdentityVerification",
            tableName: "identity_verifications",
            timestamps: true,
            underscored: true,
        }
    );

    return IdentityVerification;
};