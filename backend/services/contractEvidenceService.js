
const {
    Op,
} = require("sequelize");

const {
    Order,
    Contract,
    ContractSignature,
    ContractEvent,
    SignatureChallenge,
    ElectronicSignatureAgreement,
} = require("../models");

const {
    inspectArchivedAgreement,
} = require("./signaturePolicyArchiveService");

const {
    assertVerifiedPdfIntegrity,
} = require("./verifiedPdfIntegrity");

const {
    verifyDocumentChain,
} = require("./verifiedDocumentChainService");

const {
    verifySignatureEvidence,
} = require("./contractSignatureEvidence");

const ALLOWED_TYPES = [
    "verified_assignment",
    "verified_completion_act",
    "verified_addendum",
];

function fail(status, message) {
    return Object.assign(
        new Error(message),
        { httpStatus: status }
    );
}

function sameHash(a, b) {
    return (
        /^[a-f0-9]{64}$/i.test(String(a || "")) &&
        String(a).toLowerCase() ===
        String(b || "").toLowerCase()
    );
}

function safePhotoManifest(snapshot) {
    if (!Array.isArray(snapshot?.photoManifest)) {
        return [];
    }

    return snapshot.photoManifest.map(
        (section) => ({
            field: section.field,
            title: section.title,

            photos: Array.isArray(section.photos)
                ? section.photos.map((photo) => ({
                    sourceSha256:
                    photo.sourceSha256,

                    previewSha256:
                    photo.previewSha256,

                    sourceBytes:
                    photo.sourceBytes,
                }))
                : [],
        })
    );
}

function safeEventMetadata(event) {
    const source =
        event.metadata &&
        typeof event.metadata === "object"
            ? event.metadata
            : {};

    /*
     * Белый список. Не копируем metadata
     * целиком: в будущих событиях могут
     * появиться приватные технические поля.
     */
    const allowed = [
        "decision",
        "comment",
        "reviewComment",
        "round",
        "documentHash",
        "previousDocumentHash",
        "linkedAssignmentHash",
        "revisedActId",
        "correctionEventId",
        "disputeId",
        "fullySigned",
    ];

    return Object.fromEntries(
        allowed
            .filter((key) =>
                Object.prototype.hasOwnProperty.call(
                    source,
                    key
                )
            )
            .map((key) => [
                key,
                source[key],
            ])
    );
}

async function buildContractEvidence(contractId) {
    const contract = await Contract.findOne({
        where: {
            id: contractId,
            type: {
                [Op.in]: ALLOWED_TYPES,
            },
        },
    });

    if (!contract) {
        throw fail(404, "Документ не найден");
    }

    const order = await Order.findByPk(
        contract.orderId,
        {
            attributes: [
                "id",
                "creatorId",
                "executorId",
                "status",
                "createdAt",
                "completedAt",
            ],
        }
    );

    if (!order) {
        throw fail(404, "Заказ не найден");
    }

    /*
     * Читаем сам PDF с диска и сравниваем
     * его SHA-256 с записью contracts.
     *
     * При ошибке целостности экспорт
     * считается неуспешным.
     */
    const actualPdfHash =
        await assertVerifiedPdfIntegrity(
            contract
        );

    const [
        signatures,
        challenges,
        events,
    ] = await Promise.all([
        ContractSignature.findAll({
            where: {
                contractId: contract.id,
            },

            order: [
                ["signedAt", "ASC"],
                ["id", "ASC"],
            ],

            limit: 101,
        }),

        SignatureChallenge.findAll({
            where: {
                contractId: contract.id,
            },

            order: [
                ["createdAt", "ASC"],
                ["id", "ASC"],
            ],

            limit: 501,
        }),

        ContractEvent.findAll({
            where: {
                contractId: contract.id,
            },

            order: [
                ["eventAt", "ASC"],
                ["id", "ASC"],
            ],

            limit: 1001,
        }),
    ]);

    if (
        signatures.length > 100 ||
        challenges.length > 500 ||
        events.length > 1000
    ) {
        throw fail(
            409,
            "История документа превышает лимит отчёта. Требуется расширенная выгрузка."
        );
    }

    const uniqueIds = (values) => [
        ...new Set(
            values
                .map((value) => String(value ?? ""))
                .filter((value) =>
                    /^[1-9]\d{0,19}$/.test(value)
                )
        ),
    ];

    const bootstrapIds = uniqueIds(
        signatures
            .filter((signature) =>
                signature.method === "authenticated_click"
            )
            .map((signature) =>
                signature.evidence?.bootstrapSignatureId
            )
    );

    const bootstrapSignatures = bootstrapIds.length
        ? await ContractSignature.findAll({
            where: {
                id: { [Op.in]: bootstrapIds },
            },
        })
        : [];

    const bootstrapSignatureMap = new Map(
        bootstrapSignatures.map((signature) => [
            String(signature.id),
            signature,
        ])
    );

    const bootstrapChallengeIds = uniqueIds(
        bootstrapSignatures.map(
            (signature) => signature.evidence?.challengeId
        )
    );

    const bootstrapChallenges = bootstrapChallengeIds.length
        ? await SignatureChallenge.findAll({
            where: {
                id: { [Op.in]: bootstrapChallengeIds },
            },
        })
        : [];

    const bootstrapChallengeMap = new Map(
        bootstrapChallenges.map((challenge) => [
            String(challenge.id),
            challenge,
        ])
    );

    const agreementIds = uniqueIds([
        ...challenges.map(
            (challenge) => challenge.agreementId
        ),

        ...signatures.map(
            (signature) => signature.evidence?.agreementId
        ),

        ...bootstrapSignatures.map(
            (signature) => signature.evidence?.agreementId
        ),

        ...bootstrapChallenges.map(
            (challenge) => challenge.agreementId
        ),
    ]);

    const agreements = agreementIds.length
        ? await ElectronicSignatureAgreement.findAll({
            where: {
                id: {
                    [Op.in]: agreementIds,
                },
            },
        })
        : [];

    const agreementMap = new Map(
        agreements.map((agreement) => [
            String(agreement.id),
            agreement,
        ])
    );


    const archivedAgreementMap = new Map();

    for (const agreement of agreements) {
        const inspection =
            await inspectArchivedAgreement(
                agreement
            );

        archivedAgreementMap.set(
            String(agreement.id),
            inspection
        );
    }


    const creatorId = Number(order.creatorId);
    const executorId = Number(order.executorId);

    function signatureRecorded(userId, role) {
        return signatures.some(
            (signature) =>
                Number(signature.userId) === userId &&
                signature.partyRole === role &&
                sameHash(
                    signature.documentHash,
                    contract.documentHash
                )
        );
    }

    const creatorSigned =
        signatureRecorded(
            creatorId,
            "creator"
        );

    const executorSigned =
        signatureRecorded(
            executorId,
            "executor"
        );

    const bothRecorded =
        creatorSigned &&
        executorSigned;

    const databaseFullySigned =
        contract.status === "fully_signed" &&
        Boolean(contract.fullySignedAt);

    const warnings = [];

    /*
 * Проверка цепочки документов.
 *
 * Используем идентификаторы, сохранённые
 * в момент формирования PDF.
 *
 * Не пытаемся восстановить историю по
 * текущей стоимости заказа.
 */
    const lineageSnapshot =
        contract.metadata?.snapshot || {};

    const linkedIds = [
        contract.parentContractId,

        lineageSnapshot.assignmentId,

        ...(Array.isArray(lineageSnapshot.addenda)
            ? lineageSnapshot.addenda
                .slice(0, 100)
                .map((item) => item?.contractId)
            : []),
    ]
        .filter((id) =>
            /^[1-9]\d*$/.test(String(id ?? ""))
        )
        .map(String);

    const uniqueLinkedIds = [
        ...new Set(linkedIds),
    ];

    const linkedContracts =
        uniqueLinkedIds.length
            ? await Contract.findAll({
                where: {
                    id: {
                        [Op.in]: uniqueLinkedIds,
                    },
                },
            })
            : [];

    const linkedMap = new Map(
        linkedContracts.map((item) => [
            String(item.id),
            item,
        ])
    );

    const assignmentId =
        contract.type === "verified_addendum"
            ? contract.parentContractId
            : lineageSnapshot.assignmentId;

    const linkedAssignment =
        linkedMap.get(String(assignmentId || "")) ||
        null;

    const previousAct =
        contract.type === "verified_completion_act" &&
        Number(contract.version) === 2
            ? linkedMap.get(
            String(contract.parentContractId || "")
        ) || null
            : null;

    const linkedAddenda =
        linkedContracts.filter(
            (item) => item.type === "verified_addendum"
        );

    warnings.push(
        ...verifyDocumentChain({
            contract,
            assignment: linkedAssignment,
            previousAct,
            addenda: linkedAddenda,
        })
    );

    /*
     * Проверяем, что связанные PDF физически
     * существуют и совпадают со своими SHA-256.
     */
    const linkedDocumentIntegrity = [];

    for (const item of linkedContracts) {
        let valid = false;
        let actualSha256 = null;

        try {
            actualSha256 =
                await assertVerifiedPdfIntegrity(item);

            valid = true;
        } catch (error) {
            warnings.push(
                `Связанный документ №${item.id}: ` +
                "не прошёл проверку целостности PDF."
            );
        }

        linkedDocumentIntegrity.push({
            contractId: String(item.id),
            type: item.type,
            version: item.version,
            expectedSha256: item.documentHash,
            actualSha256,
            valid,
        });
    }

    if (
        contract.type === "verified_completion_act" &&
        signatures.length > 0
    ) {
        const acceptance = [...events]
            .reverse()
            .find(
                (event) =>
                    event.eventType ===
                    "act_customer_decision"
            );

        if (
            !acceptance ||
            acceptance.metadata?.decision !==
            "accepted" ||
            Number(acceptance.actorUserId) !==
            Number(order.creatorId) ||
            !sameHash(
                acceptance.metadata?.documentHash,
                contract.documentHash
            )
        ) {
            warnings.push(
                "Подписи акта не связаны с подтверждённой приёмкой этой версии заказчиком."
            );
        }
    }

    for (const agreement of agreements) {
        const archive =
            archivedAgreementMap.get(
                String(agreement.id)
            );

        if (!archive?.valid) {
            warnings.push(
                `Соглашение №${agreement.id}: архивный текст правил ПЭП отсутствует или не прошёл SHA-256.`
            );
        }
    }

    if (
        databaseFullySigned !== bothRecorded
    ) {
        warnings.push(
            "Статус документа не согласуется с записями подписей сторон."
        );
    }

    for (const signature of signatures) {
        if (
            !sameHash(
                signature.documentHash,
                contract.documentHash
            )
        ) {
            warnings.push(
                `Контрольная сумма подписи №${signature.id} не совпадает с документом.`
            );
        }

        const agreementId = String(
            signature.evidence?.agreementId || ""
        );

        const agreement = agreementMap.get(agreementId);

        const archiveValid = Boolean(
            archivedAgreementMap.get(agreementId)?.valid
        );

        const challenge = challenges.find(
            (item) =>
                String(item.id) ===
                String(signature.evidence?.challengeId || "")
        );

        const bootstrapSignature =
            bootstrapSignatureMap.get(
                String(
                    signature.evidence?.bootstrapSignatureId || ""
                )
            );

        const bootstrapChallenge =
            bootstrapChallengeMap.get(
                String(
                    bootstrapSignature?.evidence?.challengeId || ""
                )
            );

        const signatureWarnings =
            verifySignatureEvidence({
                signature,
                agreement,
                archiveValid,
                challenge,
                bootstrapSignature,
                bootstrapChallenge,
            });

        warnings.push(...signatureWarnings);
    }

    const snapshot =
        contract.metadata?.snapshot || {};

    const evidence = {
        schemaVersion: "1.0",
        reportType:
            "cargocamp_contract_evidence",

        generatedAt:
            new Date().toISOString(),

        /*
         * Технический отчёт.
         * Не является самостоятельной
         * электронной подписью.
         */
        legalQualification:
            "technical_evidence_report",

        order: {
            id: order.id,

            creatorId:
            order.creatorId,

            executorId:
            order.executorId,

            status:
            order.status,

            createdAt:
            order.createdAt,

            completedAt:
            order.completedAt,
        },

        document: {
            id: String(contract.id),

            parentContractId:
                contract.parentContractId
                    ? String(
                        contract.parentContractId
                    )
                    : null,

            type: contract.type,
            version: contract.version,
            status: contract.status,

            documentNumber:
            contract.documentNumber,

            templateCode:
            contract.templateCode,

            templateVersion:
            contract.templateVersion,

            createdAt:
            contract.createdAt,

            finalizedAt:
            contract.finalizedAt,

            fullySignedAt:
            contract.fullySignedAt,

            supersededAt:
            contract.supersededAt,

            sha256:
            contract.documentHash,
        },

        documentChain: {
            linkedDocuments:
            linkedDocumentIntegrity,

            valid:
                !warnings.some((warning) =>
                    warning.includes("договор") ||
                    warning.includes("Акт v") ||
                    warning.includes("соглашен") ||
                    warning.includes("стоимост") ||
                    warning.includes("PDF") ||
                    warning.includes("история")
                ),
        },

        integrity: {
            checkedAt:
                new Date().toISOString(),

            pdfPresent: true,
            hashMatches: true,

            expectedSha256:
            contract.documentHash,

            actualSha256:
            actualPdfHash,
        },

        identityAtDocumentCreation: {
            creator:
                snapshot.customer?.identity || null,

            executor:
                snapshot.executor?.identity || null,
        },

        photoManifest:
            safePhotoManifest(snapshot),

        signatures: signatures.map(
            (signature) => ({
                id: String(signature.id),

                userId:
                signature.userId,

                partyRole:
                signature.partyRole,

                method:
                signature.method,

                signedAt:
                signature.signedAt,

                documentHash:
                signature.documentHash,

                verificationId:
                    signature.verificationId
                        ? String(
                            signature.verificationId
                        )
                        : null,

                verificationSnapshot:
                signature.verificationSnapshot,

                signaturePolicyCode:
                signature.signaturePolicyCode,

                signaturePolicyVersion:
                signature.signaturePolicyVersion,

                policySha256:
                    signature.evidence
                        ?.policySha256 || null,

                challengeId:
                    signature.evidence
                        ?.challengeId || null,

                agreementId:
                    signature.evidence
                        ?.agreementId || null,

                bootstrapSignatureId:
                    signature.evidence
                        ?.bootstrapSignatureId || null,

                pepEnrollmentSnapshot:
                    signature.evidence
                        ?.pepEnrollmentSnapshot || null,

                sessionId:
                    signature.evidence
                        ?.sessionId || null,

                ipAddress:
                signature.ipAddress,

                userAgent:
                signature.userAgent,
            })
        ),

        pepBootstrapProofs: bootstrapSignatures.map(
            (signature) => {
                const challenge = bootstrapChallengeMap.get(
                    String(signature.evidence?.challengeId || "")
                );

                return {
                    signatureId: String(signature.id),
                    contractId: String(signature.contractId),
                    userId: signature.userId,
                    method: signature.method,
                    signedAt: signature.signedAt,

                    documentHash:
                    signature.documentHash,

                    agreementId:
                        signature.evidence?.agreementId || null,

                    policySha256:
                        signature.evidence?.policySha256 || null,

                    challenge: challenge
                        ? {
                            id: String(challenge.id),
                            contractId: String(challenge.contractId),
                            status: challenge.status,
                            verifiedAt: challenge.verifiedAt,
                            consumedAt: challenge.consumedAt,
                            documentHash: challenge.documentHash,
                        }
                        : null,
                };
            }
        ),


        policyArchives: agreements.map(
            (agreement) => {
                const archive =
                    archivedAgreementMap.get(
                        String(agreement.id)
                    );

                return {
                    agreementId:
                        String(agreement.id),

                    userId:
                    agreement.userId,

                    acceptedAt:
                    agreement.acceptedAt,

                    jurisdiction:
                    agreement.jurisdiction,

                    policyCode:
                    agreement.policyCode,

                    version:
                    agreement.policyVersion,

                    sha256:
                    agreement.policySha256,

                    archiveId:
                        archive?.archiveId || null,

                    integrityVerified:
                        Boolean(archive?.valid),

                    /*
                     * Полный текст архивной
                     * редакции, а не текст
                     * текущей конфигурации.
                     */
                    fullText:
                        archive?.valid
                            ? archive.text
                            : null,
                };
            }
        ),
        signatureSummary: {
            creatorSigned,
            executorSigned,

            bothSignaturesRecorded:
            bothRecorded,

            databaseFullySigned,

            /*
             * Даже наличие двух записей
             * не подменяет юридическую оценку.
             */
            technicallyConsistent:
                bothRecorded &&
                databaseFullySigned &&
                warnings.length === 0,
        },

        smsChallenges: challenges.map(
            (challenge) => ({
                id: String(challenge.id),

                userId:
                challenge.userId,

                partyRole:
                challenge.partyRole,

                agreementId:
                    String(challenge.agreementId),

                status:
                challenge.status,

                createdAt:
                challenge.createdAt,

                expiresAt:
                challenge.expiresAt,

                verifiedAt:
                challenge.verifiedAt,

                consumedAt:
                challenge.consumedAt,

                attemptsCount:
                challenge.attemptsCount,

                documentHash:
                challenge.documentHash,

                agreement:
                    (() => {
                        const agreement =
                            agreementMap.get(
                                String(
                                    challenge.agreementId
                                )
                            );

                        return agreement
                            ? {
                                policyCode:
                                agreement.policyCode,

                                policyVersion:
                                agreement.policyVersion,

                                policySha256:
                                agreement.policySha256,

                                acceptedAt:
                                agreement.acceptedAt,
                            }
                            : null;
                    })(),
            })
        ),

        events: events.map(
            (event) => ({
                id: String(event.id),

                eventType:
                event.eventType,

                actorUserId:
                event.actorUserId,

                actorRole:
                event.actorRole,

                eventAt:
                event.eventAt,

                ipAddress:
                event.ipAddress,

                previousEventHash:
                event.previousEventHash,

                eventHash:
                event.eventHash,

                metadata:
                    safeEventMetadata(event),
            })
        ),

        warnings,
    };

    return {
        contract,
        order,
        evidence,
    };
}

module.exports = {
    buildContractEvidence,
};
