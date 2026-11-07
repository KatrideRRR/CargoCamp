const test = require("node:test");
const assert = require("node:assert/strict");

const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");

const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

const TEST_SECRET =
    "cargocamp-auth-session-tests-only";

const DAY = 24 * 60 * 60 * 1000;

function hash(token) {
    return crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
}

function createEnvironment({
                               failCreate = false,
                               failRotation = false,
                           } = {}) {
    const users = new Map([
        [
            1,
            {
                id: 1,
                phone: "+79990000001",
                role: "admin",
            },
        ],
        [
            2,
            {
                id: 2,
                phone: "+79990000002",
                role: "user",
            },
        ],
        [
            3,
            {
                id: 3,
                phone: "+79990000003",
                role: "banned",
            },
        ],
    ]);

    const sessions = new Map();

    const metrics = {
        created: 0,
        rotated: 0,
        revoked: 0,
        transactions: 0,
        locks: 0,
    };

    let nextId = 1;

    /*
     * Искусственные транзакции выполняются
     * последовательно.
     *
     * Это имитация сериализованного доступа,
     * а не настоящая MySQL.
     */
    let transactionQueue = Promise.resolve();

    const sequelize = {
        async transaction(callback) {
            const previous = transactionQueue;

            let unlock;

            transactionQueue = new Promise(
                (resolve) => {
                    unlock = resolve;
                }
            );

            await previous;

            metrics.transactions++;

            const transaction = {
                LOCK: {
                    UPDATE: "UPDATE",
                },
            };

            try {
                return await callback(transaction);
            } finally {
                unlock();
            }
        },
    };

    const AuthSession = {
        async create(values) {
            if (failCreate) {
                throw new Error(
                    "TEST_SESSION_CREATE_FAILED"
                );
            }

            const session = {
                id: `test-session-${nextId++}`,
                ...values,
                revokedAt: null,

                async update(changes, options) {
                    assert.ok(
                        options?.transaction,
                        "Ротация должна выполняться в транзакции"
                    );

                    if (failRotation) {
                        throw new Error(
                            "TEST_SESSION_ROTATION_FAILED"
                        );
                    }

                    Object.assign(this, changes);
                    metrics.rotated++;

                    return this;
                },
            };

            sessions.set(session.id, session);
            metrics.created++;

            return session;
        },

        async findOne({
                          where,
                          transaction,
                          lock,
                      }) {
            assert.ok(transaction);

            assert.equal(
                lock,
                transaction.LOCK.UPDATE,
                "Для refresh требуется блокировка записи"
            );

            metrics.locks++;

            return (
                [...sessions.values()].find(
                    (session) =>
                        session.tokenHash ===
                        where.tokenHash &&
                        session.scope === where.scope
                ) || null
            );
        },

        async update(changes, { where }) {
            let count = 0;

            for (const session of sessions.values()) {
                if (
                    session.tokenHash !==
                    where.tokenHash ||
                    session.scope !== where.scope ||
                    session.revokedAt !== null
                ) {
                    continue;
                }

                Object.assign(session, changes);
                count++;
            }

            metrics.revoked += count;

            return [count];
        },
    };

    const User = {
        async findByPk(id) {
            return users.get(Number(id)) || null;
        },
    };

    /*
     * Реальный код authSessionService.js.
     *
     * JWT подписывается настоящим jsonwebtoken,
     * но используется только тестовый секрет.
     *
     * process.env и реальные модели не нужны.
     */
    const service = loadIsolatedService(
        "authSessionService.js",
        {
            crypto,

            jsonwebtoken: {
                sign(payload, ignoredSecret, options) {
                    return jwt.sign(
                        payload,
                        TEST_SECRET,
                        options
                    );
                },
            },

            "../models": {
                sequelize,
                User,
                AuthSession,
            },
        }
    );

    return {
        service,
        users,
        sessions,
        metrics,

        async createAdmin() {
            return service.createAuthSession(
                users.get(1),
                "admin"
            );
        },

        async createUser() {
            return service.createAuthSession(
                users.get(2),
                "user"
            );
        },

        getSession(id = "test-session-1") {
            return sessions.get(id);
        },

        setSession(changes, id = "test-session-1") {
            const session = sessions.get(id);

            assert.ok(session);

            Object.assign(session, changes);
        },

        setUser(id, changes) {
            const user = users.get(id);

            assert.ok(user);

            users.set(id, {
                ...user,
                ...changes,
            });
        },
    };
}

async function expectSessionError(
    action,
    expectedStatus
) {
    await assert.rejects(
        action,
        (error) => {
            assert.equal(
                error.status,
                expectedStatus
            );

            return true;
        }
    );
}

function expectTimeBetween(
    value,
    minimum,
    maximum
) {
    const actual = new Date(value).getTime();

    assert.ok(
        actual >= minimum,
        `Дата ${actual} меньше ${minimum}`
    );

    assert.ok(
        actual <= maximum,
        `Дата ${actual} больше ${maximum}`
    );
}

// ===========================================
// СОЗДАНИЕ СЕССИЙ
// ===========================================

test("создание admin-сессии сохраняет SHA-256 вместо refresh-токена", async () => {
    const env = createEnvironment();

    const result = await env.createAdmin();
    const session = env.getSession();

    assert.match(
        result.refreshToken,
        /^[a-f0-9]{96}$/
    );

    assert.equal(
        session.tokenHash,
        hash(result.refreshToken)
    );

    assert.notEqual(
        session.tokenHash,
        result.refreshToken
    );

    assert.equal(
        session.tokenHash.length,
        64
    );

    assert.equal(env.metrics.created, 1);
});

test("admin-сессия имеет сроки 30 и 90 дней", async () => {
    const env = createEnvironment();

    const before = Date.now();

    await env.createAdmin();

    const after = Date.now();
    const session = env.getSession();

    expectTimeBetween(
        session.expiresAt,
        before + 30 * DAY,
        after + 30 * DAY
    );

    expectTimeBetween(
        session.absoluteExpiresAt,
        before + 90 * DAY,
        after + 90 * DAY
    );

    assert.equal(session.scope, "admin");
});

test("user-сессия имеет сроки 90 и 180 дней", async () => {
    const env = createEnvironment();

    const before = Date.now();

    await env.createUser();

    const after = Date.now();
    const session = env.getSession();

    expectTimeBetween(
        session.expiresAt,
        before + 90 * DAY,
        after + 90 * DAY
    );

    expectTimeBetween(
        session.absoluteExpiresAt,
        before + 180 * DAY,
        after + 180 * DAY
    );

    assert.equal(session.scope, "user");
});

test("созданный access JWT содержит правильные данные сессии", async () => {
    const env = createEnvironment();

    const result = await env.createAdmin();

    const decoded = jwt.verify(
        result.token,
        TEST_SECRET
    );

    assert.equal(decoded.id, 1);
    assert.equal(decoded.role, "admin");
    assert.equal(decoded.scope, "admin");
    assert.equal(
        decoded.sid,
        "test-session-1"
    );

    assert.equal(
        decoded.exp - decoded.iat,
        30 * 60
    );
});

test("каждая новая сессия получает отдельный refresh-токен", async () => {
    const env = createEnvironment();

    const first = await env.createAdmin();
    const second = await env.createAdmin();

    assert.notEqual(
        first.refreshToken,
        second.refreshToken
    );

    assert.equal(env.metrics.created, 2);
    assert.equal(env.sessions.size, 2);
});

test("неизвестный тип сессии запрещён", async () => {
    const env = createEnvironment();

    await assert.rejects(
        () => env.service.createAuthSession(
            env.users.get(1),
            "superadmin"
        ),
        /Неизвестный тип сессии/
    );

    assert.equal(env.metrics.created, 0);
});

test("обычный пользователь не может создать admin-сессию", async () => {
    const env = createEnvironment();

    await expectSessionError(
        () => env.service.createAuthSession(
            env.users.get(2),
            "admin"
        ),
        403
    );

    assert.equal(env.metrics.created, 0);
});

test("заблокированный пользователь не может создавать сессии", async () => {
    const env = createEnvironment();

    for (const scope of ["admin", "user"]) {
        await expectSessionError(
            () => env.service.createAuthSession(
                env.users.get(3),
                scope
            ),
            403
        );
    }

    assert.equal(env.metrics.created, 0);
});

// ===========================================
// ОБНОВЛЕНИЕ И РОТАЦИЯ
// ===========================================

test("refresh выдаёт новый токен и заменяет старый хеш", async () => {
    const env = createEnvironment();

    const original = await env.createAdmin();

    const oldHash =
        env.getSession().tokenHash;

    const refreshed =
        await env.service.refreshAuthSession(
            original.refreshToken,
            "admin"
        );

    assert.notEqual(
        refreshed.refreshToken,
        original.refreshToken
    );

    assert.notEqual(
        env.getSession().tokenHash,
        oldHash
    );

    assert.equal(
        env.getSession().tokenHash,
        hash(refreshed.refreshToken)
    );

    assert.equal(env.metrics.rotated, 1);
    assert.equal(env.metrics.transactions, 1);
    assert.equal(env.metrics.locks, 1);

    const decoded = jwt.verify(
        refreshed.token,
        TEST_SECRET
    );

    assert.equal(decoded.scope, "admin");
    assert.equal(
        decoded.sid,
        "test-session-1"
    );

    assert.ok(
        env.getSession().lastUsedAt instanceof Date
    );
});

test("старый refresh-токен становится недействительным", async () => {
    const env = createEnvironment();

    const original = await env.createAdmin();

    const next =
        await env.service.refreshAuthSession(
            original.refreshToken,
            "admin"
        );

    await expectSessionError(
        () => env.service.refreshAuthSession(
            original.refreshToken,
            "admin"
        ),
        401
    );

    assert.equal(
        env.getSession().tokenHash,
        hash(next.refreshToken)
    );
});

test("последовательные обновления создают разные refresh-токены", async () => {
    const env = createEnvironment();

    const first = await env.createAdmin();

    const second =
        await env.service.refreshAuthSession(
            first.refreshToken,
            "admin"
        );

    const third =
        await env.service.refreshAuthSession(
            second.refreshToken,
            "admin"
        );

    assert.notEqual(
        first.refreshToken,
        second.refreshToken
    );

    assert.notEqual(
        second.refreshToken,
        third.refreshToken
    );

    assert.equal(env.metrics.rotated, 2);
});

test("пустой refresh-токен запрещён", async () => {
    const env = createEnvironment();

    await expectSessionError(
        () => env.service.refreshAuthSession(
            null,
            "admin"
        ),
        401
    );

    assert.equal(env.metrics.transactions, 0);
});

test("неизвестный scope при refresh запрещён", async () => {
    const env = createEnvironment();

    const issued = await env.createAdmin();

    await expectSessionError(
        () => env.service.refreshAuthSession(
            issued.refreshToken,
            "unknown"
        ),
        401
    );
});

test("несуществующий refresh-токен запрещён", async () => {
    const env = createEnvironment();

    await env.createAdmin();

    await expectSessionError(
        () => env.service.refreshAuthSession(
            "incorrect-test-refresh-token",
            "admin"
        ),
        401
    );

    assert.equal(env.metrics.rotated, 0);
});

test("refresh-токен другого scope не подходит", async () => {
    const env = createEnvironment();

    const issued = await env.createAdmin();

    await expectSessionError(
        () => env.service.refreshAuthSession(
            issued.refreshToken,
            "user"
        ),
        401
    );

    assert.equal(env.metrics.rotated, 0);
});

// ===========================================
// ИСТЕЧЕНИЕ И ОТЗЫВ
// ===========================================

test("отозванную сессию нельзя обновить", async () => {
    const env = createEnvironment();

    const issued = await env.createAdmin();

    env.setSession({
        revokedAt: new Date(),
    });

    await expectSessionError(
        () => env.service.refreshAuthSession(
            issued.refreshToken,
            "admin"
        ),
        401
    );

    assert.equal(env.metrics.rotated, 0);
});

test("истёкшую по неактивности сессию нельзя обновить", async () => {
    const env = createEnvironment();

    const issued = await env.createAdmin();

    env.setSession({
        expiresAt: new Date(
            Date.now() - DAY
        ),
    });

    await expectSessionError(
        () => env.service.refreshAuthSession(
            issued.refreshToken,
            "admin"
        ),
        401
    );
});

test("сессия после абсолютного срока не обновляется", async () => {
    const env = createEnvironment();

    const issued = await env.createAdmin();

    env.setSession({
        absoluteExpiresAt: new Date(
            Date.now() - DAY
        ),
    });

    await expectSessionError(
        () => env.service.refreshAuthSession(
            issued.refreshToken,
            "admin"
        ),
        401
    );
});

test("повреждённые даты сессии не принимаются", async () => {
    for (const field of [
        "expiresAt",
        "absoluteExpiresAt",
    ]) {
        const env = createEnvironment();

        const issued = await env.createAdmin();

        env.setSession({
            [field]: new Date("invalid-date"),
        });

        await expectSessionError(
            () => env.service.refreshAuthSession(
                issued.refreshToken,
                "admin"
            ),
            401
        );

        assert.equal(env.metrics.rotated, 0);
    }
});

test("удалённый пользователь не может обновить сессию", async () => {
    const env = createEnvironment();

    const issued = await env.createAdmin();

    env.users.delete(1);

    await expectSessionError(
        () => env.service.refreshAuthSession(
            issued.refreshToken,
            "admin"
        ),
        403
    );

    assert.equal(env.metrics.rotated, 0);
});

test("снятие административной роли запрещает refresh", async () => {
    const env = createEnvironment();

    const issued = await env.createAdmin();

    env.setUser(1, {
        role: "user",
    });

    await expectSessionError(
        () => env.service.refreshAuthSession(
            issued.refreshToken,
            "admin"
        ),
        403
    );

    assert.equal(env.metrics.rotated, 0);
});

test("блокировка пользователя запрещает refresh", async () => {
    const env = createEnvironment();

    const issued = await env.createUser();

    env.setUser(2, {
        role: "banned",
    });

    await expectSessionError(
        () => env.service.refreshAuthSession(
            issued.refreshToken,
            "user"
        ),
        403
    );

    assert.equal(env.metrics.rotated, 0);
});

test("обычная пользовательская сессия обновляется", async () => {
    const env = createEnvironment();

    const issued = await env.createUser();

    const next =
        await env.service.refreshAuthSession(
            issued.refreshToken,
            "user"
        );

    const decoded = jwt.verify(
        next.token,
        TEST_SECRET
    );

    assert.equal(decoded.id, 2);
    assert.equal(decoded.role, "user");
    assert.equal(decoded.scope, "user");

    assert.equal(env.metrics.rotated, 1);
});

test("продление не превышает абсолютный срок сессии", async () => {
    const env = createEnvironment();

    const issued = await env.createAdmin();

    const absoluteLimit = new Date(
        Date.now() + 2 * DAY
    );

    env.setSession({
        absoluteExpiresAt: absoluteLimit,
    });

    const refreshed =
        await env.service.refreshAuthSession(
            issued.refreshToken,
            "admin"
        );

    assert.equal(
        new Date(refreshed.expiresAt).getTime(),
        absoluteLimit.getTime()
    );

    assert.equal(
        env.getSession().expiresAt.getTime(),
        absoluteLimit.getTime()
    );
});

// ===========================================
// LOGOUT
// ===========================================

test("logout отзывает refresh-токен", async () => {
    const env = createEnvironment();

    const issued = await env.createAdmin();

    await env.service.revokeAuthSession(
        issued.refreshToken,
        "admin"
    );

    assert.ok(
        env.getSession().revokedAt instanceof Date
    );

    assert.equal(env.metrics.revoked, 1);

    await expectSessionError(
        () => env.service.refreshAuthSession(
            issued.refreshToken,
            "admin"
        ),
        401
    );
});

test("отзыв старого refresh-токена не отзывает новый", async () => {
    const env = createEnvironment();

    const issued = await env.createAdmin();

    const refreshed =
        await env.service.refreshAuthSession(
            issued.refreshToken,
            "admin"
        );

    await env.service.revokeAuthSession(
        issued.refreshToken,
        "admin"
    );

    assert.equal(
        env.getSession().revokedAt,
        null
    );

    assert.equal(env.metrics.revoked, 0);

    const next =
        await env.service.refreshAuthSession(
            refreshed.refreshToken,
            "admin"
        );

    assert.ok(next.token);
});

test("logout без refresh-токена ничего не изменяет", async () => {
    const env = createEnvironment();

    await env.createAdmin();

    await env.service.revokeAuthSession(
        null,
        "admin"
    );

    assert.equal(env.metrics.revoked, 0);
    assert.equal(env.getSession().revokedAt, null);
});

// ===========================================
// ОДНОВРЕМЕННЫЕ ЗАПРОСЫ
// ===========================================

test("два конкурентных refresh не могут оба использовать старый токен", async () => {
    const env = createEnvironment();

    const issued = await env.createAdmin();

    const results = await Promise.allSettled([
        env.service.refreshAuthSession(
            issued.refreshToken,
            "admin"
        ),

        env.service.refreshAuthSession(
            issued.refreshToken,
            "admin"
        ),
    ]);

    const successful = results.filter(
        (result) =>
            result.status === "fulfilled"
    );

    const rejected = results.filter(
        (result) =>
            result.status === "rejected"
    );

    assert.equal(successful.length, 1);
    assert.equal(rejected.length, 1);

    assert.equal(
        rejected[0].reason.status,
        401
    );

    assert.equal(env.metrics.rotated, 1);
    assert.equal(env.metrics.transactions, 2);

    assert.equal(
        env.getSession().tokenHash,
        hash(successful[0].value.refreshToken)
    );
});

// ===========================================
// ОШИБКИ ХРАНИЛИЩА
// ===========================================

test("ошибка ротации не заменяет действующий refresh-токен", async () => {
    const env = createEnvironment({
        failRotation: true,
    });

    const issued = await env.createAdmin();

    const originalHash =
        env.getSession().tokenHash;

    await assert.rejects(
        () => env.service.refreshAuthSession(
            issued.refreshToken,
            "admin"
        ),
        /TEST_SESSION_ROTATION_FAILED/
    );

    assert.equal(
        env.getSession().tokenHash,
        originalHash
    );

    assert.equal(env.metrics.rotated, 0);
});

test("ошибка создания записи не выдаёт сессию", async () => {
    const env = createEnvironment({
        failCreate: true,
    });

    await assert.rejects(
        () => env.createAdmin(),
        /TEST_SESSION_CREATE_FAILED/
    );

    assert.equal(env.metrics.created, 0);
    assert.equal(env.sessions.size, 0);
});