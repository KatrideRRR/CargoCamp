const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

const generateVerifiedCompletionActPDF =
    require("../utils/generateVerifiedCompletionActPDF");

const {
    renderHtml,
} = require("../utils/generateVerifiedCompletionActPDF");

const INITIAL_TIME = "2026-11-10T08:00:00.000Z";
const ACCEPTED_TIME = "2026-11-10T10:20:00.000Z";

const customer = {
    userId: 2,
    qualityDecision: "accepted",
    originalQualityDecision: "remarks",
    originalRemarks:
        "При перевозке повреждён корпус шкафа.",
    remarks: null,
    confirmedAt: INITIAL_TIME,
    acceptedAfterCorrectionsAt: ACCEPTED_TIME,
    cashAmountKopecks: 50000,
    payoutAuthorized: false,
};

const paymentEvidence = {
    paymentType: "cash",
    customer,

    executor: {
        userId: 1,
        confirmedAt: INITIAL_TIME,
        cashAmountKopecks: 50000,
    },

    cashReconciled: true,

    corrections: [
        {
            roundNumber: 1,
            eventType: "submitted",
            actorUserId: 1,
            comment:
                "Повреждённая деталь заменена.",
            eventAt:
                "2026-11-10T09:00:00.000Z",
        },
        {
            roundNumber: 1,
            eventType: "accepted",
            actorUserId: 2,
            comment: "",
            eventAt: ACCEPTED_TIME,
        },
    ],
};

const assignment = {
    id: 501,
    orderId: 101,
    type: "verified_assignment",
    version: 1,
    status: "fully_signed",
    fullySignedAt: new Date(INITIAL_TIME),
    documentNumber: "CC-ASSIGN-101",
    documentHash: "b".repeat(64),

    metadata: {
        snapshot: {
            customer: {
                profileName: "Заказчик",
            },

            executor: {
                profileName: "Исполнитель",
            },

            terms: {
                priceKopecks: 50000,
                category: "Грузоперевозка",
                service: "Перевозка мебели",
                description:
                    "Перевезти мебель без повреждений",
                address:
                    "Симферополь, улица Пушкина",
                paymentType: "cash",
            },
        },
    },
};

const order = {
    id: 101,
    creatorId: 2,
    executorId: 1,
    status: "completed",
    completedBy: [1, 2],
    completedAt: new Date(ACCEPTED_TIME),
    workStartedAt: new Date(INITIAL_TIME),
    workEndedAt: new Date(ACCEPTED_TIME),
    paymentType: "cash",
    proposedSum: 500,
    finalPriceKopecks: 50000,
};

test(
    "PDF корректно отражает приёмку после устранения замечаний",
    () => {
        const html = renderHtml(
            {
                paymentType: "cash",
                originalPriceKopecks: 50000,
                finalPriceKopecks: 50000,
                addenda: [],
                disputes: [],
                paymentEvidence,
            },
            {
                sections: [],
            }
        );

        assert.match(
            html,
            /Работы приняты после устранения замечаний/
        );

        assert.match(
            html,
            /Дата окончательной приёмки/
        );

        assert.match(
            html,
            /При перевозке повреждён корпус шкафа/
        );

        assert.match(
            html,
            /История устранения замечаний/
        );

        assert.doesNotMatch(
            html,
            /Работы приняты без замечаний на момент подтверждения/
        );
    }
);

test(
    "реальный PDF: SHA-256, повторное создание и обнаружение подмены",
    async () => {
        const root = await fs.mkdtemp(
            path.join(
                os.tmpdir(),
                "cargocamp-act-integrity-"
            )
        );

        let savedContract = null;
        let createCount = 0;

        const events = [];

        try {
            const models = {
                sequelize: {
                    transaction: async (callback) =>
                        callback({}),
                },

                Contract: {
                    findOne: async ({ where }) => {
                        if (
                            where.type ===
                            "verified_assignment"
                        ) {
                            return assignment;
                        }

                        if (
                            where.type ===
                            "verified_completion_act"
                        ) {
                            return savedContract;
                        }

                        return null;
                    },

                    create: async (data) => {
                        createCount++;

                        savedContract = {
                            id: 601,
                            ...data,
                        };

                        return savedContract;
                    },
                },

                ContractEvent: {
                    create: async (data) => {
                        events.push(data);
                        return data;
                    },
                },
            };

            const dependencies = {
                "fs/promises": fs,
                path,
                crypto,

                "./orderPhotoAnnexService": {
                    collectOrderPhotoAnnex:
                        async () => ({
                            manifest: [],
                            sections: [],
                        }),
                },

                "./completionActEvidenceService": {
                    buildCompletionActEvidence:
                        async () => ({
                            originalPriceKopecks:
                                50000,

                            finalPriceKopecks:
                                50000,

                            addenda: [],
                            disputes: [],
                            disputesCapturedAt:
                            ACCEPTED_TIME,
                        }),
                },

                "./completionPaymentSnapshotService": {
                    buildCompletionPaymentSnapshot:
                        async () =>
                            paymentEvidence,
                },

                "../models": models,

                "../config/storagePaths": {
                    contractsRoot: root,
                },

                "../utils/generateVerifiedCompletionActPDF":
                generateVerifiedCompletionActPDF,
            };

            const service = loadIsolatedService(
                "verifiedCompletionActService.js",
                dependencies
            );

            const integrity = loadIsolatedService(
                "verifiedPdfIntegrity.js",
                {
                    "fs/promises": fs,
                    path,
                    crypto,

                    "../config/storagePaths": {
                        contractsRoot: root,
                    },
                }
            );

            // Генерируем настоящий PDF через Puppeteer.
            const first =
                await service.createVerifiedCompletionActIfEligible(
                    order
                );

            assert.equal(first.created, true);
            assert.equal(createCount, 1);
            assert.ok(savedContract);

            assert.equal(
                savedContract.type,
                "verified_completion_act"
            );

            assert.equal(savedContract.version, 1);
            assert.equal(savedContract.status, "draft");

            assert.match(
                savedContract.documentHash,
                /^[a-f0-9]{64}$/
            );

            // Читаем PDF с настоящего диска.
            const filePath = path.join(
                root,
                savedContract.storageKey
            );

            const originalPdf =
                await fs.readFile(filePath);

            assert.ok(originalPdf.length > 100);

            assert.equal(
                originalPdf
                    .subarray(0, 5)
                    .toString("ascii"),
                "%PDF-"
            );

            // Независимо пересчитываем SHA-256.
            const calculatedHash = crypto
                .createHash("sha256")
                .update(originalPdf)
                .digest("hex");

            assert.equal(
                savedContract.documentHash,
                calculatedHash
            );

            // Проверяем настоящим сервисом целостности.
            assert.equal(
                await integrity.assertVerifiedPdfIntegrity(
                    savedContract
                ),
                calculatedHash
            );

            // Событие приёмки относится к этому PDF.
            const decisionEvent = events.find(
                (event) =>
                    event.eventType ===
                    "act_customer_decision"
            );

            assert.ok(decisionEvent);

            assert.equal(
                decisionEvent.metadata.documentHash,
                calculatedHash
            );

            assert.equal(
                decisionEvent.metadata.decision,
                "accepted"
            );

            assert.equal(
                decisionEvent.metadata.source,
                "completion_correction_review"
            );

            assert.equal(
                new Date(
                    decisionEvent.eventAt
                ).toISOString(),
                ACCEPTED_TIME
            );

            // Повторный запрос не создаёт акт заново.
            const second =
                await service.createVerifiedCompletionActIfEligible(
                    order
                );

            assert.equal(second.created, false);
            assert.equal(createCount, 1);
            assert.equal(events.length, 2);

            // Подменяем содержимое сохранённого PDF.
            await fs.writeFile(
                filePath,
                Buffer.concat([
                    originalPdf,
                    Buffer.from("\n%modified"),
                ])
            );

            await assert.rejects(
                integrity.assertVerifiedPdfIntegrity(
                    savedContract
                ),
                {
                    httpStatus: 409,
                    message:
                        "Нарушена целостность документа",
                }
            );

            // Возвращаем исходные байты документа.
            await fs.writeFile(
                filePath,
                originalPdf
            );

            assert.equal(
                await integrity.assertVerifiedPdfIntegrity(
                    savedContract
                ),
                calculatedHash
            );

            // Подмена SHA-256 в записи договора.
            await assert.rejects(
                integrity.assertVerifiedPdfIntegrity({
                    ...savedContract,
                    documentHash: "f".repeat(64),
                }),
                {
                    httpStatus: 409,
                    message:
                        "Нарушена целостность документа",
                }
            );

            // Недопустимый путь запрещён.
            await assert.rejects(
                integrity.assertVerifiedPdfIntegrity({
                    ...savedContract,
                    storageKey: "../../outside.pdf",
                }),
                {
                    httpStatus: 409,
                    message: "Некорректный путь PDF",
                }
            );

            // Проверяем защиту от symlink:
            // файл лежит за пределами verified.
            const outsideFile = path.join(
                root,
                "outside.pdf"
            );

            await fs.writeFile(
                outsideFile,
                originalPdf
            );

            const linkName =
                `verified_completion_act_101_v1_` +
                `${crypto.randomUUID()}.pdf`;

            const linkPath = path.join(
                root,
                "verified",
                linkName
            );

            await fs.symlink(
                outsideFile,
                linkPath
            );

            await assert.rejects(
                integrity.assertVerifiedPdfIntegrity({
                    ...savedContract,
                    storageKey:
                        `verified/${linkName}`,
                }),
                {
                    httpStatus: 409,
                    message:
                        "Недопустимое расположение файла",
                }
            );

        } finally {
            // Удаляем только нашу временную папку.
            await fs.rm(root, {
                recursive: true,
                force: true,
            });
        }
    }
);