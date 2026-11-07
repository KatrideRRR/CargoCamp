const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const path = require("node:path");
const express = require("express");
const multer = require("multer");

const {
    loadIsolatedRouter,
} = require("./helpers/loadIsolatedRouter");

const sessionTransport = require(
    "../utils/userSessionTransport"
);

const WEB_ORIGIN = "http://localhost:3000";
const NATIVE_ORIGIN = "capacitor://localhost";
const FOREIGN_ORIGIN = "https://example.org";

const PHONE = "79990000001";
const PASSWORD = "test-password";

function sessionError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

async function createTestServer() {
    const users = new Map([
        [
            PHONE,
            {
                id: 1,
                username: "Тестовый пользователь",
                phone: PHONE,
                password: PASSWORD,
                role: "user",
                rating: 5,
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
        failRefresh: false,
    };

    let sessionNumber = 0;

    function issueSession(user, scope) {
        sessionNumber++;

        const refreshToken = crypto
            .randomBytes(48)
            .toString("hex");

        refreshTokens.set(refreshToken, {
            userId: user.id,
            scope,
        });

        return {
            token: `test-access-${sessionNumber}`,
            refreshToken,
            expiresAt: new Date(
                Date.now() + 90 * 86400000
            ),
        };
    }

    const createAuthSession = async (user, scope) => {
        calls.create.push({
            userId: user.id,
            scope,
        });

        return issueSession(user, scope);
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
                "PRIVATE_TEST_DATABASE_ERROR"
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

        const user = [...users.values()].find(
            (entry) =>
                entry.id === existing.userId
        );

        if (!user || user.role === "banned") {
            throw sessionError(
                403,
                "Доступ к сессии запрещён"
            );
        }

        refreshTokens.delete(refreshToken);

        return issueSession(user, scope);
    };

    const revokeAuthSession = async (
        refreshToken,
        scope
    ) => {
        calls.revoke.push({
            refreshToken,
            scope,
        });

        const existing =
            refreshTokens.get(refreshToken);

        if (existing?.scope === scope) {
            refreshTokens.delete(refreshToken);
        }
    };

    /*
     * Загружаем реальный backend/routes/auth.js.
     *
     * Модели, файловые операции и внешние
     * сервисы полностью подменены.
     */
    const router = loadIsolatedRouter(
        "auth.js",
        {
            dotenv: {
                config: () => ({}),
            },

            express,

            bcrypt: {
                compare: async (password, stored) =>
                    password === stored,

                hash: async () => {
                    throw new Error(
                        "Unexpected password hashing"
                    );
                },
            },

            jsonwebtoken: {
                sign: () => "legacy-test-jwt",
            },

            "../models": {
                User: {
                    async findOne({ where }) {
                        return (
                            users.get(where.phone) || null
                        );
                    },
                },

                OrderReview: {},
                Order: {},
                Category: {},
                ExpressOrder: {},
            },

            "../middlewares/userAuth": (
                req,
                res
            ) => res.status(401).json({
                message: "Protected route not mocked",
            }),

            multer,

            path,

            axios: {
                get: async () => {
                    throw new Error(
                        "External HTTP is forbidden"
                    );
                },

                post: async () => {
                    throw new Error(
                        "External HTTP is forbidden"
                    );
                },
            },

            fs: {
                existsSync: () => true,

                mkdirSync: () => {
                    throw new Error(
                        "Filesystem writes are forbidden"
                    );
                },
            },

            "../services/notificationService": {
                notifyUser: async () => {},
            },

            "../services/adminNotificationService": {
                sendAdminNotification: async () => {},
                adminUserUrl: () => "",
                adminUsersUrl: () => "",
            },

            "../services/passwordResetService": {
                async resetPasswordAndRevokeSessions() {
                    throw new Error(
                        "Password reset is not used in session tests"
                    );
                },
            },

            "../services/smsCodeStore": {},

            "../services/publicUserBadgesService": {
                async getPublicUserBadges() {
                    return {
                        identityVerified: false,
                        isPensioner: false,
                    };
                },
            },

            "../services/authSessionService": {
                createAuthSession,
                refreshAuthSession,
                revokeAuthSession,
            },

            "../utils/userSessionTransport":
            sessionTransport,

            crypto,

            "../config/storagePaths": {
                uploadsRoot:
                    "/cargocamp-isolated-tests-no-io",
            },
        }
    );

    const app = express();

    app.use(express.json());
    app.use("/api/auth", router);

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
        endpoint,
        {
            body = {},
            origin,
            cookie,
        } = {}
    ) {
        const headers = {
            "Content-Type": "application/json",
        };

        if (origin != null) {
            headers.Origin = origin;
        }

        if (cookie) {
            headers.Cookie = cookie;
        }

        const response = await fetch(
            baseURL + endpoint,
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

    function login({
                       client = "web",
                       origin = WEB_ORIGIN,
                       password = PASSWORD,
                   } = {}) {
        return request("/api/auth/login", {
            origin,
            body: {
                phone: PHONE,
                password,

                ...(client
                    ? { sessionClient: client }
                    : {}),
            },
        });
    }

    function refresh({
                         client = "web",
                         origin = WEB_ORIGIN,
                         cookie,
                         refreshToken,
                     } = {}) {
        return request(
            "/api/auth/session/refresh",
            {
                origin,
                cookie,
                body: {
                    sessionClient: client,

                    ...(refreshToken
                        ? { refreshToken }
                        : {}),
                },
            }
        );
    }

    function logout({
                        client = "web",
                        origin = WEB_ORIGIN,
                        cookie,
                        refreshToken,
                    } = {}) {
        return request(
            "/api/auth/session/logout",
            {
                origin,
                cookie,
                body: {
                    sessionClient: client,

                    ...(refreshToken
                        ? { refreshToken }
                        : {}),
                },
            }
        );
    }

    return {
        request,
        login,
        refresh,
        logout,

        users,
        refreshTokens,
        calls,
        controls,

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

async function withServer(callback) {
    const api = await createTestServer();

    try {
        await callback(api);
    } finally {
        await api.close();
    }
}

function cookiePair(setCookie) {
    assert.match(
        setCookie,
        /cc_user_refresh=/
    );

    return setCookie.split(";")[0];
}

// ==========================================
// WEB LOGIN
// ==========================================

test("Web login: создаёт пользовательскую сессию", async () => {
    await withServer(async (api) => {
        const response = await api.login();

        assert.equal(response.status, 200);
        assert.ok(response.body.token);

        assert.equal(
            response.body.user.role,
            "user"
        );

        assert.deepEqual(api.calls.create, [
            {
                userId: 1,
                scope: "user",
            },
        ]);
    });
});

test("Web login: refresh хранится только в HttpOnly cookie", async () => {
    await withServer(async (api) => {
        const response = await api.login();

        assert.equal(response.status, 200);

        assert.equal(
            Object.hasOwn(
                response.body,
                "refreshToken"
            ),
            false
        );

        assert.match(
            response.setCookie,
            /cc_user_refresh=/
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
            /Path=\/api\/auth\/session/
        );
    });
});

test("Web login: неправильный пароль запрещён", async () => {
    await withServer(async (api) => {
        const response = await api.login({
            password: "wrong-password",
        });

        assert.equal(response.status, 401);
        assert.equal(api.calls.create.length, 0);
    });
});

test("Web login: неизвестный пользователь запрещён", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "/api/auth/login",
            {
                origin: WEB_ORIGIN,
                body: {
                    phone: "79990000999",
                    password: PASSWORD,
                    sessionClient: "web",
                },
            }
        );

        assert.equal(response.status, 404);
        assert.equal(api.calls.create.length, 0);
    });
});

test("Web login: заблокированный пользователь не входит", async () => {
    await withServer(async (api) => {
        api.users.get(PHONE).role = "banned";

        const response = await api.login();

        assert.equal(response.status, 403);
        assert.equal(api.calls.create.length, 0);
    });
});

test("Web login: отсутствие Origin запрещает создание сессии", async () => {
    await withServer(async (api) => {
        const response = await api.login({
            origin: null,
        });

        assert.equal(response.status, 403);
        assert.equal(api.calls.create.length, 0);
    });
});

test("Web login: чужой Origin запрещён", async () => {
    await withServer(async (api) => {
        const response = await api.login({
            origin: FOREIGN_ORIGIN,
        });

        assert.equal(response.status, 403);
        assert.equal(api.calls.create.length, 0);
    });
});

// ==========================================
// NATIVE LOGIN
// ==========================================

test("Native login: выдаёт refresh-токен в JSON", async () => {
    await withServer(async (api) => {
        const response = await api.login({
            client: "native",
            origin: NATIVE_ORIGIN,
        });

        assert.equal(response.status, 200);

        assert.match(
            response.body.refreshToken,
            /^[a-f0-9]{96}$/
        );

        assert.ok(response.body.token);

        assert.equal(
            response.setCookie,
            ""
        );
    });
});

test("Native login: работает без Origin", async () => {
    await withServer(async (api) => {
        const response = await api.login({
            client: "native",
            origin: null,
        });

        assert.equal(response.status, 200);
        assert.ok(response.body.refreshToken);
    });
});

test("Native login: чужой Origin запрещён", async () => {
    await withServer(async (api) => {
        const response = await api.login({
            client: "native",
            origin: FOREIGN_ORIGIN,
        });

        assert.equal(response.status, 403);
        assert.equal(api.calls.create.length, 0);
    });
});

test("Login: неизвестный тип клиента запрещён", async () => {
    await withServer(async (api) => {
        const response = await api.login({
            client: "desktop-unknown",
        });

        assert.equal(response.status, 400);
        assert.equal(api.calls.create.length, 0);
    });
});

// ==========================================
// WEB REFRESH
// ==========================================

test("Web refresh: выдаёт новый access JWT и cookie", async () => {
    await withServer(async (api) => {
        const login = await api.login();

        const oldCookie =
            cookiePair(login.setCookie);

        const refreshed = await api.refresh({
            cookie: oldCookie,
        });

        assert.equal(refreshed.status, 200);
        assert.equal(
            refreshed.body.success,
            true
        );

        assert.ok(refreshed.body.token);

        assert.equal(
            Object.hasOwn(
                refreshed.body,
                "refreshToken"
            ),
            false
        );

        assert.notEqual(
            cookiePair(refreshed.setCookie),
            oldCookie
        );

        assert.equal(
            api.calls.refresh[0].scope,
            "user"
        );
    });
});

test("Web refresh: старый cookie нельзя использовать дважды", async () => {
    await withServer(async (api) => {
        const login = await api.login();

        const oldCookie =
            cookiePair(login.setCookie);

        const first = await api.refresh({
            cookie: oldCookie,
        });

        assert.equal(first.status, 200);

        const repeated = await api.refresh({
            cookie: oldCookie,
        });

        assert.equal(repeated.status, 401);

        const next = await api.refresh({
            cookie: cookiePair(
                first.setCookie
            ),
        });

        assert.equal(next.status, 200);
    });
});

test("Web refresh: отсутствие Origin запрещено", async () => {
    await withServer(async (api) => {
        const login = await api.login();

        const response = await api.refresh({
            origin: null,
            cookie: cookiePair(
                login.setCookie
            ),
        });

        assert.equal(response.status, 403);
        assert.equal(api.calls.refresh.length, 0);
    });
});

test("Web refresh: чужой Origin запрещён", async () => {
    await withServer(async (api) => {
        const login = await api.login();

        const response = await api.refresh({
            origin: FOREIGN_ORIGIN,
            cookie: cookiePair(
                login.setCookie
            ),
        });

        assert.equal(response.status, 403);
        assert.equal(api.calls.refresh.length, 0);
    });
});

test("Web refresh: без cookie запрещён", async () => {
    await withServer(async (api) => {
        const response = await api.refresh();

        assert.equal(response.status, 401);
        assert.equal(api.calls.refresh.length, 0);
    });
});

// ==========================================
// NATIVE REFRESH
// ==========================================

test("Native refresh: новый токен передаётся через JSON", async () => {
    await withServer(async (api) => {
        const login = await api.login({
            client: "native",
            origin: NATIVE_ORIGIN,
        });

        const oldToken =
            login.body.refreshToken;

        const response = await api.refresh({
            client: "native",
            origin: NATIVE_ORIGIN,
            refreshToken: oldToken,
        });

        assert.equal(response.status, 200);

        assert.ok(
            response.body.refreshToken
        );

        assert.notEqual(
            response.body.refreshToken,
            oldToken
        );

        assert.equal(response.setCookie, "");
    });
});

test("Native refresh: старый токен нельзя использовать повторно", async () => {
    await withServer(async (api) => {
        const login = await api.login({
            client: "native",
            origin: NATIVE_ORIGIN,
        });

        const oldToken =
            login.body.refreshToken;

        const first = await api.refresh({
            client: "native",
            origin: NATIVE_ORIGIN,
            refreshToken: oldToken,
        });

        assert.equal(first.status, 200);

        const repeated = await api.refresh({
            client: "native",
            origin: NATIVE_ORIGIN,
            refreshToken: oldToken,
        });

        assert.equal(repeated.status, 401);
    });
});

test("Native refresh: неправильный формат токена запрещён", async () => {
    await withServer(async (api) => {
        const response = await api.refresh({
            client: "native",
            origin: NATIVE_ORIGIN,
            refreshToken: "incorrect-token",
        });

        assert.equal(response.status, 401);
        assert.equal(api.calls.refresh.length, 0);
    });
});

test("Native refresh: чужой Origin запрещён", async () => {
    await withServer(async (api) => {
        const login = await api.login({
            client: "native",
            origin: NATIVE_ORIGIN,
        });

        const response = await api.refresh({
            client: "native",
            origin: FOREIGN_ORIGIN,
            refreshToken:
            login.body.refreshToken,
        });

        assert.equal(response.status, 403);
        assert.equal(api.calls.refresh.length, 0);
    });
});

test("Refresh: блокировка пользователя запрещает обновление", async () => {
    await withServer(async (api) => {
        const login = await api.login({
            client: "native",
            origin: NATIVE_ORIGIN,
        });

        api.users.get(PHONE).role = "banned";

        const response = await api.refresh({
            client: "native",
            origin: NATIVE_ORIGIN,
            refreshToken:
            login.body.refreshToken,
        });

        assert.equal(response.status, 403);
    });
});

// ==========================================
// LOGOUT
// ==========================================

test("Web logout: отзывает токен и очищает cookie", async () => {
    await withServer(async (api) => {
        const login = await api.login();

        const cookie =
            cookiePair(login.setCookie);

        const logout = await api.logout({
            cookie,
        });

        assert.equal(logout.status, 200);

        assert.deepEqual(logout.body, {
            success: true,
            message: "Сессия завершена",
        });

        assert.match(
            logout.setCookie,
            /cc_user_refresh=/
        );

        assert.match(
            logout.setCookie,
            /Expires=|Max-Age=0/i
        );

        const after = await api.refresh({
            cookie,
        });

        assert.equal(after.status, 401);
    });
});

test("Native logout: отзывает токен без cookie", async () => {
    await withServer(async (api) => {
        const login = await api.login({
            client: "native",
            origin: NATIVE_ORIGIN,
        });

        const refreshToken =
            login.body.refreshToken;

        const logout = await api.logout({
            client: "native",
            origin: NATIVE_ORIGIN,
            refreshToken,
        });

        assert.equal(logout.status, 200);
        assert.equal(logout.setCookie, "");

        const after = await api.refresh({
            client: "native",
            origin: NATIVE_ORIGIN,
            refreshToken,
        });

        assert.equal(after.status, 401);
    });
});

test("Web logout: чужой Origin не отзывает токен", async () => {
    await withServer(async (api) => {
        const login = await api.login();

        const cookie =
            cookiePair(login.setCookie);

        const denied = await api.logout({
            origin: FOREIGN_ORIGIN,
            cookie,
        });

        assert.equal(denied.status, 403);
        assert.equal(api.calls.revoke.length, 0);

        const stillValid = await api.refresh({
            cookie,
        });

        assert.equal(stillValid.status, 200);
    });
});

test("Native logout: чужой Origin не отзывает токен", async () => {
    await withServer(async (api) => {
        const login = await api.login({
            client: "native",
            origin: NATIVE_ORIGIN,
        });

        const denied = await api.logout({
            client: "native",
            origin: FOREIGN_ORIGIN,
            refreshToken:
            login.body.refreshToken,
        });

        assert.equal(denied.status, 403);
        assert.equal(api.calls.revoke.length, 0);
    });
});

test("Logout: отсутствие типа клиента запрещено", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "/api/auth/session/logout",
            {
                body: {},
            }
        );

        assert.equal(response.status, 400);
        assert.equal(api.calls.revoke.length, 0);
    });
});

test("Refresh: внутренняя ошибка не раскрывается клиенту", async () => {
    await withServer(async (api) => {
        const login = await api.login();

        api.controls.failRefresh = true;

        const response = await api.refresh({
            cookie: cookiePair(
                login.setCookie
            ),
        });

        assert.equal(response.status, 500);

        assert.equal(
            response.body.message,
            "Ошибка обновления сессии"
        );

        assert.equal(
            JSON.stringify(response.body).includes(
                "PRIVATE_TEST_DATABASE_ERROR"
            ),
            false
        );
    });
});