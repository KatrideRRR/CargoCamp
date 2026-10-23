
require("dotenv").config();

const {
    sequelize,
} = require("../models");

const {
    getSignaturePolicy,
} = require("../config/signaturePolicy");

const {
    archiveSignaturePolicy,
} = require(
    "../services/signaturePolicyArchiveService"
);

async function main() {
    try {
        await sequelize.authenticate();

        const policy =
            getSignaturePolicy();

        const result =
            await archiveSignaturePolicy(
                policy
            );

        console.log({
            archiveId:
                String(result.record.id),

            version:
            result.record.policyVersion,

            sha256:
            result.record.policySha256,

            created:
            result.created,

            enabled:
            policy.enabled,
        });

    } finally {
        await sequelize.close();
    }
}

main().catch((error) => {
    console.error(
        "Не удалось архивировать правила ПЭП:",
        error.message
    );

    process.exitCode = 1;
});
