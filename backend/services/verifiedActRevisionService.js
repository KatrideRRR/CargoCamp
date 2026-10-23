
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const {
    collectOrderPhotoAnnex,
} = require("./orderPhotoAnnexService");

const {
    contractsRoot,
} = require("../config/storagePaths");

const generateVerifiedCompletionActPDF =
    require("../utils/generateVerifiedCompletionActPDF");

const verifiedRoot = path.join(
    contractsRoot,
    "verified"
);

async function prepareVerifiedActV2({
                                        order,
                                        originalAct,
                                        originalRemarks,
                                        correctionEvent,
                                        reviewedAt,
                                        reviewComment,
                                    }) {
    const originalSnapshot =
        originalAct.metadata?.snapshot;

    if (
        !originalSnapshot ||
        typeof originalSnapshot !== "object" ||
        Array.isArray(originalSnapshot)
    ) {
        throw Object.assign(
            new Error(
                "Исходный акт не содержит снимок данных"
            ),
            { httpStatus: 409 }
        );
    }

    if (
        Number(originalAct.version) !== 1 ||
        originalAct.type !==
        "verified_completion_act"
    ) {
        throw Object.assign(
            new Error(
                "Нельзя выпустить новую версию этого акта"
            ),
            { httpStatus: 409 }
        );
    }

    const photoAnnex =
        await collectOrderPhotoAnnex(
            order,
            "completion"
        );

    const snapshot = {
        ...originalSnapshot,

        version: 2,

        documentNumber:
            `CC-ACT-${originalAct.orderId}-V2`,

        generatedAt:
            reviewedAt.toISOString(),

        photoManifest:
        photoAnnex.manifest,

        remediation: {

            previousActId:
                String(originalAct.id),

            previousDocumentNumber:
            originalAct.documentNumber,

            previousDocumentHash:
            originalAct.documentHash,

            originalRemarks,

            correctionEventId:
                String(correctionEvent.id),

            correctionRound:
                Number(
                    correctionEvent.metadata?.round
                ),

            executorComment:
            correctionEvent.metadata?.comment,

            submittedAt:
            correctionEvent.eventAt,

            reviewedAt,
            reviewComment,
        },
    };

    const pdfBuffer =
        await generateVerifiedCompletionActPDF(
            snapshot,
            photoAnnex
        );

    if (
        !Buffer.isBuffer(pdfBuffer) ||
        pdfBuffer.length < 100 ||
        pdfBuffer.subarray(0, 5)
            .toString("ascii") !== "%PDF-"
    ) {
        throw new Error(
            "Не удалось сформировать новую версию акта"
        );
    }

    const documentHash = crypto
        .createHash("sha256")
        .update(pdfBuffer)
        .digest("hex");

    await fs.mkdir(verifiedRoot, {
        recursive: true,
        mode: 0o700,
    });

    const fileName =
        `verified_completion_act_` +
        `${originalAct.orderId}_v2_` +
        `${crypto.randomUUID()}.pdf`;

    const storageKey =
        `verified/${fileName}`;

    const absolutePath = path.join(
        verifiedRoot,
        fileName
    );

    await fs.writeFile(
        absolutePath,
        pdfBuffer,
        {
            flag: "wx",
            mode: 0o600,
        }
    );

    return {
        snapshot,
        storageKey,
        documentHash,

        async cleanup() {
            await fs.rm(
                absolutePath,
                { force: true }
            );
        },
    };
}

module.exports = {
    prepareVerifiedActV2,
};
