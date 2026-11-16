
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const {
    loadIsolatedRouter,
} = require("./helpers/loadIsolatedRouter");

test(
    "TBank webhook verifies payment before accounting",
    async (t) => {
        const oldTerminal =
            process.env.TBANK_TERMINAL_KEY;

        process.env.TBANK_TERMINAL_KEY =
            "CARGOCAMP_TEST_TERMINAL";

        t.after(() => {
            if (oldTerminal === undefined) {
                delete process.env.TBANK_TERMINAL_KEY;
            } else {
                process.env.TBANK_TERMINAL_KEY =
                    oldTerminal;
            }
        });

        const state = {
            validSignature: true,
            bankStatus: "CONFIRMED",
            failApplication: false,
            duplicate: false,
        };

        const calls = {
            bank: 0,
            applied: 0,
            accounting: 0,
            order: [],
        };

        const router = loadIsolatedRouter(
            "tbankPayments.js",
            {
                express,

                "../models": {
                    User: {},
                    Order: {},
                },

                "../services/paymentReceiptService": {
                    async applyConfirmedPayment(data) {
                        calls.applied++;
                        calls.order.push("apply");

                        assert.equal(
                            data.provider,
                            "tbank"
                        );

                        assert.equal(
                            data.purpose,
                            "debt"
                        );

                        assert.equal(
                            data.amountKopecks,
                            10000
                        );

                        if (state.failApplication) {
                            throw new Error(
                                "ISOLATED_RECEIPT_FAILURE"
                            );
                        }

                        return {
                            duplicate: state.duplicate,
                            appliedKopecks: 10000,
                            debtKopecks: 0,
                        };
                    },
                },

                "../middlewares/userAuth":
                    (req, res, next) => next(),

                "../config/tbankClient": {
                    verifyNotificationToken() {
                        return state.validSignature;
                    },

                    async requestTBank(method, params) {
                        assert.equal(
                            method,
                            "GetState"
                        );

                        assert.equal(
                            params.PaymentId,
                            "tbank-payment-101"
                        );

                        calls.bank++;
                        calls.order.push("bank");

                        return {
                            PaymentId:
                                "tbank-payment-101",

                            OrderId:
                                "debt_7_123456",

                            Status:
                            state.bankStatus,

                            Amount: 10000,

                            TerminalKey:
                                "CARGOCAMP_TEST_TERMINAL",
                        };
                    },
                },

                "../services/tbankCardBindingService": {
                    async processTBankCardNotification() {},
                },

                "../utils/orderPushService": {
                    async sendOrderPush() {},
                },

                "../services/adminNotificationService": {
                    async sendAdminNotification() {},
                    adminUsersUrl: () => "/admin/users",
                    adminOrderUrl: () => "/admin/orders",
                    async notifySystemError() {},
                },

                "../services/businessCashService": {
                    async sendBusinessCashPayment(data) {
                        calls.accounting++;
                        calls.order.push("businesscash");

                        assert.equal(
                            data.provider,
                            "tbank"
                        );

                        assert.equal(
                            data.paymentId,
                            "tbank-payment-101"
                        );

                        return { ok: true };
                    },

                    async sendBusinessCashRefund() {
                        return { ok: true };
                    },
                },

                "../services/promotionPaymentService": {
                    verifyTBankPromotion() {},
                    async applyVerifiedPromotion() {},
                },

                "../services/promotionPaymentIntentService": {
                    async claimPromotionPaymentIntent() {},
                    async recordPromotionPaymentIntent() {},
                    existingPromotionPaymentResponse() {},
                },
            }
        );

        const app = express();

        app.use(express.json());

        app.use((req, res, next) => {
            req.logAction = async () => {};
            next();
        });

        app.use(
            "/api/tbank-payments",
            router
        );

        const server = await new Promise(
            (resolve, reject) => {
                const instance = app.listen(
                    0,
                    "127.0.0.1",
                    () => resolve(instance)
                );

                instance.once("error", reject);
            }
        );

        t.after(async () => {
            const closed = new Promise(
                (resolve, reject) => {
                    server.close((error) => {
                        if (error) reject(error);
                        else resolve();
                    });
                }
            );

            server.closeAllConnections?.();

            await closed;
        });

        const url =
            `http://127.0.0.1:${server.address().port}` +
            "/api/tbank-payments/webhook";

        async function webhook(status = "CONFIRMED") {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type":
                        "application/json",
                },
                body: JSON.stringify({
                    Status: status,
                    PaymentId: "tbank-payment-101",
                    OrderId: "debt_7_123456",
                    Amount: 10000,
                }),
            });

            await response.text();

            return response.status;
        }

        // Подпись не прошла: платёж не обрабатываем.
        state.validSignature = false;

        assert.equal(await webhook(), 200);
        assert.equal(calls.bank, 0);
        assert.equal(calls.applied, 0);
        assert.equal(calls.accounting, 0);

        state.validSignature = true;

        // AUTHORIZED ещё не означает оплату.
        assert.equal(
            await webhook("AUTHORIZED"),
            200
        );

        assert.equal(calls.applied, 0);
        assert.equal(calls.accounting, 0);

        // Уведомление говорит CONFIRMED,
        // но GetState этого не подтверждает.
        state.bankStatus = "AUTHORIZED";

        assert.equal(await webhook(), 500);
        assert.equal(calls.applied, 0);
        assert.equal(calls.accounting, 0);

        state.bankStatus = "CONFIRMED";

        // Банк подтвердил, но запись платежа
        // в CargoCamp завершилась ошибкой.
        state.failApplication = true;

        assert.equal(await webhook(), 500);
        assert.equal(calls.applied, 1);
        assert.equal(calls.accounting, 0);

        state.failApplication = false;
        calls.order.length = 0;

        // Корректный подтверждённый платёж.
        assert.equal(await webhook(), 200);
        assert.equal(calls.accounting, 1);

        assert.deepEqual(
            calls.order,
            [
                "bank",
                "apply",
                "businesscash",
            ]
        );

        // Повторное уведомление:
        // внутреннее применение идемпотентно.
        // BusinessCash получает ту же операцию,
        // а не новый уникальный платёж.
        state.duplicate = true;
        calls.order.length = 0;

        assert.equal(await webhook(), 200);

        assert.deepEqual(
            calls.order,
            [
                "bank",
                "apply",
                "businesscash",
            ]
        );
    }
);
