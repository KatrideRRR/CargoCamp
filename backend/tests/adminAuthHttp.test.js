const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const path = require("node:path");

const express = require("express");
const jwt = require("jsonwebtoken");

const TEST_SECRET =
    "cargocamp-admin-auth-http-test-only-secret";

const DAY = 24 * 60 * 60 * 1000;

function makeToken(
    payload = {},
    options = {}
) {
    return jwt.sign(
        {
            id: 1,
            role: "admin",
            scope: "admin",
            sid: "session-1",
            ...payload,
        },
        options.secret || TEST_SECRET,
        {
            expiresIn:
                options.expiresIn === undefined
                    ? "30m"
                    : options.expiresIn,

            ...(options.notBefore
                ? {
                    notBefore: options.notBefore,
                }
                : {}),
        }
    );
}

async function createServer() {
    // Полностью искусственные пользователи.
    const users = new Map([
        [
            1,
            {
                id: 1,
                role: "admin",
                phone: "+79990000001",
            },
        ],
        [
            2,
            {
                id: 2,
                role: "user",
                phone: "+79990000002",
            },
        ],
    ]);

    const sessions = new Map([
        [
            "session-1",
            {
                id: "session-1",
                scope: "admin",
                userId: 1,
                revokedAt: null,

                expiresAt: new Date(
                    Date.now() + 30 * DAY
                ),

                absoluteExpiresAt: new Date(
                    Date.now() + 90 * DAY
                ),
            },
        ],
        [
            "session-2",
            {
                id: "session-2",
                scope: "admin",
                userId: 2,
                revokedAt: null,

                expiresAt: new Date(
                    Date.now() + 30 * DAY
                ),

                absoluteExpiresAt: new Date(
                    Date.now() + 90 * DAY
                ),
            },
        ],
    ]);

    const User = {
        async findByPk(id) {
            return users.get(Number(id)) || null;
        },
    };

    const AuthSession = {
        async findByPk(id) {
            return sessions.get(String(id)) || null;
        },
    };

    /*
     * Загружаем настоящий adminAuth.js.
     *
     * Подменяем только модели и секрет JWT.
     * База данных не импортируется.
     */
    const filename = path.resolve(
        __dirname,
        "../middlewares/adminAuth.js"
    );

    const source = fs.readFileSync(
        filename,
        "utf8"
    );

    const isolatedModule = {
        exports: {},
    };

    const dependencies = {
        jsonwebtoken: {
            verify(token) {
                // Настоящая криптографическая
                // проверка подписи JWT.
                return jwt.verify(
                    token,
                    TEST_SECRET
                );
            },
        },

        "../models": {
            User,
            AuthSession,
        },
    };

    const isolatedRequire = (name) => {
        if (!Object.hasOwn(dependencies, name)) {
            throw new Error(
                `Запрещён незамокированный импорт: ${name}`
            );
        }

        return dependencies[name];
    };

    new Function(
        "require",
        "module",
        "exports",
        source
    )(
        isolatedRequire,
        isolatedModule,
        isolatedModule.exports
    );

    const {
        authMiddleware,
        adminMiddleware,
    } = isolatedModule.exports;

    const app = express();

    app.get(
        "/api/admin/protected",
        authMiddleware,
        adminMiddleware,
        (req, res) => {
            res.json({
                success: true,
                userId: req.user.id,
                role: req.user.role,
            });
        }
    );

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

    async function request(token) {
        const response = await fetch(
            `${baseURL}/api/admin/protected`,
            {
                headers: token
                    ? {
                        Authorization:
                            `Bearer ${token}`,
                    }
                    : {},
            }
        );

        return {
            status: response.status,
            body: await response.json(),
        };
    }

    return {
        request,

        setUser(id, changes) {
            users.set(Number(id), {
                ...users.get(Number(id)),
                ...changes,
            });
        },

        setSession(id, changes) {
            sessions.set(String(id), {
                ...sessions.get(String(id)),
                ...changes,
            });
        },

        removeSession(id) {
            sessions.delete(String(id));
        },

        async close() {
            await new Promise(
                (resolve, reject) => {
                    server.close((error) => {
                        if (error) {
                            reject(error);
                        } else {
                            resolve();
                        }
                    });

                    server.closeAllConnections?.();
                }
            );
        },
    };
}

async function withServer(callback) {
    const api = await createServer();

    try {
        await callback(api);
    } finally {
        await api.close();
    }
}

async function expectDenied(api, token, status = 401) {
    const response = await api.request(token);

    assert.equal(
        response.status,
        status
    );

    assert.notEqual(
        response.body.success,
        true
    );
}

// =====================================
// ДЕЙСТВИТЕЛЬНЫЙ ДОСТУП
// =====================================

test("Admin JWT: действующая сессия разрешает доступ", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            makeToken()
        );

        assert.equal(response.status, 200);

        assert.deepEqual(response.body, {
            success: true,
            userId: 1,
            role: "admin",
        });
    });
});

// =====================================
// ПРОВЕРКА JWT
// =====================================

test("Admin JWT: отсутствие токена запрещает доступ", async () => {
    await withServer(async (api) => {
        await expectDenied(api, null);
    });
});

test("Admin JWT: повреждённый токен запрещён", async () => {
    await withServer(async (api) => {
        await expectDenied(
            api,
            "not-a-valid-jwt"
        );
    });
});

test("Admin JWT: поддельная подпись запрещена", async () => {
    await withServer(async (api) => {
        const token = makeToken(
            {},
            {
                secret: "another-test-secret",
            }
        );

        await expectDenied(api, token);
    });
});

test("Admin JWT: истёкший токен запрещён", async () => {
    await withServer(async (api) => {
        const token = makeToken(
            {},
            {
                expiresIn: -10,
            }
        );

        await expectDenied(api, token);
    });
});

test("Admin JWT: токен до начала действия запрещён", async () => {
    await withServer(async (api) => {
        const token = makeToken(
            {},
            {
                notBefore: "1h",
            }
        );

        await expectDenied(api, token);
    });
});

// =====================================
// ТИП АДМИНИСТРАТИВНОЙ СЕССИИ
// =====================================

test("Admin JWT: старый токен без scope и sid запрещён", async () => {
    await withServer(async (api) => {
        const token = jwt.sign(
            {
                id: 1,
                role: "admin",
            },
            TEST_SECRET,
            {
                expiresIn: "30m",
            }
        );

        await expectDenied(api, token);
    });
});

test("Admin JWT: scope admin без sid запрещён", async () => {
    await withServer(async (api) => {
        const token = makeToken({
            sid: undefined,
        });

        await expectDenied(api, token);
    });
});

test("Admin JWT: sid без scope запрещён", async () => {
    await withServer(async (api) => {
        const token = makeToken({
            scope: undefined,
        });

        await expectDenied(api, token);
    });
});

test("Admin JWT: пользовательская сессия не подходит для админки", async () => {
    await withServer(async (api) => {
        const token = makeToken({
            scope: "user",
        });

        await expectDenied(api, token);
    });
});

// =====================================
// ПРОВЕРКА AUTHSESSION
// =====================================

test("Admin JWT: несуществующая сессия запрещена", async () => {
    await withServer(async (api) => {
        api.removeSession("session-1");

        await expectDenied(
            api,
            makeToken()
        );
    });
});

test("Admin JWT: сессия другого пользователя запрещена", async () => {
    await withServer(async (api) => {
        api.setSession("session-1", {
            userId: 2,
        });

        await expectDenied(
            api,
            makeToken()
        );
    });
});

test("Admin JWT: неправильный scope записи сессии запрещён", async () => {
    await withServer(async (api) => {
        api.setSession("session-1", {
            scope: "user",
        });

        await expectDenied(
            api,
            makeToken()
        );
    });
});

test("Admin JWT: отозванная сессия запрещена", async () => {
    await withServer(async (api) => {
        api.setSession("session-1", {
            revokedAt: new Date(),
        });

        await expectDenied(
            api,
            makeToken()
        );
    });
});

test("Admin JWT: истёкшая неактивная сессия запрещена", async () => {
    await withServer(async (api) => {
        api.setSession("session-1", {
            expiresAt: new Date(
                Date.now() - 60_000
            ),
        });

        await expectDenied(
            api,
            makeToken()
        );
    });
});

test("Admin JWT: абсолютный срок сессии соблюдается", async () => {
    await withServer(async (api) => {
        api.setSession("session-1", {
            absoluteExpiresAt: new Date(
                Date.now() - 60_000
            ),
        });

        await expectDenied(
            api,
            makeToken()
        );
    });
});

test("Admin JWT: некорректные даты сессии запрещены", async () => {
    await withServer(async (api) => {
        api.setSession("session-1", {
            expiresAt: "invalid-date",
        });

        await expectDenied(
            api,
            makeToken()
        );
    });
});

// =====================================
// ПРОВЕРКА ПОЛЬЗОВАТЕЛЯ И РОЛИ
// =====================================

test("Admin JWT: неизвестный пользователь запрещён", async () => {
    await withServer(async (api) => {
        const token = makeToken({
            id: 999,
        });

        await expectDenied(api, token);
    });
});

test("Admin JWT: роль из JWT не заменяет роль в базе", async () => {
    await withServer(async (api) => {
        const token = makeToken({
            id: 2,
            sid: "session-2",
            role: "admin",
        });

        await expectDenied(
            api,
            token,
            403
        );
    });
});

// =====================================
// ОТЗЫВ ДОСТУПА ПОСЛЕ ВХОДА
// =====================================

test("Admin JWT: снятие роли немедленно закрывает доступ", async () => {
    await withServer(async (api) => {
        const token = makeToken();

        const before = await api.request(
            token
        );

        assert.equal(before.status, 200);

        api.setUser(1, {
            role: "user",
        });

        await expectDenied(
            api,
            token,
            403
        );
    });
});

test("Admin JWT: отзыв сессии немедленно закрывает доступ", async () => {
    await withServer(async (api) => {
        const token = makeToken();

        const before = await api.request(
            token
        );

        assert.equal(before.status, 200);

        api.setSession("session-1", {
            revokedAt: new Date(),
        });

        await expectDenied(
            api,
            token
        );
    });
});