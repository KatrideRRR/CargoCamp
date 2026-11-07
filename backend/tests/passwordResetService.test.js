const test = require("node:test");
const assert = require("node:assert/strict");

const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

const PHONE = "79990000001";

function createEnvironment({
                               userExists = true,
                               failHash = false,
                               failPasswordUpdate = false,
                               failSessionUpdate = false,
                           } = {}) {
    const user = {
        id: 101,
        phone: PHONE,
        password: "old-password",
    };

    const sessions = [
        {
            id: 1,
            userId: 101,
            scope: "user",
            revokedAt: null,
        },
        {
            id: 2,
            userId: 101,
            scope: "admin",
            revokedAt: null,
        },
        {
            id: 3,
            userId: 999,
            scope: "user",
            revokedAt: null,
        },
    ];

    const calls = {
        transactions: 0,
        passwordUpdates: 0,
        sessionUpdates: 0,
        hashes: 0,
    };

    const transactionToken = {
        LOCK: {
            UPDATE: "UPDATE",
        },
    };

    const sequelize = {
        async transaction(callback) {
            calls.transactions++;

            // Снимок искусственной базы для
            // проверки отката транзакции.
            const originalPassword =
                user.password;

            const originalSessions =
                sessions.map((session) => ({
                    ...session,
                }));

            try {
                return await callback(
                    transactionToken
                );
            } catch (error) {
                user.password =
                    originalPassword;

                sessions.splice(
                    0,
                    sessions.length,
                    ...originalSessions
                );

                throw error;
            }
        },
    };

    const User = {
        async findOne({
                          where,
                          transaction,
                          lock,
                      }) {
            assert.equal(
                transaction,
                transactionToken
            );

            assert.equal(
                lock,
                transactionToken.LOCK.UPDATE
            );

            if (
                !userExists ||
                where.phone !== PHONE
            ) {
                return null;
            }

            return {
                id: user.id,

                async update(values, options) {
                    assert.equal(
                        options.transaction,
                        transactionToken
                    );

                    if (failPasswordUpdate) {
                        throw new Error(
                            "TEST_PASSWORD_UPDATE_FAILED"
                        );
                    }

                    user.password =
                        values.password;

                    calls.passwordUpdates++;
                },
            };
        },
    };

    const AuthSession = {
        async update(values, options) {
            assert.equal(
                options.transaction,
                transactionToken
            );

            assert.deepEqual(
                options.where,
                {
                    userId: 101,
                    revokedAt: null,
                }
            );

            if (failSessionUpdate) {
                throw new Error(
                    "TEST_SESSION_UPDATE_FAILED"
                );
            }

            for (const session of sessions) {
                if (
                    session.userId === 101 &&
                    session.revokedAt === null
                ) {
                    session.revokedAt =
                        values.revokedAt;
                }
            }

            calls.sessionUpdates++;
        },
    };

    const service = loadIsolatedService(
        "passwordResetService.js",
        {
            bcrypt: {
                async hash(password, rounds) {
                    calls.hashes++;

                    assert.equal(rounds, 10);

                    if (failHash) {
                        throw new Error(
                            "TEST_HASH_FAILED"
                        );
                    }

                    return `hashed:${password}`;
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
        user,
        sessions,
        calls,
    };
}

test(
    "Password reset: меняет пароль и отзывает все сессии пользователя",
    async () => {
        const env = createEnvironment();

        const result =
            await env.service
                .resetPasswordAndRevokeSessions({
                    phone: PHONE,
                    newPassword: "new-password-123",
                });

        assert.equal(
            result.userId,
            101
        );

        assert.equal(
            env.user.password,
            "hashed:new-password-123"
        );

        assert.ok(
            env.sessions[0].revokedAt instanceof Date
        );

        assert.ok(
            env.sessions[1].revokedAt instanceof Date
        );

        // Сессии другого пользователя
        // нельзя затрагивать.
        assert.equal(
            env.sessions[2].revokedAt,
            null
        );

        assert.equal(
            env.calls.transactions,
            1
        );

        assert.equal(
            env.calls.passwordUpdates,
            1
        );

        assert.equal(
            env.calls.sessionUpdates,
            1
        );
    }
);

test(
    "Password reset: неизвестный пользователь не меняет данные",
    async () => {
        const env = createEnvironment({
            userExists: false,
        });

        await assert.rejects(
            () =>
                env.service
                    .resetPasswordAndRevokeSessions({
                        phone: PHONE,
                        newPassword: "new-password-123",
                    }),
            (error) => {
                assert.equal(
                    error.status,
                    404
                );

                return true;
            }
        );

        assert.equal(
            env.user.password,
            "old-password"
        );

        assert.equal(
            env.calls.sessionUpdates,
            0
        );
    }
);

test(
    "Password reset: ошибка хеширования не открывает транзакцию",
    async () => {
        const env = createEnvironment({
            failHash: true,
        });

        await assert.rejects(
            () =>
                env.service
                    .resetPasswordAndRevokeSessions({
                        phone: PHONE,
                        newPassword: "new-password-123",
                    }),
            /TEST_HASH_FAILED/
        );

        assert.equal(
            env.calls.transactions,
            0
        );

        assert.equal(
            env.user.password,
            "old-password"
        );
    }
);

test(
    "Password reset: ошибка записи пароля не отзывает сессии",
    async () => {
        const env = createEnvironment({
            failPasswordUpdate: true,
        });

        await assert.rejects(
            () =>
                env.service
                    .resetPasswordAndRevokeSessions({
                        phone: PHONE,
                        newPassword: "new-password-123",
                    }),
            /TEST_PASSWORD_UPDATE_FAILED/
        );

        assert.equal(
            env.user.password,
            "old-password"
        );

        assert.equal(
            env.sessions[0].revokedAt,
            null
        );
    }
);

test(
    "Password reset: ошибка отзыва сессий откатывает пароль",
    async () => {
        const env = createEnvironment({
            failSessionUpdate: true,
        });

        await assert.rejects(
            () =>
                env.service
                    .resetPasswordAndRevokeSessions({
                        phone: PHONE,
                        newPassword: "new-password-123",
                    }),
            /TEST_SESSION_UPDATE_FAILED/
        );

        // Проверяем откат искусственной
        // транзакции.
        assert.equal(
            env.user.password,
            "old-password"
        );

        assert.equal(
            env.sessions[0].revokedAt,
            null
        );

        assert.equal(
            env.sessions[1].revokedAt,
            null
        );
    }
);