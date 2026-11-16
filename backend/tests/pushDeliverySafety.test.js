
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

function makePushHarness({
                             available = true,
                             failBatch = false,
                         } = {}) {
    const tokens = [
        "test-valid-token-11111111111111111111",
        "test-stale-token-22222222222222222222",
        "test-other-token-33333333333333333333",
    ];

    const rows = [
        { id: 1, token: tokens[0] },
        { id: 2, token: tokens[0] },
        { id: 3, token: tokens[1] },
        { id: 4, token: tokens[2] },
    ];

    const calls = {
        messages: [],
        deactivated: [],
        alerts: [],
        dbReads: 0,
    };

    const service = loadIsolatedService(
        "pushService.js",
        {
            "../models": {
                PushToken: {
                    async findAll({ where }) {
                        calls.dbReads++;

                        assert.equal(where.userId, 42);
                        assert.equal(where.isActive, true);

                        return rows;
                    },

                    async update(values, options) {
                        assert.equal(values.isActive, false);

                        calls.deactivated.push(
                            ...options.where.tokenHash
                        );

                        return [
                            options.where.tokenHash.length
                        ];
                    },
                },
            },

            "../config/firebaseAdmin": {
                initFirebaseAdmin() {
                    if (!available) return null;

                    return {
                        messaging() {
                            return {
                                async sendEach(messages) {
                                    calls.messages.push(...messages);

                                    if (failBatch) {
                                        throw new Error(
                                            "ISOLATED_FCM_FAILURE"
                                        );
                                    }

                                    return {
                                        successCount: 1,
                                        failureCount: 2,
                                        responses: [
                                            { success: true },
                                            {
                                                success: false,
                                                error: {
                                                    code:
                                                        "messaging/registration-token-not-registered",
                                                },
                                            },
                                            {
                                                success: false,
                                                error: {
                                                    code:
                                                        "messaging/invalid-argument",
                                                },
                                            },
                                        ],
                                    };
                                },
                            };
                        },
                    };
                },
            },

            crypto,

            "./adminNotificationService": {
                notifySystemError(data) {
                    calls.alerts.push(data);
                },
            },
        }
    );

    return {
        tokens,
        calls,
        service,

        send() {
            return service.sendPushToUser({
                userId: 42,
                title: "Проверка доставки",
                body: "Тестовое сообщение",
                data: {
                    orderId: 101,
                    nested: { status: "active" },
                },
            });
        },
    };
}

test(
    "Firebase tokens are deduplicated and only proven invalid tokens are disabled",
    async () => {
        const h = makePushHarness();

        const warnings = [];
        const oldWarn = console.warn;

        console.warn = (...args) => {
            warnings.push(
                args.map((value) =>
                    typeof value === "string"
                        ? value
                        : JSON.stringify(value)
                ).join(" ")
            );
        };

        let result;

        try {
            result = await h.send();
        } finally {
            console.warn = oldWarn;
        }

        assert.equal(result.successCount, 1);
        assert.equal(result.failureCount, 2);

        // Четыре записи БД содержат только
        // три разных Firebase-токена.
        assert.equal(h.calls.messages.length, 3);

        assert.deepEqual(
            h.calls.messages.map(
                (message) => message.token
            ),
            h.tokens
        );

        const firstMessage = h.calls.messages[0];

        assert.equal(
            firstMessage.data.orderId,
            "101"
        );

        assert.equal(
            firstMessage.data.nested,
            '{"status":"active"}'
        );

        const staleHash = crypto
            .createHash("sha256")
            .update(h.tokens[1])
            .digest("hex");

        assert.deepEqual(
            h.calls.deactivated,
            [staleHash]
        );

        // Ошибка invalid-argument сама по себе
        // не доказывает неисправность токена.
        const otherHash = crypto
            .createHash("sha256")
            .update(h.tokens[2])
            .digest("hex");

        assert.equal(
            h.calls.deactivated.includes(otherHash),
            false
        );

        assert.equal(h.calls.alerts.length, 1);

        // Не допускаем фрагментов токенов в логах.
        const logText = warnings.join(" ");

        for (const token of h.tokens) {
            assert.equal(
                logText.includes(token.slice(0, 20)),
                false
            );
        }
    }
);

test(
    "Firebase unavailable does not trigger database reads",
    async () => {
        const h = makePushHarness({
            available: false,
        });

        const result = await h.send();

        assert.equal(result, undefined);
        assert.equal(h.calls.dbReads, 0);
        assert.equal(h.calls.messages.length, 0);
        assert.equal(h.calls.deactivated.length, 0);
    }
);

test(
    "Firebase batch failure does not deactivate any token",
    async () => {
        const h = makePushHarness({
            failBatch: true,
        });

        const oldError = console.error;

        console.error = () => {};

        let result;

        try {
            result = await h.send();
        } finally {
            console.error = oldError;
        }

        assert.equal(result, null);
        assert.equal(h.calls.messages.length, 3);
        assert.equal(h.calls.deactivated.length, 0);

        assert.equal(h.calls.alerts.length, 1);
        assert.equal(
            h.calls.alerts[0].phase,
            "firebase_batch"
        );
    }
);


test(
    "Notification is saved and sent over socket even when push fails",
    async () => {
        const saved = [];
        const socketEvents = [];
        const alerts = [];
        const pushCalls = [];

        const service = loadIsolatedService(
            "notificationService.js",
            {
                "../models": {
                    Notification: {
                        async create(data) {
                            const row = {
                                id: saved.length + 1,
                                createdAt: new Date(),
                                ...data,
                            };

                            saved.push(row);
                            return row;
                        },
                    },
                },

                "./pushService": {
                    async sendPushToUser(data) {
                        pushCalls.push(data);

                        throw new Error(
                            "ISOLATED_PUSH_FAILURE"
                        );
                    },
                },

                "../socket": {
                    sendToUser(userId, event, payload) {
                        socketEvents.push({
                            userId,
                            event,
                            payload,
                        });
                    },
                },

                "./adminNotificationService": {
                    notifySystemError(data) {
                        alerts.push(data);
                    },
                },
            }
        );

        const oldError = console.error;

        console.error = () => {};

        let result;

        try {
            result = await service.notifyUser({
                userId: 42,
                type: "new_message",
                title: "Новое сообщение",
                body: "Тестовое содержимое",
                orderId: 101,
                orderType: "express",
                messageId: 500,

                data: {
                    senderId: 12,
                },

                socketEvent: "customMessageEvent",

                socketPayload: {
                    orderId: 101,
                },
            });

            await Promise.resolve();
        } finally {
            console.error = oldError;
        }

        assert.equal(result.id, 1);
        assert.equal(saved.length, 1);
        assert.equal(saved[0].isRead, false);
        assert.equal(saved[0].orderType, "express");

        assert.deepEqual(
            socketEvents.map((event) => event.event),
            [
                "new_notification",
                "customMessageEvent",
            ]
        );

        assert.ok(
            socketEvents.every(
                (event) => event.userId === 42
            )
        );

        assert.equal(pushCalls.length, 1);
        assert.equal(
            pushCalls[0].data.notificationId,
            "1"
        );

        assert.equal(
            pushCalls[0].data.senderId,
            "12"
        );

        assert.equal(alerts.length, 1);
        assert.equal(alerts[0].module, "push");
    }
);

test(
    "notifyMany deduplicates recipients and isolates a failed recipient",
    async () => {
        const savedUsers = [];

        const service = loadIsolatedService(
            "notificationService.js",
            {
                "../models": {
                    Notification: {
                        async create(data) {
                            if (data.userId === 77) {
                                throw new Error(
                                    "ISOLATED_NOTIFICATION_FAILURE"
                                );
                            }

                            savedUsers.push(data.userId);

                            return {
                                id: savedUsers.length,
                                createdAt: new Date(),
                                ...data,
                            };
                        },
                    },
                },

                "./pushService": {
                    async sendPushToUser() {
                        return null;
                    },
                },

                "../socket": {
                    sendToUser() {},
                },

                "./adminNotificationService": {
                    notifySystemError() {},
                },
            }
        );

        const oldError = console.error;
        console.error = () => {};

        let results;

        try {
            results = await service.notifyMany(
                [42, 42, 77, 0, -1],
                {
                    type: "order_updated",
                    title: "Заказ обновлён",
                    body: "Проверка доставки",
                    orderId: 101,
                }
            );
        } finally {
            console.error = oldError;
        }

        assert.deepEqual(savedUsers, [42]);

        assert.deepEqual(
            results.map((item) => item.status),
            ["fulfilled", "rejected"]
        );
    }
);
