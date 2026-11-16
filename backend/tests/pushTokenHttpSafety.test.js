
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const express = require("express");
const { Op } = require("sequelize");

const {
    loadIsolatedRouter,
} = require("./helpers/loadIsolatedRouter");

function hash(token) {
    return crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
}

function matches(row, where) {
    return Reflect.ownKeys(where).every((key) => {
        const expected = where[key];

        if (
            expected &&
            typeof expected === "object" &&
            Object.hasOwn(expected, Op.ne)
        ) {
            return row[key] !== expected[Op.ne];
        }

        return row[key] === expected;
    });
}

test(
    "Push token ownership, rotation and unregister use authenticated user",
    async (t) => {
        const rows = [];
        let nextId = 1;

        const PushToken = {
            async findOrCreate({ where, defaults }) {
                let row = rows.find(
                    (item) =>
                        item.tokenHash === where.tokenHash
                );

                if (row) {
                    return [row, false];
                }

                row = {
                    id: nextId++,
                    ...defaults,

                    async update(values) {
                        Object.assign(this, values);
                    },
                };

                rows.push(row);

                return [row, true];
            },

            async update(values, { where }) {
                let count = 0;

                for (const row of rows) {
                    if (matches(row, where)) {
                        Object.assign(row, values);
                        count++;
                    }
                }

                return [count];
            },
        };

        const router = loadIsolatedRouter(
            "pushTokens.js",
            {
                express,
                crypto,
                sequelize: { Op },

                "../services/pushService": {
                    async sendPushToUser({ userId }) {
                        return {
                            successCount: 1,
                            testUserId: userId,
                        };
                    },
                },

                "../middlewares/userAuth": (
                    req,
                    res,
                    next
                ) => {
                    const userId = Number(
                        req.headers["x-test-user"]
                    );

                    if (
                        !Number.isSafeInteger(userId) ||
                        userId <= 0
                    ) {
                        return res.sendStatus(401);
                    }

                    req.user = { id: userId };
                    next();
                },

                "../models": {
                    PushToken,
                },
            }
        );

        const app = express();

        app.use(express.json());
        app.use("/api/push", router);

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

        const base =
            `http://127.0.0.1:${server.address().port}`;

        async function post(
            path,
            userId,
            body = {}
        ) {
            const response = await fetch(
                `${base}/api/push/${path}`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/json",

                        ...(userId
                            ? {
                                "x-test-user":
                                    String(userId),
                            }
                            : {}),
                    },
                    body: JSON.stringify(body),
                }
            );

            const raw = await response.text();

            let data = {};

            try {
                data = JSON.parse(raw);
            } catch {
                // 401 может быть текстовым.
            }

            return {
                status: response.status,
                body: data,
            };
        }

        const tokenA = "fake-firebase-token-A";
        const tokenB = "fake-firebase-token-B";

        assert.equal(
            (await post("register", null, {
                token: tokenA,
            })).status,
            401
        );

        assert.equal(
            (await post("register", 7, {})).status,
            400
        );

        const first = await post(
            "register",
            7,
            {
                token: tokenA,
                platform: "ios",
                deviceId: "device-one",
            }
        );

        assert.equal(first.status, 200);
        assert.equal(first.body.created, true);

        assert.equal(rows.length, 1);
        assert.equal(rows[0].userId, 7);
        assert.equal(rows[0].platform, "ios");
        assert.equal(rows[0].isActive, true);

        const duplicate = await post(
            "register",
            7,
            {
                token: tokenA,
                platform: "ios",
                deviceId: "device-one",
            }
        );

        assert.equal(duplicate.status, 200);
        assert.equal(duplicate.body.created, false);
        assert.equal(rows.length, 1);

        // У того же пользователя изменился
        // Firebase-токен устройства.
        const rotation = await post(
            "register",
            7,
            {
                token: tokenB,
                platform: "ios",
                deviceId: "device-one",
            }
        );

        assert.equal(rotation.status, 200);

        assert.equal(
            rows.find(
                (row) => row.tokenHash === hash(tokenA)
            ).isActive,
            false
        );

        assert.equal(
            rows.find(
                (row) => row.tokenHash === hash(tokenB)
            ).isActive,
            true
        );

        // Тот же токен теперь принадлежит
        // другой авторизованной учётной записи.
        const transfer = await post(
            "register",
            8,
            {
                token: tokenB,
                platform: "ios",
                deviceId: "device-one",
            }
        );

        assert.equal(transfer.status, 200);

        const active = rows.find(
            (row) =>
                row.tokenHash === hash(tokenB)
        );

        assert.equal(active.userId, 8);
        assert.equal(active.isActive, true);

        // Старый пользователь не должен
        // отключать токен новой учётной записи.
        assert.equal(
            (await post("unregister", 7, {
                token: tokenB,
            })).status,
            200
        );

        assert.equal(active.isActive, true);

        assert.equal(
            (await post("unregister", 8, {
                token: tokenB,
            })).status,
            200
        );

        assert.equal(active.isActive, false);

        // Проверка отправки — только заглушка.
        const check = await post("test", 8);

        assert.equal(check.status, 200);
        assert.equal(
            check.body.result.testUserId,
            8
        );
    }
);
