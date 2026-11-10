const test = require("node:test");
const assert = require("node:assert/strict");
const { Op } = require("sequelize");

const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

function createHarness({
                           initialDecision = "remarks",
                       } = {}) {
    const corrections = [];
    let activeDispute = false;

    const order = {
        id: 101,
        creatorId: 2,
        executorId: 1,
        status: "active",
        completedBy: [1, 2],
        paymentType: "cash",
        proposedSum: 500,

        async save() {
            return this;
        },
    };

    const decisions = [
        {
            userId: 2,
            partyRole: "creator",
            qualityDecision: initialDecision,
            remarks:
                initialDecision === "remarks"
                    ? "При перевозке повреждён корпус шкафа."
                    : null,
            cashStatus: "partial",
            cashAmountKopecks: 15025,
            payoutAuthorized: false,
            confirmedAt:
                "2026-11-10T08:00:00.000Z",
        },
        {
            userId: 1,
            partyRole: "executor",
            qualityDecision: null,
            remarks: null,
            cashStatus: "partial",
            cashAmountKopecks: 15025,
            payoutAuthorized: false,
            confirmedAt:
                "2026-11-10T07:50:00.000Z",
        },
    ];

    const models = {
        sequelize: {
            transaction: async (callback) =>
                callback({
                    LOCK: {
                        UPDATE: "UPDATE",
                    },
                }),
        },

        Order: {
            findByPk: async (id) =>
                Number(id) === 101 ? order : null,
        },

        Dispute: {
            findOne: async () =>
                activeDispute ? { id: 900 } : null,
        },

        OrderChangeRequest: {
            findOne: async () => null,
        },

        OrderCompletionDecision: {
            findOne: async ({ where }) => {
                return decisions.find((item) => {
                    if (
                        Number(item.userId) !==
                        Number(where.userId)
                    ) {
                        return false;
                    }

                    if (
                        where.qualityDecision !== undefined &&
                        item.qualityDecision !== where.qualityDecision
                    ) {
                        return false;
                    }

                    return true;
                }) || null;
            },

            findAll: async () => decisions,
        },

        OrderCompletionCorrection: {
            findOne: async () =>
                corrections[corrections.length - 1] ||
                null,

            findAll: async () => [...corrections],

            create: async (data) => {
                const record = {
                    id: corrections.length + 1,
                    ...data,
                };

                corrections.push(record);
                return record;
            },
        },

        OrderSafeDeal: {
            findOne: async () => null,
        },
    };

    const workflow = loadIsolatedService(
        "orderCompletionWorkflowService.js",
        {
            sequelize: { Op },
            "../models": models,
        }
    );

    const paymentEvidence = loadIsolatedService(
        "completionPaymentSnapshotService.js",
        {
            "../models": models,
        }
    );

    return {
        order,
        corrections,
        workflow,
        paymentEvidence,

        setActiveDispute(value) {
            activeDispute = value;
        },
    };
}

test(
    "полный цикл замечаний, повторных исправлений и окончательной приёмки",
    async () => {
        const h = createHarness();

        assert.equal(
            await h.workflow.getCompletionPhase(h.order),
            "needs_correction"
        );

        const submit = (comment, userId = 1) =>
            h.workflow.submitCorrectionAction({
                orderId: 101,
                userId,
                action: "submit",
                comment,
            });

        const review = (
            decision,
            comment = "",
            userId = 2
        ) =>
            h.workflow.submitCorrectionAction({
                orderId: 101,
                userId,
                action: "review",
                decision,
                comment,
            });

        // Исполнитель впервые сообщил об исправлениях.
        const first = await submit(
            "Повреждённая деталь шкафа заменена."
        );

        assert.equal(first.phase, "awaiting_review");
        assert.equal(h.corrections.length, 1);
        assert.equal(h.corrections[0].roundNumber, 1);

        // Нельзя повторно отправить исправления,
        // пока заказчик не проверил результат.
        await assert.rejects(
            submit("Повторное подтверждение исправлений."),
            { httpStatus: 409 }
        );

        // Исполнитель не может принять работу за заказчика.
        await assert.rejects(
            review("accepted", "", 1),
            { httpStatus: 409 }
        );

        // Заказчик не может отклонить результат
        // без подробного объяснения.
        await assert.rejects(
            review("rejected", "Плохо"),
            { httpStatus: 400 }
        );

        assert.equal(h.corrections.length, 1);

        // Заказчик обнаружил оставшийся недостаток.
        const rejected = await review(
            "rejected",
            "После ремонта дверца шкафа закрывается неправильно."
        );

        assert.equal(rejected.phase, "needs_correction");
        assert.equal(h.order.status, "active");
        assert.equal(h.corrections[1].roundNumber, 1);

        // Второй цикл исправлений.
        const second = await submit(
            "Отрегулированы петли и проверена дверца."
        );

        assert.equal(second.phase, "awaiting_review");
        assert.equal(h.corrections[2].roundNumber, 2);

        // Открытый спор блокирует окончательную приёмку.
        h.setActiveDispute(true);

        await assert.rejects(
            review("accepted"),
            { httpStatus: 409 }
        );

        assert.equal(h.order.status, "active");
        assert.equal(h.corrections.length, 3);

        // Спор урегулирован, заказчик принял исправления.
        h.setActiveDispute(false);

        const accepted = await review("accepted");

        assert.equal(accepted.phase, "completed");
        assert.equal(accepted.completed, true);
        assert.equal(h.order.status, "completed");
        assert.ok(h.order.completedAt);

        assert.equal(
            await h.workflow.getCompletionPhase(h.order),
            "completed"
        );

        assert.deepEqual(
            h.corrections.map((item) => item.eventType),
            [
                "submitted",
                "rejected",
                "submitted",
                "accepted",
            ]
        );

        // После завершения новые исправления запрещены.
        await assert.rejects(
            submit("Попытка изменить завершённый заказ."),
            { httpStatus: 409 }
        );

        // Акт должен получить исходные замечания,
        // окончательную приёмку и все исправления.
        const evidence =
            await h.paymentEvidence.buildCompletionPaymentSnapshot(
                h.order
            );

        assert.equal(
            evidence.customer.originalQualityDecision,
            "remarks"
        );

        assert.equal(
            evidence.customer.qualityDecision,
            "accepted"
        );

        assert.equal(
            evidence.customer.originalRemarks,
            "При перевозке повреждён корпус шкафа."
        );

        assert.equal(
            new Date(
                evidence.customer.acceptedAfterCorrectionsAt
            ).getTime(),
            new Date(
                h.corrections[3].eventAt
            ).getTime()
        );

        assert.equal(evidence.corrections.length, 4);
        assert.equal(evidence.cashReconciled, true);
        assert.equal(
            evidence.customer.payoutAuthorized,
            false
        );
    }
);

test(
    "исправления запрещены без первоначальных замечаний",
    async () => {
        const h = createHarness({
            initialDecision: "accepted",
        });

        await assert.rejects(
            h.workflow.submitCorrectionAction({
                orderId: 101,
                userId: 1,
                action: "submit",
                comment:
                    "Попытка отправить ненужные исправления.",
            }),
            { httpStatus: 409 }
        );

        assert.equal(h.corrections.length, 0);
    }
);