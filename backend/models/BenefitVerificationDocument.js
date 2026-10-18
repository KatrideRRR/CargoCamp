const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    class BenefitVerificationDocument extends Model {
        static associate(models) {
            this.belongsTo(
                models.UserBenefitVerification,
                {
                    foreignKey: "benefitVerificationId",
                    as: "verification",
                }
            );

            this.belongsTo(models.User, {
                foreignKey: "userId",
                as: "user",
            });
        }
    }

    BenefitVerificationDocument.init(
        {
            id: {
                type: DataTypes.BIGINT.UNSIGNED,
                primaryKey: true,
                autoIncrement: true,
            },
            benefitVerificationId: {
                type: DataTypes.BIGINT.UNSIGNED,
                allowNull: false,
                field: "benefit_verification_id",
            },
            userId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                field: "user_id",
            },
            documentType: {
                type: DataTypes.STRING(64),
                allowNull: false,
                field: "document_type",
            },
            storageKey: {
                type: DataTypes.STRING(500),
                allowNull: false,
                field: "storage_key",
            },
            mimeType: {
                type: DataTypes.STRING(100),
                allowNull: true,
                field: "mime_type",
            },
            fileSize: {
                type: DataTypes.BIGINT.UNSIGNED,
                allowNull: true,
                field: "file_size",
            },
            fileHash: {
                type: DataTypes.CHAR(64),
                allowNull: false,
                field: "file_hash",
            },
            isEncrypted: {
                type: DataTypes.BOOLEAN,
                allowNull: false,
                defaultValue: false,
                field: "is_encrypted",
            },
            retentionUntil: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "retention_until",
            },
            deletedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "deleted_at",
            },
            metadata: {
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
            modelName: "BenefitVerificationDocument",
            tableName: "benefit_verification_documents",
            timestamps: false,
        }
    );

    return BenefitVerificationDocument;
};