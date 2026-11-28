"use strict";

const { QueryTypes } = require("sequelize");

const {
    sequelize,
    User,
    Notification,
    ActionLog,
} = require("../models");

const {
    createRegularOrderRequest,
} = require("./regularOrderRequestService");

async function finalizeDebtOrderRequest({
                                            intentId,
                                            userId,
                                        }) {
    const id = Number(intentId);
    const uid = Number(userId);

    if (
        !Number.isSafeInteger(id) ||
        id <= 0 ||
        !Number.isSafeInteger(uid) ||
        uid <= 0
    ) {
        throw new Error(
            "Некорректные данные платёжного намерения"
        );
    }

    return sequelize.transaction(
        async (transaction) => {
            const user = await User.findByPk(uid, {
                transaction,
                lock: transaction.LOCK.UPDATE,
            });

            if (!user) {
                throw new Error(
                    "Пользователь не найден"
                );
            }

            const rows = await sequelize.query(
                `
                SELECT *
                FROM debt_payment_intents
                WHERE id = :id
                  AND user_id = :userId
                FOR UPDATE
                `,
                {
                    replacements: {
                        id,
                        userId: uid,
                    },
                    transaction,
                    type: QueryTypes.SELECT,
                }
            );

            const intent = rows[0];

            if (!intent) {
                throw new Error(
                    "Платёжное намерение не найдено"
                );
            }

            if (
                intent.payment_status !==
                "succeeded"
            ) {
                return {
                    completed: false,
                    paymentPending: true,
                };
            }

            // Проверяем существование реального
            // подтверждённого платежа в журнале.

            const receipts = await sequelize.query(
                `
                SELECT *
                FROM payment_receipts
                WHERE provider = :provider
                  AND payment_id = :paymentId
                  AND user_id = :userId
                  AND purpose = 'debt'
                LIMIT 1
                `,
                {
                    replacements: {
                        provider: intent.provider,
                        paymentId:
                        intent.provider_payment_id,
                        userId: uid,
                    },
                    transaction,
                    type: QueryTypes.SELECT,
                }
            );

            const receipt = receipts[0];

            if (
                !receipt ||
                Number(receipt.amount_kopecks) !==
                Number(intent.amount_kopecks)
            ) {
                throw new Error(
                    "Подтверждённый платёж не найден"
                );
            }

            if (
                intent.request_status !==
                "pending"
            ) {
                return {
                    completed: true,
                    duplicate: true,
                    requestStatus:
                    intent.request_status,
                    requestError:
                    intent.request_error,
                };
            }

            const orderId = Number(
                intent.order_id
            );

            const updateStatus = async (
                status,
                error = null
            ) => {
                await sequelize.query(
                    `
                    UPDATE debt_payment_intents
                    SET
                        request_status = :status,
                        request_error = :error
                    WHERE id = :id
                    `,
                    {
                        replacements: {
                            id,
                            status,
                            error,
                        },
                        transaction,
                    }
                );
            };

            const createNotification = async ({
                                                  recipientId,
                                                  type,
                                                  title,
                                                  body,
                                                  data = {},
                                              }) => {
                const notification =
                    await Notification.create(
                        {
                            userId: recipientId,
                            type,
                            title,
                            body,
                            orderId,
                            orderType: "regular",
                            isRead: false,
                            data: {
                                ...data,
                                type,
                                orderId,
                                orderType: "regular",
                                debtIntentId: id,
                            },
                        },
                        { transaction }
                    );

                return notification.toJSON();
            };

            const finishWithoutRequest = async (
                status,
                message
            ) => {
                await updateStatus(
                    status,
                    message
                );

                const notification =
                    await createNotification({
                        recipientId: uid,
                        type:
                            "debt_order_request_failed",
                        title:
                            "Платёж подтверждён",
                        body: message,
                    });

                return {
                    completed: true,
                    requestStatus: status,
                    requestError: message,
                    notifications: [
                        notification,
                    ],
                };
            };

            if (
                !Number.isSafeInteger(orderId) ||
                orderId <= 0
            ) {
                await updateStatus(
                    "not_required"
                );

                return {
                    completed: true,
                    requestStatus: "not_required",
                };
            }

            if (
                new Date(
                    intent.expires_at
                ).getTime() <= Date.now()
            ) {
                return finishWithoutRequest(
                    "expired",
                    "Платёж подтверждён, но срок " +
                    "отправки отклика истёк."
                );
            }

            if (Number(user.debt || 0) > 0) {
                return finishWithoutRequest(
                    "failed",
                    "Платёж учтён, но осталась " +
                    "непогашенная задолженность. " +
                    "Отклик не отправлен."
                );
            }

            let result;

            try {
                result =
                    await createRegularOrderRequest({
                        orderId,
                        executorId: uid,
                        proposedSum:
                        intent.proposed_sum,
                        comment:
                            intent.request_comment || "",
                        availableAt:
                            intent.available_at
                                ? new Date(
                                    intent.available_at
                                ).toISOString()
                                : null,
                        transaction,
                    });
            } catch (error) {
                // Бизнес-ограничение — сохраняем
                // результат без повторного отклика.
                //
                // Неожиданная ошибка базы данных —
                // откатываем транзакцию для повтора.

                if (
                    [400, 403, 404, 409].includes(
                        error.httpStatus
                    )
                ) {
                    return finishWithoutRequest(
                        "failed",
                        String(error.message)
                            .slice(0, 500)
                    );
                }

                throw error;
            }

            const order = result.order;

            const creatorId = Number(
                order.creatorId || order.userId
            );

            const customerNotification =
                await createNotification({
                    recipientId: creatorId,
                    type: "order_request",
                    title:
                        "Новый отклик на заказ",
                    body:
                        `Исполнитель хочет выполнить заказ №${orderId}`,
                    data: {
                        creatorId,
                        executorId: uid,
                        requesterId: uid,
                        proposedSum:
                        result.proposedSum,
                    },
                });

            const executorNotification =
                await createNotification({
                    recipientId: uid,
                    type:
                        "debt_order_request_sent",
                    title: "Отклик отправлен",
                    body:
                        "Задолженность погашена. " +
                        "Отклик отправлен заказчику.",
                    data: {
                        executorId: uid,
                        proposedSum:
                        result.proposedSum,
                    },
                });

            await ActionLog.create(
                {
                    actorUserId: uid,
                    actorRole: "system",
                    actionType:
                        "order_request_create",
                    entityType: "order",
                    entityId: orderId,
                    orderId,
                    severity: "info",
                    success: true,
                    meta: {
                        source:
                            "debt_payment_intent",
                        intentId: id,
                        provider:
                        intent.provider,
                        proposedSum:
                        result.proposedSum,
                        sourceOrderId:
                        result.sourceOrderId,
                    },
                },
                { transaction }
            );

            await updateStatus("sent");

            return {
                completed: true,
                duplicate: false,
                requestStatus: "sent",
                orderId,
                notifications: [
                    customerNotification,
                    executorNotification,
                ],
            };
        }
    );
}

module.exports = {
    finalizeDebtOrderRequest,
};