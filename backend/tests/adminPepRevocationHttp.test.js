
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const {
    loadIsolatedRouter,
} = require("./helpers/loadIsolatedRouter");

test(
    "Admin PEP revocation is validated, audited and atomic",
    async () => {
        const enrollment = {
            id: 55,
            userId: 7,
            revokedAt: null,
            revokedBy: null,
            revokeReason: null,

            async save({ transaction }) {
                assert.ok(transaction);
            },
        };

        const logs = [];

        let failAudit = false;

        const models = {
            sequelize: {
                async transaction(callback) {
                    const snapshot = {
                        revokedAt: enrollment.revokedAt,
                        revokedBy: enrollment.revokedBy,
                        revokeReason:
                        enrollment.revokeReason,
                    };

                    const transaction = {
                        LOCK: {
                            UPDATE: "UPDATE",
                        },
                    };

                    try {
                        return await callback(transaction);
                    } catch (error) {
                        // Имитация отката транзакции.
                        Object.assign(
                            enrollment,
                            snapshot
                        );

                        throw error;
                    }
                },
            },

            PepEnrollment: {
                async findOne(options) {
                    assert.equal(
                        options.lock,
                        options.transaction.LOCK.UPDATE
                    );

                    return Number(options.where.userId) === 7
                        ? enrollment
                        : null;
                },

                async findAll({ attributes }) {
                    const data = {
                        ...enrollment,
                        policyVersion: "1.1",
                        activatedAt: new Date(),
                        expiresAt: new Date(
                            Date.now() + 86400000
                        ),
                    };

                    return [
                        Object.fromEntries(
                            attributes.map((key) => [
                                key,
                                data[key] ?? null,
                            ])
                        ),
                    ];
                },
            },

            ActionLog: {
                async create(entry, options) {
                    assert.ok(options.transaction);

                    if (failAudit) {
                        throw new Error(
                            "ISOLATED_AUDIT_FAILURE"
                        );
                    }

                    logs.push(entry);
                },
            },
        };

        // Авторизация здесь подменена.
        // Настоящий admin JWT уже проверяется
        // в adminAuthHttp.test.js.
        const adminAuth = {
            authMiddleware(req, res, next) {
                if (!req.headers.authorization) {
                    return res.sendStatus(401);
                }

                req.user = {
                    id: 99,
                    role:
                        req.headers.authorization ===
                        "Bearer admin-test"
                            ? "admin"
                            : "user",
                };

                next();
            },

            adminMiddleware(req, res, next) {
                if (req.user.role !== "admin") {
                    return res.sendStatus(403);
                }

                next();
            },
        };

        const router = loadIsolatedRouter(
            "adminPep.js",
            {
                express,

                "../middlewares/adminAuth":
                adminAuth,

                "../models": models,
            }
        );

        const app = express();

        app.use(express.json());
        app.use("/api/admin/pep", router);

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

        async function request({
                                   path = "/7/revoke",
                                   reason = "Отзыв по решению администратора",
                                   auth = "Bearer admin-test",
                                   method = "POST",
                               } = {}) {
            const response = await fetch(
                `${base}/api/admin/pep${path}`,
                {
                    method,
                    headers: {
                        ...(auth
                            ? { Authorization: auth }
                            : {}),
                        "Content-Type":
                            "application/json",
                    },
                    ...(method !== "GET"
                        ? {
                            body: JSON.stringify({
                                reason,
                            }),
                        }
                        : {}),
                }
            );


            const responseText = await response.text();

            let body = null;

            try {
                body = JSON.parse(responseText);
            } catch {
                // HTTP 401/403 может возвращать текст.
            }

            return {
                status: response.status,
                body,
            };

        }

        try {
            assert.equal(
                (await request({ auth: null })).status,
                401
            );

            assert.equal(
                (await request({
                    auth: "Bearer user-test",
                })).status,
                403
            );

            assert.equal(
                (await request({
                    path: "/invalid/revoke",
                })).status,
                400
            );

            assert.equal(
                (await request({
                    reason: "short",
                })).status,
                400
            );

            assert.equal(
                logs.length,
                0
            );

            const success = await request();

            assert.equal(success.status, 200);
            assert.equal(success.body.success, true);

            assert.ok(enrollment.revokedAt);
            assert.equal(enrollment.revokedBy, 99);

            assert.equal(logs.length, 1);

            assert.equal(
                logs[0].actionType,
                "pep_enrollment_revoked"
            );

            assert.equal(
                logs[0].entityId,
                7
            );

            // Повторный отзыв не создаёт событие.
            assert.equal(
                (await request()).status,
                409
            );

            assert.equal(logs.length, 1);

            // Проверяем HTTP-ответ после
            // ошибки записи ActionLog.
            enrollment.revokedAt = null;
            enrollment.revokedBy = null;
            enrollment.revokeReason = null;

            failAudit = true;

            const failure = await request();

            assert.equal(failure.status, 500);
            assert.equal(enrollment.revokedAt, null);
            assert.equal(enrollment.revokedBy, null);
            assert.equal(logs.length, 1);

            // GET не должен возвращать
            // полный объект с приватными полями.
            const list = await request({
                path: "/enrollments",
                method: "GET",
            });

            assert.equal(list.status, 200);
            assert.equal(list.body.enrollments.length, 1);
            assert.equal(
                "phoneFingerprint" in
                list.body.enrollments[0],
                false
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
