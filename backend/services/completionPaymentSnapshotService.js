
const {
    OrderCompletionDecision,
    OrderSafeDeal,
} = require("../models");

function serializeDecision(record) {
    if (!record) return null;

    return {
        userId: Number(record.userId),
        partyRole: record.partyRole,
        qualityDecision: record.qualityDecision,
        remarks: record.remarks,
        cashStatus: record.cashStatus,
        cashAmountKopecks:
            record.cashAmountKopecks == null
                ? null
                : Number(record.cashAmountKopecks),
        payoutAuthorized:
            record.payoutAuthorized === true,
        confirmedAt: record.confirmedAt,
    };
}

async function buildCompletionPaymentSnapshot(order) {
    const decisions = await OrderCompletionDecision.findAll({
        where: {
            orderId: order.id,
        },
    });

    const creator = decisions.find(
        (item) =>
            Number(item.userId) === Number(order.creatorId) &&
            item.partyRole === "creator"
    );

    const executor = decisions.find(
        (item) =>
            Number(item.userId) === Number(order.executorId) &&
            item.partyRole === "executor"
    );

    const safeDeal =
        order.paymentType === "guarantee"
            ? await OrderSafeDeal.findOne({
                where: { orderId: order.id },
            })
            : null;

    const customer = serializeDecision(creator);
    const performer = serializeDecision(executor);

    let cashReconciled = null;

    if (
        order.paymentType === "cash" &&
        customer &&
        performer
    ) {
        cashReconciled =
            Number(customer.cashAmountKopecks) ===
            Number(performer.cashAmountKopecks);
    }

    return {
        capturedAt: new Date().toISOString(),
        paymentType: order.paymentType,

        customer,
        executor: performer,

        cashReconciled,

        guarantee: order.paymentType === "guarantee"
            ? {
                releaseAuthorized:
                    customer?.payoutAuthorized === true,

                authorizationAt:
                    customer?.payoutAuthorized
                        ? customer.confirmedAt
                        : null,

                mechanism:
                    safeDeal ? "safe_deal" : "legacy_hold",

                recordedProviderStatus:
                    safeDeal?.status || order.dealStatus,

                recordedPaymentStatus:
                    safeDeal?.providerPaymentStatus ||
                    order.yookassa_payment_status ||
                    null,

                // Подтверждение выплаты исполнителю
                // нельзя выводить из простого завершения.
                payoutConfirmed: false,
            }
            : null,
    };
}

module.exports = {
    buildCompletionPaymentSnapshot,
};
