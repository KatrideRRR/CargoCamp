
const {
    notifyUser,
} = require("./notificationService");

const EVENTS = {
    act_remarks_received: {
        type: "act_remarks_received",
        title: "Замечания к выполненным работам",
        body: (orderId) =>
            `Заказчик оставил замечания к акту заказа №${orderId}.`,
    },

    act_remediation_submitted: {
        type: "act_remediation_submitted",
        title: "Исполнитель сообщил об исправлениях",
        body: (orderId) =>
            `По заказу №${orderId} исправления готовы к проверке.`,
    },

    act_remediation_rejected: {
        type: "act_remediation_rejected",
        title: "Необходимо продолжить исправления",
        body: (orderId) =>
            `Заказчик вернул исправления по заказу №${orderId} на доработку.`,
    },

    act_revision_created: {
        type: "act_revision_created",
        title: "Создана новая версия акта",
        body: (orderId) =>
            `По заказу №${orderId} сформирован новый акт. Проверьте документ.`,
    },
};

async function notifyContractWorkflow({
                                          event,
                                          userId,
                                          orderId,
                                          actId,
                                          version = 1,
                                      }) {
    const config = EVENTS[event];

    if (!config) {
        throw new Error(
            `Unknown contract workflow event: ${event}`
        );
    }

    const numericUserId = Number(userId);
    const numericOrderId = Number(orderId);

    if (
        !Number.isSafeInteger(numericUserId) ||
        numericUserId <= 0 ||
        !Number.isSafeInteger(numericOrderId) ||
        numericOrderId <= 0
    ) {
        throw new Error(
            "Invalid workflow notification recipient"
        );
    }

    try {
        return await notifyUser({
            userId: numericUserId,

            type: config.type,
            title: config.title,
            body: config.body(numericOrderId),

            orderId: numericOrderId,
            orderType: "regular",

            data: {
                actId: String(actId),
                version: String(version),
                target: "order_history",
            },
        });

    } catch (error) {
        /*
         * Решение по акту уже сохранено в БД.
         * Сбой уведомления не должен приводить
         * к повторному сохранению решения.
         */
        console.error(
            "Contract workflow notification failed:",
            {
                event,
                userId: numericUserId,
                orderId: numericOrderId,
                message: error.message,
            }
        );

        return null;
    }
}

module.exports = {
    notifyContractWorkflow,
};
