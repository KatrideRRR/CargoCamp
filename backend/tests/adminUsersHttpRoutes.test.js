const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const {
    loadIsolatedRouter,
} = require("./helpers/loadIsolatedRouter");

const {
    getAdminSelfActionError,
} = require("../utils/adminRoleSafety");

const DAY = 24 * 60 * 60 * 1000;

async function createTestServer({
                                    failingSaveIds = [],
                                } = {}) {
    const now = Date.now();

    // Полностью искусственные пользователи.
    const users = new Map([
        [
            1,
            {
                id: 1,
                role: "admin",
                username: "Первый администратор",
                subscription_type: "standard",
                subscription_expires_at: null,
            },
        ],
        [
            2,
            {
                id: 2,
                role: "admin",
                username: "Второй администратор",
                subscription_type: "standard",
                subscription_expires_at: null,
            },
        ],
        [
            3,
            {
                id: 3,
                role: "user",
                username: "Обычный пользователь",
                subscription_type: "standard",
                subscription_expires_at: null,
            },
        ],
        [
            4,
            {
                id: 4,
                role: "banned",
                username: "Заблокированный пользователь",
                subscription_type: "standard",
                subscription_expires_at: null,
            },
        ],
        [
            5,
            {
                id: 5,
                role: "user",
                username: "Premium пользователь",
                subscription_type: "premium",
                subscription_expires_at:
                    new Date(now + 10 * DAY).toISOString(),
            },
        ],
        [
            6,
            {
                id: 6,
                role: "user",
                username: "Истёкший Premium",
                subscription_type: "premium",
                subscription_expires_at:
                    new Date(now - 2 * DAY).toISOString(),
            },
        ],
    ]);

    const writes = [];
    const failingIds = new Set(
        failingSaveIds.map(Number)
    );

    const User = {
        async findByPk(id) {
            const stored = users.get(Number(id));

            if (!stored) {
                return null;
            }

            return {
                ...stored,

                async save() {
                    if (failingIds.has(Number(this.id))) {
                        throw new Error(
                            "PRIVATE_DATABASE_ERROR_TEST_ONLY"
                        );
                    }

                    const {
                        save,
                        ...updated
                    } = this;

                    users.set(
                        Number(this.id),
                        { ...updated }
                    );

                    writes.push({
                        id: Number(this.id),
                        role: updated.role,
                        subscription_type:
                        updated.subscription_type,
                        subscription_expires_at:
                        updated.subscription_expires_at,
                    });
                },
            };
        },

        async findAll() {
            return [...users.values()];
        },
    };

    // Тестовые токены.
    // Настоящая JWT-авторизация здесь не используется.
    const sessions = {
        "admin-1": 1,
        "admin-2": 2,
        "user-3": 3,
    };

    const authMiddleware = (req, res, next) => {
        const token = req.headers.authorization
            ?.replace(/^Bearer /, "");

        const userId = sessions[token];

        if (!userId) {
            return res.status(401).json({
                message: "Нет доступа",
            });
        }

        const user = users.get(userId);

        if (!user) {
            return res.status(401).json({
                message: "Нет доступа",
            });
        }

        req.user = { ...user };
        next();
    };

    const adminMiddleware = (req, res, next) => {
        if (req.user?.role !== "admin") {
            return res.status(403).json({
                message: "Доступ запрещен",
            });
        }

        next();
    };

    // Загружаем настоящий admin.js.
    // Все импорты подменены тестовыми зависимостями.
    const router = loadIsolatedRouter(
        "admin.js",
        {
            express,

            "../middlewares/adminAuth": {
                authMiddleware,
                adminMiddleware,
            },

            jsonwebtoken: {},

            "node-geocoder": () => ({
                geocode: async () => [],
            }),

            sequelize: {
                Op: {},
            },

            "../services/notificationService": {
                notifyUser: async () => {},
            },

            "../models": {
                User,
                Message: {},
                Order: {},
                ExpressOrder: {},
                Category: {},
                Subcategory: {},
                Dispute: {},
                ActionLog: {},
                Service: {},
                sequelize: {},
            },

            bcrypt: {},

            "../services/recommendedPriceService": {
                calculateRecommendedPrice: () => null,
            },

            "../services/authSessionService": {
                createAuthSession: async () => null,
                refreshAuthSession: async () => null,
                revokeAuthSession: async () => null,
            },

            "../utils/adminSessionCookie": {
                validateAdminSessionOrigin: () => {},
                getAdminRefreshToken: () => null,
                setAdminRefreshCookie: () => {},
                clearAdminRefreshCookie: () => {},
            },

            "../utils/adminRoleSafety": {
                getAdminSelfActionError,
            },
        }
    );

    const app = express();

    app.use(express.json());
    app.use("/api/admin", router);

    // Только localhost и автоматически выбранный порт.
    const server = await new Promise((resolve, reject) => {
        const instance = app.listen(
            0,
            "127.0.0.1",
            () => resolve(instance)
        );

        instance.once("error", reject);
    });

    const baseURL =
        `http://127.0.0.1:${server.address().port}`;

    async function request(
        method,
        endpoint,
        body,
        token = "admin-1"
    ) {
        const response = await fetch(
            baseURL + endpoint,
            {
                method,

                headers: {
                    "Content-Type": "application/json",

                    ...(token
                        ? {
                            Authorization: `Bearer ${token}`,
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
        writes,

        getUser(id) {
            return users.get(Number(id));
        },

        setUser(id, changes) {
            const previous = users.get(Number(id));

            users.set(Number(id), {
                ...previous,
                ...changes,
            });
        },

        async close() {
            await new Promise((resolve, reject) => {
                server.close((error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });

                server.closeAllConnections?.();
            });
        },
    };
}

async function withServer(callback, options = {}) {
    const api = await createTestServer(options);

    try {
        await callback(api);
    } finally {
        await api.close();
    }
}

const USER_ROLE = "/api/admin/users/3/role";
const ADMIN_ROLE = "/api/admin/users/2/role";
const SELF_ROLE = "/api/admin/users/1/role";

const USER_BLOCK = "/api/admin/users/3/block";
const SELF_BLOCK = "/api/admin/users/1/block";

const USER_PREMIUM = "/api/admin/users/3/premium";

// ==================================================
// АВТОРИЗАЦИЯ
// ==================================================

test("HTTP admin: администратор получает список пользователей", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "GET",
            "/api/admin/users"
        );

        assert.equal(response.status, 200);
        assert.equal(response.body.length, 6);
    });
});

test("HTTP admin: запросы без авторизации запрещены", async () => {
    await withServer(async (api) => {
        const operations = [
            ["GET", "/api/admin/users"],
            ["PUT", USER_ROLE, { role: "admin" }],
            ["PUT", USER_BLOCK, {}],
            ["PUT", USER_PREMIUM, { days: 7 }],
            ["DELETE", USER_PREMIUM],
        ];

        for (const [method, path, body] of operations) {
            const response = await api.request(
                method,
                path,
                body,
                null
            );

            assert.equal(response.status, 401);
        }

        assert.equal(api.writes.length, 0);
    });
});

test("HTTP admin: обычный пользователь не может управлять админкой", async () => {
    await withServer(async (api) => {
        const operations = [
            ["GET", "/api/admin/users"],
            ["PUT", USER_ROLE, { role: "admin" }],
            ["PUT", USER_BLOCK, {}],
            ["PUT", USER_PREMIUM, { days: 7 }],
            ["DELETE", USER_PREMIUM],
        ];

        for (const [method, path, body] of operations) {
            const response = await api.request(
                method,
                path,
                body,
                "user-3"
            );

            assert.equal(response.status, 403);
        }

        assert.equal(api.writes.length, 0);
    });
});

// ==================================================
// АДМИНИСТРАТИВНЫЕ РОЛИ
// ==================================================

test("HTTP admin: нельзя назначить неизвестную роль", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "PUT",
            USER_ROLE,
            { role: "superadmin" }
        );

        assert.equal(response.status, 400);
        assert.equal(api.getUser(3).role, "user");
        assert.equal(api.writes.length, 0);
    });
});

test("HTTP admin: изменение роли неизвестного пользователя возвращает 404", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "PUT",
            "/api/admin/users/999/role",
            { role: "admin" }
        );

        assert.equal(response.status, 404);
        assert.equal(api.writes.length, 0);
    });
});

test("HTTP admin: заблокированному нельзя выдать роль администратора", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "PUT",
            "/api/admin/users/4/role",
            { role: "admin" }
        );

        assert.equal(response.status, 400);
        assert.equal(api.getUser(4).role, "banned");
        assert.equal(api.writes.length, 0);
    });
});

test("HTTP admin: нельзя снять собственные административные права", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "PUT",
            SELF_ROLE,
            { role: "user" }
        );

        assert.equal(response.status, 403);

        assert.equal(
            response.body.message,
            "Нельзя снять права администратора у самого себя"
        );

        assert.equal(api.getUser(1).role, "admin");
        assert.equal(api.writes.length, 0);
    });
});

test("HTTP admin: можно назначить другого пользователя администратором", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "PUT",
            USER_ROLE,
            { role: "admin" }
        );

        assert.equal(response.status, 200);
        assert.equal(api.getUser(3).role, "admin");
        assert.equal(api.writes.length, 1);
    });
});

test("HTTP admin: можно снять права у другого администратора", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "PUT",
            ADMIN_ROLE,
            { role: "user" }
        );

        assert.equal(response.status, 200);
        assert.equal(api.getUser(2).role, "user");

        // После снятия роли доступ больше не разрешён.
        const denied = await api.request(
            "GET",
            "/api/admin/users",
            undefined,
            "admin-2"
        );

        assert.equal(denied.status, 403);
    });
});

test("HTTP admin: ошибка сохранения не меняет роль", async () => {
    await withServer(
        async (api) => {
            const response = await api.request(
                "PUT",
                USER_ROLE,
                { role: "admin" }
            );

            assert.equal(response.status, 500);
            assert.equal(api.getUser(3).role, "user");
            assert.equal(api.writes.length, 0);
        },
        {
            failingSaveIds: [3],
        }
    );
});

// ==================================================
// БЛОКИРОВКА ПОЛЬЗОВАТЕЛЕЙ
// ==================================================

test("HTTP admin: нельзя заблокировать самого себя", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "PUT",
            SELF_BLOCK,
            {}
        );

        assert.equal(response.status, 403);

        assert.equal(
            response.body.message,
            "Нельзя заблокировать собственную учётную запись администратора"
        );

        assert.equal(api.getUser(1).role, "admin");
        assert.equal(api.writes.length, 0);
    });
});

test("HTTP admin: обычного пользователя можно заблокировать", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "PUT",
            USER_BLOCK,
            {}
        );

        assert.equal(response.status, 200);
        assert.equal(api.getUser(3).role, "banned");
        assert.equal(api.writes.length, 1);
    });
});

test("HTTP admin: заблокированного пользователя можно разблокировать", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "PUT",
            "/api/admin/users/4/unblock",
            {}
        );

        assert.equal(response.status, 200);
        assert.equal(api.getUser(4).role, "user");
        assert.equal(api.writes.length, 1);
    });
});

test("HTTP admin: нельзя блокировать или разблокировать неизвестного пользователя", async () => {
    await withServer(async (api) => {
        const block = await api.request(
            "PUT",
            "/api/admin/users/999/block",
            {}
        );

        const unblock = await api.request(
            "PUT",
            "/api/admin/users/999/unblock",
            {}
        );

        assert.equal(block.status, 404);
        assert.equal(unblock.status, 404);
        assert.equal(api.writes.length, 0);
    });
});

test("HTTP admin: ошибка сохранения не блокирует пользователя", async () => {
    await withServer(
        async (api) => {
            const response = await api.request(
                "PUT",
                USER_BLOCK,
                {}
            );

            assert.equal(response.status, 500);
            assert.equal(api.getUser(3).role, "user");
            assert.equal(api.writes.length, 0);
        },
        {
            failingSaveIds: [3],
        }
    );
});

// ==================================================
// PREMIUM
// ==================================================

test("HTTP admin: Premium разрешён только на 7 или 30 дней", async () => {
    await withServer(async (api) => {
        const invalidValues = [
            0,
            1,
            8,
            31,
            "7days",
            null,
        ];

        for (const days of invalidValues) {
            const response = await api.request(
                "PUT",
                USER_PREMIUM,
                { days }
            );

            assert.equal(response.status, 400);
        }

        assert.equal(api.writes.length, 0);
    });
});

test("HTTP admin: Premium для неизвестного пользователя возвращает 404", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "PUT",
            "/api/admin/users/999/premium",
            { days: 7 }
        );

        assert.equal(response.status, 404);
        assert.equal(api.writes.length, 0);
    });
});

test("HTTP admin: выдача Premium на 7 дней", async () => {
    await withServer(async (api) => {
        const before = Date.now();

        const response = await api.request(
            "PUT",
            USER_PREMIUM,
            { days: 7 }
        );

        const after = Date.now();

        assert.equal(response.status, 200);

        const user = api.getUser(3);

        assert.equal(
            user.subscription_type,
            "premium"
        );

        const expiresAt = new Date(
            user.subscription_expires_at
        ).getTime();

        assert.ok(expiresAt >= before + 7 * DAY);
        assert.ok(expiresAt <= after + 7 * DAY);
        assert.equal(api.writes.length, 1);
    });
});

test("HTTP admin: выдача Premium на 30 дней", async () => {
    await withServer(async (api) => {
        const before = Date.now();

        const response = await api.request(
            "PUT",
            USER_PREMIUM,
            { days: 30 }
        );

        const after = Date.now();

        assert.equal(response.status, 200);

        const expiresAt = new Date(
            api.getUser(3).subscription_expires_at
        ).getTime();

        assert.ok(expiresAt >= before + 30 * DAY);
        assert.ok(expiresAt <= after + 30 * DAY);
    });
});

test("HTTP admin: действующий Premium продлевается от старой даты", async () => {
    await withServer(async (api) => {
        const originalExpiration = new Date(
            api.getUser(5).subscription_expires_at
        ).getTime();

        const response = await api.request(
            "PUT",
            "/api/admin/users/5/premium",
            { days: 30 }
        );

        assert.equal(response.status, 200);

        const newExpiration = new Date(
            api.getUser(5).subscription_expires_at
        ).getTime();

        assert.equal(
            newExpiration,
            originalExpiration + 30 * DAY
        );

        assert.equal(api.writes.length, 1);
    });
});

test("HTTP admin: истёкший Premium продлевается от текущей даты", async () => {
    await withServer(async (api) => {
        const before = Date.now();

        const response = await api.request(
            "PUT",
            "/api/admin/users/6/premium",
            { days: 7 }
        );

        const after = Date.now();

        assert.equal(response.status, 200);

        const expiresAt = new Date(
            api.getUser(6).subscription_expires_at
        ).getTime();

        assert.ok(expiresAt >= before + 7 * DAY);
        assert.ok(expiresAt <= after + 7 * DAY);
    });
});

test("HTTP admin: Premium можно снять", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "DELETE",
            "/api/admin/users/5/premium"
        );

        assert.equal(response.status, 200);

        const user = api.getUser(5);

        assert.equal(
            user.subscription_type,
            "standard"
        );

        assert.equal(
            user.subscription_expires_at,
            null
        );

        assert.equal(api.writes.length, 1);
    });
});

test("HTTP admin: снятие Premium у неизвестного пользователя возвращает 404", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "DELETE",
            "/api/admin/users/999/premium"
        );

        assert.equal(response.status, 404);
        assert.equal(api.writes.length, 0);
    });
});

test("HTTP admin: ошибка сохранения не выдаёт Premium", async () => {
    await withServer(
        async (api) => {
            const response = await api.request(
                "PUT",
                USER_PREMIUM,
                { days: 7 }
            );

            assert.equal(response.status, 500);

            assert.equal(
                api.getUser(3).subscription_type,
                "standard"
            );

            assert.equal(api.writes.length, 0);
        },
        {
            failingSaveIds: [3],
        }
    );
});

test("HTTP admin: ошибка снятия Premium не меняет подписку и не раскрывает исключение", async () => {
    await withServer(
        async (api) => {
            const original = api.getUser(5);

            const response = await api.request(
                "DELETE",
                "/api/admin/users/5/premium"
            );

            assert.equal(response.status, 500);

            assert.equal(
                response.body.message,
                "Ошибка снятия премиума"
            );

            // Внутренние ошибки БД клиенту не возвращаются.
            assert.equal(
                Object.hasOwn(response.body, "error"),
                false
            );

            assert.equal(
                api.getUser(5).subscription_type,
                original.subscription_type
            );

            assert.equal(
                api.getUser(5).subscription_expires_at,
                original.subscription_expires_at
            );

            assert.equal(api.writes.length, 0);
        },
        {
            failingSaveIds: [5],
        }
    );
});