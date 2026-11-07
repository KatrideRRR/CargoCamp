const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const multer = require("multer");
const path = require("node:path");
const crypto = require("node:crypto");

const {
    loadIsolatedRouter,
} = require("./helpers/loadIsolatedRouter");

const {
    getSessionClient,
    getUserRefreshToken,
    buildUserSessionResponse,
    clearUserRefreshCookie,
} = require("../utils/userSessionTransport");

const PHONE = "79990000001";
const NEW_PHONE = "79990000002";

async function createHarness() {
    // Только для текущего тестового процесса.
    // Реальный SMS-ключ не используется.
    const originalSmsKey = process.env.SMS_RU_API_ID;
    process.env.SMS_RU_API_ID = "CARGOCAMP_TEST_ONLY";

    const users = new Map();

    const existingUser = {
        id: 1,
        username: "Test user",
        phone: PHONE,
        password: "original-password",
        role: "user",

        async update(values) {
            Object.assign(this, values);
        },
    };

    users.set(PHONE, existingUser);

    const smsRequests = [];
    const sessionRequests = [];
    const passwordResets = [];

    let captchaRequests = 0;
    let nextUserId = 2;

    const User = {
        async findOne({ where }) {
            return users.get(where.phone) || null;
        },

        async create(values) {
            const user = {
                id: nextUserId++,
                role: "user",
                ...values,
            };

            users.set(user.phone, user);
            return user;
        },
    };

    const fakeAxios = {
        async post(url) {
            if (
                url !==
                "https://www.google.com/recaptcha/api/siteverify"
            ) {
                throw new Error(
                    "Незапланированный внешний запрос"
                );
            }

            captchaRequests++;

            return {
                data: {
                    success: true,
                },
            };
        },

        async get(url, options) {
            if (url !== "https://sms.ru/sms/send") {
                throw new Error(
                    "Незапланированный внешний запрос"
                );
            }

            const message = String(
                options?.params?.msg || ""
            );

            const code = message.match(/\b\d{6}\b/)?.[0];

            assert.ok(code, "SMS должна содержать код");

            smsRequests.push({
                phone: options.params.to,
                code,
            });

            // Искусственный ответ SMS.ru.
            return {
                data: {
                    status: "OK",
                },
            };
        },
    };

    const router = loadIsolatedRouter(
        "auth.js",
        {
            dotenv: {
                config: () => ({}),
            },

            express,

            bcrypt: {
                hash: async (value) =>
                    `hashed:${value}`,

                compare: async (value, stored) =>
                    stored === value ||
                    stored === `hashed:${value}`,
            },

            jsonwebtoken: {
                sign: () => "test-jwt",
            },

            "../models": {
                User,
                OrderReview: {},
                Order: {},
                Category: {},
                ExpressOrder: {},
            },

            "../middlewares/userAuth": (
                req,
                res
            ) => res.sendStatus(401),

            multer,
            path,

            axios: fakeAxios,

            fs: {
                existsSync: () => true,

                mkdirSync: () => {
                    throw new Error(
                        "Запись файлов запрещена"
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

            "../services/authSessionService": {
                async createAuthSession(user, scope) {
                    sessionRequests.push({
                        userId: user.id,
                        scope,
                    });

                    return {
                        token: "test-access-token",
                        refreshToken: crypto
                            .randomBytes(48)
                            .toString("hex"),
                        expiresAt: new Date(
                            Date.now() + 86400000
                        ),
                    };
                },

                refreshAuthSession: async () => {
                    throw new Error(
                        "Refresh не используется в этом тесте"
                    );
                },

                revokeAuthSession: async () => {},
            },

            "../services/passwordResetService": {
                async resetPasswordAndRevokeSessions({
                                                         phone,
                                                         newPassword,
                                                     }) {
                    const user = users.get(phone);

                    if (!user) {
                        const error = new Error(
                            "Пользователь не найден"
                        );

                        error.status = 404;

                        throw error;
                    }

                    passwordResets.push({
                        phone,
                        newPassword,
                    });

                    await user.update({
                        password: `hashed:${newPassword}`,
                    });
                },
            },

            "../utils/userSessionTransport": {
                getSessionClient,
                getUserRefreshToken,
                buildUserSessionResponse,
                clearUserRefreshCookie,
            },

            crypto,

            "../config/storagePaths": {
                uploadsRoot: "/isolated-test-no-files",
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

    async function request(endpoint, body = {}) {
        const response = await fetch(
            baseURL + endpoint,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
            }
        );

        return {
            status: response.status,
            body: await response.json(),
        };
    }

    async function sendSms(
        purpose,
        phone = PHONE
    ) {
        return request("/api/auth/send-sms", {
            phone,
            purpose,
            captchaToken: "test-captcha",
        });
    }

    function lastCode() {
        return smsRequests.at(-1)?.code;
    }

    return {
        request,
        sendSms,
        lastCode,
        users,
        smsRequests,
        sessionRequests,
        passwordResets,

        get captchaRequests() {
            return captchaRequests;
        },

        async close() {
            try {
                await new Promise((resolve, reject) => {
                    server.close((error) =>
                        error ? reject(error) : resolve()
                    );

                    server.closeAllConnections?.();
                });
            } finally {
                if (originalSmsKey === undefined) {
                    delete process.env.SMS_RU_API_ID;
                } else {
                    process.env.SMS_RU_API_ID = originalSmsKey;
                }
            }
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

test("SMS: неизвестное назначение запрещено", async () => {
    await withHarness(async (api) => {
        const result = await api.sendSms("unknown");

        assert.equal(result.status, 400);
        assert.equal(api.smsRequests.length, 0);
    });
});

test("SMS: код входа нельзя использовать для смены пароля", async () => {
    await withHarness(async (api) => {
        const sent = await api.sendSms("login");

        assert.equal(sent.status, 200);

        const reset = await api.request(
            "/api/auth/password-reset/confirm",
            {
                phone: PHONE,
                smsCode: api.lastCode(),
                newPassword: "new-password-123",
            }
        );

        assert.equal(reset.status, 400);

        assert.equal(
            api.users.get(PHONE).password,
            "original-password"
        );

        // Для правильного назначения код остаётся действительным.
        const login = await api.request(
            "/api/auth/login-sms",
            {
                phone: PHONE,
                smsCode: api.lastCode(),
            }
        );

        assert.equal(login.status, 200);
    });
});

test("SMS: код восстановления нельзя использовать для входа", async () => {
    await withHarness(async (api) => {
        const sent = await api.sendSms(
            "password_reset"
        );

        assert.equal(sent.status, 200);

        const login = await api.request(
            "/api/auth/login-sms",
            {
                phone: PHONE,
                smsCode: api.lastCode(),
            }
        );

        assert.equal(login.status, 401);

        assert.equal(
            api.sessionRequests.length,
            0
        );
    });
});

test("SMS: после пяти неверных попыток входа код блокируется", async () => {
    await withHarness(async (api) => {
        await api.sendSms("login");

        const correctCode = api.lastCode();

        const wrongCode =
            correctCode === "000000"
                ? "111111"
                : "000000";

        for (let i = 0; i < 5; i++) {
            const response = await api.request(
                "/api/auth/login-sms",
                {
                    phone: PHONE,
                    smsCode: wrongCode,
                }
            );

            assert.equal(response.status, 401);
        }

        const response = await api.request(
            "/api/auth/login-sms",
            {
                phone: PHONE,
                smsCode: correctCode,
            }
        );

        assert.equal(response.status, 401);
    });
});

test("SMS: после пяти неверных попыток сброса код блокируется", async () => {
    await withHarness(async (api) => {
        await api.sendSms("password_reset");

        const correctCode = api.lastCode();

        const wrongCode =
            correctCode === "000000"
                ? "111111"
                : "000000";

        for (let i = 0; i < 5; i++) {
            const response = await api.request(
                "/api/auth/password-reset/confirm",
                {
                    phone: PHONE,
                    smsCode: wrongCode,
                    newPassword: "new-password-123",
                }
            );

            assert.equal(response.status, 400);
        }

        const response = await api.request(
            "/api/auth/password-reset/confirm",
            {
                phone: PHONE,
                smsCode: correctCode,
                newPassword: "new-password-123",
            }
        );

        assert.equal(response.status, 400);

        assert.equal(
            api.users.get(PHONE).password,
            "original-password"
        );
    });
});

test("SMS: правильное восстановление меняет пароль один раз", async () => {
    await withHarness(async (api) => {
        await api.sendSms("password_reset");

        const code = api.lastCode();

        const first = await api.request(
            "/api/auth/password-reset/confirm",
            {
                phone: PHONE,
                smsCode: code,
                newPassword: "new-password-123",
            }
        );

        assert.equal(first.status, 200);

        assert.equal(
            api.users.get(PHONE).password,
            "hashed:new-password-123"
        );

        const repeated = await api.request(
            "/api/auth/password-reset/confirm",
            {
                phone: PHONE,
                smsCode: code,
                newPassword: "another-password",
            }
        );

        assert.equal(repeated.status, 400);

        assert.equal(
            api.users.get(PHONE).password,
            "hashed:new-password-123"
        );
    });
});

test("SMS: успешный вход нельзя повторить с тем же кодом", async () => {
    await withHarness(async (api) => {
        await api.sendSms("login");

        const code = api.lastCode();

        const first = await api.request(
            "/api/auth/login-sms",
            {
                phone: PHONE,
                smsCode: code,
            }
        );

        assert.equal(first.status, 200);

        const repeated = await api.request(
            "/api/auth/login-sms",
            {
                phone: PHONE,
                smsCode: code,
            }
        );

        assert.equal(repeated.status, 401);
    });
});

test("SMS: повторная отправка ограничивается cooldown", async () => {
    await withHarness(async (api) => {
        const first = await api.sendSms("login");
        const second = await api.sendSms("login");

        assert.equal(first.status, 200);
        assert.equal(second.status, 429);

        assert.equal(api.smsRequests.length, 1);
    });
});

test("Регистрация: действующий код создаёт пользователя", async () => {
    await withHarness(async (api) => {
        const sent = await api.sendSms(
            "register",
            NEW_PHONE
        );

        assert.equal(sent.status, 200);

        const response = await api.request(
            "/api/auth/register",
            {
                username: "Новый пользователь",
                phone: NEW_PHONE,
                password: "password-123",
                smsCode: api.lastCode(),
            }
        );

        assert.equal(response.status, 201);

        const user = api.users.get(NEW_PHONE);

        assert.ok(user);

        assert.equal(
            user.password,
            "hashed:password-123"
        );

        assert.equal(
            user.subscription_type,
            "premium"
        );
    });
});

test("Старое восстановление пароля отключено", async () => {
    await withHarness(async (api) => {
        const response = await api.request(
            "/api/auth/recover-password",
            {
                phone: PHONE,
            }
        );

        assert.equal(response.status, 410);

        assert.equal(
            api.users.get(PHONE).password,
            "original-password"
        );

        assert.equal(api.smsRequests.length, 0);
    });
});

test(
    "SMS: два одновременных сброса не используют один код",
    async () => {
        await withHarness(async (api) => {
            const sent = await api.sendSms(
                "password_reset"
            );

            assert.equal(sent.status, 200);

            const code = api.lastCode();

            const requests = await Promise.all([
                api.request(
                    "/api/auth/password-reset/confirm",
                    {
                        phone: PHONE,
                        smsCode: code,
                        newPassword: "password-first",
                    }
                ),

                api.request(
                    "/api/auth/password-reset/confirm",
                    {
                        phone: PHONE,
                        smsCode: code,
                        newPassword: "password-second",
                    }
                ),
            ]);

            const statuses = requests
                .map((result) => result.status)
                .sort((a, b) => a - b);

            assert.deepEqual(
                statuses,
                [200, 400]
            );

            // Сервис смены пароля должен
            // вызваться только один раз.
            assert.equal(
                api.passwordResets.length,
                1
            );
        });
    }
);