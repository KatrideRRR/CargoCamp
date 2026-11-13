function calculateExpressCommission({
                                        totalPriceRub,
                                        subscriptionType,
                                        subscriptionExpiresAt,
                                        hasSocialBenefit = false,
                                        now = new Date(),
                                    }) {
    const price = Number(totalPriceRub);

    if (
        !Number.isFinite(price) ||
        price <= 0 ||
        price > 300000
    ) {
        throw new RangeError(
            "Некорректная стоимость экспресс-заказа"
        );
    }

    const totalKopecks = Math.round(price * 100);

    if (
        !Number.isSafeInteger(totalKopecks) ||
        totalKopecks <= 0
    ) {
        throw new RangeError(
            "Некорректная стоимость в копейках"
        );
    }

    const expiration = subscriptionExpiresAt
        ? new Date(subscriptionExpiresAt)
        : null;

    const premiumActive =
        subscriptionType === "premium" &&
        expiration !== null &&
        Number.isFinite(expiration.getTime()) &&
        expiration.getTime() > now.getTime();

    const baseFeeKopecks =
        Math.round(totalKopecks * 0.10);

    const feeKopecks = premiumActive
        ? 0
        : hasSocialBenefit
            ? Math.round(baseFeeKopecks / 2)
            : baseFeeKopecks;

    return {
        premiumActive,
        totalKopecks,
        feeKopecks,
    };
}

module.exports = {
    calculateExpressCommission,
};