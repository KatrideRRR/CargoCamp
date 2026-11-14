
"use strict";

const MUTATION_METHODS = new Set([
    "POST",
    "PUT",
    "PATCH",
    "DELETE",
]);

function positiveId(value) {
    if (
        value === null ||
        value === undefined ||
        value === ""
    ) {
        return null;
    }

    const number = Number(value);

    return Number.isSafeInteger(number) &&
    number > 0
        ? number
        : null;
}

function safeRoute(value) {
    if (
        typeof value !== "string" ||
        value.length > 160 ||
        !/^[a-zA-Z0-9_/:.*-]+$/.test(value)
    ) {
        return "unknown";
    }

    return value;
}

function entityForPath(pathname) {
    if (
        pathname.startsWith("/api/express/") ||
        pathname === "/api/express"
    ) {
        return "express_order";
    }

    if (
        pathname.startsWith("/api/orders/") ||
        pathname === "/api/orders" ||
        pathname.startsWith("/api/order-changes/")
    ) {
        return "order";
    }

    if (
        pathname.startsWith("/api/payments/") ||
        pathname.startsWith("/api/tbank-payments/") ||
        pathname.startsWith("/api/payment-cards/")
    ) {
        return "payment";
    }

    if (
        pathname.startsWith("/api/messages/") ||
        pathname.startsWith("/api/support/")
    ) {
        return "message";
    }

    if (
        pathname.startsWith("/api/disputes/")
    ) {
        return "dispute";
    }

    if (
        pathname.startsWith("/api/admin/")
    ) {
        return "admin";
    }

    return "user";
}

function buildMutationAuditEntry(req, statusCode) {
    const method = String(req?.method || "")
        .toUpperCase();

    if (!MUTATION_METHODS.has(method)) {
        return null;
    }

    // Успешный ответ. 4xx/5xx не считаем
    // доказательством выполненного действия.
    if (
        !Number.isInteger(statusCode) ||
        statusCode < 200 ||
        statusCode >= 300
    ) {
        return null;
    }

    const pathname = String(
        req?.originalUrl || ""
    ).split("?")[0];

    if (
        pathname !== "/api" &&
        !pathname.startsWith("/api/")
    ) {
        return null;
    }

    // Не сохраняем неизвестного исполнителя
    // как якобы авторизованного пользователя.
    const actorUserId = positiveId(
        req?.user?.id
    );

    if (!actorUserId) {
        return null;
    }

    // Только шаблон маршрута из Express.
    // Не используем originalUrl с ID, query
    // или произвольными пользовательскими данными.
    const routeTemplate = safeRoute(
        req?.route?.path
    );

    const entityType = entityForPath(pathname);

    const actorRole =
        req?.adminSession &&
        req?.user?.role === "admin"
            ? "admin"
            : "user";

    const params = req?.params || {};

    let entityId = null;
    let orderId = null;
    let expressOrderId = null;

    if (
        entityType === "order" &&
        pathname.startsWith("/api/orders/")
    ) {
        orderId = positiveId(params.id);
        entityId = orderId;
    }

    if (
        entityType === "express_order"
    ) {
        expressOrderId = positiveId(params.id);
        entityId = expressOrderId;
    }

    if (
        entityType === "admin" &&
        pathname.startsWith("/api/admin/users/")
    ) {
        entityId = positiveId(params.id);
    }

    // Ни request.body, ни response.body,
    // ни токены, ни банковские реквизиты,
    // ни текст сообщений здесь не читаем.
    return {
        ts: new Date(),

        actorUserId,
        actorRole,

        actionType: "api_mutation",
        entityType,
        entityId,

        orderId,
        expressOrderId,

        paymentId: null,

        severity: "info",
        success: true,
        reason: null,

        ip:
            typeof req.ip === "string"
                ? req.ip.slice(0, 64)
                : null,

        ua:
            typeof req.headers?.["user-agent"] ===
            "string"
                ? req.headers["user-agent"].slice(
                    0,
                    512
                )
                : null,

        meta: {
            source: "http_audit",
            method,
            route: routeTemplate,
            httpStatus: statusCode,
        },
    };
}

function createMutationAuditObserver({
                                         write,
                                         report,
                                     } = {}) {
    if (typeof write !== "function") {
        throw new TypeError(
            "Mutation audit writer is required"
        );
    }

    return function mutationAuditObserver(
        req,
        res,
        next
    ) {
        res.once("finish", () => {
            const entry = buildMutationAuditEntry(
                req,
                res.statusCode
            );

            if (!entry) {
                return;
            }

            // HTTP-ответ уже отправлен.
            // Ошибка аудита не превращает
            // выполненную операцию в повторную.
            void Promise.resolve()
                .then(() => write(entry))
                .catch((error) => {
                    console.error(
                        "Mutation ActionLog write failed:",
                        error?.code ||
                        error?.name ||
                        "Error"
                    );

                    if (
                        typeof report === "function"
                    ) {
                        try {
                            void Promise.resolve(
                                report(error)
                            ).catch(() => {});
                        } catch {
                            // Сбой мониторинга не влияет
                            // на выполнение API.
                        }
                    }
                });
        });

        next();
    };
}

module.exports = {
    buildMutationAuditEntry,
    createMutationAuditObserver,
};
