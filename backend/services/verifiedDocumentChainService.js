function sameId(a, b) {
    return /^[1-9]\d*$/.test(String(a ?? "")) &&
        String(a) === String(b);
}

function sameHash(a, b) {
    return /^[a-f0-9]{64}$/i.test(String(a || "")) &&
        String(a).toLowerCase() ===
        String(b || "").toLowerCase();
}

function validPrice(value) {
    return Number.isSafeInteger(Number(value)) &&
        Number(value) > 0;
}

function verifyDocumentChain({
                                 contract,
                                 assignment = null,
                                 previousAct = null,
                                 addenda = [],
                             }) {
    const warnings = [];

    if (contract.type === "verified_assignment") {
        return warnings;
    }

    const snapshot =
        contract.metadata?.snapshot || {};

    if (
        !assignment ||
        assignment.type !== "verified_assignment" ||
        !sameId(assignment.orderId, contract.orderId) ||
        !assignment.documentHash
    ) {
        warnings.push(
            "Не найден исходный договор-задание этого заказа."
        );

        return warnings;
    }

    if (contract.type === "verified_addendum") {
        if (
            !sameId(
                contract.parentContractId,
                assignment.id
            ) ||
            !sameId(snapshot.parentId, assignment.id) ||
            !sameHash(
                snapshot.parentHash,
                assignment.documentHash
            ) ||
            assignment.status !== "fully_signed" ||
            !assignment.fullySignedAt
        ) {
            warnings.push(
                "Дополнительное соглашение не связано " +
                "с подписанным исходным договором."
            );
        }

        return warnings;
    }

    if (contract.type !== "verified_completion_act") {
        warnings.push(
            "Неизвестный тип документа."
        );

        return warnings;
    }

    if (
        !sameId(snapshot.assignmentId, assignment.id) ||
        !sameHash(
            snapshot.assignmentHash,
            assignment.documentHash
        ) ||
        assignment.status !== "fully_signed" ||
        !assignment.fullySignedAt
    ) {
        warnings.push(
            "Акт не связан с подписанным договором-заданием."
        );
    }

    const version = Number(contract.version);

    if (version === 1) {
        if (
            !sameId(
                contract.parentContractId,
                assignment.id
            )
        ) {
            warnings.push(
                "Акт v1 имеет некорректный родительский документ."
            );
        }
    } else if (version === 2) {
        const remediation = snapshot.remediation;

        if (
            !previousAct ||
            previousAct.type !==
            "verified_completion_act" ||
            Number(previousAct.version) !== 1 ||
            !sameId(
                previousAct.orderId,
                contract.orderId
            ) ||
            !sameId(
                previousAct.parentContractId,
                assignment.id
            ) ||
            !sameId(
                contract.parentContractId,
                previousAct.id
            ) ||
            !sameId(
                remediation?.previousActId,
                previousAct.id
            ) ||
            !sameHash(
                remediation?.previousDocumentHash,
                previousAct.documentHash
            ) ||
            !previousAct.supersededAt
        ) {
            warnings.push(
                "Акт v2 не подтверждает корректную " +
                "цепочку исправлений акта v1."
            );
        }
    } else {
        warnings.push(
            "Неподдерживаемая версия акта."
        );
    }

    const history = snapshot.addenda;

    if (!Array.isArray(history)) {
        warnings.push(
            "В акте отсутствует история дополнительных соглашений."
        );

        return warnings;
    }

    if (history.length > 100) {
        warnings.push(
            "История дополнительных соглашений превышает лимит."
        );

        return warnings;
    }

    const addendumMap = new Map(
        addenda.map((item) => [
            String(item.id),
            item,
        ])
    );

    const usedIds = new Set();

    let calculatedPrice =
        Number(
            assignment.metadata?.snapshot
                ?.terms?.priceKopecks
        );

    if (
        !validPrice(calculatedPrice) ||
        !validPrice(snapshot.originalPriceKopecks) ||
        calculatedPrice !==
        Number(snapshot.originalPriceKopecks)
    ) {
        warnings.push(
            "Начальная стоимость акта не совпадает с договором."
        );
    }

    for (const item of history) {
        const id = String(item?.contractId || "");
        const document = addendumMap.get(id);

        if (
            usedIds.has(id) ||
            !document ||
            !sameId(document.orderId, contract.orderId) ||
            document.type !== "verified_addendum" ||
            document.status !== "fully_signed" ||
            !document.fullySignedAt ||
            document.supersededAt ||
            !sameId(
                document.parentContractId,
                assignment.id
            ) ||
            !sameHash(
                document.documentHash,
                item.documentHash
            )
        ) {
            warnings.push(
                `Дополнительное соглашение №${id} не подтверждено.`
            );
        }

        usedIds.add(id);

        const before = Number(
            item?.beforePriceKopecks
        );

        const after = Number(
            item?.afterPriceKopecks
        );

        if (
            !validPrice(before) ||
            !validPrice(after) ||
            before !== calculatedPrice
        ) {
            warnings.push(
                `Нарушена последовательность изменения цены: соглашение №${id}.`
            );
        }

        calculatedPrice = after;
    }

    if (
        !validPrice(snapshot.finalPriceKopecks) ||
        calculatedPrice !==
        Number(snapshot.finalPriceKopecks)
    ) {
        warnings.push(
            "Итоговая стоимость акта не совпадает " +
            "с историей дополнительных соглашений."
        );
    }

    return warnings;
}

module.exports = {
    verifyDocumentChain,
};