const express = require("express");
const { Op } = require("sequelize");
const crypto = require("crypto");
const authenticateToken = require("../middlewares/userAuth");
const { Order, Contract, ContractEvent, Dispute,} = require("../models");


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

        canSubmit: false,
        canReview: false,

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

const rejectLegacyRemediation = (req, res) => {
    return res.status(410).json({
        success: false,
        code: "LEGACY_ACT_REMEDIATION_DISABLED",
        message:
            "Исправление замечаний через историю отключено. " +
            "Исполнитель и заказчик согласовывают исправления " +
            "в активном заказе.",
    });
};

router.post(
    "/:actId/remediation/submit",
    rejectLegacyRemediation
);

router.post(
    "/:actId/remediation/review",
    rejectLegacyRemediation
);

module.exports = router;
