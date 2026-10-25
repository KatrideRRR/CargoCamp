
module.exports = (sequelize, DataTypes) => {
    return sequelize.define(
        "PepEnrollment",
        {
            id: {
                type: DataTypes.BIGINT.UNSIGNED,
                primaryKey: true,
                autoIncrement: true,
            },
            userId: {
                type: DataTypes.INTEGER,
                allowNull: false,
                unique: true,
                field: "user_id",
            },
            agreementId: {
                type: DataTypes.BIGINT.UNSIGNED,
                allowNull: false,
                field: "agreement_id",
            },
            verificationId: {
                type: DataTypes.BIGINT.UNSIGNED,
                allowNull: false,
                field: "verification_id",
            },
            bootstrapSignatureId: {
                type: DataTypes.BIGINT.UNSIGNED,
                allowNull: false,
                field: "bootstrap_signature_id",
            },
            bootstrapChallengeId: {
                type: DataTypes.BIGINT.UNSIGNED,
                allowNull: false,
                field: "bootstrap_challenge_id",
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
            phoneFingerprint: {
                type: DataTypes.CHAR(64),
                allowNull: false,
                field: "phone_fingerprint",
            },
            activatedAt: {
                type: DataTypes.DATE,
                allowNull: false,
                field: "activated_at",
            },
            expiresAt: {
                type: DataTypes.DATE,
                allowNull: false,
                field: "expires_at",
            },
            revokedAt: {
                type: DataTypes.DATE,
                allowNull: true,
                field: "revoked_at",
            },
            revokedBy: {
                type: DataTypes.INTEGER,
                allowNull: true,
                field: "revoked_by",
            },
            revokeReason: {
                type: DataTypes.STRING(255),
                allowNull: true,
                field: "revoke_reason",
            },
        },
        {
            sequelize,
            tableName: "pep_enrollments",
            timestamps: false,
        }
    );
};
