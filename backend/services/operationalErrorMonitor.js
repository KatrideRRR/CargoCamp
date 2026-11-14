"use strict";

const { randomUUID, createHash } = require("node:crypto");

const LEVELS = new Set(["critical", "high", "normal", "expected"]);
const LABELS = {
    critical: "КРИТИЧЕСКАЯ",
    high: "ВЫСОКАЯ",
    normal: "ОБЫЧНАЯ",
    expected: "ОЖИДАЕМАЯ",
};

function safeTag(value, fallback = "unknown") {
    const tag = String(value ?? "");
    return /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(tag)
        ? tag
        : fallback;
}

function safeId(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0
        ? number
        : null;
}

function requestModule(req) {
    // Используем только фиксированный первый сегмент API.
    // Ни query string, ни произвольные значения пути не отправляем.
    const path = String(req?.originalUrl || "").split("?")[0];
    const match = /^\/api\/([a-z][a-z0-9-]{0,35})(?:\/|$)/i.exec(path);
    if (match) return `api.${match[1].toLowerCase()}`;
    return path.startsWith("/uploads/") ? "uploads" : "http";
}

function classify({ severity, status, module }) {
    if (LEVELS.has(severity)) return severity;
    if (status >= 400 && status < 500) return "expected";
    if (/^(mysql|payments|payment|billing|node|migration|reconciliation)(\.|$)/.test(module)) {
        return "high";
    }
    return "normal";
}

function createErrorMonitor({
    send,
    now = () => Date.now(),
    windowMs = 5 * 60_000,
    retryMs = 60_000,
    maxGroups = 500,
    maxPerMinute = 10,
} = {}) {
    if (typeof send !== "function") throw new TypeError("send is required");
    const groups = new Map();
    let bucketTime = now();
    let bucketUsed = 0;

    function takeRateSlot() {
        const time = now();
        if (time - bucketTime >= 60_000) {
            bucketTime = time;
            bucketUsed = 0;
        }
        if (bucketUsed >= maxPerMinute) return false;
        bucketUsed += 1;
        return true;
    }

    async function deliver(group) {
        if (group.inFlight || group.pending === 0 || now() < group.nextAt) {
            return { skipped: true };
        }
        if (!takeRateSlot()) {
            group.nextAt = now() + 60_000;
            return { skipped: true, rateLimited: true };
        }

        group.inFlight = true;
        group.nextAt = now() + windowMs;
        const batchSize = group.pending;
        const body = [
            `Инцидент: ${group.incidentId}`,
            `Уровень: ${LABELS[group.level]}`,
            `Модуль: ${group.module}`,
            `Операция: ${group.phase}`,
            `Время UTC: ${new Date(now()).toISOString()}`,
            `Первое событие UTC: ${new Date(group.firstAt).toISOString()}`,
            `Тип: ${group.errorType}`,
            `Код: ${group.errorCode}`,
            group.httpStatus ? `HTTP: ${group.httpStatus}` : null,
            group.method ? `Метод: ${group.method}` : null,
            group.userId ? `User ID (первое событие): ${group.userId}` : null,
            group.orderId ? `Order ID (первое событие): ${group.orderId}` : null,
            `Событий за окно: ${batchSize}`,
            `Всего в группе: ${group.total}`,
            "Описание: операция завершилась технической ошибкой; детали доступны в защищённых логах сервера.",
        ].filter(Boolean).join("\n");

        try {
            const response = await send({
                topic: "system",
                title: `CargoCamp: ${LABELS[group.level]} ошибка`,
                message: body,
            });
            if (response?.success !== true) {
                group.nextAt = now() + retryMs;
                return { success: false };
            }
            group.pending = Math.max(0, group.pending - batchSize);
            return { success: true, incidentId: group.incidentId };
        } catch {
            group.nextAt = now() + retryMs;
            return { success: false };
        } finally {
            group.inFlight = false;
        }
    }

    async function record({
        error = null,
        req = null,
        module = null,
        phase = "operation",
        severity = null,
        userId = null,
        orderId = null,
    } = {}) {
        const moduleKey = safeTag(module || requestModule(req));
        const errorType = safeTag(error?.name, "Error");
        const errorCode = safeTag(error?.code, "UNSPECIFIED");
        const numericStatus = Number(
            error?.httpStatus ?? error?.status ?? error?.statusCode ?? 0
        );
        const httpStatus = Number.isInteger(numericStatus) &&
            numericStatus >= 100 && numericStatus <= 599
            ? numericStatus
            : null;
        const level = classify({
            severity,
            status: httpStatus,
            module: moduleKey,
        });
        if (level === "expected") return { skipped: true, reason: "expected" };

        const operation = safeTag(phase);
        const method = safeTag(req?.method, "");
        const fingerprint = createHash("sha256")
            .update(JSON.stringify([moduleKey, operation, level, errorType, errorCode, httpStatus, method]))
            .digest("hex");

        let group = groups.get(fingerprint);
        if (!group) {
            if (groups.size >= maxGroups) {
                groups.delete(groups.keys().next().value);
            }
            group = {
                incidentId: `CC-${randomUUID().slice(0, 8)}`,
                module: moduleKey,
                phase: operation,
                level,
                errorType,
                errorCode,
                httpStatus,
                method,
                userId: safeId(userId ?? req?.user?.id),
                orderId: safeId(orderId),
                firstAt: now(),
                nextAt: 0,
                total: 0,
                pending: 0,
                inFlight: false,
            };
            groups.set(fingerprint, group);
        }
        group.total += 1;
        group.pending += 1;
        return deliver(group);
    }

    async function flush() {
        // Сервер вызывает flush раз в минуту: так отправляется
        // сводка повторов даже при отсутствии новых ошибок.
        return Promise.all([...groups.values()].map(deliver));
    }

    return { record, flush };
}

function createHttpErrorObserver({ notifySystemError }) {
    if (typeof notifySystemError !== "function") {
        throw new TypeError("notifySystemError is required");
    }
    return (req, res, next) => {
        res.once("finish", () => {
            if (
                res.statusCode < 500 ||
                res.locals?.cargoCampErrorReported
            ) return;

            // Перехватывает даже ошибки, которые маршрут обработал
            // собственным catch и отправил res.status(500).
            try {
                void Promise.resolve(notifySystemError({
                    error: {
                        name: "HttpResponseError",
                        code: `HTTP_${res.statusCode}`,
                        status: res.statusCode,
                    },
                    req,
                    phase: "http_response",
                })).catch(() => {});
            } catch {
                // Мониторинг не влияет на пользовательский запрос.
            }
        });
        next();
    };
}

module.exports = {
    createErrorMonitor,
    createHttpErrorObserver,
};
