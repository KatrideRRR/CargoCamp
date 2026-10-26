
const {
    OrderCompletionDecision,
    OrderSafeDeal,
    OrderCompletionCorrection,
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


    const correctionRecords =
        await OrderCompletionCorrection.findAll({
            where: {
                orderId: order.id,
            },
            order: [["id", "ASC"]],
        });

    const corrections = correctionRecords.map((item) => ({
        roundNumber: Number(item.roundNumber),
        eventType: item.eventType,
        actorUserId: Number(item.actorUserId),
        comment: item.comment,
        eventAt: item.eventAt,
    }));

    const lastCorrection =
        corrections[corrections.length - 1] || null;


    const safeDeal =
        order.paymentType === "guarantee"
            ? await OrderSafeDeal.findOne({
                where: { orderId: order.id },
            })
            : null;

    const originalCustomer = serializeDecision(creator);

    const customer = originalCustomer
        ? {
            ...originalCustomer,

            originalQualityDecision:
            originalCustomer.qualityDecision,

            originalRemarks:
            originalCustomer.remarks,

            qualityDecision:
                lastCorrection?.eventType === "accepted"
                    ? "accepted"
                    : originalCustomer.qualityDecision,

            remarks:
                lastCorrection?.eventType === "accepted"
                    ? null
                    : originalCustomer.remarks,

            acceptedAfterCorrectionsAt:
                lastCorrection?.eventType === "accepted"
                    ? lastCorrection.eventAt
                    : null,
        }
        : null;
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
        corrections,
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
