
require("dotenv").config();

const { Op } = require("sequelize");

const {
    sequelize,
    Order,
    Contract,
} = require("../models");

const {
    getCurrentIdentityVerification,
} = require("../services/identityStatusService");

const {
    buildContractEvidence,
} = require("../services/contractEvidenceService");

function safeId(value) {
    return /^[1-9]\d*$/.test(
        String(value || "")
    );
}

function countPhotos(manifest) {
    if (!Array.isArray(manifest)) {
        return 0;
    }

    return manifest.reduce(
        (total, section) =>
            total +
            (
                Array.isArray(section.photos)
                    ? section.photos.length
                    : 0
            ),
        0
    );
}

function latestActDecision(events) {
    const decisions = events.filter(
        (event) =>
            event.eventType ===
            "act_customer_decision"
    );

    return decisions.length
        ? decisions[decisions.length - 1]
        .metadata?.decision || null
        : null;
}

async function main() {
    const orderId = process.argv[2];

    if (!safeId(orderId)) {
        console.error(
            "Использование: node scripts/auditOrderContracts.js <orderId>"
        );

        process.exitCode = 2;
        return;
    }

    await sequelize.authenticate();

    const order = await Order.findByPk(
        orderId,
        {
            attributes: [
                "id",
                "creatorId",
                "executorId",
                "status",
                "paymentType",
                "finalPriceKopecks",
                "completedAt",
            ],
        }
    );

    if (!order) {
        console.error(
            `Заказ №${orderId} не найден`
        );

        process.exitCode = 2;
        return;
    }

    const [
        customerVerification,
        executorVerification,
        contracts,
    ] = await Promise.all([
        getCurrentIdentityVerification(
            order.creatorId
        ),

        order.executorId
            ? getCurrentIdentityVerification(
                order.executorId
            )
            : Promise.resolve(null),

        Contract.findAll({
            where: {
                orderId: order.id,

                type: {
                    [Op.in]: [
                        "verified_assignment",
                        "verified_completion_act",
                    ],
                },
            },

            order: [
                ["createdAt", "ASC"],
                ["id", "ASC"],
            ],
        }),
    ]);

    const issues = [];
    const notes = [];
    const reports = [];

    const contractById = new Map(
        contracts.map((contract) => [
            String(contract.id),
            contract,
        ])
    );

    if (
        contracts.length === 0 &&
        order.executorId
    ) {
        notes.push(
            "Подтверждённые документы отсутствуют. Проверьте, были ли обе стороны верифицированы на момент назначения исполнителя."
        );
    }

    for (const contract of contracts) {
        const report = {
            contractId: String(contract.id),

            type: contract.type,
            version: contract.version,
            status: contract.status,

            documentNumber:
            contract.documentNumber,

            pdfIntegrity: false,

            creatorSigned: false,
            executorSigned: false,

            technicallyConsistent: false,

            actDecision: null,
            photoCount: 0,

            warnings: [],
        };

        if (contract.type === "verified_completion_act") {
            const parent = contract.parentContractId
                ? contractById.get(
                    String(contract.parentContractId)
                )
                : null;

            const expectedParentType =
                Number(contract.version) === 1
                    ? "verified_assignment"
                    : "verified_completion_act";

            if (
                !parent ||
                parent.type !== expectedParentType ||
                Number(parent.orderId) !==
                Number(contract.orderId) ||
                (
                    Number(contract.version) > 1 &&
                    Number(parent.version) !==
                    Number(contract.version) - 1
                )
            ) {
                const warning =
                    "Нарушена связь между договором и версиями актов.";

                report.warnings.push(warning);

                issues.push({
                    contractId: report.contractId,
                    reason: warning,
                });
            }
        }

        try {
            const { evidence } =
                await buildContractEvidence(
                    contract.id
                );

            report.pdfIntegrity =
                evidence.integrity
                    ?.hashMatches === true;

            report.creatorSigned =
                evidence.signatureSummary
                    ?.creatorSigned === true;

            report.executorSigned =
                evidence.signatureSummary
                    ?.executorSigned === true;

            report.technicallyConsistent =
                evidence.signatureSummary
                    ?.technicallyConsistent === true;

            report.actDecision =
                latestActDecision(
                    evidence.events || []
                );

            report.photoCount =
                countPhotos(
                    evidence.photoManifest
                );

            report.warnings.push(
                ...(evidence.warnings || [])
            );

            for (const warning of
            evidence.warnings || []) {
                issues.push({
                    contractId:
                    report.contractId,

                    reason: warning,
                });
            }

            if (
                contract.status ===
                "fully_signed" &&
                !report.technicallyConsistent
            ) {
                issues.push({
                    contractId:
                    report.contractId,

                    reason:
                        "Документ обозначен как полностью подписанный, но комплект технических доказательств не согласован.",
                });
            }

            if (
                contract.type ===
                "verified_completion_act" &&
                contract.version > 1 &&
                !contract.parentContractId
            ) {
                issues.push({
                    contractId:
                    report.contractId,

                    reason:
                        "Акт новой версии не имеет связи с предыдущим документом.",
                });
            }

        } catch (error) {
            issues.push({
                contractId:
                report.contractId,

                reason:
                    "Не удалось проверить PDF или сформировать отчёт доказательств.",
            });

            report.warnings.push(
                `Проверка завершилась ошибкой: ${error.message}`
            );
        }

        reports.push(report);
    }

    const result = {
        auditVersion: 1,
        auditedAt:
            new Date().toISOString(),

        mode: "read_only",

        order: {
            id: order.id,

            status: order.status,
            paymentType:
            order.paymentType,

            creatorId:
            order.creatorId,

            executorId:
            order.executorId,

            completedAt:
            order.completedAt,
        },

        currentIdentity: {
            creator: {
                status:
                customerVerification.status,

                verified:
                customerVerification.verified,
            },

            executor:
                executorVerification
                    ? {
                        status:
                        executorVerification.status,

                        verified:
                        executorVerification.verified,
                    }
                    : null,
        },

        documents: reports,

        notes,
        issues,

        passed:
            issues.length === 0,
    };

    console.log(
        JSON.stringify(
            result,
            null,
            2
        )
    );

    if (issues.length) {
        process.exitCode = 1;
    }
}

main()
    .catch((error) => {
        console.error(
            "Ошибка аудита:",
            error.message
        );

        process.exitCode = 1;
    })
    .finally(async () => {
        await sequelize.close();
    });
