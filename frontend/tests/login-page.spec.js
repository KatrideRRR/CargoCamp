import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3000";
const LOGIN_URL = `${FRONT_URL}/login?platform=web`;

const activeUser = {
    id: 1,
    username: "test-user",
    name: "Test User",
    role: "customer",
    phone: "79780032978",
};

const bannedUser = {
    id: 2,
    username: "banned-user",
    name: "Banned User",
    role: "banned",
    phone: "79780801637",
};

function createFakeJwt(payload) {
    const header = {
        alg: "none",
        typ: "JWT",
    };

    const base64url = (obj) =>
        Buffer.from(JSON.stringify(obj))
            .toString("base64")
            .replace(/=/g, "")
            .replace(/\+/g, "-")
            .replace(/\//g, "_");

    return `${base64url(header)}.${base64url(payload)}.`;
}

const activeToken = createFakeJwt({
    id: activeUser.id,
    role: activeUser.role,
    name: activeUser.username,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
});

const bannedToken = createFakeJwt({
    id: bannedUser.id,
    role: bannedUser.role,
    name: bannedUser.username,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
});

async function setupLoginMocks(page, options = {}) {
    const {
        loginStatus = 200,
        loginBody = {
            token: activeToken,
            user: activeUser,
        },
        smsLoginStatus = 200,
        smsLoginBody = {
            token: activeToken,
            user: activeUser,
        },
        sendSmsStatus = 200,
        sendSmsBody = {
            success: true,
        },
        resetStatus = 200,
        resetBody = {
            success: true,
            message: "Пароль изменён. Теперь войдите.",
        },
    } = options;

    page.on("pageerror", (error) => {
        console.log("[PAGE ERROR]", error.message);
    });

    page.on("console", (msg) => {
        const text = msg.text();

        if (
            text.includes("Ошибка") ||
            text.includes("error") ||
            text.includes("React")
        ) {
            console.log(`[BROWSER ${msg.type()}]`, text);
        }
    });

    await page.route("**/api/auth/login", async (route) => {
        await route.fulfill({
            status: loginStatus,
            contentType: "application/json",
            body: JSON.stringify(loginBody),
        });
    });

    await page.route("**/api/auth/login-sms", async (route) => {
        await route.fulfill({
            status: smsLoginStatus,
            contentType: "application/json",
            body: JSON.stringify(smsLoginBody),
        });
    });

    await page.route("**/api/auth/send-sms", async (route) => {
        await route.fulfill({
            status: sendSmsStatus,
            contentType: "application/json",
            body: JSON.stringify(sendSmsBody),
        });
    });

    await page.route("**/api/auth/password-reset/confirm", async (route) => {
        await route.fulfill({
            status: resetStatus,
            contentType: "application/json",
            body: JSON.stringify(resetBody),
        });
    });

    // На случай, если /profile после входа грузит профиль через общий контекст.
    await page.route("**/api/auth/profile", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(activeUser),
        });
    });
}

async function openLoginPage(page, options = {}) {
    await setupLoginMocks(page, options);

    await page.goto(LOGIN_URL);

    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator(".login-page")).toBeVisible({
        timeout: 15000,
    });

    await expect(page.locator(".login-title")).toHaveText("Войти");
}

function formatPhoneForMask(raw) {
    const digits = String(raw || "").replace(/\D/g, "");

    const withoutCountry =
        digits.length === 11 && digits.startsWith("7")
            ? digits.slice(1)
            : digits;

    const d = withoutCountry.padEnd(10, "_").slice(0, 10);

    return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8, 10)}`;
}

async function fillPhone(page, value = "9780032978") {
    const phoneInput = page.locator("#phone");

    await phoneInput.fill(value);

    await expect(phoneInput).toHaveValue(formatPhoneForMask(value));
}

async function selectPasswordMode(page) {
    await page.getByRole("button", { name: "Войти по паролю" }).click();
    await expect(page.locator("#password")).toBeVisible();
}

async function selectSmsMode(page) {
    await page.getByRole("button", { name: "Войти по SMS" }).click();
    await expect(page.getByRole("button", { name: /Получить код/i })).toBeVisible();
}

async function selectResetMode(page) {
    await page.getByRole("button", { name: "Сброс пароля" }).click();
    await expect(page.getByText("Мы отправим код по SMS")).toBeVisible();
}

test.describe("LoginPage", () => {
    test.beforeEach(async ({ page }) => {
        await openLoginPage(page);
    });

    test("отображает страницу логина", async ({ page }) => {
        await expect(page.locator(".login-page")).toBeVisible();

        await expect(page.locator(".login-title")).toHaveText("Войти");
        await expect(page.locator(".login-subtitle")).toHaveText("Выберите способ входа");

        await expect(page.locator("#phone")).toBeVisible();

        await expect(page.getByRole("button", { name: "Войти по паролю" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Войти по SMS" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Сброс пароля" })).toBeVisible();

        await expect(page.getByText("Нет аккаунта?")).toBeVisible();
        await expect(page.getByText("Зарегистрироваться")).toBeVisible();
    });

    test("ставит web-класс при platform=web", async ({ page }) => {
        await openLoginPage(page, {});

        await expect(page.locator(".auth-page")).toHaveClass(/auth-page--web/);
    });

    test("ставит ios-класс при platform=ios", async ({ page }) => {
        await setupLoginMocks(page);

        await page.goto(`${FRONT_URL}/login?platform=ios`);

        await expect(page.locator(".auth-page")).toHaveClass(/auth-page--ios/);
    });

    test("ставит android-класс при platform=android", async ({ page }) => {
        await setupLoginMocks(page);

        await page.goto(`${FRONT_URL}/login?platform=android`);

        await expect(page.locator(".auth-page")).toHaveClass(/auth-page--android/);
    });

    test("переключает режим входа по паролю", async ({ page }) => {
        await selectPasswordMode(page);

        await expect(page.getByRole("button", { name: "Войти по паролю" })).toHaveClass(/btn-seg-active/);
        await expect(page.locator("#password")).toBeVisible();
        await expect(page.getByRole("button", { name: /^Войти$/ })).toBeVisible();
        await expect(page.getByRole("button", { name: "Забыли пароль?" })).toBeVisible();
    });

    test("переключает режим входа по SMS", async ({ page }) => {
        await selectSmsMode(page);

        await expect(page.getByRole("button", { name: "Войти по SMS" })).toHaveClass(/btn-seg-active/);
        await expect(page.getByRole("button", { name: "Получить код" })).toBeVisible();
    });

    test("переключает режим сброса пароля", async ({ page }) => {
        await selectResetMode(page);

        await expect(page.getByRole("button", { name: "Сброс пароля" })).toHaveClass(/btn-seg-active/);
        await expect(page.getByText("Мы отправим код по SMS")).toBeVisible();
        await expect(page.getByRole("button", { name: "Получить код" })).toBeVisible();
    });

    test("переходит в режим сброса по кнопке Забыли пароль", async ({ page }) => {
        await selectPasswordMode(page);

        await page.getByRole("button", { name: "Забыли пароль?" }).click();

        await expect(page.getByRole("button", { name: "Сброс пароля" })).toHaveClass(/btn-seg-active/);
        await expect(page.getByText("Мы отправим код по SMS")).toBeVisible();
    });

    test("показывает ошибку при попытке входа без телефона", async ({ page }) => {
        await selectPasswordMode(page);

        await page.locator("#password").fill("password123");

        await page.getByRole("button", { name: /^Войти$/ }).click();

        await expect(page.locator(".login-error")).toHaveText(
            "Введите корректный номер телефона"
        );
    });

    test("показывает ошибку при входе без пароля", async ({ page }) => {
        await fillPhone(page);
        await selectPasswordMode(page);

        await page.getByRole("button", { name: /^Войти$/ }).click();

        const passwordInput = page.locator("#password");

        await expect(passwordInput).toBeFocused();

        const isValid = await passwordInput.evaluate((input) => input.checkValidity());
        expect(isValid).toBe(false);
    });

    test("успешно входит по паролю", async ({ page }) => {
        let loginRequestBody = null;

        await page.route("**/api/auth/login", async (route) => {
            loginRequestBody = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    token: activeToken,
                    user: activeUser,
                }),
            });
        });

        await fillPhone(page);
        await selectPasswordMode(page);

        await page.locator("#password").fill("password123");

        await page.getByRole("button", { name: /^Войти$/ }).click();

        await expect
            .poll(() => loginRequestBody, {
                timeout: 10000,
            })
            .not.toBeNull();

        expect(loginRequestBody).toEqual({
            phone: "79780032978",
            password: "password123",
        });

        await expect(page).toHaveURL(/\/profile/);

        const token = await page.evaluate(() => localStorage.getItem("authToken"));
        expect(token).toBe(activeToken);
    });

    test("показывает ошибку backend при неверном пароле", async ({ page }) => {
        await page.route("**/api/auth/login", async (route) => {
            await route.fulfill({
                status: 401,
                contentType: "application/json",
                body: JSON.stringify({
                    message: "Неверный логин или пароль",
                }),
            });
        });

        await fillPhone(page);
        await selectPasswordMode(page);

        await page.locator("#password").fill("wrong-password");

        await page.getByRole("button", { name: /^Войти$/ }).click();

        await expect(page.locator(".login-error")).toHaveText(
            "Неверный логин или пароль",
            {
                timeout: 10000,
            }
        );

        await expect(page).not.toHaveURL(/\/profile/);
    });

    test("не пускает заблокированного пользователя", async ({ page }) => {
        await page.route("**/api/auth/login", async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    token: bannedToken,
                    user: bannedUser,
                }),
            });
        });

        await fillPhone(page, "9780801637");
        await selectPasswordMode(page);

        await page.locator("#password").fill("password123");

        await page.getByRole("button", { name: /^Войти$/ }).click();

        await expect(page.locator(".login-error")).toHaveText(
            "Ваш аккаунт заблокирован.",
            {
                timeout: 10000,
            }
        );

        await expect(page).not.toHaveURL(/\/profile/);

        const token = await page.evaluate(() => localStorage.getItem("authToken"));
        expect(token).toBeNull();
    });

    test("отправляет SMS-код для входа", async ({ page }) => {
        let smsRequestBody = null;

        await page.route("**/api/auth/send-sms", async (route) => {
            smsRequestBody = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                }),
            });
        });

        await fillPhone(page);
        await selectSmsMode(page);

        await page.getByRole("button", { name: "Получить код" }).click();

        await expect
            .poll(() => smsRequestBody, {
                timeout: 10000,
            })
            .toEqual({
                phone: "79780032978",
                purpose: "login",
            });

        await expect(page.locator(".login-success")).toHaveText(
            "Код отправлен на ваш номер"
        );

        await expect(page.getByPlaceholder("Введите код")).toBeVisible();
        await expect(page.getByRole("button", { name: "Отправить ещё раз" })).toBeVisible();
        await expect(page.getByRole("button", { name: /^Войти$/ })).toBeVisible();
    });

    test("показывает ошибку, если SMS-код не введён", async ({ page }) => {
        await fillPhone(page);
        await selectSmsMode(page);

        await page.getByRole("button", { name: "Получить код" }).click();

        const codeInput = page.getByPlaceholder("Введите код");

        await expect(codeInput).toBeVisible({
            timeout: 10000,
        });

        await page.getByRole("button", { name: /^Войти$/ }).click();

        await expect(codeInput).toBeFocused();

        const isValid = await codeInput.evaluate((input) => input.checkValidity());
        expect(isValid).toBe(false);
    });

    test("успешно входит по SMS", async ({ page }) => {
        let loginSmsRequestBody = null;

        await page.route("**/api/auth/login-sms", async (route) => {
            loginSmsRequestBody = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    token: activeToken,
                    user: activeUser,
                }),
            });
        });

        await fillPhone(page);
        await selectSmsMode(page);

        await page.getByRole("button", { name: "Получить код" }).click();

        await expect(page.getByPlaceholder("Введите код")).toBeVisible({
            timeout: 10000,
        });

        await page.getByPlaceholder("Введите код").fill("1234");

        await page.getByRole("button", { name: /^Войти$/ }).click();

        await expect
            .poll(() => loginSmsRequestBody, {
                timeout: 10000,
            })
            .toEqual({
                phone: "79780032978",
                smsCode: "1234",
            });

        await expect(page).toHaveURL(/\/profile/);
    });

    test("показывает ошибку при неправильном SMS-коде", async ({ page }) => {
        await page.route("**/api/auth/login-sms", async (route) => {
            await route.fulfill({
                status: 400,
                contentType: "application/json",
                body: JSON.stringify({
                    message: "Неверный SMS-код",
                }),
            });
        });

        await fillPhone(page);
        await selectSmsMode(page);

        await page.getByRole("button", { name: "Получить код" }).click();

        await expect(page.getByPlaceholder("Введите код")).toBeVisible({
            timeout: 10000,
        });

        await page.getByPlaceholder("Введите код").fill("0000");

        await page.getByRole("button", { name: /^Войти$/ }).click();

        await expect(page.locator(".login-error")).toHaveText("Неверный SMS-код", {
            timeout: 10000,
        });
    });

    test("отправляет код для сброса пароля", async ({ page }) => {
        let resetSmsRequestBody = null;

        await page.route("**/api/auth/send-sms", async (route) => {
            resetSmsRequestBody = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                }),
            });
        });

        await fillPhone(page);
        await selectResetMode(page);

        await page.getByRole("button", { name: "Получить код" }).click();

        await expect
            .poll(() => resetSmsRequestBody, {
                timeout: 10000,
            })
            .toEqual({
                phone: "79780032978",
                purpose: "password_reset",
            });

        await expect(page.locator(".login-success")).toHaveText(
            "Код для сброса отправлен на ваш номер"
        );

        await expect(page.getByPlaceholder("Введите код")).toBeVisible();
        await expect(page.getByPlaceholder("Минимум 6 символов")).toBeVisible();
        await expect(page.getByPlaceholder("Повторите пароль")).toBeVisible();
    });

    test("показывает ошибку, если новый пароль слишком короткий", async ({ page }) => {
        await fillPhone(page);
        await selectResetMode(page);

        await page.getByRole("button", { name: "Получить код" }).click();

        await expect(page.getByPlaceholder("Введите код")).toBeVisible({
            timeout: 10000,
        });

        await page.getByPlaceholder("Введите код").fill("1234");
        await page.getByPlaceholder("Минимум 6 символов").fill("123");
        await page.getByPlaceholder("Повторите пароль").fill("123");

        await page.getByRole("button", { name: "Сменить пароль" }).click();

        await expect(page.locator(".login-error")).toHaveText(
            "Пароль должен быть минимум 6 символов",
            {
                timeout: 10000,
            }
        );
    });

    test("показывает ошибку, если новые пароли не совпадают", async ({ page }) => {
        await fillPhone(page);
        await selectResetMode(page);

        await page.getByRole("button", { name: "Получить код" }).click();

        await expect(page.getByPlaceholder("Введите код")).toBeVisible({
            timeout: 10000,
        });

        await page.getByPlaceholder("Введите код").fill("1234");
        await page.getByPlaceholder("Минимум 6 символов").fill("password123");
        await page.getByPlaceholder("Повторите пароль").fill("password456");

        await page.getByRole("button", { name: "Сменить пароль" }).click();

        await expect(page.locator(".login-error")).toHaveText("Пароли не совпадают");
    });

    test("успешно сбрасывает пароль и переводит в режим входа по паролю", async ({ page }) => {
        let resetRequestBody = null;

        await page.route("**/api/auth/password-reset/confirm", async (route) => {
            resetRequestBody = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                    message: "Пароль изменён. Теперь войдите.",
                }),
            });
        });

        await fillPhone(page);
        await selectResetMode(page);

        await page.getByRole("button", { name: "Получить код" }).click();

        await expect(page.getByPlaceholder("Введите код")).toBeVisible({
            timeout: 10000,
        });

        await page.getByPlaceholder("Введите код").fill("1234");
        await page.getByPlaceholder("Минимум 6 символов").fill("password123");
        await page.getByPlaceholder("Повторите пароль").fill("password123");

        await page.getByRole("button", { name: "Сменить пароль" }).click();

        await expect
            .poll(() => resetRequestBody, {
                timeout: 10000,
            })
            .toEqual({
                phone: "79780032978",
                smsCode: "1234",
                newPassword: "password123",
            });

        await expect(page.locator(".login-success")).toHaveText(
            "Пароль изменён. Теперь войдите."
        );

        await expect(page.getByRole("button", { name: "Войти по паролю" })).toHaveClass(/btn-seg-active/);
        await expect(page.locator("#password")).toBeVisible();
    });

    test("показывает ошибку backend при сбросе пароля", async ({ page }) => {
        await page.route("**/api/auth/password-reset/confirm", async (route) => {
            await route.fulfill({
                status: 400,
                contentType: "application/json",
                body: JSON.stringify({
                    message: "Код сброса неверный",
                }),
            });
        });

        await fillPhone(page);
        await selectResetMode(page);

        await page.getByRole("button", { name: "Получить код" }).click();

        await expect(page.getByPlaceholder("Введите код")).toBeVisible({
            timeout: 10000,
        });

        await page.getByPlaceholder("Введите код").fill("0000");
        await page.getByPlaceholder("Минимум 6 символов").fill("password123");
        await page.getByPlaceholder("Повторите пароль").fill("password123");

        await page.getByRole("button", { name: "Сменить пароль" }).click();

        await expect(page.locator(".login-error")).toHaveText("Код сброса неверный", {
            timeout: 10000,
        });
    });

    test("переходит на страницу регистрации", async ({ page }) => {
        await page.getByText("Зарегистрироваться").click();

        await expect(page).toHaveURL(/\/register/);
    });

    test("смена режима очищает ошибки и сообщения", async ({ page }) => {
        await page.route("**/api/auth/login", async (route) => {
            await route.fulfill({
                status: 401,
                contentType: "application/json",
                body: JSON.stringify({
                    message: "Тестовая ошибка входа",
                }),
            });
        });

        await fillPhone(page);
        await selectPasswordMode(page);

        await page.locator("#password").fill("wrong-password");

        await page.getByRole("button", { name: /^Войти$/ }).click();

        await expect(page.locator(".login-error")).toHaveText(
            "Тестовая ошибка входа",
            {
                timeout: 10000,
            }
        );

        await page.getByRole("button", { name: "Войти по SMS" }).click();

        await expect(page.locator(".login-error")).not.toBeVisible();
    });
});