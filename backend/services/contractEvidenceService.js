
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

const ALLOWED_TYPES = [
    "verified_assignment",
    "verified_completion_act",
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

    const agreementIds = [
        ...new Set(
            challenges
                .map((challenge) =>
                    String(challenge.agreementId)
                )
                .filter((id) =>
                    /^[1-9]\d*$/.test(id)
                )
        ),
    ];

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


        const challengeId =
            signature.evidence?.challengeId;

        const challenge = challenges.find(
            (item) =>
                String(item.id) ===
                String(challengeId || "")
        );

        if (
            !challenge ||
            challenge.status !== "consumed" ||
            !challenge.consumedAt ||
            !challenge.verifiedAt ||
            Number(challenge.userId) !==
            Number(signature.userId) ||
            challenge.partyRole !==
            signature.partyRole ||
            !sameHash(
                challenge.documentHash,
                contract.documentHash
            )
        ) {
            warnings.push(
                `Подпись №${signature.id}: не подтверждена согласованная запись успешного SMS-вызова.`
            );
        }

        const agreementId =
            signature.evidence?.agreementId;

        const agreement =
            agreementMap.get(
                String(agreementId || "")
            );

        if (
            !agreement ||
            Number(agreement.userId) !==
            Number(signature.userId) ||
            !sameHash(
                agreement.policySha256,
                signature.evidence?.policySha256
            ) ||
            String(agreement.policyVersion) !==
            String(signature.signaturePolicyVersion)
        ) {
            warnings.push(
                `Подпись №${signature.id}: отсутствует согласованная запись принятия правил ПЭП.`
            );
        }

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

                ipAddress:
                signature.ipAddress,

                userAgent:
                signature.userAgent,
            })
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
