
function isTrue(value) {
    return (
        value === true ||
        value === 1 ||
        value === "1" ||
        value === "true"
    );
}

export function orderHasSocialDiscount(order, creator) {
    const snapshot =
        order?.creatorSocialBenefitAtCreation ??
        order?.creator_social_benefit_at_creation;

    // Для новых заказов используем зафиксированное
    // сервером право на скидку.
    if (snapshot !== null && snapshot !== undefined) {
        return isTrue(snapshot);
    }

    // Старые заказы без снимка льготы.
    return (
        isTrue(creator?.hasSocialBenefit) ||
        isTrue(creator?.isPensioner)
    );
}

export function getSocialCommissionPreview(order) {
    if (!order || order.paymentType !== "cash") {
        return null;
    }

    let baseKopecks;

    if (order.express) {
        const price = Number(
            order.proposedSum ?? order.totalPrice
        );

        if (
            !Number.isFinite(price) ||
            price <= 0
        ) {
            return null;
        }

        const priceKopecks = Math.round(price * 100);

        if (!Number.isSafeInteger(priceKopecks)) {
            return null;
        }

        baseKopecks =
            Math.round(priceKopecks * 0.10);
    } else {
        baseKopecks = order.is_recommended
            ? 10000
            : 20000;
    }

    return {
        baseRubles: baseKopecks / 100,
        discountedRubles:
            Math.round(baseKopecks / 2) / 100,
    };
}
