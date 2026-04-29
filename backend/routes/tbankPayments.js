// backend/routes/tbankPayments.js

const express = require("express");
const router = express.Router();
const { Order, User } = require("../models");
const db = require("../models");
const authenticateToken = require("../middlewares/userAuth");
const { requestTBank, verifyNotificationToken } = require("../config/tbankClient");
const { sendOrderPush } = require("../utils/orderPushService");

function cleanPhone(phone) {
    return String(phone || "").replace(/[^\d+]/g, "");
}

function rubToKopecks(value) {
    return Math.round(Number(value || 0) * 100);
}

function kopecksToRubString(kopecks) {
    return (Number(kopecks || 0) / 100).toFixed(2);
}

function buildTBankOrderId(type, id) {
    return `${type}_${id}_${Date.now()}`;
}

/**
 * Чек для Т-Банка.
 * Важно: проверь в личном кабинете Т-Банка, какая у тебя система налогообложения.
 * Здесь стоит "usn_income" как аналог твоего tax_system_code: 2 в ЮKassa.
 */
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

/**
 * 1) Premium через Т-Банк
 */
router.post("/premium/create", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { duration } = req.body;

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

        const addDays = duration === "7d" ? 7 : 30;
        const amountKopecks = rubToKopecks(amountRub);
        const orderId = buildTBankOrderId("premium", userId);

        const description = `Premium ${duration} для пользователя #${userId}`;

        const payment = await requestTBank("Init", {
            Amount: amountKopecks,
            OrderId: orderId,
            Description: description,
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
        return res.status(500).json({
            success: false,
            error: e?.message || "Internal server error",
        });
    }
});

/**
 * 2) Debt через Т-Банк
 */
router.post("/debt/create", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const { returnPath } = req.body || {};

        const user = await User.findByPk(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: "Пользователь не найден",
            });
        }

        const debtKopecks = Number(user.debt || 0);

        if (debtKopecks <= 0) {
            return res.json({
                success: true,
                noDebt: true,
            });
        }

        const safeReturnPath =
            typeof returnPath === "string" && returnPath.startsWith("/")
                ? returnPath
                : "/profile?debtReturn=1";

        const orderId = buildTBankOrderId("debt", userId);
        const description = `Оплата комиссии пользователя #${userId}`;

        const payment = await requestTBank("Init", {
            Amount: debtKopecks,
            OrderId: orderId,
            Description: description,
            SuccessURL: `${process.env.FRONTEND_URL}${safeReturnPath}${safeReturnPath.includes("?") ? "&" : "?"}provider=tbank`,
            FailURL: `${process.env.FRONTEND_URL}/profile?debtReturn=0&provider=tbank`,
            NotificationURL: `${process.env.BACKEND_URL}/api/tbank-payments/webhook`,
            DATA: {
                type: "debt",
                userId: String(userId),
                expectedKopecks: String(debtKopecks),
            },
            Receipt: buildReceipt({
                user,
                amountKopecks: debtKopecks,
                description: "Оплата комиссии",
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
                type: "debt",
                amount: kopecksToRubString(debtKopecks),
                status: payment.Status,
                tbankOrderId: orderId,
            },
        });

        return res.json({
            success: true,
            provider: "tbank",
            paidBySavedCard: false,
            paymentId: String(payment.PaymentId),
            orderId,
            confirmationUrl: payment.PaymentURL,
            status: payment.Status,
        });
    } catch (e) {
        console.error("tbank debt/create error:", e);
        return res.status(500).json({
            success: false,
            error: e?.message || "Internal server error",
        });
    }
});

/**
 * 3) Promotion через Т-Банк
 */
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

        const PROMOTION_PRICES = {
            highlight: 50,
            recommended: 100,
            push: 150,
        };

        let pr = order.promotionRequested || {};

        if (typeof pr === "string") {
            try {
                pr = JSON.parse(pr);
            } catch {
                pr = {};
            }
        }

        const totalRub = Object.entries(pr).reduce((sum, [key, value]) => {
            return value && PROMOTION_PRICES[key]
                ? sum + PROMOTION_PRICES[key]
                : sum;
        }, 0);

        if (totalRub <= 0) {
            return res.status(400).json({
                success: false,
                error: "Продвижение не выбрано",
            });
        }

        const amountKopecks = rubToKopecks(totalRub);
        const tbankOrderId = buildTBankOrderId("promotion", orderId);
        const description = `Продвижение заказа #${orderId}`;

        const payment = await requestTBank("Init", {
            Amount: amountKopecks,
            OrderId: tbankOrderId,
            Description: description,
            SuccessURL: `${process.env.FRONTEND_URL}/orders?promoReturn=1&orderId=${orderId}&provider=tbank`,
            FailURL: `${process.env.FRONTEND_URL}/orders?promoReturn=0&orderId=${orderId}&provider=tbank`,
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

        await order.update({
            promotionPaymentId: String(payment.PaymentId),
            promotionPaymentProvider: "tbank",
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
        return res.status(500).json({
            success: false,
            error: e?.message || "Internal server error",
        });
    }
});

/**
 * 4) Webhook Т-Банка
 */
router.post("/webhook", async (req, res) => {
    const io = req.app.locals.io;

    try {
        const body = req.body || {};

        const isValid = verifyNotificationToken(body);

        if (!isValid) {
            console.warn("⚠️ Invalid TBank webhook token", body);
            return res.status(403).send("INVALID TOKEN");
        }

        const status = body.Status;
        const paymentId = String(body.PaymentId || "");
        const amountKopecks = Number(body.Amount || 0);

        const data = body.DATA || body.Data || {};
        const type = data.type;

        await req.logAction?.({
            req,
            actorUserId: null,
            actorRole: "webhook",
            actionType: `tbank_${status}`,
            entityType: "payment",
            paymentId,
            orderId: data.orderId ? Number(data.orderId) : null,
            severity: "info",
            meta: {
                provider: "tbank",
                type,
                status,
                amount: kopecksToRubString(amountKopecks),
                rawOrderId: body.OrderId,
            },
        });

        /**
         * Для простых платежей нас интересует CONFIRMED.
         * В Т-Банке успешная оплата обычно приходит как CONFIRMED.
         */
        if (status !== "CONFIRMED") {
            return res.status(200).send("OK");
        }

        // ====== Premium ======
        if (type === "premium") {
            const userId = Number(data.userId);
            const duration = data.duration;

            const addDays =
                duration === "7d"
                    ? 7
                    : duration === "30d"
                        ? 30
                        : 0;

            if (!addDays) return res.status(200).send("OK");

            const user = await User.findByPk(userId);
            if (!user) return res.status(200).send("OK");

            const now = new Date();
            const currentExp = user.subscription_expires_at
                ? new Date(user.subscription_expires_at)
                : null;

            const base =
                user.subscription_type === "premium" &&
                currentExp &&
                currentExp > now
                    ? currentExp
                    : now;

            const newExp = new Date(
                base.getTime() + addDays * 24 * 60 * 60 * 1000
            );

            await user.update({
                subscription_type: "premium",
                subscription_expires_at: newExp,
            });

            return res.status(200).send("OK");
        }

        // ====== Debt ======
        if (type === "debt") {
            const userId = Number(data.userId);

            const user = await User.findByPk(userId);
            if (!user) return res.status(200).send("OK");

            const currentDebt = Number(user.debt || 0);

            if (currentDebt <= 0) {
                return res.status(200).send("OK");
            }

            const newDebt = Math.max(0, currentDebt - amountKopecks);

            await user.update({
                debt: newDebt,
                commissionDebtOrderId:
                    newDebt === 0 ? null : user.commissionDebtOrderId,
            });

            return res.status(200).send("OK");
        }

        // ====== Promotion ======
        if (type === "order_promotion") {
            const orderId = Number(data.orderId);

            const order = await Order.findByPk(orderId);
            if (!order) return res.status(200).send("OK");

            if (
                order.promotionPaymentId &&
                String(order.promotionPaymentId) !== paymentId
            ) {
                return res.status(200).send("OK");
            }

            let pr = order.promotionRequested || {};

            if (typeof pr === "string") {
                try {
                    pr = JSON.parse(pr);
                } catch {
                    pr = {};
                }
            }

            await order.update({
                status: "pending",
                is_highlighted: !!pr.highlight,
                is_recommended: !!pr.recommended,
                is_push_notified: !!pr.push,
                promotionPaidAt: new Date(),
            });

            io?.emit("orderUpdated");

            if (pr.push) {
                try {
                    const logAction = req.logAction || req.app?.locals?.logAction || null;

                    await sendOrderPush({
                        db,
                        io,
                        orderId: order.id,
                        radiusKm: 50,
                        limit: 10,
                        logAction,
                    });
                } catch (e) {
                    console.error("sendOrderPush error:", e);
                }
            }

            return res.status(200).send("OK");
        }

        return res.status(200).send("OK");
    } catch (e) {
        console.error("tbank webhook error:", e);

        /**
         * Важно:
         * лучше вернуть 200, чтобы банк не долбил webhook бесконечно,
         * но ошибку записать в логи.
         */
        return res.status(200).send("OK");
    }
});

module.exports = router;