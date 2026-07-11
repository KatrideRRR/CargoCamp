import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3000";

function formatPhoneForMask(raw) {
    const digits = String(raw || "").replace(/\D/g, "");

    const withoutCountry =
        digits.length === 11 && digits.startsWith("7")
            ? digits.slice(1)
            : digits;

    const d = withoutCountry.padEnd(10, "_").slice(0, 10);

    return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8, 10)}`;
}

async function mockRecaptcha(page, token = "mock-captcha-token") {
    await page.addInitScript((captchaToken) => {
        window.__mockCaptchaToken = captchaToken;

        window.grecaptcha = {
            render: (container, options = {}) => {
                window.__recaptchaOptions = options;

                setTimeout(() => {
                    if (typeof options.callback === "function") {
                        options.callback(captchaToken);
                    }
                }, 50);

                return "mock-recaptcha-widget-id";
            },
            reset: () => {},
            getResponse: () => captchaToken,
            execute: () => Promise.resolve(captchaToken),
            ready: (callback) => callback(),
        };
    }, token);

    await page.route("**/recaptcha/api.js**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/javascript",
            body: `
                window.grecaptcha = window.grecaptcha || {
                    render: function(container, options) {
                        window.__recaptchaOptions = options || {};
                        setTimeout(function() {
                            if (options && typeof options.callback === "function") {
                                options.callback(window.__mockCaptchaToken || "mock-captcha-token");
                            }
                        }, 50);
                        return "mock-recaptcha-widget-id";
                    },
                    reset: function(){},
                    getResponse: function(){ return window.__mockCaptchaToken || "mock-captcha-token"; },
                    execute: function(){ return Promise.resolve(window.__mockCaptchaToken || "mock-captcha-token"); },
                    ready: function(cb){ cb(); }
                };
            `,
        });
    });

    await page.route("**/recaptcha/**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: "<html><body>mock recaptcha</body></html>",
        });
    });
}

async function setupRegisterMocks(page, options = {}) {
    const {
        smsStatus = 200,
        smsBody = {
            success: true,
            cooldownSec: 60,
        },
        registerStatus = 200,
        registerBody = {
            token: "mock-token",
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

    await page.route("**/api/auth/send-sms", async (route) => {
        await route.fulfill({
            status: smsStatus,
            contentType: "application/json",
            body: JSON.stringify(smsBody),
        });
    });

    await page.route("**/api/auth/register", async (route) => {
        await route.fulfill({
            status: registerStatus,
            contentType: "application/json",
            body: JSON.stringify(registerBody),
        });
    });
}

async function openRegisterPage(page, options = {}) {
    if (options.withCaptcha !== false) {
        await mockRecaptcha(page, options.captchaToken || "mock-captcha-token");
    }

    await setupRegisterMocks(page, options);

    const query = options.query || "platform=web";

    await page.goto(`${FRONT_URL}/register?${query}`);

    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator(".register-title")).toHaveText("Регистрация", {
        timeout: 15000,
    });
}

async function fillPhone(page, value = "9780032978") {
    const phoneInput = page.locator("#phone");

    await phoneInput.fill(value);

    await expect(phoneInput).toHaveValue(formatPhoneForMask(value));
}

async function fillBaseFields(page) {
    await page.locator("#username").fill("TestUser");
    await fillPhone(page);
    await page.locator("#password").fill("Password123");
}

async function acceptAgreement(page) {
    await page.locator(".agreement input[type='checkbox']").check({
        force: true,
    });
}

async function clickGetCode(page) {
    const button = page.getByRole("button", {
        name: /^Получить код$/,
    });

    await expect(button).toBeEnabled({
        timeout: 10000,
    });

    await button.click();
}

async function sendSmsSuccessfully(page) {
    page.once("dialog", async (dialog) => {
        expect(dialog.message()).toBe("Код подтверждения отправлен на ваш номер");
        await dialog.accept();
    });

    await clickGetCode(page);

    await expect(page.getByPlaceholder("Введите код")).toBeVisible({
        timeout: 10000,
    });
}

test.describe("RegisterPage", () => {
    test("отображает страницу регистрации", async ({ page }) => {
        await openRegisterPage(page);

        await expect(page.locator(".register-page")).toBeVisible();
        await expect(page.locator(".register-title")).toHaveText("Регистрация");
        await expect(page.locator(".register-subtitle")).toHaveText("Создайте аккаунт за минуту");

        await expect(page.locator("#username")).toBeVisible();
        await expect(page.locator("#phone")).toBeVisible();
        await expect(page.locator("#password")).toBeVisible();

        await expect(page.getByRole("button", { name: "Получить код" })).toBeVisible();
    });

    test("ставит web-класс при platform=web", async ({ page }) => {
        await openRegisterPage(page, {
            query: "platform=web",
        });

        await expect(page.locator(".register-page")).toHaveClass(/auth-page--web/);
    });

    test("ставит ios-класс при platform=ios", async ({ page }) => {
        await openRegisterPage(page, {
            query: "platform=ios",
        });

        await expect(page.locator(".register-page")).toHaveClass(/auth-page--ios/);
    });

    test("ставит android-класс при platform=android", async ({ page }) => {
        await openRegisterPage(page, {
            query: "platform=android",
        });

        await expect(page.locator(".register-page")).toHaveClass(/auth-page--android/);
    });

    test("маскирует телефон в формате +7", async ({ page }) => {
        await openRegisterPage(page);

        await fillPhone(page, "9780032978");

        await expect(page.locator("#phone")).toHaveValue("+7 (978) 003-29-78");
    });

    test("кнопка Получить код отключена без captcha", async ({ page }) => {
        await openRegisterPage(page, {
            withCaptcha: false,
        });

        await fillBaseFields(page);

        await expect(page.getByRole("button", { name: "Получить код" })).toBeDisabled();
    });

    test("показывает ошибку, если номер некорректный", async ({ page }) => {
        await openRegisterPage(page);

        await page.locator("#phone").fill("123");

        await clickGetCode(page);

        await expect(page.locator(".register-error")).toHaveText(
            "Введите корректный номер телефона"
        );
    });

    test("отправляет SMS-код", async ({ page }) => {
        let smsRequestBody = null;

        await openRegisterPage(page);

        await page.route("**/api/auth/send-sms", async (route) => {
            smsRequestBody = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                    cooldownSec: 60,
                }),
            });
        });

        await fillBaseFields(page);

        page.once("dialog", async (dialog) => {
            expect(dialog.message()).toBe("Код подтверждения отправлен на ваш номер");
            await dialog.accept();
        });

        await clickGetCode(page);

        await expect
            .poll(() => smsRequestBody, {
                timeout: 10000,
            })
            .toEqual({
                phone: "+7 (978) 003-29-78",
                captchaToken: "mock-captcha-token",
                purpose: "register",
            });

        await expect(page.getByPlaceholder("Введите код")).toBeVisible();
        await expect(page.getByRole("button", { name: /Отправить ещё раз через/i })).toBeDisabled();
    });

    test("показывает ошибку при сбое отправки SMS", async ({ page }) => {
        await openRegisterPage(page, {
            smsStatus: 429,
            smsBody: {
                message: "SMS уже отправлено",
                waitSec: 30,
            },
        });

        await fillBaseFields(page);

        await clickGetCode(page);

        await expect(page.locator(".register-error")).toHaveText("SMS уже отправлено");

        await expect(page.getByRole("button", { name: /Повторно через/i })).toBeDisabled();
    });

    test("после отправки SMS показывает поле кода и кнопку регистрации", async ({ page }) => {
        await openRegisterPage(page);

        await fillBaseFields(page);
        await sendSmsSuccessfully(page);

        await expect(page.getByPlaceholder("Введите код")).toBeVisible();
        await expect(page.getByRole("button", { name: "Зарегистрироваться" })).toBeDisabled();

        await page.getByPlaceholder("Введите код").fill("123456");

        await expect(page.getByRole("button", { name: "Зарегистрироваться" })).toBeEnabled();
    });

    test("повторная отправка кода заблокирована на cooldown", async ({ page }) => {
        await openRegisterPage(page);

        await fillBaseFields(page);
        await sendSmsSuccessfully(page);

        await expect(page.getByRole("button", { name: /Отправить ещё раз через/i })).toBeDisabled();
    });

    test("не регистрирует без принятия соглашения", async ({ page }) => {
        let registerCalled = false;

        await openRegisterPage(page);

        await page.route("**/api/auth/register", async (route) => {
            registerCalled = true;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    token: "should-not-be-set",
                }),
            });
        });

        await fillBaseFields(page);
        await sendSmsSuccessfully(page);

        await page.getByPlaceholder("Введите код").fill("123456");

        page.once("dialog", async (dialog) => {
            expect(dialog.message()).toBe("Пожалуйста, примите пользовательское соглашение");
            await dialog.accept();
        });

        await page.getByRole("button", { name: "Зарегистрироваться" }).click();

        expect(registerCalled).toBe(false);

        const token = await page.evaluate(() => localStorage.getItem("authToken"));
        expect(token).toBeNull();

        await expect(page).toHaveURL(/\/register/);
    });

    test("полностью регистрирует пользователя", async ({ page }) => {
        let registerRequestBody = null;

        await openRegisterPage(page);

        await page.route("**/api/auth/register", async (route) => {
            registerRequestBody = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    token: "mock-token",
                }),
            });
        });

        await fillBaseFields(page);
        await acceptAgreement(page);
        await sendSmsSuccessfully(page);

        await page.getByPlaceholder("Введите код").fill("123456");

        page.once("dialog", async (dialog) => {
            expect(dialog.message()).toBe("Пользователь успешно создан");
            await dialog.accept();
        });

        await page.getByRole("button", { name: "Зарегистрироваться" }).click();

        await expect
            .poll(() => registerRequestBody, {
                timeout: 10000,
            })
            .toEqual({
                username: "TestUser",
                phone: "+7 (978) 003-29-78",
                password: "Password123",
                smsCode: "123456",
            });

        await expect(page).toHaveURL(/\/profile/);

        const token = await page.evaluate(() => localStorage.getItem("authToken"));
        expect(token).toBe("mock-token");
    });

    test("показывает ошибку при неудачной регистрации", async ({ page }) => {
        await openRegisterPage(page, {
            registerStatus: 400,
            registerBody: {
                message: "Пользователь уже существует",
            },
        });

        await fillBaseFields(page);
        await acceptAgreement(page);
        await sendSmsSuccessfully(page);

        await page.getByPlaceholder("Введите код").fill("123456");
        await page.getByRole("button", { name: "Зарегистрироваться" }).click();

        await expect(page.locator(".register-error")).toHaveText(
            "Пользователь уже существует"
        );

        await expect(page).toHaveURL(/\/register/);
    });

    test("открывает и закрывает пользовательское соглашение", async ({ page }) => {
        await openRegisterPage(page);

        await page.getByRole("button", { name: "пользовательское соглашение" }).click();

        await expect(page.locator(".modal-content-agreement")).toBeVisible();
        await expect(page.locator(".modal-content-agreement")).toContainText("1. Общие положения");
        await expect(page.locator(".modal-content-agreement")).toContainText("CargoCamp");

        await page.locator(".modal-content-agreement").getByRole("button", { name: "Закрыть" }).click();

        await expect(page.locator(".modal-content-agreement")).not.toBeVisible();
    });

    test("переходит на Политику конфиденциальности", async ({ page }) => {
        await openRegisterPage(page);

        await page.getByText("Политике конфиденциальности").click();

        await expect(page).toHaveURL(/\/info/);
    });

    test("переходит на login", async ({ page }) => {
        await openRegisterPage(page);

        await page.getByText("Войти").click();

        await expect(page).toHaveURL(/\/login/);
    });

    test("required-поля блокируют отправку формы без username/password", async ({ page }) => {
        await openRegisterPage(page);

        await fillPhone(page);
        await acceptAgreement(page);
        await sendSmsSuccessfully(page);

        await page.getByPlaceholder("Введите код").fill("123456");

        const usernameValid = await page.locator("#username").evaluate((input) =>
            input.checkValidity()
        );

        const passwordValid = await page.locator("#password").evaluate((input) =>
            input.checkValidity()
        );

        expect(usernameValid).toBe(false);
        expect(passwordValid).toBe(false);
    });
});