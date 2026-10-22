
function toKopecks(value) {
    if (
        typeof value !== "string" &&
        typeof value !== "number"
    ) {
        return null;
    }

    const text = String(value);

    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
        return null;
    }

    const [whole, fraction = ""] =
        text.split(".");

    const kopecks =
        Number(whole) * 100 +
        Number(fraction.padEnd(2, "0"));

    return Number.isSafeInteger(kopecks)
        ? kopecks
        : null;
}

function verifySafeDealFunding({
                                   localDeal,
                                   providerDeal,
                                   payment,
                               }) {
    const reasons = [];

    const expectedTotal =
        Number(
            localDeal.expectedAmountKopecks
        );

    const expectedPayout =
        Number(
            localDeal.sellerPayoutKopecks
        );

    const providerTotal =
        toKopecks(
            payment?.amount?.value
        );

    const providerPayout =
        toKopecks(
            payment?.deal
                ?.settlements?.[0]
                ?.amount?.value
        );

    const availablePayout =
        toKopecks(
            providerDeal?.payout_balance?.value
        );

    const expiresAt = providerDeal?.expires_at
        ? new Date(providerDeal.expires_at)
        : null;

    if (
        payment?.id !==
        localDeal.providerPaymentId
    ) {
        reasons.push("payment_id_mismatch");
    }

    if (
        providerDeal?.id !==
        localDeal.providerDealId
    ) {
        reasons.push("deal_id_mismatch");
    }

    if (
        payment?.deal?.id !==
        providerDeal?.id
    ) {
        reasons.push("payment_deal_mismatch");
    }

    if (
        String(payment?.metadata?.order_id) !==
        String(localDeal.orderId)
    ) {
        reasons.push("order_mismatch");
    }

    if (
        String(providerDeal?.metadata?.order_id) !==
        String(localDeal.orderId)
    ) {
        reasons.push("deal_order_mismatch");
    }

    if (
        payment?.status !== "succeeded" ||
        payment?.paid !== true
    ) {
        reasons.push("payment_not_succeeded");
    }

    if (
        providerDeal?.status !== "opened"
    ) {
        reasons.push("deal_not_opened");
    }

    if (
        payment?.amount?.currency !== "RUB" ||
        providerDeal?.payout_balance?.currency !==
        "RUB"
    ) {
        reasons.push("currency_mismatch");
    }

    if (
        providerTotal !== expectedTotal ||
        providerPayout !== expectedPayout
    ) {
        reasons.push("amount_mismatch");
    }

    if (
        payment?.deal?.settlements?.length !== 1 ||
        payment?.deal?.settlements?.[0]?.type !==
        "payout"
    ) {
        reasons.push("settlement_mismatch");
    }

    if (
        availablePayout === null ||
        availablePayout < expectedPayout
    ) {
        reasons.push("insufficient_payout_balance");
    }

    if (
        !expiresAt ||
        !Number.isFinite(expiresAt.getTime()) ||
        expiresAt.getTime() <= Date.now()
    ) {
        reasons.push("deal_expired");
    }

    return {
        funded: reasons.length === 0,

        reasons,

        confirmedAmountKopecks:
            reasons.length === 0
                ? expectedTotal
                : 0,

        expiresAt:
            expiresAt &&
            Number.isFinite(expiresAt.getTime())
                ? expiresAt.toISOString()
                : null,
    };
}

module.exports = {
    verifySafeDealFunding,
};
