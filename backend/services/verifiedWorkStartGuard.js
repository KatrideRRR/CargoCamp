function getVerifiedWorkStartBlockReason(assignment) {
    // Если подтверждённого договора нет,
    // действует обычный порядок выполнения заказа.
    if (!assignment) {
        return null;
    }

    if (
        assignment.type !== "verified_assignment" ||
        assignment.status !== "fully_signed" ||
        !assignment.fullySignedAt ||
        assignment.supersededAt ||
        !/^[a-f0-9]{64}$/i.test(
            String(assignment.documentHash || "")
        )
    ) {
        return (
            "Перед началом работы заказчик и исполнитель " +
            "должны подписать договор-задание."
        );
    }

    return null;
}

module.exports = {
    getVerifiedWorkStartBlockReason,
};