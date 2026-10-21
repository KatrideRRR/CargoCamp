const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const {contractsRoot} =
    require("../config/storagePaths");

async function assertVerifiedPdfIntegrity(contract) {
    const key = String(contract.storageKey || "");
    const expectedName =
        `verified_assignment_${contract.orderId}` +
        `_v${contract.version}_`;

    const match = /^verified\/([^/]+\.pdf)$/i.exec(key);

    if (
        !match ||
        !match[1].startsWith(expectedName) ||
        !/^verified_assignment_\d+_v\d+_[0-9a-f-]{36}\.pdf$/i
            .test(match[1]) ||
        !/^[0-9a-f]{64}$/i.test(contract.documentHash || "")
    ) {
        throw Object.assign(
            new Error("Некорректные данные PDF"),
            {httpStatus: 409}
        );
    }

    const root = path.join(contractsRoot, "verified");
    const file = path.join(root, match[1]);

    const realRoot = await fs.realpath(root);
    const realFile = await fs.realpath(file);

    if (path.dirname(realFile) !== realRoot) {
        throw Object.assign(
            new Error("Недопустимый путь документа"),
            {httpStatus: 409}
        );
    }

    const pdf = await fs.readFile(realFile);

    const actualHash = crypto
        .createHash("sha256")
        .update(pdf)
        .digest("hex");

    if (
        pdf.subarray(0, 5).toString("ascii") !== "%PDF-" ||
        actualHash !== contract.documentHash.toLowerCase()
    ) {
        throw Object.assign(
            new Error("Нарушена целостность договора"),
            {httpStatus: 409}
        );
    }

    return actualHash;
}

module.exports = {assertVerifiedPdfIntegrity};
