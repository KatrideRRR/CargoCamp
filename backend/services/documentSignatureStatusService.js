const SIGNING_METHODS = new Set([
    "otp_sms",
    "authenticated_click",
]);

function sameHash(left, right) {
    const a = String(left || "");
    const b = String(right || "");

    return (
        /^[a-f0-9]{64}$/i.test(a) &&
        /^[a-f0-9]{64}$/i.test(b) &&
        a.toLowerCase() === b.toLowerCase()
    );
}

function summarizeDocumentSignatures({
                                         signatures,
                                         contract,
                                         order,
                                     }) {
    const rows = Array.isArray(signatures)
        ? signatures
        : [];

    const creatorId = Number(order?.creatorId);
    const executorId = Number(order?.executorId);

    const validParties =
        Number.isSafeInteger(creatorId) &&
        creatorId > 0 &&
        Number.isSafeInteger(executorId) &&
        executorId > 0 &&
        creatorId !== executorId;

    const validSignature = (signature) => {
        if (
            !validParties ||
            !sameHash(
                signature.documentHash,
                contract?.documentHash
            ) ||
            !SIGNING_METHODS.has(signature.method)
        ) {
            return false;
        }

        const userId = Number(signature.userId);

        return (
            (
                userId === creatorId &&
                signature.partyRole === "creator"
            ) ||
            (
                userId === executorId &&
                signature.partyRole === "executor"
            )
        );
    };

    const creatorSigned = rows.some(
        (signature) =>
            validSignature(signature) &&
            Number(signature.userId) === creatorId
    );

    const executorSigned = rows.some(
        (signature) =>
            validSignature(signature) &&
            Number(signature.userId) === executorId
    );

    // В документе допускаются ровно две подписи:
    // заказчика и исполнителя.
    //
    // Посторонние или некорректные записи
    // не могут переводить документ в fully_signed.
    const fullySigned =
        rows.length === 2 &&
        rows.every(validSignature) &&
        creatorSigned &&
        executorSigned;

    return {
        creatorSigned,
        executorSigned,
        fullySigned,
    };
}

async function getDocumentSignatureState({
                                             ContractSignature,
                                             contract,
                                             order,
                                             transaction = null,
                                         }) {
    const signatures =
        await ContractSignature.findAll({
            where: {
                contractId: contract.id,
            },

            attributes: [
                "userId",
                "partyRole",
                "method",
                "documentHash",
            ],

            ...(transaction ? { transaction } : {}),
        });

    return summarizeDocumentSignatures({
        signatures,
        contract,
        order,
    });
}

module.exports = {
    summarizeDocumentSignatures,
    getDocumentSignatureState,
};