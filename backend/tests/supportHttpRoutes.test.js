const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const express = require("express");
const { Op } = require("sequelize");

const UUID1 = "123e4567-e89b-42d3-a456-426614174000";
const UUID2 = "123e4567-e89b-42d3-a456-426614174001";

// Загружаем настоящий Express-router,
// но заменяем все его зависимости.
function loadRouter(filename, dependencies) {
    const filenameFull = path.join(
        __dirname, "../routes", filename
    );

    const module = { exports: {} };

    const localRequire = (name) => {
        if (!Object.hasOwn(dependencies, name)) {
            throw new Error(
                `Запрещён незамокированный импорт: ${name}`
            );
        }

        return dependencies[name];
    };

    new Function(
        "require", "module", "exports",
        fs.readFileSync(filenameFull, "utf8")
    )(localRequire, module, module.exports);

    return module.exports;
}

async function createTestServer() {
    const messages = [];
    const notifications = [];
    const events = [];
    const actions = [];

    let telegramNotifications = 0;
    let nextId = 1;

    const users = {
        101: { id: 101, username: "Тестовый пользователь 1" },
        202: { id: 202, username: "Тестовый пользователь 2" },
    };

    // Искусственные тестовые сессии.
    const sessions = {
        "user-101": { id: 101, role: "customer" },
        "user-202": { id: 202, role: "customer" },
        "admin-1": { id: 1, role: "admin" },
    };

    const authenticate = (req, res, next) => {
        const token = req.headers.authorization?.replace(
            /^Bearer /, ""
        );

        const user = sessions[token];

        if (!user) {
            return res.status(401).json({
                message: "Нет доступа",
            });
        }

        req.user = user;
        next();
    };

    const adminOnly = (req, res, next) => {
        if (req.user.role !== "admin") {
            return res.status(403).json({
                message: "Доступ запрещен",
            });
        }

        next();
    };

    const SupportMessage = {
        async findAll({ where } = {}) {
            if (!where?.userId) {
                return [];
            }

            return messages.filter(
                (m) => Number(m.userId) === Number(where.userId)
            );
        },

        async update(values, { where }) {
            let updated = 0;

            for (const message of messages) {
                if (
                    Number(message.userId) !== Number(where.userId) ||
                    message.senderRole !== where.senderRole
                ) {
                    continue;
                }

                if (
                    where.id?.[Op.lte] != null &&
                    message.id > where.id[Op.lte]
                ) {
                    continue;
                }

                if (
                    where.isReadByUser !== undefined &&
                    message.isReadByUser !== where.isReadByUser
                ) {
                    continue;
                }

                if (
                    where.isReadByAdmin !== undefined &&
                    message.isReadByAdmin !== where.isReadByAdmin
                ) {
                    continue;
                }

                Object.assign(message, values);
                updated++;
            }

            return [updated];
        },
    };

    const models = {
        SupportMessage,

        User: {
            async findByPk(id) {
                return users[Number(id)] || null;
            },
        },

        Notification: {
            async create(data) {
                notifications.push(data);
                return data;
            },

            async update() {
                return [0];
            },
        },

        ActionLog: {
            async create(data) {
                actions.push(data);
                return data;
            },
        },

        sequelize: {
            fn: () => null,
            col: () => null,
            literal: () => null,
        },
    };

    // Здесь имитируем сохранение сообщения.
    // Настоящая идемпотентность сервиса
    // уже проверяется отдельным набором тестов.
    const createSupportMessage = async ({
                                            userId,
                                            senderId,
                                            senderRole,
                                            text,
                                            rawClientMessageId,
                                        }) => {
        const cleanText = String(text || "").trim();
        const uuid = rawClientMessageId?.toLowerCase() || null;

        if (!cleanText) {
            const error = new Error("Пустое сообщение");
            error.status = 400;
            throw error;
        }

        const existing = uuid
            ? messages.find(
                (m) =>
                    m.senderId === senderId &&
                    m.clientMessageId === uuid
            )
            : null;

        if (existing) {
            if (
                Number(existing.userId) !== Number(userId) ||
                existing.senderRole !== senderRole ||
                existing.text !== cleanText
            ) {
                const error = new Error(
                    "UUID уже использован"
                );
                error.status = 409;
                throw error;
            }

            return {
                created: false,
                message: existing,
            };
        }

        const message = {
            id: nextId++,
            userId: Number(userId),
            senderId,
            senderRole,
            text: cleanText,
            clientMessageId: uuid,
            isReadByUser: senderRole === "user",
            isReadByAdmin: senderRole === "admin",
        };

        messages.push(message);

        return {
            created: true,
            message,
        };
    };

    const app = express();
    app.use(express.json());

    app.locals.io = {
        to(room) {
            return {
                emit(event, payload) {
                    events.push({ room, event, payload });
                },
            };
        },
    };

    app.use(
        "/api/support",
        loadRouter("support.js", {
            express,
            sequelize: { Op },
            "../middlewares/userAuth": authenticate,
            "../models": models,
            "../services/supportMessageIdempotency": {
                createSupportMessage,
            },
            "../services/adminNotificationService": {
                sendAdminNotification: async () => {
                    telegramNotifications++;
                },
            },
        })
    );

    app.use(
        "/api/admin/support",
        loadRouter("adminSupport.js", {
            express,
            sequelize: { Op },
            "../middlewares/adminAuth": {
                authMiddleware: authenticate,
                adminMiddleware: adminOnly,
            },
            "../models": models,
            "../services/supportMessageIdempotency": {
                createSupportMessage,
            },

            "../services/notificationService": {
                async notifyUser(payload) {
                    notifications.push({
                        ...payload,
                        messageId: payload.messageId ?? null,
                    });

                    events.push({
                        room: `user_${payload.userId}`,
                        event: "new_notification",
                        payload: {
                            id: notifications.length,
                            type: payload.type,
                        },
                    });
                },
            },
        })
    );

    // Порт выбирает ОС. Нет фиксированного
    // адреса production и нет подключения к БД.
    const server = await new Promise((resolve) => {
        const instance = app.listen(
            0, "127.0.0.1",
            () => resolve(instance)
        );
    });

    const baseUrl =
        `http://127.0.0.1:${server.address().port}`;

    async function request(method, endpoint, token, body) {
        const response = await fetch(baseUrl + endpoint, {
            method,
            headers: {
                "Content-Type": "application/json",
                "Connection": "close",
                ...(token
                    ? { Authorization: `Bearer ${token}` }
                    : {}),
            },
            ...(body !== undefined
                ? { body: JSON.stringify(body) }
                : {}),
        });

        return {
            status: response.status,
            body: await response.json(),
        };
    }

    return {
        request,
        messages,
        notifications,
        events,
        actions,

        get telegramNotifications() {
            return telegramNotifications;
        },

        async close() {
            await new Promise((resolve, reject) => {
                server.close((error) =>
                    error ? reject(error) : resolve()
                );
                server.closeAllConnections?.();
            });
        },
    };
}

test("HTTP API поддержки: безопасность и повторы", async (t) => {
    const api = await createTestServer();

    try {
        await t.test("неавторизованный доступ запрещён", async () => {
            const user = await api.request(
                "GET", "/api/support/messages"
            );

            const admin = await api.request(
                "GET", "/api/admin/support/chats"
            );

            assert.equal(user.status, 401);
            assert.equal(admin.status, 401);
        });

        await t.test("обычный пользователь не является администратором", async () => {
            const result = await api.request(
                "GET",
                "/api/admin/support/chats",
                "user-101"
            );

            assert.equal(result.status, 403);
        });

        await t.test("пользователь видит только свою переписку", async () => {
            const sent = await api.request(
                "POST",
                "/api/support/messages",
                "user-101",
                {
                    text: "Помогите с заказом",
                    clientMessageId: UUID1,

                    // Попытка подменить отправителя.
                    userId: 202,
                    senderId: 202,
                    senderRole: "admin",
                }
            );

            assert.equal(sent.status, 201);
            assert.equal(sent.body.senderId, 101);
            assert.equal(sent.body.userId, 101);
            assert.equal(sent.body.senderRole, "user");

            const mine = await api.request(
                "GET", "/api/support/messages", "user-101"
            );

            const foreign = await api.request(
                "GET", "/api/support/messages", "user-202"
            );

            assert.equal(mine.body.length, 1);
            assert.equal(foreign.body.length, 0);
        });

        await t.test("повтор UUID не создаёт уведомления повторно", async () => {
            const eventsBefore = api.events.length;
            const logsBefore = api.actions.length;
            const telegramBefore = api.telegramNotifications;

            const repeated = await api.request(
                "POST",
                "/api/support/messages",
                "user-101",
                {
                    text: "Помогите с заказом",
                    clientMessageId: UUID1,
                }
            );

            assert.equal(repeated.status, 200);
            assert.equal(api.messages.length, 1);
            assert.equal(api.events.length, eventsBefore);
            assert.equal(api.actions.length, logsBefore);
            assert.equal(
                api.telegramNotifications,
                telegramBefore
            );
        });

        await t.test("другой текст со старым UUID запрещён", async () => {
            const response = await api.request(
                "POST",
                "/api/support/messages",
                "user-101",
                {
                    text: "Совершенно другой вопрос",
                    clientMessageId: UUID1,
                }
            );

            assert.equal(response.status, 409);
            assert.equal(api.messages.length, 1);
        });

        await t.test("администратор отвечает только с ролью admin", async () => {
            const forbidden = await api.request(
                "POST",
                "/api/admin/support/chats/101/messages",
                "user-202",
                {
                    text: "Чужой ответ",
                }
            );

            assert.equal(forbidden.status, 403);

            const sent = await api.request(
                "POST",
                "/api/admin/support/chats/101/messages",
                "admin-1",
                {
                    text: "Мы проверяем ваш заказ",
                    clientMessageId: UUID2,
                }
            );

            assert.equal(sent.status, 201);
            assert.equal(sent.body.senderRole, "admin");
            assert.equal(sent.body.senderId, 1);

            const supportNotification =
                api.notifications.find(
                    (notification) =>
                        notification.type === "support_reply"
                );

            assert.ok(supportNotification);

            assert.equal(
                supportNotification.messageId,
                null
            );

            assert.equal(
                supportNotification.data.supportMessageId,
                sent.body.id
            );

            const replyEvents =
                api.events.filter(
                    (event) =>
                        event.event === "support:reply"
                );

            assert.equal(replyEvents.length, 1);

            assert.equal(
                replyEvents[0].room,
                "user_101"
            );

            const notificationsBefore =
                api.notifications.length;
            const eventsBefore = api.events.length;

            const repeated = await api.request(
                "POST",
                "/api/admin/support/chats/101/messages",
                "admin-1",
                {
                    text: "Мы проверяем ваш заказ",
                    clientMessageId: UUID2,
                }
            );

            assert.equal(repeated.status, 200);
            assert.equal(
                api.notifications.length,
                notificationsBefore
            );
            assert.equal(api.events.length, eventsBefore);
        });

        await t.test("прочтение ограничено своим диалогом", async () => {
            const adminMessage = api.messages.find(
                (message) => message.senderRole === "admin"
            );

            const foreignRead = await api.request(
                "PATCH",
                "/api/support/read",
                "user-202",
                {
                    throughId: adminMessage.id,
                }
            );

            assert.equal(foreignRead.status, 200);
            assert.equal(foreignRead.body.updated, 0);

            const ownRead = await api.request(
                "PATCH",
                "/api/support/read",
                "user-101",
                {
                    throughId: adminMessage.id,
                }
            );

            assert.equal(ownRead.status, 200);
            assert.equal(ownRead.body.updated, 1);
            assert.equal(adminMessage.isReadByUser, true);

            const invalid = await api.request(
                "PATCH",
                "/api/support/read",
                "user-101",
                {
                    throughId: -1,
                }
            );

            assert.equal(invalid.status, 400);
        });
    } finally {
        await api.close();
    }
});