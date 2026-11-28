"use strict";

const { User } = require("../models");

const {
    requestTBank,
} = require("../config/tbankClient");

const {
    customerKey,
} = require("./tbankCardBindingService");

const {
    claimDebtPaymentIntent,
    recordDebtPaymentIntent,
    publicDebtPaymentIntent,
} = require("./debtPaymentIntentService");

const {
    settleConfirmedDebtPayment,
} = require("./debtPaymentSettlementService");

const FAILED_STATUSES = [
    "CANCELED",
    "REJECTED",
    "AUTH_FAIL",
];

function fail(message, status = 409) {
    return Object.assign(new Error(message), {
        httpStatus: status,
    });
}

async function createTbankDebtPayment({
                                          userId,
                                          paymentMode,
                                          expectedAmountKopecks,
                                          request = null,
                                          returnPath,
                                      }) {
    const intent =
        await claimDebtPaymentIntent({
            userId,
            provider: "tbank",
            paymentMode,
            expectedAmountKopecks,
            request,
        });

    if (intent.noDebt) {
        return {
            success: true,
            noDebt: true,
        };
    }

    if (!intent.created) {
        return publicDebtPaymentIntent(intent);
    }

    let paymentId = null;

    try {
        const user = await User.findByPk(userId);

        if (!user) {
            throw fail(
                "Пользователь не найден",
                404
            );
        }

        const useSavedCard =
            paymentMode === "saved_card";

        if (
            useSavedCard &&
            (
                !user.tbankRebillId ||
                !user.tbankCardId
            )
        ) {
            await recordDebtPaymentIntent({
                intentId: intent.id,
                userId,
                provider: "tbank",
                status: "failed",
            });

            throw fail(
                "Сохранённая карта недоступна"
            );
        }

        const frontendUrl = new URL(
            process.env.FRONTEND_URL
        );

        let successUrl = new URL(
            intent.orderId
                ? "/orders"
                : "/profile",
            frontendUrl
        );

        if (
            typeof returnPath === "string" &&
            returnPath.startsWith("/") &&
            !returnPath.startsWith("//")
        ) {
            const candidate = new URL(
                returnPath,
                frontendUrl
            );

            if (
                candidate.origin ===
                frontendUrl.origin
            ) {
                successUrl = candidate;
            }
        }

        successUrl.searchParams.delete(
            "resumeRequest"
        );

        successUrl.searchParams.set(
            "debtReturn",
            "1"
        );

        successUrl.searchParams.set(
            "provider",
            "tbank"
        );

        successUrl.searchParams.set(
            "debtIntentId",
            String(intent.id)
        );

        const failUrl = new URL(
            successUrl.toString()
        );

        failUrl.searchParams.set(
            "debtReturn",
            "0"
        );

        const description =
            "Оплата комиссии CargoCamp";

        const amount =
            intent.amountKopecks;

        const payment =
            await requestTBank(
                "Init",
                {
                    Amount: amount,

                    OrderId:
                    intent.bankOrderId,

                    Description:
                    description,

                    ...(useSavedCard
                        ? {
                            CustomerKey:
                                customerKey(
                                    user.id
                                ),

                            OperationInitiatorType:
                                "R",

                            PayType: "O",
                        }
                        : {}),

                    SuccessURL:
                        successUrl.toString(),

                    FailURL:
                        failUrl.toString(),

                    NotificationURL:
                        `${process.env.BACKEND_URL}` +
                        "/api/tbank-payments/webhook",

                    DATA: {
                        type: "debt",
                        userId: String(userId),

                        debtIntentId:
                            String(intent.id),
                    },

                    Receipt: {
                        Taxation: "usn_income",

                        Phone: String(
                            user.phone || ""
                        ).replace(
                            /[^\d+]/g,
                            ""
                        ),

                        Items: [
                            {
                                Name:
                                description,

                                Price: amount,
                                Quantity: 1,
                                Amount: amount,

                                Tax: "none",

                                PaymentMethod:
                                    "full_payment",

                                PaymentObject:
                                    "service",
                            },
                        ],
                    },
                }
            );

        paymentId = String(
            payment?.PaymentId || ""
        );

        if (!paymentId) {
            throw new Error(
                "Т-Банк не вернул PaymentId"
            );
        }

        // Обязательно сохраняем PaymentId
        // до вызова Charge.

        const updated =
            await recordDebtPaymentIntent({
                intentId: intent.id,
                userId,
                provider: "tbank",
                paymentId,

                confirmationUrl:
                    useSavedCard
                        ? null
                        : payment.PaymentURL ||
                        null,

                status: "pending",
            });

        if (!useSavedCard) {
            return publicDebtPaymentIntent(
                updated
            );
        }

        if (
            updated.paymentStatus ===
            "succeeded"
        ) {
            return publicDebtPaymentIntent(
                updated
            );
        }

        try {
            await requestTBank(
                "Charge",
                {
                    PaymentId: paymentId,

                    RebillId:
                    user.tbankRebillId,
                }
            );
        } catch (error) {
            // Не повторяем Charge.
            // Проверяем результат через GetState.

            console.error(
                "TBank debt Charge result unknown:",
                paymentId
            );
        }

        const verified =
            await requestTBank(
                "GetState",
                {
                    PaymentId: paymentId,
                }
            );

        if (
            String(verified.PaymentId) !==
            paymentId ||

            String(verified.OrderId) !==
            intent.bankOrderId ||

            Number(verified.Amount) !==
            amount ||

            String(verified.TerminalKey) !==
            String(
                process.env.TBANK_TERMINAL_KEY
            )
        ) {
            throw new Error(
                "Не удалось подтвердить " +
                "параметры платежа Т-Банка"
            );
        }

        if (
            verified.Status === "CONFIRMED"
        ) {
            const result =
                await settleConfirmedDebtPayment({
                    provider: "tbank",
                    paymentId,
                    userId,

                    amountKopecks: amount,

                    intentId: intent.id,

                    bankOrderId:
                    intent.bankOrderId,
                });

            return {
                ...publicDebtPaymentIntent(
                    updated
                ),

                ...result,

                success: true,
                paid: true,
                paymentProcessing: false,
            };
        }

        const finalIntent =
            await recordDebtPaymentIntent({
                intentId: intent.id,
                userId,
                provider: "tbank",
                paymentId,

                status:
                    FAILED_STATUSES.includes(
                        verified.Status
                    )
                        ? "failed"
                        : "pending",
            });

        return publicDebtPaymentIntent(
            finalIntent
        );

    } catch (error) {
        await recordDebtPaymentIntent({
            intentId: intent.id,
            userId,
            provider: "tbank",

            paymentId: paymentId || null,

            status: "unknown",
        });

        throw error;
    }
}

module.exports = {
    createTbankDebtPayment,
};