
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const {
    createMutationAuditObserver,
} = require("../middlewares/mutationAuditObserver");

const {
    createHttpErrorObserver,
} = require("../services/operationalErrorMonitor");

test(
    "HTTP audit and error monitoring work together",
    async () => {
        const entries = [];
        const alerts = [];

        const app = express();

        app.use(
            createHttpErrorObserver({
                notifySystemError: async (event) => {
                    alerts.push(event);
                    return { success: true };
                },
            })
        );

        app.use(
            createMutationAuditObserver({
                write: async (entry) => {
                    entries.push(entry);
                },
            })
        );

        // Исключительно тестовый пользователь.
        app.use("/api", (req, res, next) => {
            if (
                req.headers.authorization !==
                "Bearer isolated-test"
            ) {
                return res.sendStatus(401);
            }

            req.user = {
                id: 17,
                role: "user",
            };

            next();
        });

        app.post(
            "/api/orders/:id/accept",
            (req, res) => {
                res.status(201).json({
                    success: true,
                });
            }
        );

        app.post(
            "/api/orders/:id/denied",
            (req, res) => {
                res.sendStatus(403);
            }
        );

        app.post(
            "/api/orders/:id/crash",
            (req, res) => {
                res.sendStatus(500);
            }
        );

        app.get(
            "/api/orders/:id",
            (req, res) => {
                res.json({ id: req.params.id });
            }
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

        const base =
            `http://127.0.0.1:${server.address().port}`;

        async function request(path, {
            method = "POST",
            authorized = true,
        } = {}) {
            const response = await fetch(
                base + path,
                {
                    method,
                    headers: authorized
                        ? {
                            Authorization:
                                "Bearer isolated-test",
                        }
                        : {},
                }
            );

            await response.text();

            return response.status;
        }

        try {
            assert.equal(
                await request("/api/orders/123/accept"),
                201
            );

            assert.equal(
                await request("/api/orders/123/denied"),
                403
            );

            assert.equal(
                await request("/api/orders/123/accept", {
                    authorized: false,
                }),
                401
            );

            assert.equal(
                await request("/api/orders/123", {
                    method: "GET",
                }),
                200
            );

            assert.equal(
                await request("/api/orders/123/crash"),
                500
            );

            await new Promise((resolve) =>
                setImmediate(resolve)
            );

            // Только успешный POST попал в ActionLog.
            assert.equal(entries.length, 1);

            assert.equal(
                entries[0].actorUserId,
                17
            );

            assert.equal(
                entries[0].orderId,
                123
            );

            assert.equal(
                entries[0].actionType,
                "api_mutation"
            );

            assert.equal(
                entries[0].meta.route,
                "/api/orders/:id/accept"
            );

            // Только HTTP 500 вызывает мониторинг.
            assert.equal(alerts.length, 1);

            assert.equal(
                alerts[0].error.code,
                "HTTP_500"
            );

        } finally {
            const closed = new Promise(
                (resolve, reject) => {
                    server.close((error) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve();
                        }
                    });
                }
            );

            server.closeAllConnections?.();

            await closed;
        }
    }
);
