const express = require("express");
const crypto = require("crypto");
const {Op} = require("sequelize");
const authenticateToken = require("../middlewares/userAuth");
const { Order, Contract, ContractEvent, Dispute,} = require("../models");

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

                canDecide: false,

                isCustomer: ctx.isCustomer,

                hasActiveDispute:
                    Boolean(activeDispute),

                decision: serializeDecision(event),
                canRequestCorrections: false,
            });

        } catch (error) {
            return respondError(res, error);
        }
    });

router.post(
    "/:actId/acceptance",
    (req, res) => {
        return res.status(410).json({
            success: false,
            code: "LEGACY_ACT_ACCEPTANCE_DISABLED",
            message:
                "Повторная приёмка через историю отключена. " +
                "Приёмка работ выполняется при завершении " +
                "активного заказа.",
        });
    }
);

module.exports = router;
