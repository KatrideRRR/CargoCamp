const test = require("node:test");
const assert = require("node:assert/strict");

const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

const originalTime = "2026-11-09T10:00:00.000Z";
const correctionTime = "2026-11-09T14:00:00.000Z";

async function generateAct(customerDecision) {
    const events = [];
    let createdContract = null;

    const assignment = {
        id: 501,
        orderId: 101,
        type: "verified_assignment",
        documentNumber: "CC-501",
        documentHash: "b".repeat(64),
        metadata: {
            snapshot: {
                terms: {
                    priceKopecks: 50000,
                },
            },
        },
    };

    const service = loadIsolatedService(
        "verifiedCompletionActService.js",
        {
            "fs/promises": {
                mkdir: async () => {},
                writeFile: async () => {},
                rm: async () => {},
            },

            path: require("node:path"),
            crypto: require("node:crypto"),

            "./orderPhotoAnnexService": {
                collectOrderPhotoAnnex: async () => ({
                    manifest: [],
                }),
            },

            "./completionActEvidenceService": {
                buildCompletionActEvidence: async () => ({
                    originalPriceKopecks: 50000,
                    finalPriceKopecks: 50000,
                    addenda: [],
                    disputes: [],
                }),
            },

            "./completionPaymentSnapshotService": {
                buildCompletionPaymentSnapshot: async () => ({
                    customer: customerDecision,
                    corrections: [],
                    paymentType: "cash",
                }),
            },

            "../models": {
                sequelize: {
                    transaction: async (callback) =>
                        callback({}),
                },

                Contract: {
                    findOne: async ({ where }) =>
                        where.type === "verified_assignment"
                            ? assignment
                            : null,

                    create: async (data) => {
                        createdContract = {
                            id: 601,
                            ...data,
                        };

                        return createdContract;
                    },
                },

                ContractEvent: {
                    create: async (data) => {
                        events.push(data);
                        return data;
                    },
                },
            },

            "../config/storagePaths": {
                contractsRoot: "/tmp/cargocamp-test-contracts",
            },

            "../utils/generateVerifiedCompletionActPDF":
                async () => Buffer.concat([
                    Buffer.from("%PDF-1.4\n"),
                    Buffer.alloc(120),
                ]),
        }
    );

    const order = {
        id: 101,
        creatorId: 1,
        executorId: 2,
        status: "completed",
        completedAt: new Date(),
        completedBy: [1, 2],
        paymentType: "cash",
        proposedSum: 500,
    };

    await service.createVerifiedCompletionActIfEligible(
        order
    );

    return {
        events,
        createdContract,
        decision: events.find(
            (event) =>
                event.eventType ===
                "act_customer_decision"
        ),
    };
}

test(
    "обычная приёмка сохраняет время первоначального подтверждения",
    async () => {
        const result = await generateAct({
            qualityDecision: "accepted",
            originalQualityDecision: "accepted",
            originalRemarks: null,
            remarks: null,
            confirmedAt: originalTime,
            acceptedAfterCorrectionsAt: null,
        });

        assert.ok(result.decision);

        assert.equal(
            new Date(result.decision.eventAt).toISOString(),
            originalTime
        );

        assert.equal(
            result.decision.metadata.source,
            "completion_modal"
        );

        assert.equal(
            result.decision.metadata.decision,
            "accepted"
        );
    }
);

test(
    "после исправлений используется время окончательной приёмки",
    async () => {
        const result = await generateAct({
            qualityDecision: "accepted",
            originalQualityDecision: "remarks",
            originalRemarks:
                "Исполнитель повредил шкаф при перевозке.",
            remarks: null,
            confirmedAt: originalTime,
            acceptedAfterCorrectionsAt: correctionTime,
        });

        assert.ok(result.decision);

        assert.equal(
            new Date(result.decision.eventAt).toISOString(),
            correctionTime
        );

        assert.equal(
            result.decision.metadata.source,
            "completion_correction_review"
        );

        assert.equal(
            result.decision.metadata.originalQualityDecision,
            "remarks"
        );

        assert.equal(
            result.decision.metadata.originalRemarks,
            "Исполнитель повредил шкаф при перевозке."
        );

        assert.equal(
            result.decision.metadata.decision,
            "accepted"
        );

        assert.equal(
            result.createdContract.metadata.snapshot
                .paymentEvidence.customer.originalRemarks,
            "Исполнитель повредил шкаф при перевозке."
        );
    }
);