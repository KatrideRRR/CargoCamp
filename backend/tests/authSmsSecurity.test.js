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

    const smsStates = new Map();

    const fakeSmsCodeStore = {
        async reserveSmsCode({ phone, purpose }) {
            const now = Date.now();
            const previous = smsStates.get(phone);

            if (
                previous?.lastSentAt &&
                now - previous.lastSentAt < 60_000
            ) {
                const error = new Error(
                    "Повторная отправка пока запрещена"
                );

                error.status = 429;
                error.waitSec = 60;

                throw error;
            }

            const code = crypto
                .randomInt(100000, 1000000)
                .toString();

            const reservationId = crypto.randomUUID();

            smsStates.set(phone, {
                code,
                purpose,
                reservationId,
                status: "pending",
                attempts: 0,
                expiresAt: now + 300_000,
                lastSentAt: now,
            });

            return {
                code,
                reservationId,
                cooldownSec: 60,
                expiresInSec: 300,
            };
        },

        async completeSmsSend({
                                  phone,
                                  reservationId,
                                  success,
                              }) {
            const state = smsStates.get(phone);

            if (
                !state ||
                state.status !== "pending" ||
                state.reservationId !== reservationId
            ) {
                return false;
            }

            state.status = success ? "active" : "idle";

            return true;
        },

        async consumeSmsCode({
                                 phone,
                                 purpose,
                                 code,
                             }) {
            const state = smsStates.get(phone);

            if (
                !state ||
                state.status !== "active" ||
                state.purpose !== purpose
            ) {
                return {
                    ok: false,
                    reason: "not_found",
                };
            }

            if (Date.now() >= state.expiresAt) {
                state.status = "idle";

                return {
                    ok: false,
                    reason: "expired",
                };
            }

            if (state.code !== String(code)) {
                state.attempts++;

                if (state.attempts >= 5) {
                    state.status = "idle";

                    return {
                        ok: false,
                        reason: "too_many_attempts",
                    };
                }

                return {
                    ok: false,
                    reason: "incorrect",
                };
            }

            state.status = "idle";

            return {
                ok: true,
            };
        },
    };

    let captchaRequests = 0;
    let smsRecipientAccepted = true;
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
        async post(url, body, options = {}) {
            // Искусственная проверка reCAPTCHA.
            if (
                url ===
                "https://www.google.com/recaptcha/api/siteverify"
            ) {
                captchaRequests++;

                return {
                    data: {
                        success: true,
                    },
                };
            }

            // Любые другие внешние запросы запрещены.
            assert.equal(
                url,
                "https://sms.ru/sms/send"
            );

            // Проверяем безопасный способ передачи данных.
            assert.equal(
                typeof body,
                "string"
            );

            assert.equal(
                options.headers?.["Content-Type"],
                "application/x-www-form-urlencoded"
            );

            assert.equal(options.timeout, 15000);
            assert.equal(options.maxRedirects, 0);

            // SMS нельзя отправлять параметрами URL.
            assert.equal(options.params, undefined);

            const params = new URLSearchParams(body);

            assert.equal(
                params.get("api_id"),
                "CARGOCAMP_TEST_ONLY"
            );

            assert.equal(
                params.get("json"),
                "1"
            );

            const phone = params.get("to");
            const message = params.get("msg") || "";

            const code =
                message.match(/\b\d{6}\b/)?.[0];

            assert.ok(
                code,
                "SMS должна содержать шестизначный код"
            );

            smsRequests.push({
                phone,
                code,
                method: "POST",
            });

            return {
                data: {
                    status: "OK",
                    sms: {
                        [phone]: {
                            status: smsRecipientAccepted
                                ? "OK"
                                : "ERROR",

                            status_code: smsRecipientAccepted
                                ? 100
                                : 201,
                        },
                    },
                },
            };
        },

        async get() {
            throw new Error(
                "Отправка SMS через GET запрещена"
            );
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

            "../services/smsCodeStore": fakeSmsCodeStore,

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
        setSmsRecipientAccepted(value) {
            smsRecipientAccepted = Boolean(value);
        },

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

test(
    "SMS: два одновременных входа не используют один код",
    async () => {
        await withHarness(async (api) => {
            const sent = await api.sendSms("login");

            assert.equal(sent.status, 200);

            const code = api.lastCode();

            const results = await Promise.all([
                api.request("/api/auth/login-sms", {
                    phone: PHONE,
                    smsCode: code,
                }),

                api.request("/api/auth/login-sms", {
                    phone: PHONE,
                    smsCode: code,
                }),
            ]);

            const statuses = results
                .map((result) => result.status)
                .sort((a, b) => a - b);

            assert.deepEqual(statuses, [
                200,
                401,
            ]);

            assert.equal(
                api.sessionRequests.length,
                0
            );
        });
    }
);

test(
    "SMS: использование кода не сбрасывает cooldown",
    async () => {
        await withHarness(async (api) => {
            const sent = await api.sendSms("login");

            assert.equal(sent.status, 200);

            const login = await api.request(
                "/api/auth/login-sms",
                {
                    phone: PHONE,
                    smsCode: api.lastCode(),
                }
            );

            assert.equal(login.status, 200);

            const repeated = await api.sendSms(
                "login"
            );

            assert.equal(repeated.status, 429);

            assert.equal(
                api.smsRequests.length,
                1
            );
        });
    }
);

test(
    "SMS: отказ конкретному получателю не активирует код",
    async () => {
        await withHarness(async (api) => {
            api.setSmsRecipientAccepted(false);

            const response = await api.sendSms("login");

            assert.equal(response.status, 502);

            const login = await api.request(
                "/api/auth/login-sms",
                {
                    phone: PHONE,
                    smsCode: api.lastCode(),
                }
            );

            assert.equal(login.status, 401);
        });
    }
);

test(
    "SMS: код отправляется через POST без параметров URL",
    async () => {
        await withHarness(async (api) => {
            const response =
                await api.sendSms("login");

            assert.equal(response.status, 200);

            assert.equal(
                api.smsRequests.length,
                1
            );

            assert.equal(
                api.smsRequests[0].method,
                "POST"
            );

            assert.match(
                api.smsRequests[0].code,
                /^\d{6}$/
            );
        });
    }
);