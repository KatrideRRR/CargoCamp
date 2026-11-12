
const PROTECTED_PATHS = new Set([
    "/orders",
    "/express/express-orders",

    "/payments/premium/create",
    "/tbank-payments/premium/create",

    "/payments/order/promotion/create",
    "/tbank-payments/order/promotion/create",

    "/payments/order/promotion/retry/prepare",
]);

function requiresCurrentOffer(method, rawPath) {
    if (method !== "POST") return false;

    const path =
        "/" +
        String(rawPath || "")
            .replace(/^\/+|\/+$/g, "");

    if (PROTECTED_PATHS.has(path)) {
        return true;
    }

    // Новые обязательства по обычным заказам.
    if (
        /^\/orders\/\d+\/(restore|request|reserve|approve|activate-reservation)$/.test(
            path
        )
    ) {
        return true;
    }

    // Принятие нового экспресс-заказа.
    return /^\/express\/express-orders\/\d+\/accept$/.test(
        path
    );
}

function createOfferGuard({
                              authenticate,
                              findAcceptance,
                              currentOffer,
                          }) {
    if (
        typeof authenticate !== "function" ||
        typeof findAcceptance !== "function" ||
        !currentOffer?.version ||
        !currentOffer?.sha256
    ) {
        throw new Error(
            "Некорректная настройка защиты оферты"
        );
    }

    return function offerGuard(req, res, next) {
        if (
            !requiresCurrentOffer(
                req.method,
                req.path
            )
        ) {
            return next();
        }

        return authenticate(req, res, () => {
            const userId = Number(req.user?.id);

            if (
                !Number.isSafeInteger(userId) ||
                userId <= 0
            ) {
                return res.status(401).json({
                    message: "Требуется авторизация",
                });
            }

            Promise.resolve()
                .then(() =>
                    findAcceptance(
                        userId,
                        currentOffer
                    )
                )
                .then((acceptance) => {
                    if (!acceptance) {
                        return res.status(428).json({
                            code: "PUBLIC_OFFER_REQUIRED",
                            version: currentOffer.version,
                            message:
                                "Примите действующую публичную оферту CargoCamp",
                        });
                    }

                    return next();
                })
                .catch((error) => {
                    console.error(
                        "Public offer guard error:",
                        error.message
                    );

                    if (!res.headersSent) {
                        return res.status(503).json({
                            code: "PUBLIC_OFFER_CHECK_UNAVAILABLE",
                            message:
                                "Не удалось проверить согласие с офертой",
                        });
                    }
                });
        });
    };
}

module.exports = {
    requiresCurrentOffer,
    createOfferGuard,
};
