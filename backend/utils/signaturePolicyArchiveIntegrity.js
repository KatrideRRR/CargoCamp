
const crypto = require("crypto");

function sha256(text) {
    if (typeof text !== "string") {
        throw new TypeError(
            "Текст правил ПЭП должен быть строкой"
        );
    }

    return crypto
        .createHash("sha256")
        .update(text, "utf8")
        .digest("hex");
}

function validatePolicyRevision(
    archived,
    expected
) {
    if (!archived || !expected) {
        return false;
    }

    if (
        archived.jurisdiction !==
        expected.jurisdiction ||

        archived.policyCode !==
        expected.code ||

        archived.policyVersion !==
        expected.version
    ) {
        return false;
    }

    const storedHash =
        String(
            archived.policySha256 || ""
        ).toLowerCase();

    const expectedHash =
        String(
            expected.sha256 || ""
        ).toLowerCase();

    if (
        !/^[a-f0-9]{64}$/.test(storedHash) ||
        !/^[a-f0-9]{64}$/.test(expectedHash)
    ) {
        return false;
    }

    return (
        storedHash === expectedHash &&
        sha256(archived.policyText) ===
        storedHash
    );
}

module.exports = {
    sha256,
    validatePolicyRevision,
};
