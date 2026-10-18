const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    class VerificationDocument extends Model {
        static associate(models) {
            VerificationDocument.belongsTo(
                models.IdentityVerification,
                {
                    foreignKey: "verificationId",
                    as: "verification",
                }
            );

            VerificationDocument.belongsTo(
                models.User,
                {
                    foreignKey: "userId",
                    as: "user",
                }
            );
        }
    }

    VerificationDocument.init(
        {
            id: {
                type: DataTypes.BIGINT.UNSIGNED,
                primaryKey: true,
                autoIncrement: true,
            },

            verificationId: {
                type: DataTypes.BIGINT.UNSIGNED,
                allowNull: false,
                field: "verification_id",
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
                defaultValue: true,
                field: "is_encrypted",
            },

            encryptionVersion: {
                type: DataTypes.STRING(32),
                allowNull: true,
                field: "encryption_version",
            },

            retentionUntil: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "retention_until",
            },

            metadata: {
                type: DataTypes.JSON,
                allowNull: true,
            },

            deletedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "deleted_at",
            },

            deletionReason: {
                type: DataTypes.STRING(255),
                allowNull: true,
                field: "deletion_reason",
            },
        },
        {
            sequelize,
            modelName: "VerificationDocument",
            tableName: "verification_documents",
            timestamps: true,
            underscored: true,

            // deletedAt у нас пока просто поле истории,
            // а не Sequelize paranoid delete.
            paranoid: false,
        }
    );

    return VerificationDocument;
};