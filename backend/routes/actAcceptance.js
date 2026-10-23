const express = require("express");
const crypto = require("crypto");
const {Op} = require("sequelize");
const {notifyContractWorkflow,} = require("../services/contractWorkflowNotificationService");
const authenticateToken = require("../middlewares/userAuth");
const {sequelize, Order, Contract, ContractEvent, Dispute,} = require("../models");
const {assertVerifiedPdfIntegrity,} = require("../services/verifiedPdfIntegrity");

const router = express.Router();

const DECISIONS = [
    "accepted",
    "remarks",
    "dispute",
];

const ACTIVE_DISPUTE_STATUSES = [
    "open",
    "in_review",
    "waiting_creator",
    "waiting_executor",
];

router.use(authenticateToken);

router.use((req, res, next) => {res.setHeader("Cache-Control", "no-store");next();});

function fail(status, message) {
    return Object.assign(
        new Error(message),
        {httpStatus: status}
    );
}

function respondError(res, error) {
    if (error.httpStatus) {
        return res.status(error.httpStatus).json({
            success: false,
            message: error.message,
        });
    }

    console.error("Act acceptance error:", error);

    return res.status(500).json({
        success: false,
        message: "Ошибка обработки приёмки",
    });
}

function sameSha256(a, b) {
    if (
        !/^[a-f0-9]{64}$/i.test(String(a || "")) ||
        !/^[a-f0-9]{64}$/i.test(String(b || ""))
    ) {
        return false;
    }

    return crypto.timingSafeEqual(
        Buffer.from(a, "hex"),
        Buffer.from(b, "hex")
    );
}

function serializeDecision(event) {
    if (!event) return null;

    return {
        decision: event.metadata?.decision || null,
        comment: event.metadata?.comment || "",
        disputeId: event.metadata?.disputeId || null,
        decidedAt: event.eventAt,
        documentHash:
            event.metadata?.documentHash || null,
    };
}

async function getContext(actId, userId, transaction = null, lock = false) {
    if (!/^[1-9]\d*$/.test(String(actId))) {
        throw fail(400, "Некорректный ID акта");
    }

    const act = await Contract.findOne({
        where: {
            id: actId,
            type: "verified_completion_act",
        },
        transaction,
        ...(lock
            ? {lock: transaction.LOCK.UPDATE}
            : {}),
    });

    if (!act) {
        throw fail(404, "Акт не найден");
    }

    const order = await Order.findByPk(
        act.orderId,
        {transaction}
    );

    if (!order) {
        throw fail(404, "Акт не найден");
    }

    const isCustomer =
        Number(order.creatorId) === Number(userId);

    const isExecutor =
        Number(order.executorId) === Number(userId);

    if (!isCustomer && !isExecutor) {
        // Не раскрываем существование чужого акта.
        throw fail(404, "Акт не найден");
    }

    return {
        act,
        order,
        isCustomer,
        isExecutor,
    };
}

async function findDecision(actId, transaction = null) {
    return ContractEvent.findOne({
        where: {
            contractId: actId,
            eventType: "act_customer_decision",
        },
        order: [["id", "DESC"]],
        transaction,
    });
}

async function findActiveDispute(orderId, transaction = null) {
    return Dispute.findOne({
        where: {
            orderId,
            orderType: "regular",
            status: {
                [Op.in]: ACTIVE_DISPUTE_STATUSES,
            },
        },
        order: [["id", "DESC"]],
        transaction,
    });
}

function canDecide(ctx, hasDecision) {
    return (
        ctx.isCustomer &&
        ctx.order.status === "completed" &&
        ctx.act.status === "draft" &&
        !ctx.act.fullySignedAt &&
        !ctx.act.supersededAt &&
        !hasDecision
    );
}

/*
 * GET /api/contracts/acts/:actId/acceptance
 */
router.get("/:actId/acceptance", async (req, res) => {
        try {
            const ctx = await getContext(
                req.params.actId,
                req.user.id
            );

            const [event, activeDispute] =
                await Promise.all([
                    findDecision(ctx.act.id),
                    findActiveDispute(ctx.order.id),
                ]);

            return res.json({
                success: true,
                actId: ctx.act.id,
                orderId: ctx.order.id,
                documentHash: ctx.act.documentHash,
                actStatus: ctx.act.status,

                canDecide: canDecide(
                    ctx,
                    Boolean(event)
                ),

                isCustomer: ctx.isCustomer,

                hasActiveDispute:
                    Boolean(activeDispute),

                decision: serializeDecision(event),
                canRequestCorrections:
                    Number(ctx.act.version) === 1,
            });

        } catch (error) {
            return respondError(res, error);
        }
    });

router.post("/:actId/acceptance", async (req, res) => {
        try {
            const userId = Number(req.user.id);

            const decision = String(
                req.body?.decision || ""
            );

            if (
                decision === "remarks" &&
                Number(ctxBefore.act.version) > 1
            ) {
                throw fail(
                    409,
                    "Повторная процедура исправлений для этого акта недоступна. При несогласии откройте спор."
                );
            }

            const comment = String(
                req.body?.comment || ""
            ).trim();

            const disputeId =
                req.body?.disputeId == null
                    ? null
                    : Number(req.body.disputeId);

            if (!DECISIONS.includes(decision)) {
                throw fail(
                    400,
                    "Выберите результат приёмки"
                );
            }

            if (comment.length > 1500) {
                throw fail(
                    400,
                    "Комментарий не должен превышать 1500 символов"
                );
            }

            if (
                ["remarks", "dispute"].includes(decision) &&
                comment.length < 10
            ) {
                throw fail(
                    400,
                    "Опишите замечания: минимум 10 символов"
                );
            }

            if (
                decision === "dispute" &&
                (
                    !Number.isSafeInteger(disputeId) ||
                    disputeId <= 0
                )
            ) {
                throw fail(
                    400,
                    "Сначала необходимо открыть спор"
                );
            }

            const ctxBefore = await getContext(
                req.params.actId,
                userId
            );

            if (
                decision === "remarks" &&
                Number(ctxBefore.act.version) > 1
            ) {
                throw fail(
                    409,
                    "Повторная процедура исправлений для этого акта недоступна. При несогласии откройте спор."
                );
            }

            if (!ctxBefore.isCustomer) {
                throw fail(
                    403,
                    "Решение о приёмке принимает заказчик"
                );
            }

            if (
                !sameSha256(
                    req.body?.documentHash,
                    ctxBefore.act.documentHash
                )
            ) {
                throw fail(
                    409,
                    "Версия акта изменилась. Обновите страницу."
                );
            }

            /*
             * Проверяем фактический PDF,
             * а не только хеш из запроса.
             */
            await assertVerifiedPdfIntegrity(
                ctxBefore.act
            );

            const result = await sequelize.transaction(
                async (transaction) => {
                    const ctx = await getContext(
                        req.params.actId,
                        userId,
                        transaction,
                        true
                    );

                    if (
                        !sameSha256(
                            ctxBefore.act.documentHash,
                            ctx.act.documentHash
                        )
                    ) {
                        throw fail(
                            409,
                            "Акт был изменён"
                        );
                    }

                    const latestAct =
                        await Contract.findOne({
                            where: {
                                orderId: ctx.order.id,
                                type: "verified_completion_act",
                            },
                            order: [
                                ["version", "DESC"],
                                ["id", "DESC"],
                            ],
                            transaction,
                        });

                    if (
                        String(latestAct?.id) !==
                        String(ctx.act.id)
                    ) {
                        throw fail(
                            409,
                            "Для заказа создана новая версия акта"
                        );
                    }

                    const existing = await findDecision(
                        ctx.act.id,
                        transaction
                    );

                    if (existing) {
                        const saved = serializeDecision(existing);

                        /*
                         * Повтор точно такого же запроса
                         * безопасен и не создаёт новое событие.
                         */
                        if (
                            saved.decision === decision &&
                            saved.comment ===
                            (decision === "accepted"
                                ? ""
                                : comment) &&
                            Number(saved.disputeId || 0) ===
                            Number(disputeId || 0)
                        ) {
                            return {
                                created: false,
                                decision: saved,
                            };
                        }

                        throw fail(
                            409,
                            "Решение уже сохранено. Для изменения потребуется новая версия акта."
                        );
                    }

                    if (!canDecide(ctx, false)) {
                        throw fail(
                            409,
                            "Акт недоступен для приёмки"
                        );
                    }

                    const activeDispute =
                        await findActiveDispute(
                            ctx.order.id,
                            transaction
                        );

                    if (
                        decision === "accepted" &&
                        activeDispute
                    ) {
                        throw fail(
                            409,
                            "По заказу открыт спор. Приёмка без замечаний недоступна."
                        );
                    }

                    if (decision === "dispute") {
                        const dispute =
                            await Dispute.findOne({
                                where: {
                                    id: disputeId,
                                    orderId: ctx.order.id,
                                    orderType: "regular",
                                    status: {
                                        [Op.in]:
                                        ACTIVE_DISPUTE_STATUSES,
                                    },
                                },
                                transaction,
                            });

                        if (!dispute) {
                            throw fail(
                                409,
                                "Активный спор не найден"
                            );
                        }
                    }

                    const event =
                        await ContractEvent.create(
                            {
                                contractId: ctx.act.id,
                                actorUserId: userId,
                                actorRole: "creator",
                                eventType:
                                    "act_customer_decision",
                                eventAt: new Date(),

                                metadata: {
                                    decision,

                                    comment:
                                        decision === "accepted"
                                            ? ""
                                            : comment,

                                    disputeId:
                                        decision === "dispute"
                                            ? disputeId
                                            : null,

                                    documentHash:
                                    ctx.act.documentHash,

                                    documentVersion:
                                    ctx.act.version,

                                    source:
                                        "cargocamp_order_history",
                                },
                            },
                            {transaction}
                        );

                    return {
                        created: true,
                        decision: serializeDecision(event),
                    };
                }
            );

            if (
                result.created &&
                decision === "remarks"
            ) {
                await notifyContractWorkflow({
                    event: "act_remarks_received",

                    userId: ctxBefore.order.executorId,
                    orderId: ctxBefore.order.id,
                    actId: ctxBefore.act.id,
                    version: ctxBefore.act.version,
                });
            }

            return res.json({
                success: true,
                ...result,
            });

        } catch (error) {
            return respondError(res, error);
        }
    });

module.exports = router;
