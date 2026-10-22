
const axios = require("axios");

const BASE_URL = "https://api.yookassa.ru/v3";

function credentials() {
    /*
     * Пока используем только отдельный
     * тестовый магазин Safe Deal.
     *
     * Боевые ключи основного магазина
     * здесь намеренно не используем.
     */
    if (
        process.env.CARGOCAMP_SAFE_DEAL_MODE !==
        "sandbox"
    ) {
        throw new Error(
            "YooKassa Safe Deal is disabled"
        );
    }

    const shopId =
        process.env.YOOKASSA_SAFE_DEAL_TEST_SHOP_ID;

    const secretKey =
        process.env.YOOKASSA_SAFE_DEAL_TEST_SECRET_KEY;

    if (!shopId || !secretKey) {
        throw new Error(
            "YooKassa Safe Deal sandbox credentials missing"
        );
    }

    return { shopId, secretKey };
}

async function request(method, endpoint, {
    body,
    idempotenceKey,
} = {}) {
    const { shopId, secretKey } =
        credentials();

    const headers = {
        "Content-Type": "application/json",
    };

    if (method !== "GET") {
        if (
            !/^[0-9a-f-]{36}$/i.test(
                idempotenceKey || ""
            )
        ) {
            throw new Error(
                "Persistent idempotence key required"
            );
        }

        headers["Idempotence-Key"] =
            idempotenceKey;
    }

    const response = await axios({
        method,
        url: `${BASE_URL}${endpoint}`,

        auth: {
            username: shopId,
            password: secretKey,
        },

        headers,
        data: body,

        timeout: 20000,
        maxRedirects: 0,
    });

    return response.data;
}

function rubles(kopecks) {
    const value = Number(kopecks);

    if (
        !Number.isSafeInteger(value) ||
        value <= 0
    ) {
        throw new Error(
            "Invalid payment amount"
        );
    }

    return (value / 100).toFixed(2);
}

async function createDeal({
                              orderId,
                              idempotenceKey,
                          }) {
    return request("POST", "/deals", {
        idempotenceKey,

        body: {
            type: "safe_deal",

            fee_moment: "deal_closed",

            description:
                `CargoCamp order ${orderId}`,

            metadata: {
                order_id: String(orderId),
            },
        },
    });
}

async function createDealPayment({
                                     orderId,
                                     dealId,
                                     totalKopecks,
                                     payoutKopecks,
                                     idempotenceKey,
                                     returnUrl,
                                 }) {
    if (
        !dealId ||
        payoutKopecks >= totalKopecks
    ) {
        throw new Error(
            "Invalid Safe Deal settlement"
        );
    }

    return request("POST", "/payments", {
        idempotenceKey,

        body: {
            amount: {
                value: rubles(totalKopecks),
                currency: "RUB",
            },

            /*
             * Одностадийный платёж:
             * деньги списываются с покупателя
             * и учитываются на балансе сделки.
             */
            capture: true,

            confirmation: {
                type: "redirect",
                return_url: returnUrl,
            },

            description:
                `CargoCamp guarantee order ${orderId}`,

            deal: {
                id: dealId,

                settlements: [
                    {
                        type: "payout",

                        amount: {
                            value:
                                rubles(payoutKopecks),
                            currency: "RUB",
                        },
                    },
                ],
            },

            metadata: {
                type: "cargocamp_safe_deal",
                order_id: String(orderId),
            },

            /*
             * Receipt здесь нет намеренно.
             *
             * Для Safe Deal чек по 54-ФЗ
             * создаётся отдельным API-запросом.
             * Подключим после настройки
             * фискализации с YooKassa.
             */
        },
    });
}

async function getDeal(dealId) {
    return request(
        "GET",
        `/deals/${encodeURIComponent(dealId)}`
    );
}

async function getPayment(paymentId) {
    return request(
        "GET",
        `/payments/${encodeURIComponent(paymentId)}`
    );
}

module.exports = {
    createDeal,
    createDealPayment,
    getDeal,
    getPayment,
};
