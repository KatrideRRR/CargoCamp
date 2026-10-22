
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const {
    contractsRoot,
} = require("../config/storagePaths");

const ALLOWED_TYPES = new Set([
    "verified_assignment",
    "verified_completion_act",
]);

function integrityError(message) {
    return Object.assign(
        new Error(message),
        { httpStatus: 409 }
    );
}

async function assertVerifiedPdfIntegrity(contract) {
    const type = String(contract?.type || "");

    if (!ALLOWED_TYPES.has(type)) {
        throw integrityError(
            "Недопустимый тип документа"
        );
    }

    const orderId = String(contract.orderId);
    const version = String(contract.version);

    if (
        !/^[1-9]\d*$/.test(orderId) ||
        !/^[1-9]\d*$/.test(version)
    ) {
        throw integrityError(
            "Некорректные реквизиты документа"
        );
    }

    const storageKey = String(
        contract.storageKey || ""
    );

    const prefix =
        `verified/${type}_${orderId}_v${version}_`;

    const uuidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/i;

    if (
        !storageKey.startsWith(prefix) ||
        !uuidPattern.test(
            storageKey.slice(prefix.length)
        )
    ) {
        throw integrityError(
            "Некорректный путь PDF"
        );
    }

    const expectedHash = String(
        contract.documentHash || ""
    ).toLowerCase();

    if (!/^[a-f0-9]{64}$/.test(expectedHash)) {
        throw integrityError(
            "Некорректная контрольная сумма"
        );
    }

    const fileName =
        storageKey.slice("verified/".length);

    const root = path.join(
        contractsRoot,
        "verified"
    );

    const file = path.join(
        root,
        fileName
    );

    let realRoot;
    let realFile;
    let pdf;

    try {
        realRoot = await fs.realpath(root);
        realFile = await fs.realpath(file);

        if (path.dirname(realFile) !== realRoot) {
            throw integrityError(
                "Недопустимое расположение файла"
            );
        }

        pdf = await fs.readFile(realFile);

    } catch (error) {
        if (
            error.code === "ENOENT" ||
            error.code === "EACCES"
        ) {
            throw integrityError(
                "Файл документа недоступен"
            );
        }

        throw error;
    }

    if (
        pdf.length < 100 ||
        pdf.subarray(0, 5)
            .toString("ascii") !== "%PDF-"
    ) {
        throw integrityError(
            "Некорректный PDF"
        );
    }

    const actualHash = crypto
        .createHash("sha256")
        .update(pdf)
        .digest("hex");

    if (actualHash !== expectedHash) {
        throw integrityError(
            "Нарушена целостность документа"
        );
    }

    return actualHash;
}

module.exports = {
    assertVerifiedPdfIntegrity,
};
