const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const jwt = require("jsonwebtoken");
const { Server } = require("socket.io");
const { io: connectSocket } = require("socket.io-client");

// Только для изолированных тестов.
const TEST_SECRET = "cargocamp-socket-tests-only-secret";

function loadModule(relativePath, dependencies) {
    const filename = path.resolve(
        __dirname,
        "..",
        relativePath
    );

    const module = { exports: {} };

    const localRequire = (name) => {
        if (!Object.hasOwn(dependencies, name)) {
            throw new Error(
                `Незапланированная зависимость: ${name}`
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
        fs.readFileSync(filename, "utf8")
    )(
        localRequire,
        module,
        module.exports,
        filename,
        path.dirname(filename)
    );

    return module.exports;
}

function makeSession(userId, scope) {
    const future = new Date(
        Date.now() + 60 * 60 * 1000
    ).toISOString();

    return {
        userId,
        scope,
        revokedAt: null,
        expiresAt: future,
        absoluteExpiresAt: future,
    };
}

async function createSocketHarness() {
    const users = new Map([
        [1, { id: 1, role: "admin" }],
        [101, { id: 101, role: "customer" }],
        [202, { id: 202, role: "executor" }],
        [303, { id: 303, role: "executor" }],
        [404, { id: 404, role: "customer" }],
        [505, { id: 505, role: "banned" }],
    ]);

    const sessions = new Map([
        ["s-admin", makeSession(1, "admin")],
        ["s-101", makeSession(101, "user")],
        ["s-202", makeSession(202, "user")],
        ["s-303", makeSession(303, "user")],
        ["s-404", makeSession(404, "user")],
        ["s-505", makeSession(505, "user")],
    ]);

    const orderLookupHooks = new Map();

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
    };

    const expressOrders = {
        11: {
            id: 11,
            creatorId: 101,
            executorId: 303,
        },
    };

    const notificationUpdates = [];

    const models = {
        User: {
            async findByPk(id) {
                return users.get(Number(id)) || null;
            },
        },

        AuthSession: {
            async findByPk(id) {
                return sessions.get(String(id)) || null;
            },
        },

        Order: {
            async findByPk(id) {
                const hook = orderLookupHooks.get(
                    Number(id)
                );

                if (hook) {
                    await hook();
                }

                return regularOrders[id] || null;
            },
        },

        ExpressOrder: {
            async findByPk(id) {
                return expressOrders[id] || null;
            },
        },

        Notification: {
            async findAll() {
                return [];
            },

            async update(values, options) {
                notificationUpdates.push({
                    values,
                    where: options.where,
                });

                return [1];
            },
        },
    };

    const accessService = loadModule(
        "services/chatOrderAccess.js",
        {
            "../models": models,
        }
    );

    // Настоящая JWT-проверка, но с тестовым ключом.
    const authService = loadModule(
        "middlewares/socketAuth.js",
        {
            jsonwebtoken: {
                verify(token, unusedSecret, options) {
                    return jwt.verify(
                        token,
                        TEST_SECRET,
                        options
                    );
                },
            },

            "../models": models,
        }
    );

    const typingService = loadModule(
        "services/chatTypingEvents.js",
        {
            "./chatOrderAccess": accessService,
        }
    );

    const socketModule = loadModule(
        "socket.js",
        {
            "socket.io": (server, options) =>
                new Server(server, options),

            "./models": models,

            "./config/allowedOrigins": [
                "http://localhost:3000",
            ],

            "./middlewares/socketAuth": authService,

            "./services/chatOrderAccess":
            accessService,

            "./services/chatTypingEvents":
            typingService,
        }
    );

    const httpServer = http.createServer(
        (req, res) => {
            res.writeHead(404);
            res.end();
        }
    );

    const io = socketModule.initializeSocket(
        httpServer
    );

    await new Promise((resolve, reject) => {
        httpServer.once("error", reject);

        httpServer.listen(
            0,
            "127.0.0.1",
            resolve
        );
    });

    const address =
        `http://127.0.0.1:${httpServer.address().port}`;

    const clients = [];

    function token(userId, sid, scope, expiresIn = "10m") {
        return jwt.sign(
            {
                id: userId,
                sid,
                scope,
            },
            TEST_SECRET,
            {
                algorithm: "HS256",
                expiresIn,
            }
        );
    }

    async function connect(tokenValue) {
        const client = connectSocket(address, {
            autoConnect: false,
            forceNew: true,
            reconnection: false,
            transports: ["websocket"],
            timeout: 3000,
            auth: {
                token: tokenValue,
            },
        });

        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                client.disconnect();

                reject(
                    new Error("Socket connection timeout")
                );
            }, 4000);

            client.once("connect", () => {
                clearTimeout(timer);
                resolve();
            });

            client.once("connect_error", (error) => {
                clearTimeout(timer);
                client.disconnect();
                reject(error);
            });

            client.connect();
        });

        clients.push(client);

        return client;
    }

    function serverSocket(client) {
        return io.sockets.sockets.get(client.id);
    }

    function inRoom(client, room) {
        return Boolean(
            serverSocket(client)?.rooms.has(room)
        );
    }

    async function joinChat(client, payload) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(
                    new Error("joinChat acknowledgement timeout")
                );
            }, 3000);

            client.emit("joinChat", payload, (result) => {
                clearTimeout(timer);
                resolve(result);
            });
        });
    }

    async function waitUntil(predicate) {
        const deadline = Date.now() + 3000;

        while (Date.now() < deadline) {
            if (predicate()) {
                return;
            }

            await new Promise((resolve) =>
                setTimeout(resolve, 10)
            );
        }

        assert.fail("Ожидаемое Socket.IO-событие не получено");
    }

    async function close() {
        for (const client of clients) {
            client.disconnect();
        }

        await new Promise((resolve) => {
            io.close(resolve);
        });
    }

    return {
        io,
        connect,
        token,
        sessions,
        authService,
        notificationUpdates,
        serverSocket,
        inRoom,
        joinChat,
        waitUntil,
        close,
        orderLookupHooks,
    };
}

async function withHarness(callback) {
    const harness = await createSocketHarness();

    try {
        await callback(harness);
    } finally {
        await harness.close();
    }
}

// 1. Авторизация.
test("Socket.IO: отклоняет недействительные сессии", async () => {
    await withHarness(async (h) => {
        const unauthorized = (error) =>
            error.message === "SOCKET_UNAUTHORIZED";

        await assert.rejects(
            () => h.connect(),
            unauthorized
        );

        await assert.rejects(
            () => h.connect("invalid-token"),
            unauthorized
        );

        await assert.rejects(
            () => h.connect(
                h.token(101, "s-101", "user", -10)
            ),
            unauthorized
        );

        // Нельзя выдать пользовательскую сессию
        // за административную.
        await assert.rejects(
            () => h.connect(
                h.token(101, "s-101", "admin")
            ),
            unauthorized
        );

        // Заблокированный пользователь.
        await assert.rejects(
            () => h.connect(
                h.token(505, "s-505", "user")
            ),
            unauthorized
        );

        // Отозванная сессия.
        h.sessions.get("s-202").revokedAt = new Date();

        await assert.rejects(
            () => h.connect(
                h.token(202, "s-202", "user")
            ),
            unauthorized
        );
    });
});

// 2. Личные комнаты.
test("Socket.IO: не разрешает подписаться на чужие комнаты", async () => {
    await withHarness(async (h) => {
        const user = await h.connect(
            h.token(101, "s-101", "user")
        );

        assert.equal(
            h.inRoom(user, "user_101"),
            true
        );

        assert.equal(
            h.inRoom(user, "notifications_101"),
            true
        );

        // Попытки выдать себя за пользователя 202.
        user.emit("register", 202);

        user.emit(
            "subscribeToNotifications",
            202
        );

        user.emit(
            "subscribeSupportChat",
            { userId: 202 }
        );

        user.emit("subscribeAdminSupport");

        // Ожидаем обработки предыдущих событий.
        const joined = await h.joinChat(user, {
            orderId: 11,
            orderType: "regular",
        });

        assert.equal(joined.ok, true);

        assert.equal(
            h.inRoom(user, "user_202"),
            false
        );

        assert.equal(
            h.inRoom(user, "notifications_202"),
            false
        );

        assert.equal(
            h.inRoom(user, "support_user_202"),
            false
        );

        assert.equal(
            h.inRoom(user, "support_user_101"),
            true
        );

        assert.equal(
            h.inRoom(user, "admins"),
            false
        );

        user.emit("unsubscribeSupportChat");

        await h.joinChat(user, {
            orderId: 999,
            orderType: "regular",
        });

        assert.equal(
            h.inRoom(user, "support_user_101"),
            false
        );
    });
});

// 3. Административная поддержка.
test("Socket.IO: отделяет административные комнаты от пользовательских", async () => {
    await withHarness(async (h) => {
        const admin = await h.connect(
            h.token(1, "s-admin", "admin")
        );

        const user = await h.connect(
            h.token(101, "s-101", "user")
        );

        admin.emit("subscribeAdminSupport");

        // Администратор не должен получать
        // пользовательские комнаты автоматически.
        admin.emit("register", 101);
        admin.emit("subscribeToNotifications", 101);
        admin.emit("subscribeSupportChat", 101);

        const adminJoin = await h.joinChat(admin, {
            orderId: 11,
            orderType: "regular",
        });

        assert.equal(adminJoin.ok, false);

        assert.equal(
            h.inRoom(admin, "admins"),
            true
        );

        assert.equal(
            h.inRoom(admin, "user_101"),
            false
        );

        assert.equal(
            h.inRoom(admin, "support_user_101"),
            false
        );

        assert.equal(
            h.inRoom(admin, "notifications_101"),
            false
        );

        user.emit("subscribeAdminSupport");

        await h.joinChat(user, {
            orderId: 11,
            orderType: "regular",
        });

        assert.equal(
            h.inRoom(user, "admins"),
            false
        );
    });
});

// 4. Комнаты обычных и экспресс-заказов.
test("Socket.IO: проверяет участие и переключение между чатами", async () => {
    await withHarness(async (h) => {
        const user = await h.connect(
            h.token(101, "s-101", "user")
        );

        const regular = await h.joinChat(user, {
            orderId: 11,
            orderType: "regular",
            userId: 999,
        });

        assert.equal(regular.ok, true);

        assert.equal(
            h.inRoom(user, "chat_regular_11"),
            true
        );

        const express = await h.joinChat(user, {
            orderId: 11,
            orderType: "express",
        });

        assert.equal(express.ok, true);

        // При переключении прежняя комната
        // должна освобождаться.
        assert.equal(
            h.inRoom(user, "chat_regular_11"),
            false
        );

        assert.equal(
            h.inRoom(user, "chat_express_11"),
            true
        );

        const foreign = await h.joinChat(user, {
            orderId: 22,
            orderType: "regular",
        });

        assert.equal(foreign.ok, false);

        assert.equal(
            h.inRoom(user, "chat_regular_22"),
            false
        );

        const invalid = await h.joinChat(user, {
            orderId: -1,
            orderType: "regular",
        });

        assert.equal(invalid.ok, false);

        user.emit("leaveChat");

        // Ожидаем обработки leaveChat.
        await h.joinChat(user, {
            orderId: 22,
            orderType: "regular",
        });

        assert.equal(
            h.inRoom(user, "chat_express_11"),
            false
        );

        assert.equal(
            h.serverSocket(user).data.activeChatRoom,
            null
        );
    });
});

// 5. Доставка личных уведомлений.
test("Socket.IO: доставляет личные события только получателю", async () => {
    await withHarness(async (h) => {
        const first = await h.connect(
            h.token(101, "s-101", "user")
        );

        const second = await h.connect(
            h.token(202, "s-202", "user")
        );

        const receivedFirst = [];
        const receivedSecond = [];

        first.on("test:private", (data) => {
            receivedFirst.push(data);
        });

        second.on("test:private", (data) => {
            receivedSecond.push(data);
        });

        h.io.to("notifications_101").emit(
            "test:private",
            {
                value: "Только для пользователя 101",
            }
        );

        await h.waitUntil(
            () => receivedFirst.length === 1
        );

        assert.equal(
            receivedFirst[0].value,
            "Только для пользователя 101"
        );

        assert.equal(
            receivedSecond.length,
            0
        );
    });
});

// 6. Индикатор набора текста.
test("Socket.IO: отправляет typing только участнику заказа", async () => {
    await withHarness(async (h) => {
        const sender = await h.connect(
            h.token(101, "s-101", "user")
        );

        const receiver = await h.connect(
            h.token(202, "s-202", "user")
        );

        const outsider = await h.connect(
            h.token(303, "s-303", "user")
        );

        const receiverEvents = [];
        const outsiderEvents = [];

        receiver.on("chat:typing", (data) => {
            receiverEvents.push(data);
        });

        outsider.on("chat:typing", (data) => {
            outsiderEvents.push(data);
        });

        const joined = await h.joinChat(sender, {
            orderId: 11,
            orderType: "regular",
        });

        assert.equal(joined.ok, true);

        // Клиент пытается подменить отправителя
        // и получателя события.
        sender.emit("chat:typing", {
            orderId: 11,
            orderType: "regular",
            senderId: 999,
            receiverId: 303,
            isTyping: true,
        });

        await h.waitUntil(
            () => receiverEvents.length === 1
        );

        assert.equal(
            receiverEvents[0].senderId,
            101
        );

        assert.equal(
            receiverEvents[0].isTyping,
            true
        );

        assert.equal(
            outsiderEvents.length,
            0
        );

        // Выход из чата завершает typing.
        sender.emit("leaveChat");

        await h.waitUntil(
            () => receiverEvents.length === 2
        );

        assert.equal(
            receiverEvents[1].isTyping,
            false
        );

        assert.equal(
            h.inRoom(sender, "chat_regular_11"),
            false
        );
    });
});

// 7. Прочтение уведомлений.
test("Socket.IO: markAsRead не изменяет чужие уведомления", async () => {
    await withHarness(async (h) => {
        const user = await h.connect(
            h.token(101, "s-101", "user")
        );

        const admin = await h.connect(
            h.token(1, "s-admin", "admin")
        );

        // Пользователь пытается подменить userId.
        user.emit("markAsRead", {
            orderId: 11,
            orderType: "regular",
            userId: 202,
        });

        await h.waitUntil(
            () => h.notificationUpdates.length === 1
        );

        assert.equal(
            h.notificationUpdates[0].where.userId,
            101
        );

        assert.equal(
            h.notificationUpdates[0].where.orderId,
            11
        );

        assert.equal(
            h.notificationUpdates[0].where.orderType,
            "regular"
        );

        assert.equal(
            h.notificationUpdates[0].where.type,
            "new_message"
        );

        // Чужой заказ.
        user.emit("markAsRead", {
            orderId: 22,
            orderType: "regular",
        });

        // Админ не может использовать пользовательский
        // обработчик markAsRead.
        admin.emit("markAsRead", {
            orderId: 11,
            orderType: "regular",
        });

        // Барьер обработки предыдущих пакетов.
        await h.joinChat(user, {
            orderId: 22,
            orderType: "regular",
        });

        await h.joinChat(admin, {
            orderId: 11,
            orderType: "regular",
        });

        assert.equal(
            h.notificationUpdates.length,
            1
        );
    });
});

// 8. Отзыв сессии.
test("Socket.IO: повторная проверка обнаруживает отозванную сессию", async () => {
    await withHarness(async (h) => {
        const user = await h.connect(
            h.token(101, "s-101", "user")
        );

        const socketData = {
            ...h.serverSocket(user).data,
        };

        assert.equal(
            await h.authService.validateSocketSession(
                socketData
            ),
            true
        );

        // Имитируем отзыв сессии администратором.
        h.sessions.get("s-101").revokedAt = new Date();

        assert.equal(
            await h.authService.validateSocketSession(
                socketData
            ),
            false
        );
    });
});

test(
    "Socket.IO: запоздавшая подписка не возвращает старый чат",
    async () => {
        await withHarness(async (h) => {
            const user = await h.connect(
                h.token(101, "s-101", "user")
            );

            let releaseLookup;
            let lookupStarted;

            const started = new Promise((resolve) => {
                lookupStarted = resolve;
            });

            const hold = new Promise((resolve) => {
                releaseLookup = resolve;
            });

            h.orderLookupHooks.set(
                11,
                async () => {
                    lookupStarted();
                    await hold;
                }
            );

            /*
             * Открываем обычный чат.
             * Проверка доступа пока не завершена.
             */
            const oldJoin = h.joinChat(user, {
                orderId: 11,
                orderType: "regular",
            });

            await started;

            /*
             * Пользователь переключился
             * на экспресс-чат.
             */
            const currentJoin = await h.joinChat(
                user,
                {
                    orderId: 11,
                    orderType: "express",
                }
            );

            assert.equal(currentJoin.ok, true);

            // Теперь MySQL завершила старую проверку.
            releaseLookup();

            const staleResult = await oldJoin;

            assert.equal(staleResult.ok, false);

            assert.equal(
                h.inRoom(user, "chat_express_11"),
                true
            );

            assert.equal(
                h.inRoom(user, "chat_regular_11"),
                false
            );
        });
    }
);

test(
    "Socket.IO: закрытый чат не открывается запоздавшим запросом",
    async () => {
        await withHarness(async (h) => {
            const user = await h.connect(
                h.token(101, "s-101", "user")
            );

            const initial = await h.joinChat(
                user,
                {
                    orderId: 11,
                    orderType: "express",
                }
            );

            assert.equal(initial.ok, true);

            let releaseLookup;
            let lookupStarted;

            const started = new Promise((resolve) => {
                lookupStarted = resolve;
            });

            const hold = new Promise((resolve) => {
                releaseLookup = resolve;
            });

            h.orderLookupHooks.set(
                11,
                async () => {
                    lookupStarted();
                    await hold;
                }
            );

            const pendingJoin = h.joinChat(
                user,
                {
                    orderId: 11,
                    orderType: "regular",
                }
            );

            await started;

            user.emit("leaveChat");

            await h.waitUntil(
                () =>
                    h.serverSocket(user)
                        ?.data.activeChatRoom === null
            );

            releaseLookup();

            const result = await pendingJoin;

            assert.equal(result.ok, false);

            assert.equal(
                h.inRoom(user, "chat_regular_11"),
                false
            );

            assert.equal(
                h.inRoom(user, "chat_express_11"),
                false
            );
        });
    }
);

test(
    "Socket.IO: при подписке отправляет снимок непрочитанных",
    async () => {
        await withHarness(async (h) => {
            const user = await h.connect(
                h.token(101, "s-101", "user")
            );

            const received = [];

            user.on(
                "new_notification",
                (payload) => {
                    received.push(payload);
                }
            );

            user.emit(
                "subscribeToNotifications"
            );

            await h.waitUntil(
                () => received.length > 0
            );

            assert.equal(
                Array.isArray(received[0]),
                true
            );
        });
    }
);