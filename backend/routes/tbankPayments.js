const express = require("express");
const router = express.Router();
const { Order, User } = require("../models");
const {
    applyConfirmedPayment,
} = require("../services/paymentReceiptService");
const {
    settleConfirmedDebtPayment,
} = require("../services/debtPaymentSettlementService");
const {
    createTbankDebtPayment,
} = require("../services/tbankDebtPaymentService");
const {
    reconcileDebtPayment,
} = require("../services/debtPaymentReconciliationService");
const db = require("../models");
const authenticateToken = require("../middlewares/userAuth");
const { requestTBank, verifyNotificationToken } = require("../config/tbankClient");
const {
    processTBankCardNotification,
    customerKey,
} = require("../services/tbankCardBindingService");
const { sendOrderPush } = require("../utils/orderPushService");
const {
    publishPaidOrder,
} = require("../services/orderPublicationService");
const {
    sendAdminNotification,
    adminUsersUrl,
    adminOrderUrl,
    notifySystemError,
} = require("../services/adminNotificationService");
const {sendBusinessCashPayment, sendBusinessCashRefund,} = require("../services/businessCashService");
const {
    verifyTBankPromotion,
    applyVerifiedPromotion,
} = require("../services/promotionPaymentService");
const {
    claimPromotionPaymentIntent,
    recordPromotionPaymentIntent,
    existingPromotionPaymentResponse,
} = require("../services/promotionPaymentIntentService");

function notifyPaymentProblem({provider, type, title, message, userId = null, orderId = null,}) {
    const buttonUrl =
        orderId
            ? adminOrderUrl(orderId)
            : adminUsersUrl();

    const buttonText =
        orderId
            ? "Открыть заказ"
            : "Открыть пользователей";

    void sendAdminNotification({
        topic: "payments",

        title,

        message: [
            `Провайдер: ${provider}`,
            type ? `Тип: ${type}` : null,
            userId ? `Пользователь ID: ${userId}` : null,
            orderId ? `Заказ ID: ${orderId}` : null,
            "",
            message,
        ]
            .filter(Boolean)
            .join("\n"),

        buttonText,
        buttonUrl,
    });
}

function cleanPhone(phone) {
    return String(phone || "").replace(/[^\d+]/g, "");
}

function rubToKopecks(value) {
    return Math.round(Number(value || 0) * 100);
}

function kopecksToRubString(kopecks) {
    return (Number(kopecks || 0) / 100).toFixed(2);
}

function buildTBankOrderId(type, id, extra = null) {
    return extra
        ? `${type}_${id}_${extra}_${Date.now()}`
        : `${type}_${id}_${Date.now()}`;
}

function parseTBankOrderId(orderId) {
    const parts = String(orderId || "").split("_");

    return {
        type: parts[0] || null,
        id: parts[1] ? Number(parts[1]) : null,
        extra: parts[2] || null,
    };
}

function buildReceipt({ user, amountKopecks, description }) {
    return {
        Taxation: "usn_income",
        Phone: cleanPhone(user.phone),
        Items: [
            {
                Name: description,
                Price: amountKopecks,
                Quantity: 1,
                Amount: amountKopecks,
                Tax: "none",
                PaymentMethod: "full_payment",
                PaymentObject: "service",
            },
        ],
    };
}

router.post("/premium/create", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            duration,
            paymentMode = "redirect",
        } = req.body || {};

        if (!["redirect", "saved_card"].includes(paymentMode)) {
            return res.status(400).json({
                success: false,
                error: "Неверный способ оплаты",
            });
        }

        const prices = {
            "7d": 2500,
            "30d": 9000,
        };

        const amountRub = prices[duration];

        if (!amountRub) {
            return res.status(400).json({
                success: false,
                error: "Неверная длительность",
            });
        }

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: "Пользователь не найден",
            });
        }

        if (
            paymentMode === "saved_card" &&
            (!user.tbankRebillId || !user.tbankCardId)
        ) {
            return res.status(409).json({
                success: false,
                error: "Сохранённая карта недоступна",
            });
        }

        const addDays = duration === "7d" ? 7 : 30;
        const amountKopecks = rubToKopecks(amountRub);
        const orderId = buildTBankOrderId("premium", userId, duration);

        const description = `Premium ${duration} для пользователя #${userId}`;

        const payment = await requestTBank("Init", {
            Amount: amountKopecks,
            OrderId: orderId,
            Description: description,
            ...(paymentMode === "saved_card"
                ? {
                    CustomerKey: customerKey(user.id),
                    OperationInitiatorType: "R",
                    PayType: "O",
                }
                : {}),
            SuccessURL: `${process.env.FRONTEND_URL}/profile?premiumReturn=1&provider=tbank`,
            FailURL: `${process.env.FRONTEND_URL}/profile?premiumReturn=0&provider=tbank`,
            NotificationURL: `${process.env.BACKEND_URL}/api/tbank-payments/webhook`,
            DATA: {
                type: "premium",
                userId: String(userId),
                duration,
            },
            Receipt: buildReceipt({
                user,
                amountKopecks,
                description: `Подписка Premium (${addDays} дней)`,
            }),
        });

        await req.logAction?.({
            req,
            actorUserId: userId,
            actorRole: "user",
            actionType: "payment_create",
            entityType: "payment",
            paymentId: String(payment.PaymentId),
            severity: "info",
            meta: {
                provider: "tbank",
                type: "premium",
                duration,
                amount: kopecksToRubString(amountKopecks),
                status: payment.Status,
                tbankOrderId: orderId,
            },
        });

        if (paymentMode === "saved_card") {
            const paymentId = String(
                payment.PaymentId || ""
            );

            if (!paymentId) {
                throw new Error(
                    "Т-Банк не вернул PaymentId"
                );
            }

            try {
                await requestTBank(
                    "Charge",
                    {
                        PaymentId: paymentId,
                        RebillId: user.tbankRebillId,
                    }
                );
            } catch (chargeError) {
                console.error(
                    "TBank Premium charge result unknown:",
                    {
                        paymentId,
                        code:
                            chargeError?.code ||
                            chargeError?.name ||
                            "Error",
                    }
                );
            }

            let verified;

            try {
                verified = await requestTBank(
                    "GetState",
                    {
                        PaymentId: paymentId,
                    }
                );
            } catch (verificationError) {
                return res.json({
                    success: true,
                    provider: "tbank",
                    paymentId,
                    paidBySavedCard: true,
                    paymentProcessing: true,
                    paid: false,
                    status: "UNKNOWN",
                });
            }

            if (
                String(verified.PaymentId) !== paymentId ||
                String(verified.OrderId) !== orderId ||
                Number(verified.Amount) !== amountKopecks ||
                String(verified.TerminalKey) !==
                String(process.env.TBANK_TERMINAL_KEY)
            ) {
                throw new Error(
                    "Не удалось подтвердить параметры платежа"
                );
            }

            if (
                ["REJECTED", "CANCELED", "AUTH_FAIL"]
                    .includes(verified.Status)
            ) {
                return res.json({
                    success: false,
                    provider: "tbank",
                    paymentId,
                    paidBySavedCard: true,
                    paymentProcessing: false,
                    paid: false,
                    status: verified.Status,
                    error: "Не удалось оплатить сохранённой картой",
                });
            }

            if (verified.Status === "CONFIRMED") {
                const result = await applyConfirmedPayment({
                    provider: "tbank",
                    paymentId,
                    userId,
                    purpose: "premium",
                    duration,
                    amountKopecks,
                });

                if (!result.duplicate) {
                    await req.logAction?.({
                        req,
                        actorUserId: userId,
                        actorRole: "system",
                        actionType: "premium_activated",
                        entityType: "user",
                        entityId: userId,
                        paymentId,
                        severity: "info",
                        meta: {
                            provider: "tbank",
                            duration,
                            activatedBy: "saved_card_payment",
                        },
                    });
                }

                return res.json({
                    success: true,
                    provider: "tbank",
                    paymentId,
                    paidBySavedCard: true,
                    paymentProcessing: false,
                    paid: true,
                    status: verified.Status,
                });
            }

            return res.json({
                success: true,
                provider: "tbank",
                paymentId,
                paidBySavedCard: true,
                paymentProcessing: true,
                paid: false,
                status: verified.Status,
            });
        }

        return res.json({
            success: true,
            provider: "tbank",
            paymentId: String(payment.PaymentId),
            orderId,
            confirmationUrl: payment.PaymentURL,
            status: payment.Status,
        });
    } catch (e) {
        console.error("tbank premium/create error:", e);

        notifyPaymentProblem({
            provider: "T-Bank",
            type: "webhook",

            title: "🚨 Ошибка обработки платежа премиума",

            message: [
                `Ошибка: ${e?.message || "Unknown error"}`,
                req.body?.PaymentId
                    ? `Payment ID: ${req.body.PaymentId}`
                    : null,
                req.body?.OrderId
                    ? `Order ID: ${req.body.OrderId}`
                    : null,
                req.body?.Status
                    ? `Статус: ${req.body.Status}`
                    : null,
            ]
                .filter(Boolean)
                .join("\n"),
        });

        return res.status(500).json({
            success: false,
            error: e?.message || "Internal server error",
        });
    }
});

router.post(
    "/debt/intent/create",
    authenticateToken,
    async (req, res) => {
        try {
            const result =
                await createTbankDebtPayment({
                    userId: req.user.id,

                    paymentMode:
                    req.body?.paymentMode,

                    expectedAmountKopecks:
                    req.body
                        ?.expectedAmountKopecks,

                    request:
                        req.body?.request || null,

                    returnPath:
                    req.body?.returnPath,
                });

            res.setHeader(
                "Cache-Control",
                "no-store"
            );

            return res.json(result);

        } catch (error) {
            console.error(
                "TBank debt intent error:",
                error.message
            );

            return res.status(
                error.httpStatus || 502
            ).json({
                success: false,

                error: error.httpStatus
                    ? error.message
                    : "Не удалось установить результат " +
                    "платежа. Не повторяйте оплату.",
            });
        }
    }
);

router.post(
    "/debt/create",
    authenticateToken,
    async (req, res) => {
        try {
            const userId =
                req.user.id;

            const user =
                await User.findByPk(
                    userId
                );

            if (!user) {
                return res.status(404).json({
                    success: false,
                    error:
                        "Пользователь не найден",
                });
            }

            const paymentMode =
                req.body?.paymentMode ||
                "redirect";

            if (
                ![
                    "saved_card",
                    "redirect",
                ].includes(paymentMode)
            ) {
                return res.status(400).json({
                    success: false,
                    error:
                        "Неверный способ оплаты",
                });
            }

            const result =
                await createTbankDebtPayment({
                    userId,
                    paymentMode,

                    expectedAmountKopecks:
                        Number(
                            user.debt || 0
                        ),

                    returnPath:
                    req.body?.returnPath,
                });

            res.setHeader(
                "Cache-Control",
                "no-store"
            );

            return res.json({
                ...result,

                status:
                    result.paymentStatus ||
                    result.status,
            });

        } catch (error) {
            console.error(
                "Legacy TBank debt payment:",
                error?.name || "Error"
            );

            return res.status(
                error.httpStatus || 502
            ).json({
                success: false,

                error: error.httpStatus
                    ? error.message
                    : "Не удалось проверить результат " +
                    "оплаты. Не повторяйте платёж.",
            });
        }
    }
);

router.post("/order/promotion/create", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { orderId } = req.body;

        if (!orderId) {
            return res.status(400).json({
                success: false,
                error: "orderId обязателен",
            });
        }

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: "Пользователь не найден",
            });
        }

        const order = await Order.findByPk(orderId);
        if (!order) {
            return res.status(404).json({
                success: false,
                error: "Заказ не найден",
            });
        }

        if (order.creatorId !== userId) {
            return res.status(403).json({
                success: false,
                error: "Нет доступа к этому заказу",
            });
        }

        if (order.status !== "pending_payment") {
            return res.status(400).json({
                success: false,
                error: "Этот заказ не требует оплаты продвижения",
            });
        }

        const intent = await claimPromotionPaymentIntent({
            orderId: order.id,
            userId,
            provider: "tbank",
            mode: "redirect",
        });

        if (!intent.created) {
            const previous =
                existingPromotionPaymentResponse(intent);

            return res.status(previous.httpStatus)
                .json(previous.body);
        }

        const amountKopecks = intent.amountKopecks;

        const tbankOrderId = intent.bankOrderId;
        const description = `Продвижение заказа #${orderId}`;

        const payment = await requestTBank("Init", {
            Amount: amountKopecks,
            OrderId: tbankOrderId,
            Description: description,
            SuccessURL: `${process.env.FRONTEND_URL}/my-orders/${userId}?promoReturn=1&orderId=${orderId}&provider=tbank`,
            FailURL: `${process.env.FRONTEND_URL}/my-orders/${userId}?promoReturn=0&orderId=${orderId}&provider=tbank`,
            NotificationURL: `${process.env.BACKEND_URL}/api/tbank-payments/webhook`,
            DATA: {
                type: "order_promotion",
                orderId: String(orderId),
                userId: String(userId),
            },
            Receipt: buildReceipt({
                user,
                amountKopecks,
                description,
            }),
        });

        await recordPromotionPaymentIntent({
            orderId: order.id,
            provider: "tbank",
            paymentId: String(payment.PaymentId || ""),
            confirmationUrl: payment.PaymentURL || null,
            paymentStatus: payment.Status,
        });

        await req.logAction?.({
            req,
            actorUserId: userId,
            actorRole: "user",
            actionType: "payment_create",
            entityType: "payment",
            paymentId: String(payment.PaymentId),
            orderId: Number(orderId),
            severity: "info",
            meta: {
                provider: "tbank",
                type: "order_promotion",
                amount: kopecksToRubString(amountKopecks),
                status: payment.Status,
                tbankOrderId,
            },
        });

        return res.json({
            success: true,
            provider: "tbank",
            paymentId: String(payment.PaymentId),
            orderId: tbankOrderId,
            confirmationUrl: payment.PaymentURL,
            status: payment.Status,
        });
    } catch (e) {
        console.error("tbank order/promotion/create error:", e);

        notifyPaymentProblem({
            provider: "T-Bank",
            type: "webhook",

            title: "🚨 Ошибка оплаты продвижения",

            message: [
                `Ошибка: ${e?.message || "Unknown error"}`,
                req.body?.PaymentId
                    ? `Payment ID: ${req.body.PaymentId}`
                    : null,
                req.body?.OrderId
                    ? `Order ID: ${req.body.OrderId}`
                    : null,
                req.body?.Status
                    ? `Статус: ${req.body.Status}`
                    : null,
            ]
                .filter(Boolean)
                .join("\n"),
        });

        return res.status(500).json({
            success: false,
            error: e?.message || "Internal server error",
        });
    }
});

router.post("/webhook", async (req, res) => {
    const io = req.app.locals.io;

    try {
        const body = req.body || {};

        const isValid = verifyNotificationToken(body);


        if (!isValid) {
            // Не выводим недоверенные данные
            // входящего webhook в технические логи.
            console.warn(
                "TBank webhook signature verification failed"
            );

            // Единый мониторинг ошибок.
            // Повторы автоматически группируются.
            void notifySystemError({
                module: "payments.tbank",
                phase: "invalid_webhook_signature",
                severity: "high",
                error: {
                    name: "WebhookSecurityError",
                    code: "INVALID_SIGNATURE",
                },
            });

            // Сохраняем существующее поведение:
            // неправильная подпись не должна
            // вызывать бесконечные повторы банка.
            return res.status(200).send("OK");
        }


        // Уведомление о привязке карты.
// Подпись Т-Банка уже проверена выше.
        if (
            String(body.NotificationType || "") === "LINKCARD"
        ) {
            await processTBankCardNotification(body);

            return res.status(200).send("OK");
        }

        const status = body.Status;
        const paymentId = String(body.PaymentId || "");
        const amountKopecks = Number(body.Amount || 0);

        /**
         * У тебя в callback сейчас НЕ приходит Data/DATA.
         * Поэтому основной источник type/userId/orderId — это OrderId.
         *
         * Примеры:
         * premium_1_7d_1777460981363
         * debt_1_1777460981363
         * promo_123_1777460981363
         */
// Вложенный DATA не участвует в расчёте
// подписи Т-Банка. Для определения пользователя
// используем подписанный OrderId.
        const parsed = parseTBankOrderId(body.OrderId);

        const type = parsed.type;
        const userId = Number(parsed.id);
        const orderId = Number(parsed.id);
        const duration = parsed.extra;

        const autoChargeMatch =
            /^auto([0-9]+)$/.exec(
                String(parsed.extra || "")
            );

        const commissionAttemptId =
            autoChargeMatch
                ? Number(autoChargeMatch[1])
                : null;

        const isDebtPaymentIntent =
            type === "debt" &&
            /^[a-f0-9]{32}$/i.test(
                String(parsed.extra || "")
            );

        await req.logAction?.({
            req,
            actorUserId: null,
            actorRole: "webhook",
            actionType: `tbank_${status}`,
            entityType: "payment",
            paymentId,
            orderId: type === "promo" || type === "order_promotion" ? orderId : null,
            severity: "info",
            meta: {
                provider: "tbank",
                type,
                status,
                amount: kopecksToRubString(amountKopecks),
                rawOrderId: body.OrderId,
                userId: type === "premium" || type === "debt" ? userId : null,
                duration: type === "premium" ? duration : null,
            },
        });

        /**
         * Т-Банк может прислать AUTHORIZED и CONFIRMED.
         * Для простых платежей финально обрабатываем только CONFIRMED.
         */

        const problemStatuses = new Set([
            "CANCELED",
            "REVERSED",
            "PARTIAL_REVERSED",
            "REJECTED",
        ]);

        if (problemStatuses.has(status)) {

            if (isDebtPaymentIntent) {
                const { QueryTypes } = require("sequelize");

                const intents = await db.sequelize.query(
                    `
        SELECT id, user_id
        FROM debt_payment_intents
        WHERE provider = 'tbank'
          AND provider_order_id = :bankOrderId
          AND provider_payment_id = :paymentId
          AND user_id = :userId
        LIMIT 1
        `,
                    {
                        replacements: {
                            bankOrderId: String(body.OrderId),
                            paymentId,
                            userId,
                        },
                        type: QueryTypes.SELECT,
                    }
                );

                if (intents.length === 1) {
                    await reconcileDebtPayment({
                        intentId: Number(intents[0].id),
                        userId,
                    });
                }
            }

            notifyPaymentProblem({
                provider: "T-Bank",
                type,

                title: "❌ Проблема с платежом T-Bank",

                userId:
                    type === "premium" ||
                    type === "debt"
                        ? userId
                        : null,

                orderId:
                    type === "promo" ||
                    type === "order_promotion" ||
                    type === "promotion"
                        ? orderId
                        : null,

                message: [
                    `Payment ID: ${paymentId || "—"}`,
                    `Order ID: ${body.OrderId || "—"}`,
                    `Статус: ${status}`,
                    `Сумма: ${kopecksToRubString(amountKopecks)} ₽`,
                ].join("\n"),
            });

            return res.status(200).send("OK");
        }

        if (
            status ===
            "REFUNDED"
        ) {
            /*
             * Не доверяем Amount как размеру
             * возврата.
             *
             * BusinessCash сам знает исходную
             * сумму этого paymentId и вернёт
             * весь оставшийся остаток.
             */
            void sendBusinessCashRefund({
                provider:
                    "tbank",

                paymentId,

                refundId:
                    `${paymentId}:REFUNDED`,

                fullRefund:
                    true,

                occurredAt:
                    new Date()
                        .toISOString(),
            });

            return res
                .status(200)
                .send("OK");
        }

        if (
            status ===
            "PARTIAL_REFUNDED"
        ) {
            /*
             * Пока не записываем сумму вслепую.
             * В уведомлении нам нужно достоверно
             * знать именно размер конкретного
             * частичного возврата.
             */
            console.warn(
                "⚠️ TBank PARTIAL_REFUNDED требует сверки суммы возврата",
                {
                    paymentId,
                    orderId:
                    body.OrderId,
                }
            );

            return res
                .status(200)
                .send("OK");
        }

        if (status !== "CONFIRMED") {
            return res.status(200).send("OK");
        }

// ====== Premium / Debt ======
        if (type === "premium" || type === "debt") {
            if (
                !Number.isSafeInteger(userId) ||
                userId <= 0 ||
                !paymentId ||
                !Number.isSafeInteger(amountKopecks) ||
                amountKopecks <= 0
            ) {
                throw new Error(
                    "Некорректные данные платежа Т-Банка"
                );
            }

            // Подпись webhook уже проверена выше.
            // Дополнительно сверяем платёж с API банка.
            const verified = await requestTBank(
                "GetState",
                {
                    PaymentId: paymentId,
                }
            );

            if (
                String(verified.PaymentId) !== paymentId ||
                String(verified.OrderId) !== String(body.OrderId) ||
                verified.Status !== "CONFIRMED" ||
                Number(verified.Amount) !== amountKopecks ||
                String(verified.TerminalKey) !==
                String(process.env.TBANK_TERMINAL_KEY)
            ) {
                throw new Error(
                    "Не удалось подтвердить платёж Т-Банка"
                );
            }

            const result = isDebtPaymentIntent
                ? await settleConfirmedDebtPayment({
                    provider: "tbank",
                    paymentId,
                    userId,
                    amountKopecks,
                    bankOrderId: String(verified.OrderId),
                })
                : await applyConfirmedPayment({
                    provider: "tbank",
                    paymentId,
                    userId,
                    purpose: type,
                    duration:
                        type === "premium"
                            ? duration
                            : null,
                    amountKopecks,
                    commissionAttemptId:
                        type === "debt"
                            ? commissionAttemptId
                            : null,
                });

            /*
             * Выручку передаём только после:
             * 1. проверки подписи уведомления;
             * 2. подтверждения GetState;
             * 3. успешной транзакции учёта платежа.
             *
             * Повторную доставку разрешаем —
             * идемпотентность BusinessCash должна
             * обеспечиваться по provider + paymentId.
             */
            void sendBusinessCashPayment({
                provider: "tbank",
                paymentId,
                kind: type,
                amountKopecks,
                userId,
                orderId: null,
                occurredAt: new Date().toISOString(),
            });


            if (!result.duplicate) {
                await req.logAction?.({
                    req,
                    actorUserId: userId,
                    actorRole: "webhook",
                    actionType:
                        type === "premium"
                            ? "premium_activated"
                            : "debt_paid",
                    entityType:
                        type === "premium"
                            ? "user"
                            : "payment",
                    entityId:
                        type === "premium"
                            ? userId
                            : null,
                    paymentId,
                    severity: "info",
                    meta: {
                        provider: "tbank",
                        duration:
                            type === "premium"
                                ? duration
                                : null,
                        appliedKopecks:
                        result.appliedKopecks,
                        subscriptionExpiresAt:
                        result.subscriptionExpiresAt,
                    },
                });
            }

            return res.status(200).send("OK");
        }

        // ====== 3) Promotion ======
        if (
            type === "promo" ||
            type === "order_promotion" ||
            type === "promotion"
        ) {
            if (
                !Number.isSafeInteger(orderId) ||
                orderId <= 0 ||
                !paymentId
            ) {
                throw new Error(
                    "Некорректный платёж продвижения Т-Банка"
                );
            }

            const order = await Order.findByPk(orderId);

            if (!order) {
                throw new Error(
                    "Заказ оплаченного продвижения не найден"
                );
            }

            const verified = await requestTBank(
                "GetState",
                {
                    PaymentId: paymentId,
                }
            );

            verifyTBankPromotion(
                verified,
                order,
                paymentId,
                body.OrderId
            );

            const result = await applyVerifiedPromotion({
                provider: "tbank",
                paymentId,
                orderId,
                amountKopecks: Number(verified.Amount),
            });

            if (result.duplicate) {
                return res.status(200).send("OK");
            }

            await publishPaidOrder({
                db,
                io,
                orderId,
            });

            void sendBusinessCashPayment({
                provider: "tbank",
                paymentId,
                kind: "promotion",
                amountKopecks: Number(verified.Amount),
                userId: order.creatorId,
                orderId,
                occurredAt: new Date().toISOString(),
            });

            if (result.sendPush) {
                try {
                    await sendOrderPush({
                        db,
                        io,
                        orderId,
                        radiusKm: 50,
                        limit: 10,
                        logAction:
                            req.logAction ||
                            req.app?.locals?.logAction ||
                            null,
                    });
                } catch (error) {
                    console.error(
                        "TBank promotion push error:",
                        error
                    );
                }
            }

            try {
                await req.logAction?.({
                    req,
                    actorUserId: order.creatorId,
                    actorRole: "webhook",
                    actionType: "promotion_paid",
                    entityType: "order",
                    paymentId,
                    orderId,
                    severity: "info",
                    meta: {
                        provider: "tbank",
                        amountKopecks:
                            Number(verified.Amount),
                    },
                });
            } catch (error) {
                console.error(
                    "Promotion audit error:",
                    error
                );
            }

            return res.status(200).send("OK");
        }

        return res.status(200).send("OK");

    } catch (e) {
        console.error(
            "TBank webhook error:",
            e?.code || e?.name || "Error"
        );

        // Исключаем повторное уведомление
        // от общего HTTP-монитора.
        res.locals.cargoCampErrorReported = true;

        void notifySystemError({
            module: "payments.tbank",
            phase: "webhook",
            severity: "high",
            error: e,
            req,
        });

        // Сохраняем существующие правила
        // ответа Т-Банку при ошибке.
        const paymentType = parseTBankOrderId(
            req.body?.OrderId
        ).type;

        if (
            [
                "premium",
                "debt",
                "promo",
                "promotion",
                "order_promotion",
            ].includes(paymentType)
        ) {
            return res.status(500).send("ERROR");
        }

        if (
            req.body?.NotificationType === "LINKCARD" ||
            ["premium", "debt"].includes(
                parseTBankOrderId(
                    req.body?.OrderId
                ).type
            )
        ) {
            return res.status(500).send("ERROR");
        }

        return res.status(200).send("OK");
    }
});

module.exports = router;
