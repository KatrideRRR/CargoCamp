module.exports = function makeActionLogger({ db }) {
    const ActionLog = db.ActionLog;

    function getIp(req) {
        const xf = req.headers["x-forwarded-for"];
        if (xf) return String(xf).split(",")[0].trim();
        return req.ip || null;
    }

    async function logAction({
                                 req = null,
                                 actorUserId = null,
                                 actorRole = "user", // user|admin|system|webhook
                                 actionType,
                                 entityType,
                                 entityId = null,
                                 orderId = null,
                                 expressOrderId = null,
                                 paymentId = null,
                                 severity = "info",
                                 success = true,
                                 reason = null,
                                 meta = null,
                             }) {
        try {
            const ip = req ? getIp(req) : null;
            const ua = req ? (req.headers["user-agent"] || null) : null;

            await ActionLog.create({
                ts: new Date(),
                actorUserId,
                actorRole,
                actionType,
                entityType,
                entityId,
                orderId,
                expressOrderId,
                paymentId,
                severity,
                success,
                reason,
                ip,
                ua,
                meta,
            });
        } catch (e) {
            // Логирование не должно ломать бизнес-процесс
            console.error("ActionLog write error:", e?.message || e);
        }
    }

    return { logAction };
};