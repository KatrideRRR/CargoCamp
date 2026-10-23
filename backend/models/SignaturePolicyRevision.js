
const { Model, DataTypes } =
    require("sequelize");

module.exports = (sequelize) => {
    class SignaturePolicyRevision extends Model {}

    SignaturePolicyRevision.init(
        {
            id: {
                type: DataTypes.BIGINT.UNSIGNED,
                primaryKey: true,
                autoIncrement: true,
            },

            jurisdiction: {
                type: DataTypes.STRING(16),
                allowNull: false,
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

            policyText: {
                type: DataTypes.TEXT("long"),
                allowNull: false,
                field: "policy_text",
            },

            archivedAt: {
                type: DataTypes.DATE,
                allowNull: false,
                defaultValue: DataTypes.NOW,
                field: "archived_at",
            },
        },
        {
            sequelize,
            modelName: "SignaturePolicyRevision",
            tableName: "signature_policy_revisions",
            timestamps: false,
        }
    );

    /*
     * Блокируем изменения через Sequelize.
     * Дополнительная защита на уровне
     * прав MySQL настраивается отдельно.
     */
    const readonlyError = () => {
        throw new Error(
            "Архивные редакции ПЭП нельзя изменять или удалять"
        );
    };

    for (const hook of [
        "beforeUpdate",
        "beforeBulkUpdate",
        "beforeDestroy",
        "beforeBulkDestroy",
    ]) {
        SignaturePolicyRevision.addHook(
            hook,
            readonlyError
        );
    }

    return SignaturePolicyRevision;
};
