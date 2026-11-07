const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const {
    loadIsolatedRouter,
} = require("./helpers/loadIsolatedRouter");

const {
    getAdminSelfActionError,
} = require("../utils/adminRoleSafety");

const sessionCookies = require(
    "../utils/adminSessionCookie"
);

const ADMIN_ORIGIN = "http://localhost:3001";
const FOREIGN_ORIGIN = "https://example.org";

function sessionError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

async function createHarness() {
    const users = new Map([
        [
            1,
            {
                id: 1,
                username: "test-admin",
                phone: "+79990000001",
                password: "correct-password",
                role: "admin",
                rating: 5,
            },
        ],
        [
            2,
            {
                id: 2,
                username: "test-user",
                phone: "+79990000002",
                password: "user-password",
                role: "user",
            },
        ],
    ]);

    const refreshTokens = new Map();

    const calls = {
        create: [],
        refresh: [],
        revoke: [],
    };

    const controls = {
        failCreate: false,
        failRefresh: false,
        failLogout: false,
    };

    let nextTokenId = 1;

    function issueSession(userId, scope) {
        const id = nextTokenId++;

        const refreshToken = `test-refresh-${id}`;

        refreshTokens.set(refreshToken, {
            userId,
            scope,
        });

        return {
            token: `test-access-${id}`,
            refreshToken,
            expiresAt: new Date(
                Date.now() + 30 * 86400000
            ),
        };
    }

    const createAuthSession = async (user, scope) => {
        calls.create.push({
            userId: user.id,
            scope,
        });

        if (controls.failCreate) {
            throw new Error(
                "PRIVATE_CREATE_SESSION_ERROR"
            );
        }

        return issueSession(user.id, scope);
    };

    const refreshAuthSession = async (
        refreshToken,
        scope
    ) => {
        calls.refresh.push({
            refreshToken,
            scope,
        });

        if (controls.failRefresh) {
            throw new Error(
                "PRIVATE_REFRESH_DATABASE_ERROR"
            );
        }

        const existing =
            refreshTokens.get(refreshToken);

        if (!existing || existing.scope !== scope) {
            throw sessionError(
                401,
                "Сессия не найдена"
            );
        }

        const user = users.get(existing.userId);

        if (!user || user.role !== "admin") {
            throw sessionError(
                403,
                "Доступ к сессии запрещён"
            );
        }

        refreshTokens.delete(refreshToken);

        return issueSession(
            existing.userId,
            scope
        );
    };

    const revokeAuthSession = async (
        refreshToken,
        scope
    ) => {
        calls.revoke.push({
            refreshToken,
            scope,
        });

        if (controls.failLogout) {
            throw new Error(
                "PRIVATE_LOGOUT_DATABASE_ERROR"
            );
        }

        const existing =
            refreshTokens.get(refreshToken);

        if (existing?.scope === scope) {
            refreshTokens.delete(refreshToken);
        }
    };

    const router = loadIsolatedRouter(
        "admin.js",
        {
            express,

            "../middlewares/adminAuth": {
                authMiddleware: (req, res, next) =>
                    res.sendStatus(401),

                adminMiddleware: (req, res, next) =>
                    res.sendStatus(403),
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
                User: {
                    async findOne({ where }) {
                        return (
                            [...users.values()].find(
                                (user) =>
                                    user.phone === where.phone
                            ) || null
                        );
                    },
                },

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

            bcrypt: {
                async compare(password, stored) {
                    return password === stored;
                },
            },

            "../services/recommendedPriceService": {
                calculateRecommendedPrice: () => null,
            },

            "../services/authSessionService": {
                createAuthSession,
                refreshAuthSession,
                revokeAuthSession,
            },

            "../utils/adminSessionCookie":
            sessionCookies,

            "../utils/adminRoleSafety": {
                getAdminSelfActionError,
            },
        }
    );

    const app = express();

    app.use(express.json());
    app.use("/api/admin", router);

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

    const baseURL =
        `http://127.0.0.1:${server.address().port}`;

    async function request(
        path,
        {
            body = {},
            origin,
            cookie,
        } = {}
    ) {
        const headers = {
            "Content-Type": "application/json",
        };

        if (origin !== undefined) {
            headers.Origin = origin;
        }

        if (cookie) {
            headers.Cookie = cookie;
        }

        const response = await fetch(
            baseURL + path,
            {
                method: "POST",
                headers,
                body: JSON.stringify(body),
            }
        );

        return {
            status: response.status,
            body: await response.json(),
            setCookie:
                response.headers.get("set-cookie") || "",
        };
    }

    return {
        request,
        users,
        controls,
        calls,
        refreshTokens,

        async login() {
            return request("/api/admin/login", {
                body: {
                    phone: "+79990000001",
                    password: "correct-password",
                },
            });
        },

        async refresh(cookie, origin = ADMIN_ORIGIN) {
            return request(
                "/api/admin/session/refresh",
                {
                    origin,
                    cookie,
                }
            );
        },

        async logout(cookie, origin = ADMIN_ORIGIN) {
            return request(
                "/api/admin/session/logout",
                {
                    origin,
                    cookie,
                }
            );
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

async function withHarness(callback) {
    const api = await createHarness();

    try {
        await callback(api);
    } finally {
        await api.close();
    }
}

function cookiePair(setCookie) {
    return setCookie.split(";")[0];
}

// ============================================
// LOGIN
// ============================================

test("HTTP session: правильный вход создаёт административную сессию", async () => {
    await withHarness(async (api) => {
        const response = await api.login();

        assert.equal(response.status, 200);
        assert.equal(response.body.user.role, "admin");

        assert.ok(response.body.token);

        assert.equal(
            Object.hasOwn(
                response.body,
                "refreshToken"
            ),
            false
        );

        assert.deepEqual(api.calls.create, [
            {
                userId: 1,
                scope: "admin",
            },
        ]);
    });
});

test("HTTP session: refresh-token передаётся через HttpOnly cookie", async () => {
    await withHarness(async (api) => {
        const response = await api.login();

        assert.equal(response.status, 200);

        assert.match(
            response.setCookie,
            /cc_admin_refresh=/
        );

        assert.match(
            response.setCookie,
            /HttpOnly/i
        );

        assert.match(
            response.setCookie,
            /SameSite=Lax/i
        );

        assert.match(
            response.setCookie,
            /Path=\/api\/admin\/session/
        );
    });
});

test("HTTP session: неизвестный пользователь не входит", async () => {
    await withHarness(async (api) => {
        const response = await api.request(
            "/api/admin/login",
            {
                body: {
                    phone: "+79990000999",
                    password: "password",
                },
            }
        );

        assert.equal(response.status, 404);
        assert.equal(api.calls.create.length, 0);
    });
});

test("HTTP session: неправильный пароль запрещает вход", async () => {
    await withHarness(async (api) => {
        const response = await api.request(
            "/api/admin/login",
            {
                body: {
                    phone: "+79990000001",
                    password: "wrong-password",
                },
            }
        );

        assert.equal(response.status, 401);
        assert.equal(api.calls.create.length, 0);
    });
});

test("HTTP session: обычный пользователь не может войти в админку", async () => {
    await withHarness(async (api) => {
        const response = await api.request(
            "/api/admin/login",
            {
                body: {
                    phone: "+79990000002",
                    password: "user-password",
                },
            }
        );

        assert.equal(response.status, 403);
        assert.equal(api.calls.create.length, 0);
    });
});

test("HTTP session: внутренняя ошибка входа не раскрывается клиенту", async () => {
    await withHarness(async (api) => {
        api.controls.failCreate = true;

        const response = await api.login();

        assert.equal(response.status, 500);

        assert.equal(
            JSON.stringify(response.body).includes(
                "PRIVATE_CREATE_SESSION_ERROR"
            ),
            false
        );
    });
});

// ============================================
// ORIGIN / CSRF
// ============================================

test("HTTP session: refresh без Origin запрещён", async () => {
    await withHarness(async (api) => {
        const login = await api.login();

        const response = await api.request(
            "/api/admin/session/refresh",
            {
                cookie: cookiePair(login.setCookie),
            }
        );

        assert.equal(response.status, 403);
        assert.equal(api.calls.refresh.length, 0);
    });
});

test("HTTP session: чужой Origin запрещён", async () => {
    await withHarness(async (api) => {
        const login = await api.login();

        const response = await api.refresh(
            cookiePair(login.setCookie),
            FOREIGN_ORIGIN
        );

        assert.equal(response.status, 403);
        assert.equal(api.calls.refresh.length, 0);
    });
});

test("HTTP session: localhost разрешён для тестового refresh", async () => {
    await withHarness(async (api) => {
        const login = await api.login();

        const response = await api.refresh(
            cookiePair(login.setCookie)
        );

        assert.equal(response.status, 200);
        assert.ok(response.body.token);
    });
});

// ============================================
// REFRESH
// ============================================

test("HTTP session: refresh без cookie запрещён", async () => {
    await withHarness(async (api) => {
        const response = await api.refresh(null);

        assert.equal(response.status, 401);

        assert.equal(
            response.body.message,
            "Сессия отсутствует"
        );
    });
});

test("HTTP session: неверный refresh-token запрещён", async () => {
    await withHarness(async (api) => {
        const response = await api.refresh(
            "cc_admin_refresh=invalid-token"
        );

        assert.equal(response.status, 401);

        assert.match(
            response.setCookie,
            /cc_admin_refresh=/
        );
    });
});

test("HTTP session: обновление ротирует refresh-cookie", async () => {
    await withHarness(async (api) => {
        const login = await api.login();

        const oldCookie =
            cookiePair(login.setCookie);

        const refreshed =
            await api.refresh(oldCookie);

        assert.equal(refreshed.status, 200);
        assert.ok(refreshed.body.token);

        const newCookie =
            cookiePair(refreshed.setCookie);

        assert.notEqual(newCookie, oldCookie);

        assert.equal(
            Object.hasOwn(
                refreshed.body,
                "refreshToken"
            ),
            false
        );
    });
});

test("HTTP session: старый refresh-cookie нельзя использовать повторно", async () => {
    await withHarness(async (api) => {
        const login = await api.login();

        const oldCookie =
            cookiePair(login.setCookie);

        const refreshed =
            await api.refresh(oldCookie);

        assert.equal(refreshed.status, 200);

        const reused =
            await api.refresh(oldCookie);

        assert.equal(reused.status, 401);

        const newCookie =
            cookiePair(refreshed.setCookie);

        const valid =
            await api.refresh(newCookie);

        assert.equal(valid.status, 200);
    });
});

test("HTTP session: отзыв административной роли запрещает refresh", async () => {
    await withHarness(async (api) => {
        const login = await api.login();

        api.users.get(1).role = "user";

        const response = await api.refresh(
            cookiePair(login.setCookie)
        );

        assert.equal(response.status, 403);

        assert.match(
            response.setCookie,
            /cc_admin_refresh=/
        );
    });
});

test("HTTP session: ошибка refresh не раскрывает внутреннюю ошибку", async () => {
    await withHarness(async (api) => {
        const login = await api.login();

        api.controls.failRefresh = true;

        const response = await api.refresh(
            cookiePair(login.setCookie)
        );

        assert.equal(response.status, 500);

        assert.equal(
            response.body.message,
            "Ошибка обновления сессии"
        );

        assert.equal(
            JSON.stringify(response.body).includes(
                "PRIVATE_REFRESH_DATABASE_ERROR"
            ),
            false
        );
    });
});

// ============================================
// LOGOUT
// ============================================

test("HTTP session: logout отзывает refresh-token", async () => {
    await withHarness(async (api) => {
        const login = await api.login();

        const cookie =
            cookiePair(login.setCookie);

        const logout =
            await api.logout(cookie);

        assert.equal(logout.status, 200);

        assert.deepEqual(logout.body, {
            success: true,
        });

        assert.equal(api.calls.revoke.length, 1);

        assert.equal(
            api.calls.revoke[0].scope,
            "admin"
        );

        const refresh =
            await api.refresh(cookie);

        assert.equal(refresh.status, 401);
    });
});

test("HTTP session: logout очищает cookie", async () => {
    await withHarness(async (api) => {
        const login = await api.login();

        const logout = await api.logout(
            cookiePair(login.setCookie)
        );

        assert.equal(logout.status, 200);

        assert.match(
            logout.setCookie,
            /cc_admin_refresh=/
        );

        assert.match(
            logout.setCookie,
            /Expires=|Max-Age=0/i
        );
    });
});

test("HTTP session: logout без cookie безопасен", async () => {
    await withHarness(async (api) => {
        const response = await api.logout(null);

        assert.equal(response.status, 200);

        assert.deepEqual(response.body, {
            success: true,
        });
    });
});

test("HTTP session: чужой Origin не может завершить сессию", async () => {
    await withHarness(async (api) => {
        const login = await api.login();

        const cookie =
            cookiePair(login.setCookie);

        const denied = await api.logout(
            cookie,
            FOREIGN_ORIGIN
        );

        assert.equal(denied.status, 403);
        assert.equal(api.calls.revoke.length, 0);

        const refresh =
            await api.refresh(cookie);

        assert.equal(refresh.status, 200);
    });
});

test("HTTP session: внутренняя ошибка logout не раскрывается", async () => {
    await withHarness(async (api) => {
        const login = await api.login();

        api.controls.failLogout = true;

        const response = await api.logout(
            cookiePair(login.setCookie)
        );

        assert.equal(response.status, 500);

        assert.equal(
            response.body.message,
            "Не удалось завершить сессию"
        );

        assert.equal(
            JSON.stringify(response.body).includes(
                "PRIVATE_LOGOUT_DATABASE_ERROR"
            ),
            false
        );
    });
});