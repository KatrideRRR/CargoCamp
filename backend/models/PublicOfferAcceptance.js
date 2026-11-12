
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
    class PublicOfferAcceptance extends Model {}

    PublicOfferAcceptance.init(
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
            offerVersion: {
                type: DataTypes.STRING(20),
                allowNull: false,
                field: "offer_version",
            },
            offerSha256: {
                type: DataTypes.CHAR(64),
                allowNull: false,
                field: "offer_sha256",
            },
            acceptedAt: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
                field: "accepted_at",
            },
            source: {
                type: DataTypes.STRING(20),
                allowNull: false,
            },
            ipAddress: {
                type: DataTypes.STRING(64),
                field: "ip_address",
            },
            userAgent: {
                type: DataTypes.TEXT,
                field: "user_agent",
            },
        },
        {
            sequelize,
            modelName: "PublicOfferAcceptance",
            tableName: "user_public_offer_acceptances",
            timestamps: false,
        }
    );

    const immutable = () => {
        throw new Error(
            "Записи принятия оферты запрещено изменять или удалять"
        );
    };

    for (const hook of [
        "beforeUpdate",
        "beforeBulkUpdate",
        "beforeDestroy",
        "beforeBulkDestroy",
    ]) {
        PublicOfferAcceptance.addHook(hook, immutable);
    }

    return PublicOfferAcceptance;
};
