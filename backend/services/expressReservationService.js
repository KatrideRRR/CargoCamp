"use strict";

const {
    Op,
    QueryTypes,
} = require("sequelize");

const {
    sequelize,
    User,
    Order,
    ExpressOrder,
    ActionLog,
    PublicOfferAcceptance,
} = require("../models");

const {
    CURRENT_OFFER,
} = require("./publicOfferConsentService");

const {
    checkExpressReservationEligibility,
    REQUEST_TTL_SECONDS,
} = require("../utils/expressReservationPolicy");

function fail(status, message, code) {
    return Object.assign(
        new Error(message),
        {
            httpStatus: status,
            code,
        }
    );
}

function validId(value) {
    const id = Number(value);

    if (
        !Number.isSafeInteger(id) ||
        id <= 0
    ) {
        throw fail(
            400,
            "Некорректный идентификатор"
        );
    }

    return id;
}

async function select(sql, replacements, transaction) {
    return sequelize.query(sql, {
        replacements,
        transaction,
        type: QueryTypes.SELECT,
    });
}

async function execute(sql, replacements, transaction) {
    return sequelize.query(sql, {
        replacements,
        transaction,
    });
}

async function lockExecutor(executorId, transaction) {
    const executor = await User.findByPk(
        executorId,
        {
            transaction,
            lock: transaction.LOCK.UPDATE,
        }
    );

    if (
        !executor ||
        executor.role === "banned"
    ) {
        throw fail(
            403,
            "Исполнитель недоступен"
        );
    }

    return executor;
}

async function assertCurrentOffer(userId, transaction) {
    const acceptance =
        await PublicOfferAcceptance.findOne({
            where: {
                userId,
                offerVersion: CURRENT_OFFER.version,
                offerSha256: CURRENT_OFFER.sha256,
            },
            transaction,
        });

    if (!acceptance) {
        throw fail(
            428,
            "Необходимо принять действующую оферту",
            "PUBLIC_OFFER_REQUIRED"
        );
    }
}

function assertTargetAvailable(order, executorId) {
    if (!order) {
        throw fail(
            404,
            "Заказ не найден"
        );
    }

    if (
        Number(order.creatorId) ===
        Number(executorId)
    ) {
        throw fail(
            409,
            "Нельзя принять собственный заказ"
        );
    }

    if (
        order.status !== "created" ||
        order.executorId ||
        order.creatorHidden ||
        order.adminDeleted ||
        order.paymentType !== "cash"
    ) {
        throw fail(
            409,
            "Заказ больше недоступен"
        );
    }
}

function assertVehicle(order, executor) {
    if (order.type !== "taxi") return;

    const fields = [
        executor.vehicleBrand,
        executor.vehicleModel,
        executor.vehicleColor,
        executor.vehiclePlate,
    ];

    if (
        fields.some(
            (value) =>
                !String(value || "").trim()
        ) ||
        executor.vehicleVerificationStatus !==
        "verified"
    ) {
        throw fail(
            403,
            "Для заказа такси необходим подтверждённый автомобиль",
            "TAXI_VEHICLE_NOT_VERIFIED"
        );
    }
}

function applyVehicleSnapshot(order, executor) {
    if (order.type !== "taxi") return;

    order.executorVehicleBrand =
        executor.vehicleBrand;

    order.executorVehicleModel =
        executor.vehicleModel;

    order.executorVehicleColor =
        executor.vehicleColor;

    order.executorVehiclePlate =
        executor.vehiclePlate;

    order.executorVehiclePhoto =
        executor.vehiclePhoto || null;
}

async function assertNoOtherOrders({
                                       executorId,
                                       sourceOrderId,
                                       transaction,
                                   }) {
    const regular = await Order.findOne({
        where: {
            executorId,
            status: {
                [Op.notIn]: [
                    "completed",
                    "cancelled",
                    "expired",
                ],
            },
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
    });

    if (regular) {
        throw fail(
            409,
            "У исполнителя есть обычный заказ"
        );
    }

    const express = await ExpressOrder.findOne({
        where: {
            executorId,

            id: {
                [Op.ne]: sourceOrderId,
            },

            status: {
                [Op.notIn]: [
                    "completed",
                    "cancelled",
                ],
            },
        },

        transaction,
        lock: transaction.LOCK.UPDATE,
    });

    if (express) {
        throw fail(
            409,
            "У исполнителя уже есть другой активный или забронированный заказ"
        );
    }
}

async function writeAudit({
                              actorUserId,
                              actionType,
                              orderId,
                              meta,
                              transaction,
                          }) {
    await ActionLog.create(
        {
            actorUserId,
            actorRole: "user",
            actionType,
            entityType: "express_order",
            entityId: orderId,
            severity: "info",
            success: true,
            meta,
        },
        {
            transaction,
        }
    );
}

/*
 * Исполнитель предлагает принять следующий заказ.
 */
async function requestExpressReservation({
                                             orderId,
                                             executorId,
                                             sourceOrderId,
                                             latitude,
                                             longitude,
                                         }) {
    orderId = validId(orderId);
    executorId = validId(executorId);
    sourceOrderId = validId(sourceOrderId);

    if (orderId === sourceOrderId) {
        throw fail(
            409,
            "Нельзя забронировать текущий заказ"
        );
    }

    return sequelize.transaction(
        async (transaction) => {
            const executor =
                await lockExecutor(
                    executorId,
                    transaction
                );

            await assertCurrentOffer(
                executorId,
                transaction
            );

            const sourceOrder =
                await ExpressOrder.findByPk(
                    sourceOrderId,
                    {
                        transaction,
                        lock: transaction.LOCK.UPDATE,
                    }
                );

            await assertNoOtherOrders({
                executorId,
                sourceOrderId,
                transaction,
            });

            const eligibility =
                checkExpressReservationEligibility({
                    sourceOrder,
                    executorId,
                    latitude,
                    longitude,
                    hasRegularOrder: false,
                    hasReservation: false,
                    debtKopecks: Number(
                        executor.debt || 0
                    ),
                });

            if (!eligibility.allowed) {
                throw fail(
                    409,
                    "Следующий заказ пока недоступен",
                    eligibility.reason
                );
            }

            const order =
                await ExpressOrder.findByPk(
                    orderId,
                    {
                        transaction,
                        lock: transaction.LOCK.UPDATE,
                    }
                );

            assertTargetAvailable(
                order,
                executorId
            );

            assertVehicle(
                order,
                executor
            );

            /*
             * Просроченные предложения не блокируют
             * возможность сделать новый запрос.
             */
            await execute(
                `
                UPDATE express_reservation_requests
                SET
                    status = 'expired',
                    resolved_at = CURRENT_TIMESTAMP(3)
                WHERE executor_id = :executorId
                  AND status = 'pending'
                  AND expires_at <= CURRENT_TIMESTAMP(3)
                `,
                {
                    executorId,
                },
                transaction
            );

            await execute(
                `
    UPDATE express_reservation_requests r

    INNER JOIN express_orders target
        ON target.id = r.order_id

    INNER JOIN express_orders source
        ON source.id = r.source_order_id

    SET
        r.status = 'cancelled',
        r.resolved_at = CURRENT_TIMESTAMP(3)

    WHERE r.executor_id = :executorId
      AND r.status = 'pending'

      AND (
          target.status <> 'created'
          OR target.executor_id IS NOT NULL
          OR source.status <> 'in_progress'
          OR source.executor_id IS NULL
          OR source.executor_id <> :executorId
      )
    `,
                {
                    executorId,
                },
                transaction
            );

            const existing = await select(
                `
                SELECT id, order_id
                FROM express_reservation_requests
                WHERE executor_id = :executorId
                  AND status = 'pending'
                  AND expires_at > CURRENT_TIMESTAMP(3)
                LIMIT 1
                FOR UPDATE
                `,
                {
                    executorId,
                },
                transaction
            );

            if (existing.length) {
                throw fail(
                    409,
                    "У вас уже есть предложение следующего заказа",
                    "RESERVATION_REQUEST_EXISTS"
                );
            }

            await execute(
                `
                INSERT INTO express_reservation_requests (
                    order_id,
                    source_order_id,
                    executor_id,
                    status,
                    distance_to_destination_m,
                    expires_at
                )
                VALUES (
                    :orderId,
                    :sourceOrderId,
                    :executorId,
                    'pending',
                    :distanceMeters,
                    DATE_ADD(
                        CURRENT_TIMESTAMP(3),
                        INTERVAL :ttl SECOND
                    )
                )
                `,
                {
                    orderId,
                    sourceOrderId,
                    executorId,

                    distanceMeters:
                    eligibility.distanceMeters,

                    ttl:
                    REQUEST_TTL_SECONDS,
                },
                transaction
            );

            const [request] = await select(
                `
                SELECT id, expires_at
                FROM express_reservation_requests
                WHERE executor_id = :executorId
                  AND order_id = :orderId
                  AND status = 'pending'
                ORDER BY id DESC
                LIMIT 1
                `,
                {
                    executorId,
                    orderId,
                },
                transaction
            );

            await writeAudit({
                actorUserId: executorId,

                actionType:
                    "express_reservation_requested",

                orderId,

                meta: {
                    requestId: request.id,
                    sourceOrderId,
                    distanceMeters:
                    eligibility.distanceMeters,
                },

                transaction,
            });

            return {
                requestId: request.id,
                orderId,
                creatorId: order.creatorId,
                executorId,
                expiresAt: request.expires_at,
                distanceMeters:
                eligibility.distanceMeters,
            };
        }
    );
}

/*
 * Заказчик получает предложения исполнителей.
 */
async function listExpressReservationRequests({
                                                  orderId,
                                                  creatorId,
                                              }) {
    orderId = validId(orderId);
    creatorId = validId(creatorId);

    const order =
        await ExpressOrder.findByPk(orderId);

    if (!order) {
        throw fail(
            404,
            "Заказ не найден"
        );
    }

    if (
        Number(order.creatorId) !==
        creatorId
    ) {
        throw fail(
            403,
            "Нет доступа к предложениям"
        );
    }

    if (
        order.status !== "created" ||
        order.executorId
    ) {
        return [];
    }

    const rows = await select(
        `
        SELECT
            id,
            executor_id,
            distance_to_destination_m,
            expires_at
        FROM express_reservation_requests
        WHERE order_id = :orderId
          AND status = 'pending'
          AND expires_at > CURRENT_TIMESTAMP(3)
        ORDER BY id ASC
        `,
        {
            orderId,
        }
    );

    const result = [];

    for (const row of rows) {
        const executor = await User.findByPk(
            row.executor_id,
            {
                attributes: [
                    "id",
                    "username",
                    "rating",
                    "ratingCount",
                    "vehicleBrand",
                    "vehicleModel",
                    "vehicleColor",
                ],
            }
        );

        if (!executor) continue;

        result.push({
            id: row.id,

            executor: {
                id: executor.id,
                username: executor.username,
                rating: executor.rating,
                ratingCount: executor.ratingCount,
                vehicleBrand: executor.vehicleBrand,
                vehicleModel: executor.vehicleModel,
                vehicleColor: executor.vehicleColor,
            },

            distanceMeters:
            row.distance_to_destination_m,

            expiresAt:
            row.expires_at,
        });
    }

    return result;
}

/*
 * Заказчик подтверждает предложение.
 */
async function approveExpressReservation({
                                             orderId,
                                             requestId,
                                             creatorId,
                                         }) {
    orderId = validId(orderId);
    requestId = validId(requestId);
    creatorId = validId(creatorId);

    return sequelize.transaction(
        async (transaction) => {
            /*
             * Сначала узнаём исполнителя.
             * Блокируем его до блокировки заказа.
             */
            const [snapshot] = await select(
                `
                SELECT executor_id, source_order_id
                FROM express_reservation_requests
                WHERE id = :requestId
                  AND order_id = :orderId
                LIMIT 1
                `,
                {
                    requestId,
                    orderId,
                },
                transaction
            );

            if (!snapshot) {
                throw fail(
                    404,
                    "Предложение не найдено"
                );
            }

            const executorId =
                Number(snapshot.executor_id);

            const sourceOrderId =
                Number(snapshot.source_order_id);

            const executor =
                await lockExecutor(
                    executorId,
                    transaction
                );

            await assertCurrentOffer(
                creatorId,
                transaction
            );

            await assertCurrentOffer(
                executorId,
                transaction
            );

            const source =
                await ExpressOrder.findByPk(
                    sourceOrderId,
                    {
                        transaction,
                        lock: transaction.LOCK.UPDATE,
                    }
                );

            const order =
                await ExpressOrder.findByPk(
                    orderId,
                    {
                        transaction,
                        lock: transaction.LOCK.UPDATE,
                    }
                );

            if (!order) {
                throw fail(
                    404,
                    "Заказ не найден"
                );
            }

            if (
                Number(order.creatorId) !==
                creatorId
            ) {
                throw fail(
                    403,
                    "Только заказчик может подтвердить предложение"
                );
            }

            const [request] = await select(
                `
                SELECT id, executor_id, source_order_id
                FROM express_reservation_requests
                WHERE id = :requestId
                  AND order_id = :orderId
                  AND status = 'pending'
                  AND expires_at > CURRENT_TIMESTAMP(3)
                FOR UPDATE
                `,
                {
                    requestId,
                    orderId,
                },
                transaction
            );

            if (!request) {
                throw fail(
                    409,
                    "Предложение истекло или уже обработано"
                );
            }

            assertTargetAvailable(
                order,
                executorId
            );

            assertVehicle(
                order,
                executor
            );

            if (
                !source ||
                Number(source.executorId) !== executorId ||
                source.status !== "in_progress"
            ) {
                throw fail(
                    409,
                    "Текущий заказ исполнителя изменился"
                );
            }

            await assertNoOtherOrders({
                executorId,
                sourceOrderId,
                transaction,
            });

            if (
                Number(executor.debt || 0) > 0
            ) {
                throw fail(
                    403,
                    "У исполнителя появилась задолженность"
                );
            }

            order.executorId = executorId;

            order.status = "reserved";

            order.reservationSourceOrderId =
                sourceOrderId;

            order.reservationApprovedAt =
                new Date();

            order.reservationActivatedAt =
                null;

            applyVehicleSnapshot(
                order,
                executor
            );

            await order.save({
                transaction,
            });

            await execute(
                `
                UPDATE express_reservation_requests
                SET
                    status = 'approved',
                    resolved_at = CURRENT_TIMESTAMP(3)
                WHERE id = :requestId
                `,
                {
                    requestId,
                },
                transaction
            );

            await execute(
                `
                UPDATE express_reservation_requests
                SET
                    status = 'rejected',
                    resolved_at = CURRENT_TIMESTAMP(3)
                WHERE order_id = :orderId
                  AND id <> :requestId
                  AND status = 'pending'
                `,
                {
                    orderId,
                    requestId,
                },
                transaction
            );

            await writeAudit({
                actorUserId: creatorId,

                actionType:
                    "express_reservation_approved",

                orderId,

                meta: {
                    requestId,
                    executorId,
                    sourceOrderId,
                },

                transaction,
            });

            return order;
        }
    );
}

/*
 * Вызывается внутри транзакции завершения
 * текущего экспресс-заказа.
 */
async function activateNextExpressOrder({
                                            sourceOrder,
                                            executorId,
                                            transaction,
                                        }) {
    if (!transaction) {
        throw new Error(
            "Для активации необходима транзакция"
        );
    }

    if (
        sourceOrder.status !== "completed" ||
        Number(sourceOrder.executorId) !==
        Number(executorId)
    ) {
        throw fail(
            409,
            "Исходный заказ ещё не завершён"
        );
    }

    const reservations =
        await ExpressOrder.findAll({
            where: {
                executorId,
                status: "reserved",
                reservationSourceOrderId:
                sourceOrder.id,
            },

            transaction,
            lock: transaction.LOCK.UPDATE,
        });

    if (reservations.length > 1) {
        throw fail(
            409,
            "Обнаружено несколько следующих заказов"
        );
    }

    const nextOrder =
        reservations[0] || null;

    if (
        nextOrder &&
        (
            nextOrder.adminDeleted ||
            nextOrder.creatorHidden
        )
    ) {
        nextOrder.status = "cancelled";

        nextOrder.dealStatus = "cancelled";

        await nextOrder.save({
            transaction,
        });

        await execute(
            `
        UPDATE express_reservation_requests
        SET
            status = 'cancelled',
            resolved_at = CURRENT_TIMESTAMP(3)
        WHERE order_id = :orderId
          AND status = 'approved'
        `,
            {
                orderId: nextOrder.id,
            },
            transaction
        );

        await execute(
            `
        UPDATE express_reservation_requests
        SET
            status = 'cancelled',
            resolved_at = CURRENT_TIMESTAMP(3)
        WHERE source_order_id = :sourceOrderId
          AND status = 'pending'
        `,
            {
                sourceOrderId:
                sourceOrder.id,
            },
            transaction
        );

        await writeAudit({
            actorUserId:
            executorId,

            actionType:
                "express_reservation_activation_skipped",

            orderId:
            nextOrder.id,

            meta: {
                reason:
                    "TARGET_ORDER_HIDDEN_OR_DELETED",
            },

            transaction,
        });

        return null;
    }

    if (nextOrder) {
        nextOrder.status = "accepted";

        nextOrder.reservationActivatedAt =
            new Date();

        await nextOrder.save({
            transaction,
        });

        await writeAudit({
            actorUserId: executorId,

            actionType:
                "express_reservation_activated",

            orderId: nextOrder.id,

            meta: {
                sourceOrderId:
                sourceOrder.id,

                automatic: true,
            },

            transaction,
        });
    }

    /*
     * Неподтверждённые предложения больше
     * не актуальны после завершения поездки.
     */
    await execute(
        `
        UPDATE express_reservation_requests
        SET
            status = 'cancelled',
            resolved_at = CURRENT_TIMESTAMP(3)
        WHERE source_order_id = :sourceOrderId
          AND executor_id = :executorId
          AND status = 'pending'
        `,
        {
            sourceOrderId:
            sourceOrder.id,

            executorId,
        },
        transaction
    );

    return nextOrder;
}

async function rejectExpressReservation({
                                            orderId,
                                            requestId,
                                            userId,
                                        }) {
    orderId = validId(orderId);
    requestId = validId(requestId);
    userId = validId(userId);

    return sequelize.transaction(
        async (transaction) => {
            const order =
                await ExpressOrder.findByPk(
                    orderId,
                    {
                        transaction,
                        lock: transaction.LOCK.UPDATE,
                    }
                );

            if (!order) {
                throw fail(
                    404,
                    "Заказ не найден"
                );
            }

            const [request] = await select(
                `
                SELECT id, executor_id, status
                FROM express_reservation_requests
                WHERE id = :requestId
                  AND order_id = :orderId
                FOR UPDATE
                `,
                {
                    requestId,
                    orderId,
                },
                transaction
            );

            if (!request) {
                throw fail(
                    404,
                    "Предложение не найдено"
                );
            }

            const byCreator =
                Number(order.creatorId) === userId;

            const byExecutor =
                Number(request.executor_id) === userId;

            if (
                !byCreator &&
                !byExecutor
            ) {
                throw fail(
                    403,
                    "Нет доступа"
                );
            }

            if (request.status !== "pending") {
                throw fail(
                    409,
                    "Предложение уже обработано"
                );
            }

            const status = byCreator
                ? "rejected"
                : "cancelled";

            await execute(
                `
                UPDATE express_reservation_requests
                SET
                    status = :status,
                    resolved_at = CURRENT_TIMESTAMP(3)
                WHERE id = :requestId
                `,
                {
                    status,
                    requestId,
                },
                transaction
            );

            await writeAudit({
                actorUserId: userId,

                actionType: byCreator
                    ? "express_reservation_rejected"
                    : "express_reservation_withdrawn",

                orderId,

                meta: {
                    requestId,
                    status,
                },

                transaction,
            });

            return {
                orderId,
                creatorId: order.creatorId,
                executorId: request.executor_id,
                status,
            };
        }
    );
}

async function cancelExpressReservation({
                                            orderId,
                                            userId,
                                        }) {
    orderId = validId(orderId);
    userId = validId(userId);

    return sequelize.transaction(
        async (transaction) => {
            const snapshot =
                await ExpressOrder.findByPk(
                    orderId,
                    {
                        transaction,
                    }
                );

            if (
                !snapshot ||
                !snapshot.executorId
            ) {
                throw fail(
                    404,
                    "Бронирование не найдено"
                );
            }

            const executorId =
                Number(snapshot.executorId);

            await lockExecutor(
                executorId,
                transaction
            );

            const order =
                await ExpressOrder.findByPk(
                    orderId,
                    {
                        transaction,
                        lock: transaction.LOCK.UPDATE,
                    }
                );

            if (
                !order ||
                order.status !== "reserved" ||
                Number(order.executorId) !== executorId
            ) {
                throw fail(
                    409,
                    "Бронирование уже недоступно"
                );
            }

            if (
                Number(order.creatorId) !== userId &&
                executorId !== userId
            ) {
                throw fail(
                    403,
                    "Нет доступа"
                );
            }

            order.status = "created";

            order.executorId = null;

            order.reservationSourceOrderId = null;
            order.reservationApprovedAt = null;
            order.reservationActivatedAt = null;

            order.executorVehicleBrand = null;
            order.executorVehicleModel = null;
            order.executorVehicleColor = null;
            order.executorVehiclePlate = null;
            order.executorVehiclePhoto = null;

            await order.save({
                transaction,
            });

            await execute(
                `
                UPDATE express_reservation_requests
                SET
                    status = 'cancelled',
                    resolved_at = CURRENT_TIMESTAMP(3)
                WHERE order_id = :orderId
                  AND executor_id = :executorId
                  AND status = 'approved'
                `,
                {
                    orderId,
                    executorId,
                },
                transaction
            );

            await writeAudit({
                actorUserId: userId,

                actionType:
                    "express_reservation_cancelled",

                orderId,

                meta: {
                    previousExecutorId:
                    executorId,
                },

                transaction,
            });

            return {
                order,
                previousExecutorId:
                executorId,
            };
        }
    );
}

async function getMyPendingExpressReservation({
                                                  executorId,
                                              }) {
    executorId = validId(executorId);

    const creatorHidden =
        ExpressOrder.rawAttributes.creatorHidden.field;

    const adminDeleted =
        ExpressOrder.rawAttributes.adminDeleted.field;

    const [request] = await select(
        `
        SELECT
            r.id,
            r.order_id,
            r.source_order_id,
            r.expires_at,
            r.distance_to_destination_m
        FROM express_reservation_requests r

        INNER JOIN express_orders target
            ON target.id = r.order_id

        INNER JOIN express_orders source
            ON source.id = r.source_order_id

        WHERE r.executor_id = :executorId
          AND r.status = 'pending'
          AND r.expires_at > CURRENT_TIMESTAMP(3)

          AND target.status = 'created'
          AND target.executor_id IS NULL
          AND target.creatorHidden = 0
          AND target.adminDeleted = 0

          AND source.executor_id = :executorId
          AND source.status = 'in_progress'

        ORDER BY r.id DESC
        LIMIT 1
        `,
        {
            executorId,
        }
    );

    if (!request) return null;

    return {
        id: request.id,

        orderId:
        request.order_id,

        sourceOrderId:
        request.source_order_id,

        expiresAt:
        request.expires_at,

        distanceMeters:
        request.distance_to_destination_m,
    };
}

async function releaseInvalidExpressReservations({
                                                     executorId,
                                                 }) {
    executorId = validId(executorId);

    return sequelize.transaction(
        async (transaction) => {
            await lockExecutor(
                executorId,
                transaction
            );

            const orders =
                await ExpressOrder.findAll({
                    where: {
                        executorId,
                        status: "reserved",
                    },
                    transaction,
                    lock:
                    transaction.LOCK.UPDATE,
                });

            const released = [];

            for (const order of orders) {
                const source =
                    order.reservationSourceOrderId
                        ? await ExpressOrder.findByPk(
                            order.reservationSourceOrderId,
                            {
                                transaction,
                                lock:
                                transaction.LOCK.UPDATE,
                            }
                        )
                        : null;

                if (
                    source &&
                    Number(source.executorId) ===
                    executorId &&
                    [
                        "in_progress",
                        "completed",
                    ].includes(source.status) &&
                    !source.adminDeleted
                ) {
                    continue;
                }

                order.status = "created";

                order.executorId = null;

                order.reservationSourceOrderId =
                    null;

                order.reservationApprovedAt =
                    null;

                order.reservationActivatedAt =
                    null;

                order.executorVehicleBrand = null;
                order.executorVehicleModel = null;
                order.executorVehicleColor = null;
                order.executorVehiclePlate = null;
                order.executorVehiclePhoto = null;

                await order.save({
                    transaction,
                });

                await execute(
                    `
                    UPDATE express_reservation_requests
                    SET
                        status = 'cancelled',
                        resolved_at = CURRENT_TIMESTAMP(3)
                    WHERE order_id = :orderId
                      AND executor_id = :executorId
                      AND status = 'approved'
                    `,
                    {
                        orderId: order.id,
                        executorId,
                    },
                    transaction
                );

                await writeAudit({
                    actorUserId:
                    executorId,

                    actionType:
                        "express_reservation_released",

                    orderId:
                    order.id,

                    meta: {
                        automatic: true,

                        reason:
                            "SOURCE_ORDER_UNAVAILABLE",

                        previousExecutorId:
                        executorId,
                    },

                    transaction,
                });

                released.push({
                    orderId: order.id,

                    creatorId:
                    order.creatorId,

                    executorId,
                });
            }

            return released;
        }
    );
}

module.exports = {
    requestExpressReservation,
    listExpressReservationRequests,
    approveExpressReservation,
    rejectExpressReservation,
    cancelExpressReservation,
    activateNextExpressOrder,
    getMyPendingExpressReservation,
    releaseInvalidExpressReservations,
};