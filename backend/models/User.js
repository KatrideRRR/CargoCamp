const { Model, DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    class User extends Model {
        static associate(models) {
            User.hasMany(models.Order, { foreignKey: 'userId', as: 'orders' });
            User.hasMany(models.ExpressSavedAddress, {foreignKey: "userId", as: "expressSavedAddresses", onDelete: "CASCADE",});
            User.hasMany(models.ExpressOrder, { foreignKey: "creatorId", as: "expressCreatedOrders" });
            User.hasMany(models.ExpressOrder, { foreignKey: "executorId", as: "expressTakenOrders" });
            User.hasMany(models.SupportMessage, {foreignKey: "userId", as: "supportMessages",});
            User.hasMany(models.SupportMessage, {foreignKey: "senderId", as: "sentSupportMessages",});
            User.hasMany(models.IdentityVerification, {foreignKey: "userId", as: "identityVerifications",});
            User.hasMany(models.IdentityVerification, {foreignKey: "reviewedBy", as: "reviewedIdentityVerifications",});
            User.hasMany(models.VerificationDocument, {foreignKey: "userId", as: "verificationDocuments",});
            User.hasMany(models.ContractSignature, {foreignKey: "userId", as: "contractSignatures",});
            User.hasMany(models.ContractEvent, {foreignKey: "actorUserId", as: "contractEvents",});
            User.hasMany(models.ElectronicSignatureAgreement, {foreignKey: "userId", as: "electronicSignatureAgreements",});
            User.hasMany(models.SignatureChallenge, {foreignKey: "userId", as: "signatureChallenges",});
            User.hasMany(models.UserBenefitVerification, {foreignKey: "userId", as: "benefitVerifications",});
            User.hasMany(models.UserBenefitVerification, {foreignKey: "reviewedBy", as: "reviewedBenefitVerifications",});
            User.hasMany(models.BenefitVerificationDocument, {foreignKey: "userId", as: "benefitDocuments",});
        }
    }
    User.init(
        {
            id: {
                type: DataTypes.INTEGER,
                primaryKey: true,
                autoIncrement: true,
            },
            username: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            phone: {
                type: DataTypes.STRING,
                allowNull: false,
                unique: true,
                validate: {
                    notEmpty: true,
                    is: /^[0-9+\-()\s]{10,20}$/ // Разрешаем цифры, +, -, пробелы, скобки. От 10 до 20 символов.
                },
            },
            password: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            rating: {
                type: DataTypes.FLOAT,
                defaultValue: 0,
            },
            ratingCount: {
                type: DataTypes.INTEGER,
                defaultValue: 0,
            },
            documentPhotos: {
                type: DataTypes.JSON, // Массив изображений
                allowNull: true,
                defaultValue: []
            },
            role: {
                type: DataTypes.ENUM('user', 'admin', 'banned'),
                defaultValue: 'user' // по умолчанию обычный пользователь
            },
            userStatus: {
                type: DataTypes.STRING,
                defaultValue: 'unverified',
                allowNull: false
            },
            cardLastFour: {
                type: DataTypes.STRING(4),
                allowNull: true,
            },
            cardType: {
                type: DataTypes.STRING,
                allowNull: true,
            },
            subscription_type: {
                type: DataTypes.ENUM('standard', 'premium'),
                allowNull: false,
                defaultValue: 'standard',
            },
            subscription_expires_at: {
                type: DataTypes.DATE,
                allowNull: true,
            },
            debt: {
                type: DataTypes.INTEGER,
                allowNull: false,
                defaultValue: 0,
            },
            yookassa_payment_method_id: {
                type: DataTypes.STRING,
                allowNull: true,
            },
            yookassa_payment_method_saved_at: {
                type: DataTypes.DATE,
                allowNull: true,
            },

            tbankRebillId: {
                type: DataTypes.STRING(128),
                allowNull: true,
                field: "tbank_rebill_id",
            },

            tbankCardId: {
                type: DataTypes.STRING(128),
                allowNull: true,
                field: "tbank_card_id",
            },

            tbankCardMask: {
                type: DataTypes.STRING(32),
                allowNull: true,
                field: "tbank_card_mask",
            },

            tbankCardBoundAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "tbank_card_bound_at",
            },

            autoCommissionProvider: {
                type: DataTypes.ENUM(
                    "none",
                    "yookassa",
                    "tbank"
                ),
                allowNull: false,
                defaultValue: "none",
                field: "auto_commission_provider",
            },
            locationAddress: {
                type: DataTypes.TEXT,
                allowNull: true,
                field: "location_address",
            },
            locationLat: {
                type: DataTypes.DECIMAL(10, 7),
                allowNull: true,
                field: "location_lat",
            },
            locationLng: {
                type: DataTypes.DECIMAL(10, 7),
                allowNull: true,
                field: "location_lng",
            },
            locationSource: {
                type: DataTypes.ENUM("gps", "manual", "map"),
                allowNull: true,
                field: "location_source",
            },
            locationUpdatedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "location_updated_at",
            },
            preferredCategoryIds: {
                type: DataTypes.JSON,
                allowNull: false,
                defaultValue: [],
                field: "preferred_category_ids",
            },
            avatar: {
                type: DataTypes.STRING,
                allowNull: true,
            },
            vehicleBrand: {
                type: DataTypes.STRING(100),
                allowNull: true,
                field: "vehicle_brand",
            },
            vehicleModel: {
                type: DataTypes.STRING(100),
                allowNull: true,
                field: "vehicle_model",
            },
            vehicleColor: {
                type: DataTypes.STRING(100),
                allowNull: true,
                field: "vehicle_color",
            },
            vehiclePlate: {
                type: DataTypes.STRING(30),
                allowNull: true,
                field: "vehicle_plate",
            },
            vehicleYear: {
                type: DataTypes.INTEGER,
                allowNull: true,
                field: "vehicle_year",
            },
            vehiclePhoto: {
                type: DataTypes.STRING,
                allowNull: true,
                field: "vehicle_photo",
            },
            vehicleVerificationStatus: {
                type: DataTypes.ENUM(
                    "none",
                    "pending",
                    "verified",
                    "rejected"
                ),
                allowNull: false,
                defaultValue: "none",
                field: "vehicle_verification_status",
            },
            vehicleVerificationNote: {
                type: DataTypes.STRING(500),
                allowNull: true,
                field: "vehicle_verification_note",
            },
            premium_last_payment_id: {
                type: DataTypes.STRING,
                allowNull: true,
            },
        },
        {
            sequelize,
            modelName: 'User',
            tableName: 'users',
        }
    );

    return User;
};
