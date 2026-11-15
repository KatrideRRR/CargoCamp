
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const jwt = require("jsonwebtoken");

const SECRET = "cargocamp-stage4-jwt-test-only";

function loadAuthMiddleware(User, AuthSession) {
    const filename = path.resolve(
        __dirname,
        "../middlewares/userAuth.js"
    );

    const source = fs.readFileSync(
        filename,
        "utf8"
    );

    const isolated = { exports: {} };

    const dependencies = {
        jsonwebtoken: {
            verify(token) {
                return jwt.verify(token, SECRET);
            },
        },

        "../models": {
            User,
            AuthSession,
        },

        "../utils/expiryGuard":
            require("../utils/expiryGuard"),
    };

    new Function(
        "require",
        "module",
        "exports",
        source
    )(
        (name) => {
            if (!Object.hasOwn(dependencies, name)) {
                throw new Error(
                    `Unexpected dependency: ${name}`
                );
            }

            return dependencies[name];
        },
        isolated,
        isolated.exports
    );

    return isolated.exports;
}

test(
    "User authentication rejects invalid and expired sessions",
    async () => {
        const user = {
            id: 42,
            role: "user",
            phone: "79990000042",
        };

        const session = {
            id: "55",
            userId: 42,
            scope: "user",
            revokedAt: null,
            expiresAt: new Date(
                Date.now() + 3600000
            ),
            absoluteExpiresAt: new Date(
                Date.now() + 86400000
            ),
        };

        const User = {
            async findByPk(id) {
                return Number(id) === 42
                    ? user
                    : null;
            },
        };

        const AuthSession = {
            async findByPk(id) {
                return String(id) === "55"
                    ? session
                    : null;
            },
        };

        const auth = loadAuthMiddleware(
            User,
            AuthSession
        );

        const app = express();

        app.get("/api/private", auth, (req, res) => {
            res.json({
                success: true,
                userId: req.user.id,
                role: req.user.role,
            });
        });

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

        const token = jwt.sign(
            {
                id: 42,
                scope: "user",
                sid: "55",
            },
            SECRET,
            {
                expiresIn: "30m",
            }
        );

        async function request(value = token) {
            const response = await fetch(
                `${base}/api/private`,
                {
                    headers: value
                        ? {
                            Authorization:
                                `Bearer ${value}`,
                        }
                        : {},
                }
            );

            await response.text();

            return response.status;
        }

        try {
            assert.equal(
                await request(),
                200
            );

            assert.equal(
                await request(null),
                401
            );

            assert.equal(
                await request("broken-jwt"),
                401
            );

            session.expiresAt =
                new Date(Date.now() - 1000);

            assert.equal(
                await request(),
                401
            );

            session.expiresAt = "broken-date";

            assert.equal(
                await request(),
                401
            );

            session.expiresAt =
                new Date(Date.now() + 3600000);

            session.absoluteExpiresAt =
                "broken-date";

            assert.equal(
                await request(),
                401
            );

            session.absoluteExpiresAt =
                new Date(Date.now() + 86400000);

            session.revokedAt = new Date();

            assert.equal(
                await request(),
                401
            );

            session.revokedAt = null;
            session.scope = "admin";

            assert.equal(
                await request(),
                401
            );

            session.scope = "user";
            session.userId = 99;

            assert.equal(
                await request(),
                401
            );

            session.userId = 42;
            user.role = "banned";

            assert.equal(
                await request(),
                403
            );

            user.role = "user";

            assert.equal(
                await request(),
                200
            );

            // Admin JWT недопустим в user API.
            const adminToken = jwt.sign(
                {
                    id: 42,
                    scope: "admin",
                    sid: "55",
                },
                SECRET,
                { expiresIn: "30m" }
            );

            assert.equal(
                await request(adminToken),
                401
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
