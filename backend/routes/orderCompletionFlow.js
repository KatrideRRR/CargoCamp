
const express = require("express");
const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { Op } = require("sequelize");

const authenticateToken = require("../middlewares/userAuth");

const {
    Order,
    User,
    Category,
    Subcategory,
    Service,
    Contract,
    ContractSignature,
} = require("../models");

const {
    submitInitialCompletion,
    submitCorrectionAction,
} = require("../services/orderCompletionWorkflowService");

const {
    createVerifiedCompletionActIfEligible,
} = require("../services/verifiedCompletionActService");

const {
    buildCompletionPaymentSnapshot,
} = require("../services/completionPaymentSnapshotService");

const {
    buildOrderContractDetails,
} = require("../services/orderContractDetailsService");

const {
    collectOrderPhotoAnnex,
} = require("../services/orderPhotoAnnexService");

const generateContractPDF =
    require("../utils/generateContractPDF");

const { contractsRoot } = require("../config/storagePaths");

const {
    notifyUser,
    notifyMany,
} = require("../services/notificationService");

const router = express.Router();

router.use(authenticateToken);
router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
});

function sendError(res, error) {
    if (error.httpStatus) {
        return res.status(error.httpStatus).json({
            message: error.message,
        });
    }

    console.error("Completion workflow error:", error);

    return res.status(500).json({
        message: "Ошибка завершения заказа",
    });
}

async function loadFullOrder(orderId) {
    return Order.findByPk(orderId, {
        include: [
            { model: User, as: "creator" },
            { model: User, as: "executor" },
            { model: Category, as: "category" },
            { model: Subcategory, as: "subcategory" },
            { model: Service, as: "service" },
        ],
    });
}

function actSummary(contract) {
    if (!contract) return null;

    return {
        id: String(contract.id),
        orderId: Number(contract.orderId),
        type: contract.type,
        version: contract.version,
        documentNumber: contract.documentNumber,
        documentHash: contract.documentHash,
        status: contract.status,
        fullySignedAt: contract.fullySignedAt,
    };
}

async function ensureCompletionDocuments(order) {
    if (order.status !== "completed") {
        return null;
    }

    const assignment = await Contract.findOne({
        where: {
            orderId: order.id,
            type: "verified_assignment",
        },
        order: [["version", "DESC"]],
    });

    if (assignment) {
        const result =
            await createVerifiedCompletionActIfEligible(order);

        return actSummary(result?.contract);
    }

    // Для обычной сделки сохраняем отдельный
    // PDF завершения, не перезаписывая исходный договор.
    const fileName = `completion_order_${order.id}_v1.pdf`;
    const absolutePath = path.join(contractsRoot, fileName);
    const temporaryPath = path.join(
        contractsRoot,
        `completion_${order.id}_${crypto.randomUUID()}.tmp.pdf`
    );

    let alreadyExists = false;

    try {
        await fs.access(absolutePath);
        alreadyExists = true;
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }

    if (!alreadyExists) {
        const paymentEvidence =
            await buildCompletionPaymentSnapshot(order);

        const photoAnnex = await collectOrderPhotoAnnex(
            order,
            "completion"
        );

        const data = {
            orderId: order.id,
            serviceName: order.service?.name || "—",
            serviceDetailRows:
            buildOrderContractDetails(order).rows,
            approvalDate:
                new Date(order.createdAt).toLocaleDateString("ru-RU"),
            customerId: order.creatorId,
            customerName:
                order.creator?.username || "—",
            performerId: order.executorId,
            performerName:
                order.executor?.username || "—",
            category: order.category?.name || "—",
            subcategory: order.subcategory?.name || "—",
            address: order.address,
            description: order.description,
            price:
                Number(order.finalPriceKopecks) > 0
                    ? Number(order.finalPriceKopecks) / 100
                    : Number(order.proposedSum || 0),
            paymentType: order.paymentType,
            completeAt: order.completedAt,
            completedBy: order.completedBy,
            workStartedAt: order.workStartedAt,
            workEndedAt: order.workEndedAt,
            completionPaymentEvidence: paymentEvidence,
            photoAnnex,
        };

        try {
            await generateContractPDF(data, temporaryPath);

            // Не перезаписываем документ,
            // если параллельный запрос уже его сохранил.
            try {
                await fs.link(temporaryPath, absolutePath);
            } catch (error) {
                if (error.code !== "EEXIST") throw error;
            }
        } finally {
            await fs.rm(temporaryPath, {
                force: true,
            });
        }
    }

    if (order.contractPath !== `/contracts/${fileName}`) {
        await order.update({
            contractPath: `/contracts/${fileName}`,
        });
    }

    return null;
}

async function safeNotify(params) {
    try {
        await notifyUser(params);
    } catch (error) {
        console.error("Completion notification:", error);
    }
}

async function safeLog(req, actionType, orderId, meta = {}) {
    try {
        await req.logAction({
            req,
            actorUserId: req.user.id,
            actorRole: "user",
            actionType,
            entityType: "order",
            entityId: orderId,
            orderId,
            meta,
        });
    } catch (error) {
        console.error("Completion action log:", error);
    }
}

function registerOrderCompletionFlow(io) {
    // Первое или второе подтверждение завершения.
    router.post("/complete/:id", async (req, res) => {
        try {
            const orderId = Number(req.params.id);

            if (!Number.isSafeInteger(orderId) || orderId <= 0) {
                return res.status(400).json({
                    message: "Некорректный заказ",
                });
            }

            const result = await submitInitialCompletion({
                orderId,
                userId: Number(req.user.id),
                completion: req.body?.completion,
                ipAddress: req.socket.remoteAddress,
                userAgent: req.get("user-agent"),
            });

            const order = await loadFullOrder(orderId);

            let act = null;
            let documentPending = false;

            if (result.completed) {
                try {
                    act = await ensureCompletionDocuments(order);
                } catch (error) {
                    documentPending = true;
                    console.error(
                        "Completion PDF error:",
                        orderId,
                        error
                    );
                }
            }

            if (result.changed) {
                await safeLog(req, "order_completion_confirmed", orderId, {
                    phase: result.phase,
                    completed: result.completed,
                });

                if (result.phase === "awaiting_other") {
                    const otherUserId =
                        Number(req.user.id) === Number(order.creatorId)
                            ? order.executorId
                            : order.creatorId;

                    await safeNotify({
                        userId: otherUserId,
                        type: "order_completion_requested",
                        title: "Подтвердите завершение заказа",
                        body: `Заказ №${orderId} ожидает вашего подтверждения`,
                        orderId,
                        orderType: "regular",
                    });
                }

                if (result.phase === "needs_correction") {
                    await safeNotify({
                        userId: order.executorId,
                        type: "order_completion_requested",
                        title: "Заказ требует исправлений",
                        body: `По заказу №${orderId} заказчик указал замечания`,
                        orderId,
                        orderType: "regular",
                    });
                }

                if (result.completed) {
                    try {
                        await notifyMany(
                            [order.creatorId, order.executorId],
                            {
                                type: "review_needed",
                                title: "Заказ завершён",
                                body: `Заказ №${orderId} завершён`,
                                orderId,
                                orderType: "regular",
                            }
                        );
                    } catch (error) {
                        console.error("Review notification:", error);
                    }
                }
            }

            io?.emit("orderUpdated");
            io?.emit("activeOrdersUpdated");

            return res.json({
                ...order.toJSON(),
                completionPhase: result.phase,
                completionAct: act,
                documentPending,
            });
        } catch (error) {
            return sendError(res, error);
        }
    });

    // Исполнитель сообщил, что исправил недостатки.
    router.post("/:id/corrections/submit", async (req, res) => {
        try {
            const orderId = Number(req.params.id);

            const result = await submitCorrectionAction({
                orderId,
                userId: Number(req.user.id),
                action: "submit",
                comment: req.body?.comment,
            });

            const order = await loadFullOrder(orderId);

            await safeLog(req, "order_corrections_submitted", orderId);

            await safeNotify({
                userId: order.creatorId,
                type: "order_completion_requested",
                title: "Проверьте исправления",
                body: `Исполнитель устранил замечания по заказу №${orderId}`,
                orderId,
                orderType: "regular",
            });

            io?.emit("orderUpdated");
            io?.emit("activeOrdersUpdated");

            return res.json({
                success: true,
                phase: result.phase,
            });
        } catch (error) {
            return sendError(res, error);
        }
    });

    // Заказчик принял либо отклонил исправления.
    router.post("/:id/corrections/review", async (req, res) => {
        try {
            const orderId = Number(req.params.id);

            const result = await submitCorrectionAction({
                orderId,
                userId: Number(req.user.id),
                action: "review",
                decision: req.body?.decision,
                comment: req.body?.comment,
            });

            const order = await loadFullOrder(orderId);

            let act = null;
            let documentPending = false;

            if (result.completed) {
                try {
                    act = await ensureCompletionDocuments(order);
                } catch (error) {
                    documentPending = true;
                    console.error("Revised completion PDF:", error);
                }
            }

            await safeLog(
                req,
                result.completed
                    ? "order_corrections_accepted"
                    : "order_corrections_rejected",
                orderId
            );

            await safeNotify({
                userId: order.executorId,
                type: "order_completion_requested",
                title: result.completed
                    ? "Исправления приняты"
                    : "Остались замечания",
                body: result.completed
                    ? `Заказ №${orderId} завершён`
                    : `По заказу №${orderId} требуется повторное исправление`,
                orderId,
                orderType: "regular",
            });

            io?.emit("orderUpdated");
            io?.emit("activeOrdersUpdated");

            return res.json({
                ...order.toJSON(),
                completionPhase: result.phase,
                completionAct: act,
                documentPending,
            });
        } catch (error) {
            return sendError(res, error);
        }
    });

    // Повторное формирование документа после сбоя PDF.
    // Финансовых операций этот маршрут не выполняет.
    router.post("/:id/ensure-completion-act", async (req, res) => {
        try {
            const orderId = Number(req.params.id);
            const order = await loadFullOrder(orderId);

            if (
                !order ||
                ![Number(order.creatorId), Number(order.executorId)]
                    .includes(Number(req.user.id))
            ) {
                return res.sendStatus(404);
            }

            if (order.status !== "completed") {
                return res.status(409).json({
                    message: "Заказ ещё не завершён",
                });
            }

            const act = await ensureCompletionDocuments(order);

            return res.json({
                success: true,
                act,
            });
        } catch (error) {
            return sendError(res, error);
        }
    });

    // Документы, которые пользователь ещё не подписал.
    router.get("/pending-act-signatures", async (req, res) => {
        try {
            const userId = Number(req.user.id);

            const orders = await Order.findAll({
                where: {
                    status: "completed",
                    [Op.or]: [
                        { creatorId: userId },
                        { executorId: userId },
                    ],
                },
                attributes: ["id"],
                limit: 200,
                order: [["completedAt", "DESC"]],
            });

            const ids = orders.map((order) => order.id);

            if (!ids.length) {
                return res.json({
                    success: true,
                    acts: [],
                    missingOrderIds: [],
                });
            }

            const [contracts, assignments] = await Promise.all([
                Contract.findAll({
                    where: {
                        orderId: { [Op.in]: ids },
                        type: "verified_completion_act",
                    },
                    order: [
                        ["version", "DESC"],
                        ["id", "DESC"],
                    ],
                }),

                Contract.findAll({
                    where: {
                        orderId: { [Op.in]: ids },
                        type: "verified_assignment",
                    },
                    attributes: ["orderId"],
                }),
            ]);

            const latest = new Map();

            for (const contract of contracts) {
                if (!latest.has(Number(contract.orderId))) {
                    latest.set(Number(contract.orderId), contract);
                }
            }

            const actIds = [...latest.values()].map(
                (contract) => contract.id
            );

            const signatures = actIds.length
                ? await ContractSignature.findAll({
                    where: {
                        contractId: { [Op.in]: actIds },
                        userId,
                    },
                    attributes: ["contractId"],
                })
                : [];

            const signed = new Set(
                signatures.map((item) => String(item.contractId))
            );

            const acts = [...latest.values()]
                .filter((contract) =>
                    !signed.has(String(contract.id)) &&
                    !contract.supersededAt
                )
                .map(actSummary);

            const assignmentOrderIds = new Set(
                assignments.map((item) => Number(item.orderId))
            );

            const missingOrderIds = ids.filter(
                (id) =>
                    assignmentOrderIds.has(Number(id)) &&
                    !latest.has(Number(id))
            );

            return res.json({
                success: true,
                acts,
                missingOrderIds,
            });
        } catch (error) {
            return sendError(res, error);
        }
    });

    return router;
}

module.exports = registerOrderCompletionFlow;
