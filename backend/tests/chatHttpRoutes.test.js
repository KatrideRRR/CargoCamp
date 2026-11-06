const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const express = require("express");
const { Op } = require("sequelize");

const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

const uuid = (n) =>
    `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

/*
 * Проверяем условия Sequelize WHERE
 * на вымышленных записях.
 */
function matches(row, where = {}) {
    return Reflect.ownKeys(where).every((key) => {
        const expected = where[key];

        if (key === Op.or) {
            return expected.some((part) => matches(row, part));
        }

        const actual = row[key];

        if (
            expected &&
            typeof expected === "object" &&
            !(expected instanceof Date)
        ) {
            return Reflect.ownKeys(expected).every((operation) => {
                const value = expected[operation];

                if (operation === Op.gt) {
                    return actual > value;
                }

                if (operation === Op.lte) {
                    return actual <= value;
                }

                if (operation === Op.ne) {
                    return actual !== value;
                }

                if (operation === Op.is) {
                    return actual === value;
                }

                throw new Error(
                    `Неподдерживаемое условие: ${String(operation)}`
                );
            });
        }

        return actual === expected;
    });
}

/*
 * Загружаем настоящий Express-router,
 * запрещая обращения к непредусмотренным модулям.
 */
function loadRouter(filename, dependencies) {
    const fullPath = path.resolve(
        __dirname,
        "../routes",
        filename
    );

    const source = fs.readFileSync(fullPath, "utf8");

    const isolatedModule = {
        exports: {},
    };

    const isolatedRequire = (name) => {
        if (!Object.hasOwn(dependencies, name)) {
            throw new Error(
                `Незапланированный импорт: ${name}`
            );
        }

        return dependencies[name];
    };

    new Function(
        "require",
        "module",
        "exports",
        "__filename",
        "__dirname",
        source
    )(
        isolatedRequire,
        isolatedModule,
        isolatedModule.exports,
        fullPath,
        path.dirname(fullPath)
    );

    return isolatedModule.exports;
}

async function createChatServer() {
    const rows = [];
    const notifications = [];
    const events = [];
    const actionLogs = [];

    let nextId = 1;

    /*
     * Все заказы вымышленные.
     *
     * regular/11: заказчик 101, исполнитель 202
     * regular/22: заказчик 303, исполнитель 404
     * regular/33: исполнитель ещё не назначен
     * express/11: заказчик 101, исполнитель 303
     */
    const regularOrders = {
        11: {
            id: 11,
            creatorId: 101,
            executorId: 202,
        },

        22: {
            id: 22,
            creatorId: 303,
            executorId: 404,
        },

        33: {
            id: 33,
            creatorId: 101,
            executorId: null,
        },
    };

    const expressOrders = {
        11: {
            id: 11,
            creatorId: 101,
            executorId: 303,
        },
    };

    const Order = {
        async findByPk(id) {
            return regularOrders[id] || null;
        },
    };

    const ExpressOrder = {
        async findByPk(id) {
            return expressOrders[id] || null;
        },
    };

    const Message = {
        async findOne({ where }) {
            return rows
                .filter((row) => matches(row, where))
                .sort((a, b) => b.id - a.id)[0] || null;
        },

        async findAll({ where, limit } = {}) {
            const found = rows
                .filter((row) => matches(row, where))
                .sort((a, b) => a.id - b.id);

            return limit == null
                ? found
                : found.slice(0, limit);
        },

        async findByPk(id) {
            return rows.find(
                (row) => row.id === Number(id)
            ) || null;
        },

        async create(data) {
            if (
                data.clientMessageId &&
                rows.some(
                    (row) =>
                        row.senderId === data.senderId &&
                        row.clientMessageId === data.clientMessageId
                )
            ) {
                const error = new Error("Duplicate entry");
                error.name = "SequelizeUniqueConstraintError";
                throw error;
            }

            const row = {
                id: nextId++,
                ...data,
                readAt: null,
                createdAt: new Date().toISOString(),
            };

            rows.push(row);

            return row;
        },

        async update(values, { where }) {
            let updated = 0;

            for (const row of rows) {
                if (matches(row, where)) {
                    Object.assign(row, values);
                    updated++;
                }
            }

            return [updated];
        },
    };

    const Notification = {
        async findOne({ where }) {
            return notifications.find(
                (notification) => matches(notification, where)
            ) || null;
        },

        async update(values, { where }) {
            let updated = 0;

            for (const notification of notifications) {
                if (matches(notification, where)) {
                    Object.assign(notification, values);
                    updated++;
                }
            }

            return [updated];
        },
    };

    const models = {
        Order,
        ExpressOrder,
        Message,
        Notification,
        User: {},
    };

    const socketMock = {
        sendToUser(userId, event, payload) {
            events.push({
                userId,
                event,
                payload,
            });
        },

        async sendNotifications() {},
    };

    // Загружаем реальные backend-сервисы.
    const accessService = loadIsolatedService(
        "chatOrderAccess.js",
        {
            "../models": models,
        }
    );

    const replyService = loadIsolatedService(
        "chatReplyService.js",
        {
            sequelize: { Op },
            "../models": models,
            "./chatOrderAccess": accessService,
        }
    );

    const idempotencyService = loadIsolatedService(
        "chatMessageIdempotency.js",
        {
            "../models": models,
            "./chatOrderAccess": accessService,
            "./chatReplyService": replyService,
        }
    );

    const readService = loadIsolatedService(
        "chatReadReceipts.js",
        {
            sequelize: { Op },
            "../models": models,
            "./chatOrderAccess": accessService,
            "../socket": socketMock,
        }
    );

    /*
     * Тестовая авторизация.
     * Настоящие JWT здесь не используются.
     */
    const authenticate = (req, res, next) => {
        const token = req.headers.authorization
            ?.replace(/^Bearer /, "");

        const id = Number(
            /^user-(\d+)$/.exec(token || "")?.[1]
        );

        if (![101, 202, 303, 404, 999].includes(id)) {
            return res.status(401).json({
                message: "Нет доступа",
            });
        }

        req.user = { id };

        next();
    };

    const app = express();

    app.use(express.json());

    app.use((req, res, next) => {
        req.logAction = async (entry) => {
            actionLogs.push(entry);
        };

        next();
    });

    const router = loadRouter("messages.js", {
        express,
        sequelize: { Op },
        "../models": models,
        "../middlewares/userAuth": authenticate,

        "../socket": socketMock,

        "../services/chatReadReceipts": readService,

        "../services/notificationService": {
            async notifyUser(notification) {
                notifications.push({
                    ...notification,
                    isRead: false,
                });
            },
        },

        "../services/chatOrderAccess": accessService,

        "../services/chatMessageIdempotency":
        idempotencyService,

        "../services/chatReplyService": replyService,
    });

    app.use("/api/messages", router);

    /*
     * Только 127.0.0.1.
     * Порт выделяется автоматически.
     */
    const server = await new Promise((resolve) => {
        const instance = app.listen(
            0,
            "127.0.0.1",
            () => resolve(instance)
        );
    });

    const baseURL =
        `http://127.0.0.1:${server.address().port}`;

    async function request(
        method,
        endpoint,
        userId,
        body
    ) {
        const response = await fetch(
            baseURL + endpoint,
            {
                method,

                headers: {
                    "Content-Type": "application/json",

                    ...(userId
                        ? {
                            Authorization:
                                `Bearer user-${userId}`,
                        }
                        : {}),
                },

                ...(body !== undefined
                    ? {
                        body: JSON.stringify(body),
                    }
                    : {}),
            }
        );

        return {
            status: response.status,
            body: await response.json(),
        };
    }

    return {
        request,
        rows,
        notifications,
        events,
        actionLogs,

        async close() {
            await new Promise((resolve, reject) => {
                server.close((error) => {
                    if (error) reject(error);
                    else resolve();
                });

                server.closeAllConnections?.();
            });
        },
    };
}

async function withServer(callback) {
    const api = await createChatServer();

    try {
        await callback(api);
    } finally {
        await api.close();
    }
}

function send(
    api,
    userId,
    {
        orderId = 11,
        orderType = "regular",
        content = "Тестовое сообщение",
        clientMessageId,
        ...extra
    } = {}
) {
    return api.request(
        "POST",
        "/api/messages",
        userId,
        {
            orderId,
            orderType,
            content,
            clientMessageId,
            ...extra,
        }
    );
}

/*
 * ТЕСТ 1
 */
test("HTTP chat: запрещает доступ без авторизации и посторонним", async () => {
    await withServer(async (api) => {
        const unauthorized = await api.request(
            "GET",
            "/api/messages/regular/11"
        );

        assert.equal(unauthorized.status, 401);

        const stranger = await api.request(
            "GET",
            "/api/messages/regular/11",
            999
        );

        assert.equal(stranger.status, 404);

        const unknown = await api.request(
            "GET",
            "/api/messages/regular/999",
            101
        );

        assert.equal(unknown.status, 404);
    });
});

/*
 * ТЕСТ 2
 */
test("HTTP chat: изолирует regular и express переписки", async () => {
    await withServer(async (api) => {
        const regular = await send(api, 101, {
            clientMessageId: uuid(1),
            content: "Обычный заказ",
        });

        const express = await send(api, 101, {
            orderType: "express",
            clientMessageId: uuid(2),
            content: "Экспресс-заказ",
        });

        assert.equal(regular.status, 201);
        assert.equal(express.status, 201);

        const regularHistory = await api.request(
            "GET",
            "/api/messages/regular/11",
            101
        );

        const expressHistory = await api.request(
            "GET",
            "/api/messages/express/11",
            101
        );

        assert.deepEqual(
            regularHistory.body.map((m) => m.content),
            ["Обычный заказ"]
        );

        assert.deepEqual(
            expressHistory.body.map((m) => m.content),
            ["Экспресс-заказ"]
        );

        // Старый маршрут по умолчанию regular.
        const legacyHistory = await api.request(
            "GET",
            "/api/messages/11",
            101
        );

        assert.equal(legacyHistory.body.length, 1);

        // Исполнитель regular не участвует в express.
        const wrongExpress = await api.request(
            "GET",
            "/api/messages/express/11",
            202
        );

        assert.equal(wrongExpress.status, 404);

        // Исполнитель express не участвует в regular.
        const wrongRegular = await api.request(
            "GET",
            "/api/messages/regular/11",
            303
        );

        assert.equal(wrongRegular.status, 404);
    });
});

/*
 * ТЕСТ 3
 */
test("HTTP chat: запрещает подмену получателя и чужую отправку", async () => {
    await withServer(async (api) => {
        const wrongReceiver = await send(api, 101, {
            clientMessageId: uuid(3),
            receiverId: 303,
        });

        assert.equal(wrongReceiver.status, 403);
        assert.equal(api.rows.length, 0);

        const stranger = await send(api, 999, {
            clientMessageId: uuid(4),
        });

        assert.equal(stranger.status, 404);

        const unassigned = await send(api, 101, {
            orderId: 33,
            clientMessageId: uuid(5),
        });

        assert.equal(unassigned.status, 409);

        const valid = await send(api, 101, {
            receiverId: 202,
            clientMessageId: uuid(6),
        });

        assert.equal(valid.status, 201);
        assert.equal(valid.body.senderId, 101);
        assert.equal(valid.body.receiverId, 202);

        assert.equal(api.rows.length, 1);
    });
});

/*
 * ТЕСТ 4
 */
test("HTTP chat: повтор UUID не создаёт сообщение и уведомление повторно", async () => {
    await withServer(async (api) => {
        const first = await send(api, 101, {
            clientMessageId: uuid(7),
            content: "  Привет  ",
        });

        assert.equal(first.status, 201);

        const notificationCount =
            api.notifications.length;

        const eventCount = api.events.length;
        const actionCount = api.actionLogs.length;

        const repeated = await send(api, 101, {
            clientMessageId: uuid(7),
            content: "Привет",
        });

        assert.equal(repeated.status, 200);
        assert.equal(repeated.body.id, first.body.id);

        assert.equal(api.rows.length, 1);
        assert.equal(
            api.notifications.length,
            notificationCount
        );
        assert.equal(api.events.length, eventCount);
        assert.equal(api.actionLogs.length, actionCount);

        const conflict = await send(api, 101, {
            clientMessageId: uuid(7),
            content: "Другой текст",
        });

        assert.equal(conflict.status, 409);

        const otherOrderType = await send(api, 101, {
            orderType: "express",
            clientMessageId: uuid(7),
            content: "Привет",
        });

        assert.equal(otherOrderType.status, 409);
        assert.equal(api.rows.length, 1);
    });
});

/*
 * ТЕСТ 5
 */
test("HTTP chat: разрешает правильную цитату и запрещает чужую", async () => {
    await withServer(async (api) => {
        const original = await send(api, 101, {
            clientMessageId: uuid(8),
            content: "Первое сообщение",
        });

        assert.equal(original.status, 201);

        const reply = await send(api, 202, {
            clientMessageId: uuid(9),
            content: "Ответ на сообщение",
            replyToMessageId: original.body.id,
        });

        assert.equal(reply.status, 201);
        assert.equal(
            reply.body.replyToMessageId,
            original.body.id
        );

        const express = await send(api, 101, {
            orderType: "express",
            clientMessageId: uuid(10),
            content: "Сообщение другого заказа",
        });

        assert.equal(express.status, 201);

        const foreignReply = await send(api, 101, {
            clientMessageId: uuid(11),
            content: "Попытка чужой цитаты",
            replyToMessageId: express.body.id,
        });

        assert.equal(foreignReply.status, 404);

        const item = await api.request(
            "GET",
            `/api/messages/item/regular/11/${reply.body.id}`,
            101
        );

        assert.equal(item.status, 200);
        assert.equal(item.body.id, reply.body.id);

        const wrongItem = await api.request(
            "GET",
            `/api/messages/item/express/11/${reply.body.id}`,
            101
        );

        assert.equal(wrongItem.status, 404);
    });
});

/*
 * ТЕСТ 6
 */
test("HTTP chat: синхронизирует только сообщения нужного заказа", async () => {
    await withServer(async (api) => {
        const first = await send(api, 101, {
            clientMessageId: uuid(12),
            content: "Первое",
        });

        await send(api, 101, {
            orderType: "express",
            clientMessageId: uuid(13),
            content: "Экспресс",
        });

        const third = await send(api, 202, {
            clientMessageId: uuid(14),
            content: "Второе",
        });

        assert.equal(first.status, 201);
        assert.equal(third.status, 201);

        const result = await api.request(
            "GET",
            `/api/messages/sync/regular/11?afterId=${first.body.id}`,
            101
        );

        assert.equal(result.status, 200);

        assert.deepEqual(
            result.body.messages.map((m) => m.id),
            [third.body.id]
        );

        assert.equal(
            result.body.nextCursor,
            third.body.id
        );

        assert.equal(result.body.hasMore, false);

        const invalid = await api.request(
            "GET",
            "/api/messages/sync/regular/11?afterId=-1",
            101
        );

        assert.equal(invalid.status, 400);

        const outsider = await api.request(
            "GET",
            "/api/messages/sync/regular/11",
            999
        );

        assert.equal(outsider.status, 404);
    });
});

/*
 * ТЕСТ 7
 */
test("HTTP chat: прочтение доступно только получателю сообщения", async () => {
    await withServer(async (api) => {
        const first = await send(api, 101, {
            clientMessageId: uuid(15),
            content: "Первое сообщение",
        });

        const second = await send(api, 101, {
            clientMessageId: uuid(16),
            content: "Второе сообщение",
        });

        assert.equal(first.status, 201);
        assert.equal(second.status, 201);

        // Автор не может отметить собственное
        // исходящее сообщение прочитанным.
        const ownRead = await api.request(
            "POST",
            "/api/messages/read/regular/11",
            101,
            {
                throughId: first.body.id,
            }
        );

        assert.equal(ownRead.status, 404);

        // Посторонний не может читать чужой заказ.
        const outsider = await api.request(
            "POST",
            "/api/messages/read/regular/11",
            999,
            {
                throughId: first.body.id,
            }
        );

        assert.equal(outsider.status, 404);

        // Настоящий получатель читает первое сообщение.
        const eventCountBefore = api.events.length;

        const read = await api.request(
            "POST",
            "/api/messages/read/regular/11",
            202,
            {
                throughId: first.body.id,
            }
        );

        assert.equal(read.status, 200);

        assert.ok(
            api.rows.find(
                (m) => m.id === first.body.id
            ).readAt
        );

        assert.equal(
            api.rows.find(
                (m) => m.id === second.body.id
            ).readAt,
            null
        );

        const readEvents = api.events
            .slice(eventCountBefore)
            .filter((event) =>
                event.event === "chat:read"
            );

        assert.equal(readEvents.length, 1);
        assert.equal(readEvents[0].userId, 101);

        // Повтор прочтения не создаёт новое событие.
        await api.request(
            "POST",
            "/api/messages/read/regular/11",
            202,
            {
                throughId: first.body.id,
            }
        );

        assert.equal(
            api.events.filter(
                (event) => event.event === "chat:read"
            ).length,
            1
        );

        // HTTP восстанавливает состояние галочек.
        const state = await api.request(
            "GET",
            "/api/messages/read-state/regular/11",
            101
        );

        assert.equal(state.status, 200);
        assert.equal(
            state.body.lastReadMessageId,
            first.body.id
        );

        const invalid = await api.request(
            "POST",
            "/api/messages/read/regular/11",
            202,
            {
                throughId: -1,
            }
        );

        assert.equal(invalid.status, 400);
    });
});

/*
 * ТЕСТ 8
 */
test("HTTP chat: проверяет формат входных данных", async () => {
    await withServer(async (api) => {
        const invalidUUID = await send(api, 101, {
            clientMessageId: "not-a-uuid",
        });

        assert.equal(invalidUUID.status, 400);

        const empty = await send(api, 101, {
            content: "   ",
            clientMessageId: uuid(17),
        });

        assert.equal(empty.status, 400);

        const tooLong = await send(api, 101, {
            content: "А".repeat(10001),
            clientMessageId: uuid(18),
        });

        assert.equal(tooLong.status, 400);

        const badType = await send(api, 101, {
            orderType: "unknown",
            clientMessageId: uuid(19),
        });

        assert.equal(badType.status, 400);

        const invalidReply = await send(api, 101, {
            replyToMessageId: -1,
            clientMessageId: uuid(20),
        });

        assert.equal(invalidReply.status, 400);

        assert.equal(api.rows.length, 0);
    });
});