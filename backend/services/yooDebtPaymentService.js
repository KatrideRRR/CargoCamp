"use strict";

const { User } = require("../models");

const yooKassa = require("../config/yookassaClient");

const {
    claimDebtPaymentIntent,
    recordDebtPaymentIntent,
    publicDebtPaymentIntent,
} = require("./debtPaymentIntentService");

const {
    settleConfirmedDebtPayment,
} = require("./debtPaymentSettlementService");

function fail(message, status = 409) {
    return Object.assign(new Error(message), {
        httpStatus: status,
    });
}

async function createYooDebtPayment({
                                        userId,
                                        paymentMode,
                                        expectedAmountKopecks,
                                        request = null,
                                        returnPath,
                                    }) {
    const intent = await claimDebtPaymentIntent({
        userId,
        provider: "yookassa",
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

    // Повторный запрос возвращает существующую
    // операцию, не создавая новый платёж.
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

        const amountValue = (
            intent.amountKopecks / 100
        ).toFixed(2);

        const description =
            "Оплата комиссии CargoCamp";

        const frontendUrl = new URL(
            process.env.FRONTEND_URL
        );

        const fallbackPath = intent.orderId
            ? "/orders"
            : "/profile";

        let targetUrl = new URL(
            fallbackPath,
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
                targetUrl = candidate;
            }
        }

        // Старый клиентский механизм
        // автоматического отклика не запускаем.
        targetUrl.searchParams.delete(
            "resumeRequest"
        );

        targetUrl.searchParams.set(
            "debtReturn",
            "1"
        );

        targetUrl.searchParams.set(
            "debtIntentId",
            String(intent.id)
        );

        const payload = {
            amount: {
                value: amountValue,
                currency: "RUB",
            },

            capture: true,

            description,

            metadata: {
                type: "debt",
                userId: String(userId),
                expectedKopecks: String(
                    intent.amountKopecks
                ),
                debtIntentId: String(intent.id),
            },

            receipt: {
                customer: {
                    phone: String(
                        user.phone || ""
                    ).replace(/[^\d+]/g, ""),
                },

                items: [
                    {
                        description,
                        quantity: 1,

                        amount: {
                            value: amountValue,
                            currency: "RUB",
                        },

                        vat_code: 1,
                        payment_mode:
                            "full_payment",
                        payment_subject:
                            "service",
                    },
                ],

                tax_system_code: 2,
            },
        };

        if (paymentMode === "saved_card") {
            if (
                !user.yookassa_payment_method_id
            ) {
                await recordDebtPaymentIntent({
                    intentId: intent.id,
                    userId,
                    provider: "yookassa",
                    status: "failed",
                });

                throw fail(
                    "Сохранённая карта недоступна"
                );
            }

            payload.payment_method_id =
                user.yookassa_payment_method_id;
        } else {
            // При выборе другой карты
            // payment_method_id не передаём.
            payload.confirmation = {
                type: "redirect",
                return_url:
                    targetUrl.toString(),
            };
        }

        const payment =
            await yooKassa.createPayment(
                payload,
                intent.idempotencyKey
            );

        paymentId = String(
            payment?.id || ""
        );

        if (!paymentId) {
            throw new Error(
                "ЮKassa не вернула ID платежа"
            );
        }

        const updated =
            await recordDebtPaymentIntent({
                intentId: intent.id,
                userId,
                provider: "yookassa",
                paymentId,

                confirmationUrl:
                    payment.confirmation
                        ?.confirmation_url ||
                    null,

                status:
                    payment.status === "canceled"
                        ? "failed"
                        : "pending",
            });

        if (
            payment.status === "succeeded"
        ) {
            // Даже при мгновенном списании
            // дополнительно проверяем платёж.
            const verified =
                await yooKassa.getPayment(
                    paymentId
                );

            if (
                String(verified?.id) !==
                paymentId ||
                verified?.status !==
                "succeeded" ||
                verified?.amount?.currency !==
                "RUB" ||
                Math.round(
                    Number(
                        verified.amount.value
                    ) * 100
                ) !== intent.amountKopecks ||
                verified.metadata?.type !==
                "debt" ||
                String(
                    verified.metadata?.userId
                ) !== String(userId) ||
                String(
                    verified.metadata
                        ?.debtIntentId
                ) !== String(intent.id)
            ) {
                throw new Error(
                    "Не удалось подтвердить " +
                    "параметры платежа ЮKassa"
                );
            }

            const result =
                await settleConfirmedDebtPayment({
                    provider: "yookassa",
                    paymentId,
                    userId,

                    amountKopecks:
                    intent.amountKopecks,

                    intentId: intent.id,
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

        return publicDebtPaymentIntent(
            updated
        );

    } catch (error) {
        // Если результат обращения к банку
        // неизвестен, повторное списание
        // не разрешаем.

        await recordDebtPaymentIntent({
            intentId: intent.id,
            userId,
            provider: "yookassa",
            paymentId: paymentId || null,
            status: "unknown",
        });

        throw error;
    }
}

module.exports = {
    createYooDebtPayment,
};