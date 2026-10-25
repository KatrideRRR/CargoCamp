const express = require("express");
const { Op } = require("sequelize");
const crypto = require("crypto");
const authenticateToken = require("../middlewares/userAuth");
const {sequelize, Order, Contract, ContractEvent, Dispute,} = require("../models");
const {assertVerifiedPdfIntegrity,} = require("../services/verifiedPdfIntegrity");
const {prepareVerifiedActV2,} = require("../services/verifiedActRevisionService");
const {notifyContractWorkflow,} = require("../services/contractWorkflowNotificationService");

const router = express.Router();

const EVENT_SUBMITTED =
    "act_remediation_submitted";

const EVENT_REJECTED =
    "act_remediation_rejected";

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
        { httpStatus: status }
    );
}

function sendError(res, error) {
    if (error.httpStatus) {
        return res.status(error.httpStatus).json({
            success: false,
            message: error.message,
        });
    }

    console.error("Act remediation error:", error);

    return res.status(500).json({
        success: false,
        message:
            "Не удалось обработать исправления",
    });
}

function hashMatches(first, second) {
    if (
        !/^[a-f0-9]{64}$/i.test(String(first || "")) ||
        !/^[a-f0-9]{64}$/i.test(String(second || ""))
    ) {
        return false;
    }

    return crypto.timingSafeEqual(
        Buffer.from(first, "hex"),
        Buffer.from(second, "hex")
    );
}

function normalizeComment(value, required = true) {
    if (
        value != null &&
        typeof value !== "string"
    ) {
        throw fail(400, "Некорректный комментарий");
    }

    const comment = String(value || "").trim();

    if (comment.length > 1500) {
        throw fail(
            400,
            "Максимальная длина комментария — 1500 символов"
        );
    }

    if (required && comment.length < 10) {
        throw fail(
            400,
            "Напишите минимум 10 символов"
        );
    }

    return comment;
}

async function context(actId, userId, transaction = null, lock = false) {
    if (!/^[1-9]\d*$/.test(String(actId))) {
        throw fail(400, "Некорректный номер акта");
    }

    const act = await Contract.findOne({
        where: {
            id: actId,
            type: "verified_completion_act",
            version: 1,
        },
        transaction,
        ...(lock
            ? { lock: transaction.LOCK.UPDATE }
            : {}),
    });

    if (!act) {
        throw fail(404, "Акт не найден");
    }

    const order = await Order.findByPk(
        act.orderId,
        { transaction }
    );

    if (!order) {
        throw fail(404, "Акт не найден");
    }

    const isCustomer =
        Number(order.creatorId) === userId;

    const isExecutor =
        Number(order.executorId) === userId;

    if (!isCustomer && !isExecutor) {
        throw fail(404, "Акт не найден");
    }

    return {
        act,
        order,
        isCustomer,
        isExecutor,
    };
}

async function loadState(ctx, transaction = null) {
    const [decisionEvent, events, revision, dispute] =
        await Promise.all([
            ContractEvent.findOne({
                where: {
                    contractId: ctx.act.id,
                    eventType: "act_customer_decision",
                },
                transaction,
                order: [["id", "DESC"]],
            }),

            ContractEvent.findAll({
                where: {
                    contractId: ctx.act.id,
                    eventType: {
                        [Op.in]: [
                            EVENT_SUBMITTED,
                            EVENT_REJECTED,
                        ],
                    },
                },
                transaction,
                order: [["id", "ASC"]],
            }),

            Contract.findOne({
                where: {
                    orderId: ctx.order.id,
                    type: "verified_completion_act",
                    version: 2,
                },
                transaction,
            }),

            Dispute.findOne({
                where: {
                    orderId: ctx.order.id,
                    orderType: "regular",
                    status: {
                        [Op.in]:
                        ACTIVE_DISPUTE_STATUSES,
                    },
                },
                transaction,
            }),
        ]);

    const validRemarks =
        decisionEvent?.metadata?.decision ===
        "remarks" &&
        Number(decisionEvent.actorUserId) ===
        Number(ctx.order.creatorId) &&
        hashMatches(
            decisionEvent.metadata?.documentHash,
            ctx.act.documentHash
        );

    const submissions = events.filter(
        (event) =>
            event.eventType === EVENT_SUBMITTED
    );

    const last = events[events.length - 1] || null;

    let status = "not_applicable";

    if (validRemarks) {
        if (revision) {
            status = "revised";
        } else if (
            dispute ||
            ctx.act.supersededAt
        ) {
            status = "blocked";
        } else if (
            last?.eventType === EVENT_SUBMITTED
        ) {
            status = "awaiting_customer";
        } else {
            status = "awaiting_executor";
        }
    }

    if (
        ctx.order.status !== "completed" ||
        ctx.act.status !== "draft" ||
        ctx.act.fullySignedAt
    ) {
        if (status !== "revised") {
            status = "blocked";
        }
    }

    return {
        status,
        decisionEvent,
        lastEvent: last,
        latestSubmission:
            submissions[submissions.length - 1] ||
            null,
        round: submissions.length,
        revision,
        dispute,
    };
}

function requireCurrentRound(state, expectedRound, submitting = false) {
    const currentRound =
        submitting && state.status === "awaiting_customer"
            ? expectedRound + 1
            : expectedRound;

    if (
        !Number.isSafeInteger(expectedRound) ||
        expectedRound < 0 ||
        state.round !== currentRound
    ) {
        throw fail(
            409,
            "Состояние исправлений изменилось. Обновите страницу."
        );
    }
}

function publicState(ctx, state) {
    return {
        success: true,

        actId: ctx.act.id,
        orderId: ctx.order.id,

        status: state.status,
        round: state.round,

        isCustomer: ctx.isCustomer,
        isExecutor: ctx.isExecutor,

        originalRemarks:
            state.decisionEvent?.metadata?.decision ===
            "remarks"
                ? state.decisionEvent.metadata.comment
                : null,

        submitted:
            state.status === "awaiting_customer"
                ? {
                    comment:
                    state.lastEvent.metadata?.comment,

                    submittedAt:
                    state.lastEvent.eventAt,
                }
                : null,

        canSubmit:
            ctx.isExecutor &&
            state.status === "awaiting_executor",

        canReview:
            ctx.isCustomer &&
            state.status === "awaiting_customer",

        revisedAct: state.revision
            ? {
                id: state.revision.id,
                version: state.revision.version,
                documentNumber:
                state.revision.documentNumber,
            }
            : null,
    };
}

router.get("/:actId/remediation", async (req, res) => {
        try {
            const ctx = await context(
                req.params.actId,
                Number(req.user.id)
            );

            const state = await loadState(ctx);

            return res.json(
                publicState(ctx, state)
            );

        } catch (error) {
            return sendError(res, error);
        }
    });

router.post("/:actId/remediation/submit", async (req, res) => {
        try {
            const userId = Number(req.user.id);

            const comment = normalizeComment(
                req.body?.comment
            );

            const result =
                await sequelize.transaction(
                    async (transaction) => {
                        const ctx = await context(
                            req.params.actId,
                            userId,
                            transaction,
                            true
                        );

                        if (!ctx.isExecutor) {
                            throw fail(
                                403,
                                "Сообщить об исправлениях может только исполнитель"
                            );
                        }

                        if (!hashMatches(
                            req.body?.documentHash,
                            ctx.act.documentHash
                        )) {
                            throw fail(
                                409,
                                "Акт изменился"
                            );
                        }

                        const state =
                            await loadState(
                                ctx,
                                transaction
                            );

                        requireCurrentRound(state, req.body?.expectedRound, true);

                        if (
                            state.status ===
                            "awaiting_customer"
                        ) {
                            if (
                                state.lastEvent
                                    ?.metadata?.comment ===
                                comment
                            ) {
                                return {
                                    created: false,
                                    round: state.round,
                                };
                            }

                            throw fail(
                                409,
                                "Исправления уже отправлены заказчику"
                            );
                        }

                        if (
                            state.status !==
                            "awaiting_executor"
                        ) {
                            throw fail(
                                409,
                                "Сейчас нельзя отправить исправления"
                            );
                        }

                        await assertVerifiedPdfIntegrity(
                            ctx.act
                        );

                        const nextRound =
                            state.round + 1;

                        await ContractEvent.create(
                            {
                                contractId: ctx.act.id,
                                actorUserId: userId,
                                actorRole: "executor",

                                eventType:
                                EVENT_SUBMITTED,

                                eventAt: new Date(),

                                metadata: {
                                    round: nextRound,
                                    comment,
                                    documentHash:
                                    ctx.act.documentHash,
                                },
                            },
                            { transaction }
                        );

                        return {
                            created: true,
                            round: nextRound,
                        };
                    }
                );

            try {
            if (result.created) {
                const completedAct = await Contract.findByPk(
                    req.params.actId,
                    {
                        attributes: [
                            "id",
                            "orderId",
                            "version",
                        ],
                    }
                );

                if (completedAct) {
                    const recipientOrder = await Order.findByPk(
                        completedAct.orderId,
                        {
                            attributes: [
                                "id",
                                "creatorId",
                            ],
                        }
                    );

                    if (recipientOrder) {
                        await notifyContractWorkflow({
                            event: "act_remediation_submitted",

                            userId: recipientOrder.creatorId,
                            orderId: recipientOrder.id,
                            actId: completedAct.id,
                            version: completedAct.version,
                        });
                    }
                }
            }} catch (notificationError) {
                console.error(
                    "Post-commit contract notification failed:",
                    notificationError
                );
            }

            return res.json({
                success: true,
                ...result,
            });

        } catch (error) {
            return sendError(res, error);
        }
    });

router.post("/:actId/remediation/review", async (req, res) => {
        let prepared = null;
        let created = false;

        try {
            if (
                typeof req.body?.approved !==
                "boolean" ||
                req.body?.confirmed !== true
            ) {
                throw fail(
                    400,
                    "Подтвердите ваше решение"
                );
            }

            const approved = req.body.approved;

            const comment = normalizeComment(
                req.body?.comment,
                !approved
            );

            const userId = Number(req.user.id);

            const ctxBefore = await context(
                req.params.actId,
                userId
            );

            if (!ctxBefore.isCustomer) {
                throw fail(
                    403,
                    "Проверить исправления может только заказчик"
                );
            }

            if (!hashMatches(
                req.body?.documentHash,
                ctxBefore.act.documentHash
            )) {
                throw fail(
                    409,
                    "Версия акта изменилась"
                );
            }

            const initialState =
                await loadState(ctxBefore);

            requireCurrentRound(initialState, req.body?.expectedRound);

            if (initialState.revision && approved) {
                return res.json({
                    success: true,
                    created: false,
                    revisedAct: {
                        id: initialState.revision.id,
                        version: 2,
                    },
                });
            }

            if (
                initialState.status !==
                "awaiting_customer"
            ) {
                throw fail(
                    409,
                    "Сейчас нечего подтверждать"
                );
            }

            await assertVerifiedPdfIntegrity(
                ctxBefore.act
            );

            const reviewedAt = new Date();

            /*
             * Для подтверждения формируем PDF
             * до транзакции. Не держим блокировку
             * MySQL во время работы Puppeteer.
             */
            if (approved) {
                prepared =
                    await prepareVerifiedActV2({
                        originalAct:
                        ctxBefore.act,

                        originalRemarks:
                        initialState.decisionEvent
                            .metadata.comment,

                        order: ctxBefore.order,

                        correctionEvent:
                        initialState.lastEvent,

                        reviewedAt,
                        reviewComment: comment,
                    });
            }

            const result =
                await sequelize.transaction(
                    async (transaction) => {
                        const ctx = await context(
                            req.params.actId,
                            userId,
                            transaction,
                            true
                        );

                        const state =
                            await loadState(
                                ctx,
                                transaction
                            );

                        requireCurrentRound(state, req.body?.expectedRound);

                        if (
                            approved &&
                            state.revision
                        ) {
                            return {
                                created: false,
                                revisedAct: {
                                    id: state.revision.id,
                                    version: 2,
                                },
                            };
                        }

                        if (
                            state.status !==
                            "awaiting_customer" ||
                            String(state.lastEvent?.id) !==
                            String(
                                initialState.lastEvent.id
                            )
                        ) {
                            throw fail(
                                409,
                                "Состояние исправлений изменилось"
                            );
                        }

                        if (!hashMatches(
                            ctx.act.documentHash,
                            ctxBefore.act.documentHash
                        )) {
                            throw fail(
                                409,
                                "Версия акта изменилась"
                            );
                        }

                        if (!approved) {
                            await ContractEvent.create(
                                {
                                    contractId:
                                    ctx.act.id,

                                    actorUserId: userId,
                                    actorRole: "creator",

                                    eventType:
                                    EVENT_REJECTED,

                                    eventAt: reviewedAt,

                                    metadata: {
                                        round: state.round,
                                        comment,
                                        correctionEventId:
                                            String(
                                                state.lastEvent.id
                                            ),
                                        documentHash:
                                        ctx.act.documentHash,
                                    },
                                },
                                { transaction }
                            );

                            return {
                                created: true,
                                returnedForCorrection: true,
                            };
                        }

                        const newAct =
                            await Contract.create(
                                {
                                    orderId:
                                    ctx.order.id,

                                    parentContractId:
                                    ctx.act.id,

                                    type:
                                        "verified_completion_act",

                                    version: 2,
                                    status: "draft",

                                    documentNumber:
                                    prepared.snapshot
                                        .documentNumber,

                                    jurisdiction: "RU",

                                    templateCode:
                                        "verified_completion_act_default",

                                    templateVersion: "4",

                                    storageKey:
                                    prepared.storageKey,

                                    documentHash:
                                    prepared.documentHash,

                                    metadata: {
                                        snapshot:
                                        prepared.snapshot,

                                        acceptanceState:
                                            "not_recorded",

                                        signatureState:
                                            "not_signed",
                                    },
                                },
                                { transaction }
                            );

                        await ContractEvent.create(
                            {
                                contractId: ctx.act.id,
                                actorUserId: userId,
                                actorRole: "creator",

                                eventType:
                                    "act_remediation_approved",

                                eventAt: reviewedAt,

                                metadata: {
                                    round: state.round,
                                    reviewComment: comment,
                                    revisedActId:
                                        String(newAct.id),

                                    originalHash:
                                    ctx.act.documentHash,

                                    newHash:
                                    prepared.documentHash,
                                },
                            },
                            { transaction }
                        );

                        await ContractEvent.create(
                            {
                                contractId: newAct.id,
                                actorUserId: null,
                                actorRole: "system",

                                eventType:
                                    "act_revision_created",

                                eventAt: reviewedAt,

                                metadata: {
                                    previousActId:
                                        String(ctx.act.id),

                                    previousDocumentHash:
                                    ctx.act.documentHash,

                                    documentHash:
                                    prepared.documentHash,

                                    remediationRound:
                                    state.round,
                                },
                            },
                            { transaction }
                        );

                        await ctx.act.update(
                            {
                                supersededAt:
                                reviewedAt,
                            },
                            { transaction }
                        );

                        return {
                            created: true,
                            revisedAct: {
                                id: newAct.id,
                                version: 2,
                                documentNumber:
                                newAct.documentNumber,
                            },
                        };
                    }
                );

            created = approved && result.created;

            if (result.created) {
                const recipientOrder = await Order.findByPk(
                    ctxBefore.order.id,
                    {
                        attributes: [
                            "id",
                            "executorId",
                        ],
                    }
                );

                if (recipientOrder) {
                    await notifyContractWorkflow({
                        event: approved
                            ? "act_revision_created"
                            : "act_remediation_rejected",

                        userId: recipientOrder.executorId,
                        orderId: recipientOrder.id,

                        actId: approved
                            ? result.revisedAct.id
                            : ctxBefore.act.id,

                        version: approved
                            ? 2
                            : ctxBefore.act.version,
                    });
                }
            }

            return res.json({
                success: true,
                ...result,
            });

        } catch (error) {
            return sendError(res, error);

        } finally {
            /*
             * Если DB-транзакция не создала v2,
             * удаляем неиспользованный PDF.
             */
            if (prepared && !created) {
                await prepared.cleanup().catch(
                    (error) => {
                        console.error(
                            "Не удалось очистить временный акт:",
                            error
                        );
                    }
                );
            }
        }
    });

module.exports = router;
