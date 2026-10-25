const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const {
    getCurrentVerifiedIdentity,
} = require("./identityStatusService");
const {
    buildOrderContractDetails,
} = require("./orderContractDetailsService");
const {
    collectOrderPhotoAnnex,
} = require("./orderPhotoAnnexService");

const {
    sequelize,
    Contract,
    ContractEvent,
} = require("../models");

const {
    contractsRoot,
} = require("../config/storagePaths");

const generateVerifiedAssignmentPDF =
    require("../utils/generateVerifiedAssignmentPDF");

const CONTRACT_TYPE = "verified_assignment";
const VERSION = 1;

const verifiedRoot = path.join(
    contractsRoot,
    "verified"
);

async function findActiveVerification(
    userId,
    now
) {
    return getCurrentVerifiedIdentity(
        userId,
        { now }
    );
}

function identitySnapshot(record, userId) {
    return {
        userId,
        verificationId: String(record.id),
        statusAtCreation: record.status,
        verifiedAt: record.verifiedAt,
        expiresAt: record.expiresAt,
        method: record.verificationMethod,
        assuranceLevel: record.assuranceLevel,
    };
}

function createSnapshot(
    order,
    creatorVerification,
    executorVerification,
    generatedAt
) {
    const orderId = Number(order.id);

    const priceKopecks =
        order.finalPriceKopecks != null
            ? Number(order.finalPriceKopecks)
            : Math.round(
                Number(order.proposedSum || 0) * 100
            );

    if (
        !Number.isSafeInteger(priceKopecks) ||
        priceKopecks <= 0
    ) {
        throw new Error(
            "Невозможно сформировать договор: " +
            "некорректная стоимость заказа"
        );
    }

    const detailSnapshot = buildOrderContractDetails(order);

    return {
        schemaVersion: 1,
        version: VERSION,

        documentNumber:
            `CC-VA-${orderId}-V${VERSION}`,

        generatedAt:
            generatedAt.toISOString(),

        customer: {
            userId: Number(order.creatorId),
            profileName:
                order.creator?.username ||
                `Пользователь ${order.creatorId}`,

            identity: identitySnapshot(
                creatorVerification,
                Number(order.creatorId)
            ),
        },

        executor: {
            userId: Number(order.executorId),
            profileName:
                order.executor?.username ||
                `Пользователь ${order.executorId}`,

            identity: identitySnapshot(
                executorVerification,
                Number(order.executorId)
            ),
        },

        terms: {
            orderId,

            service:
                order.service?.name || "—",

            isAsap:
                order.isAsap === true,

            serviceDetails:
            detailSnapshot.raw,

            serviceDetailRows:
            detailSnapshot.rows,

            category:
                order.category?.name || "—",

            subcategory:
                order.subcategory?.name || "—",

            address: order.address || "—",

            description:
                order.description || "—",

            workTime:
                order.workTime || null,

            priceKopecks,

            paymentType:
                order.paymentType || "—",
        },
    };
}

async function createVerifiedAssignmentIfEligible(order) {
    if (
        !order ||
        !order.id ||
        !order.creatorId ||
        !order.executorId
    ) {
        return null;
    }

    const orderId = Number(order.id);

    if (
        Number(order.creatorId) ===
        Number(order.executorId)
    ) {
        return null;
    }

    /*
     * Идемпотентность:
     * повторный вызов не создаёт вторую
     * первую версию документа.
     */
    const lookup = {
        orderId,
        type: CONTRACT_TYPE,
        version: VERSION,
    };

    const existing = await Contract.findOne({
        where: lookup,
    });

    if (existing) {
        return {
            contract: existing,
            created: false,
        };
    }

    const now = new Date();

    const [
        creatorVerification,
        executorVerification,
    ] = await Promise.all([
        findActiveVerification(order.creatorId, now),
        findActiveVerification(order.executorId, now),
    ]);

    /*
     * Если хотя бы одна сторона не подтверждена,
     * остаётся действующий обычный договор.
     */
    if (
        !creatorVerification ||
        !executorVerification
    ) {
        return null;
    }

    const snapshot = createSnapshot(
        order,
        creatorVerification,
        executorVerification,
        now
    );

    const photoAnnex =
        await collectOrderPhotoAnnex(
            order,
            "assignment"
        );

    snapshot.photoManifest =
        photoAnnex.manifest;

    await fs.mkdir(verifiedRoot, {
        recursive: true,
        mode: 0o700,
    });

    /*
     * Уникальное имя исключает перезапись
     * старой версии даже при повторных запросах.
     */
    const fileName =
        `verified_assignment_${orderId}_v${VERSION}_` +
        `${crypto.randomUUID()}.pdf`;

    const storageKey =
        `verified/${fileName}`;

    const absolutePath = path.join(
        verifiedRoot,
        fileName
    );

    let fileWritten = false;

    try {
        const pdfBuffer =
            await generateVerifiedAssignmentPDF(
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
                "Генератор вернул некорректный PDF"
            );
        }

        const documentHash = crypto
            .createHash("sha256")
            .update(pdfBuffer)
            .digest("hex");

        await fs.writeFile(
            absolutePath,
            pdfBuffer,
            {
                flag: "wx",
                mode: 0o600,
            }
        );

        fileWritten = true;

        const contract =
            await sequelize.transaction(
                async (transaction) => {
                    const created =
                        await Contract.create(
                            {
                                orderId,
                                parentContractId: null,

                                type: CONTRACT_TYPE,
                                version: VERSION,
                                status: "draft",

                                documentNumber:
                                snapshot.documentNumber,

                                jurisdiction: "RU",

                                templateCode:
                                    "verified_assignment_default",

                                templateVersion: "5",

                                storageKey,
                                documentHash,

                                finalizedAt: null,
                                fullySignedAt: null,

                                metadata: {
                                    snapshot,

                                    signatureState:
                                        "not_signed",
                                },
                            },
                            {transaction}
                        );

                    await ContractEvent.create(
                        {
                            contractId: created.id,

                            actorUserId: null,
                            actorRole: "system",

                            eventType:
                                "draft_created",

                            eventAt: now,

                            metadata: {
                                documentHash,
                                documentNumber:
                                snapshot.documentNumber,

                                creatorVerificationId:
                                    String(
                                        creatorVerification.id
                                    ),

                                executorVerificationId:
                                    String(
                                        executorVerification.id
                                    ),
                            },
                        },
                        {transaction}
                    );

                    return created;
                }
            );

        return {
            contract,
            created: true,
        };

    } catch (error) {
        if (fileWritten) {
            await fs.rm(absolutePath, {
                force: true,
            }).catch((cleanupError) => {
                console.error(
                    "Не удалось очистить PDF:",
                    cleanupError
                );
            });
        }

        /*
         * Если два запроса одновременно пытались
         * создать v1, уникальный индекс
         * предотвращает дублирование.
         */
        if (
            error.name ===
            "SequelizeUniqueConstraintError"
        ) {
            const winner =
                await Contract.findOne({
                    where: lookup,
                });

            if (winner) {
                return {
                    contract: winner,
                    created: false,
                };
            }
        }

        throw error;
    }
}

module.exports = {
    createVerifiedAssignmentIfEligible,
};
