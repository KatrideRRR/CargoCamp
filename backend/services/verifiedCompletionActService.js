
const fs = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

const {
    sequelize,
    Contract,
    ContractEvent,
} = require("../models");

const {
    contractsRoot,
} = require("../config/storagePaths");

const generateVerifiedCompletionActPDF =
    require("../utils/generateVerifiedCompletionActPDF");

const TYPE = "verified_completion_act";
const VERSION = 1;

const verifiedRoot = path.join(
    contractsRoot,
    "verified"
);

function parseCompletedBy(value) {
    if (Array.isArray(value)) {
        return value.map(Number);
    }

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);

            return Array.isArray(parsed)
                ? parsed.map(Number)
                : [];
        } catch {
            return [];
        }
    }

    return [];
}

function buildSnapshot(order, assignment) {
    const agreedTerms =
        assignment.metadata?.snapshot?.terms || {};

    const priceKopecks = Number(
        agreedTerms.priceKopecks ??
        order.finalPriceKopecks ??
        Math.round(Number(order.proposedSum || 0) * 100)
    );

    if (
        !Number.isSafeInteger(priceKopecks) ||
        priceKopecks <= 0
    ) {
        throw new Error(
            "Некорректная согласованная стоимость заказа"
        );
    }

    return {
        schemaVersion: 1,
        version: VERSION,

        documentNumber:
            `CC-ACT-${order.id}-V${VERSION}`,

        generatedAt: new Date().toISOString(),

        orderId: Number(order.id),

        assignmentId: String(assignment.id),
        assignmentNumber: assignment.documentNumber,
        assignmentHash: assignment.documentHash,

        customerId: Number(order.creatorId),
        customerName:
            order.creator?.username ||
            `Пользователь ${order.creatorId}`,

        executorId: Number(order.executorId),
        executorName:
            order.executor?.username ||
            `Пользователь ${order.executorId}`,

        category:
            order.category?.name || "—",

        subcategory:
            order.subcategory?.name || "—",

        address:
            agreedTerms.address ??
            order.address ??
            "—",

        description:
            agreedTerms.description ??
            order.description ??
            "—",

        priceRub: (priceKopecks / 100).toFixed(2),

        paymentType:
            agreedTerms.paymentType ??
            order.paymentType ??
            "—",

        workStartedAt:
            order.workStartedAt || null,

        workEndedAt:
            order.workEndedAt || null,

        completedAt:
        order.completedAt,
    };
}

async function createVerifiedCompletionActIfEligible(order) {
    if (!order || order.status !== "completed") {
        return null;
    }

    const creatorId = Number(order.creatorId);
    const executorId = Number(order.executorId);

    if (
        !Number.isSafeInteger(creatorId) ||
        !Number.isSafeInteger(executorId) ||
        creatorId === executorId ||
        !order.completedAt
    ) {
        return null;
    }

    const confirmed = parseCompletedBy(
        order.completedBy
    );

    if (
        !confirmed.includes(creatorId) ||
        !confirmed.includes(executorId)
    ) {
        return null;
    }

    const orderId = Number(order.id);

    const lookup = {
        orderId,
        type: TYPE,
        version: VERSION,
    };

    /*
     * Повторный запрос не создаёт
     * вторую первую версию акта.
     */
    const existing = await Contract.findOne({
        where: lookup,
    });

    if (existing) {
        return {
            contract: existing,
            created: false,
        };
    }

    /*
     * Создаём акт только у заказа,
     * для которого существует подтверждённое
     * договор-задание.

     * Подписывать само задание на этом этапе
     * ещё необязательно, так как SMS отключено.
     */
    const assignment = await Contract.findOne({
        where: {
            orderId,
            type: "verified_assignment",
        },
        order: [
            ["version", "DESC"],
            ["id", "DESC"],
        ],
    });

    if (
        !assignment ||
        !assignment.documentHash ||
        assignment.supersededAt
    ) {
        return null;
    }

    const snapshot = buildSnapshot(
        order,
        assignment
    );

    const pdfBuffer =
        await generateVerifiedCompletionActPDF(
            snapshot
        );

    if (
        pdfBuffer.length < 100 ||
        pdfBuffer.subarray(0, 5)
            .toString("ascii") !== "%PDF-"
    ) {
        throw new Error(
            "Не удалось сформировать PDF акта"
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
        `verified_completion_act_${orderId}_` +
        `v${VERSION}_${crypto.randomUUID()}.pdf`;

    const storageKey =
        `verified/${fileName}`;

    const absolutePath = path.join(
        verifiedRoot,
        fileName
    );

    let written = false;

    try {
        await fs.writeFile(
            absolutePath,
            pdfBuffer,
            {
                flag: "wx",
                mode: 0o600,
            }
        );

        written = true;

        const contract = await sequelize.transaction(
            async (transaction) => {
                const created = await Contract.create(
                    {
                        orderId,

                        parentContractId:
                        assignment.id,

                        type: TYPE,
                        version: VERSION,
                        status: "draft",

                        documentNumber:
                        snapshot.documentNumber,

                        jurisdiction: "RU",

                        templateCode:
                            "verified_completion_act_default",

                        templateVersion: "1",

                        storageKey,
                        documentHash,

                        finalizedAt: null,
                        fullySignedAt: null,

                        metadata: {
                            snapshot,
                            signatureState: "not_signed",
                            acceptanceState: "not_recorded",
                        },
                    },
                    { transaction }
                );

                await ContractEvent.create(
                    {
                        contractId: created.id,
                        actorUserId: null,
                        actorRole: "system",

                        eventType: "act_draft_created",
                        eventAt: new Date(),

                        metadata: {
                            orderId,
                            documentHash,

                            linkedAssignmentId:
                                String(assignment.id),

                            linkedAssignmentHash:
                            assignment.documentHash,
                        },
                    },
                    { transaction }
                );

                return created;
            }
        );

        return {
            contract,
            created: true,
        };

    } catch (error) {
        if (written) {
            await fs.rm(absolutePath, {
                force: true,
            }).catch((cleanupError) => {
                console.error(
                    "Не удалось очистить PDF акта:",
                    cleanupError
                );
            });
        }

        if (
            error.name ===
            "SequelizeUniqueConstraintError"
        ) {
            const winner = await Contract.findOne({
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
    createVerifiedCompletionActIfEligible,
};
