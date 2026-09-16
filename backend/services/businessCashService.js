const axios =
    require("axios");

function sleep(ms) {
    return new Promise(
        (resolve) =>
            setTimeout(
                resolve,
                ms
            )
    );
}

function normalizeKind(kind) {
    if (kind === "premium") {
        return "premium";
    }

    if (kind === "debt") {
        return "debt";
    }

    if (
        kind === "promo" ||
        kind === "promotion" ||
        kind === "order_promotion"
    ) {
        return "promotion";
    }

    return null;
}

async function sendBusinessCashPayment({
                                           provider,
                                           paymentId,
                                           kind,
                                           amountKopecks,
                                           userId = null,
                                           orderId = null,
                                           occurredAt = null,
                                       }) {
    const url =
        process.env
            .BUSINESS_CASH_URL;

    const secret =
        process.env
            .BUSINESS_CASH_API_SECRET;

    if (!url || !secret) {
        console.warn(
            "⚠️ BusinessCash integration: URL или secret не настроен"
        );

        return {
            ok: false,
            skipped: true,
        };
    }

    const normalizedKind =
        normalizeKind(
            kind
        );

    const amount =
        Number(
            amountKopecks || 0
        );

    if (
        !provider ||
        !paymentId ||
        !normalizedKind ||
        !Number.isSafeInteger(
            amount
        ) ||
        amount <= 0
    ) {
        console.warn(
            "⚠️ BusinessCash integration: некорректный payment",
            {
                provider,
                paymentId,
                kind,
                amountKopecks,
            }
        );

        return {
            ok: false,
            skipped: true,
        };
    }

    const payload = {
        eventId:
            `${provider}:${paymentId}`,

        provider:
            String(
                provider
            ).toLowerCase(),

        paymentId:
            String(
                paymentId
            ),

        kind:
        normalizedKind,

        amountKopecks:
            String(
                amount
            ),

        occurredAt:
            occurredAt ||
            new Date()
                .toISOString(),

        userId:
            userId
                ? Number(userId)
                : null,

        orderId:
            orderId
                ? Number(orderId)
                : null,
    };

    /*
     * Если BusinessCash на несколько
     * секунд недоступен, пробуем ещё.
     *
     * Сам BusinessCash идемпотентный,
     * поэтому повтор безопасен.
     */
    const delays = [
        0,
        1000,
        3000,
        7000,
    ];

    let lastError = null;

    for (
        let attempt = 0;
        attempt < delays.length;
        attempt += 1
    ) {
        if (
            delays[attempt] > 0
        ) {
            await sleep(
                delays[attempt]
            );
        }

        try {
            const response =
                await axios.post(
                    url,
                    payload,
                    {
                        headers: {
                            "Content-Type":
                                "application/json",

                            "x-cargocamp-secret":
                            secret,
                        },

                        timeout:
                            5000,
                    }
                );

            console.log(
                `💰 BusinessCash: ` +
                `${provider} ` +
                `${normalizedKind} ` +
                `${amount} коп. ` +
                (
                    response
                        .data
                        ?.duplicate
                        ? "(duplicate)"
                        : "(recorded)"
                )
            );

            return {
                ok: true,

                duplicate:
                    Boolean(
                        response
                            .data
                            ?.duplicate
                    ),
            };
        } catch (error) {
            lastError =
                error;

            console.error(
                `⚠️ BusinessCash attempt ${attempt + 1}/${delays.length}:`,
                error
                    ?.response
                    ?.data ||
                error.message
            );
        }
    }

    console.error(
        "❌ BusinessCash: платёж не передан:",
        {
            provider,
            paymentId,
            kind:
            normalizedKind,

            error:
                lastError
                    ?.message ||
                "unknown",
        }
    );

    return {
        ok: false,
    };
}

async function sendBusinessCashRefund({
                                          provider,
                                          paymentId,
                                          refundId,
                                          amountKopecks = null,
                                          fullRefund = false,
                                          occurredAt = null,
                                      }) {
    const paymentUrl =
        process.env
            .BUSINESS_CASH_URL;

    const secret =
        process.env
            .BUSINESS_CASH_API_SECRET;

    if (!paymentUrl || !secret) {
        console.warn(
            "⚠️ BusinessCash refund: URL или secret не настроен"
        );

        return {
            ok: false,
            skipped: true,
        };
    }

    const refundUrl =
        process.env
            .BUSINESS_CASH_REFUND_URL ||
        paymentUrl.replace(
            /\/payments\/?$/,
            "/refunds"
        );

    const amount =
        amountKopecks === null
            ? null
            : Number(
                amountKopecks
            );

    if (
        !provider ||
        !paymentId ||
        !refundId ||
        (
            !fullRefund &&
            (
                !Number.isSafeInteger(
                    amount
                ) ||
                amount <= 0
            )
        )
    ) {
        console.warn(
            "⚠️ BusinessCash: некорректный refund",
            {
                provider,
                paymentId,
                refundId,
                amountKopecks,
                fullRefund,
            }
        );

        return {
            ok: false,
            skipped: true,
        };
    }

    const payload = {
        provider:
            String(
                provider
            ).toLowerCase(),

        paymentId:
            String(
                paymentId
            ),

        refundId:
            String(
                refundId
            ),

        fullRefund:
            Boolean(
                fullRefund
            ),

        amountKopecks:
            amount === null
                ? null
                : String(
                    amount
                ),

        occurredAt:
            occurredAt ||
            new Date()
                .toISOString(),
    };

    const delays = [
        0,
        1000,
        3000,
        7000,
    ];

    for (
        let attempt = 0;
        attempt < delays.length;
        attempt += 1
    ) {
        if (
            delays[attempt] > 0
        ) {
            await sleep(
                delays[attempt]
            );
        }

        try {
            const response =
                await axios.post(
                    refundUrl,
                    payload,
                    {
                        headers: {
                            "Content-Type":
                                "application/json",

                            "x-cargocamp-secret":
                            secret,
                        },

                        timeout:
                            5000,
                    }
                );

            console.log(
                `↩️ BusinessCash refund: ` +
                `${provider} ` +
                `${paymentId} ` +
                (
                    response.data
                        ?.duplicate
                        ? "(duplicate)"
                        : response.data
                            ?.ignored
                            ? "(ignored)"
                            : "(recorded)"
                )
            );

            return {
                ok: true,
            };
        } catch (error) {
            console.error(
                `⚠️ BusinessCash refund attempt ${attempt + 1}/${delays.length}:`,
                error
                    ?.response
                    ?.data ||
                error.message
            );
        }
    }

    return {
        ok: false,
    };
}

module.exports = {
    sendBusinessCashPayment,
    sendBusinessCashRefund,
};