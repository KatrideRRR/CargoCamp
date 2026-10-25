
const {
    Contract,
    Dispute,
    OrderChangeRequest,
} = require("../models");

function validPrice(value) {
    const number = Number(value);

    if (!Number.isSafeInteger(number) || number <= 0) {
        throw new Error("Некорректная стоимость в истории заказа");
    }

    return number;
}

function evidencePhotos(value) {
    if (Array.isArray(value)) return value;

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }

    return [];
}

async function readDisputesSnapshot(orderId) {
    const disputes = await Dispute.findAll({
        where: {
            orderId,
            orderType: "regular",
        },
        order: [
            ["createdAt", "ASC"],
            ["id", "ASC"],
        ],
    });

    return disputes.map((dispute) => ({
        id: Number(dispute.id),
        openedById: Number(dispute.openedById),
        openedByRole: dispute.openedByRole,
        createdAt: dispute.createdAt,
        reasonCode: dispute.reasonCode,
        reason: dispute.reason,
        description: dispute.description || null,
        status: dispute.status,
        resolution: dispute.resolution || null,
        resolvedAt: dispute.resolvedAt || null,
        evidence: evidencePhotos(dispute.evidencePhotos)
            .map((photo) => ({
                id: photo.id || null,
                sha256: photo.sha256 || null,
                uploadedById: photo.uploadedById || null,
            })),
    }));
}

async function buildCompletionActEvidence(order, assignment) {
    const initialPrice = validPrice(
        assignment.metadata?.snapshot?.terms?.priceKopecks
    );

    const finalPrice = validPrice(
        order.finalPriceKopecks
    );

    const changes = await OrderChangeRequest.findAll({
        where: {
            orderId: order.id,
            status: "applied",
        },
        order: [
            ["appliedAt", "ASC"],
            ["id", "ASC"],
        ],
    });

    const addenda = [];
    let calculatedPrice = initialPrice;

    for (const change of changes) {
        const contract = change.agreementContractId
            ? await Contract.findByPk(change.agreementContractId)
            : null;

        if (
            !contract ||
            contract.type !== "verified_addendum" ||
            contract.status !== "fully_signed" ||
            !contract.fullySignedAt ||
            !contract.documentHash ||
            contract.supersededAt ||
            Number(contract.orderId) !== Number(order.id) ||
            String(contract.parentContractId) !==
            String(assignment.id)
        ) {
            throw new Error(
                `Не найдено подписанное соглашение для изменения №${change.id}`
            );
        }

        const snapshot = contract.metadata?.snapshot || {};

        const before = validPrice(change.basePriceKopecks);
        const after = validPrice(change.proposedPriceKopecks);

        if (
            before !== calculatedPrice ||
            String(snapshot.changeId) !== String(change.id) ||
            String(snapshot.parentHash) !==
            String(assignment.documentHash) ||
            Number(snapshot.basePriceKopecks) !== before ||
            Number(snapshot.proposedPriceKopecks) !== after ||
            String(snapshot.additionalWork) !==
            String(change.additionalWork)
        ) {
            throw new Error(
                `Несоответствие истории стоимости: изменение №${change.id}`
            );
        }

        addenda.push({
            changeId: String(change.id),
            contractId: String(contract.id),
            documentNumber: contract.documentNumber,
            documentHash: contract.documentHash,
            signedAt: contract.fullySignedAt,
            appliedAt: change.appliedAt,
            additionalWork: snapshot.additionalWork,
            beforePriceKopecks: before,
            afterPriceKopecks: after,
        });

        calculatedPrice = after;
    }

    if (calculatedPrice !== finalPrice) {
        throw new Error(
            "Итоговая цена отличается от истории подписанных соглашений"
        );
    }

    return {
        originalPriceKopecks: initialPrice,
        finalPriceKopecks: finalPrice,
        addenda,
        disputesCapturedAt: new Date().toISOString(),
        disputes: await readDisputesSnapshot(order.id),
    };
}

module.exports = {
    buildCompletionActEvidence,
    readDisputesSnapshot,
};
