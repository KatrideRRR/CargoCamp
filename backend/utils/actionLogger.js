
"use strict";

const {
    notifySystemError,
} = require("../services/adminNotificationService");

module.exports = function makeActionLogger({
                                               db,
                                           }) {
    const ActionLog = db.ActionLog;

    function getIp(req) {
        if (!req) {
            return null;
        }

        // Используем обработанное Express значение.
        // Не доверяем напрямую произвольному
        // X-Forwarded-For из запроса.
        const ip = req.ip;

        return typeof ip === "string"
            ? ip.slice(0, 64)
            : null;
    }

    async function logAction({
                                 req = null,
                                 actorUserId = null,
                                 actorRole = "user",
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
            const ip = getIp(req);

            const userAgent =
                req?.headers?.["user-agent"];

            const ua =
                typeof userAgent === "string"
                    ? userAgent.slice(0, 512)
                    : null;

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

            return true;
        } catch (error) {
            // Не выводим SQL, параметры запроса
            // или конфиденциальные данные.
            console.error(
                "ActionLog write failed:",
                error?.code ||
                error?.name ||
                "Error"
            );

            // Telegram-монитор сгруппирует
            // повторяющиеся сбои записи.
            void notifySystemError({
                module: "mysql",
                phase: "action_log_write",
                severity: "high",
                error,
            });

            // Сохраняем совместимость:
            // прежние обработчики не падают,
            // но теперь могут проверить результат.
            return false;
        }
    }

    return {
        logAction,
    };
};
