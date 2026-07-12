import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3001";
const LOGIN_PATH = "/";

async function setupMocks(page, options = {}) {
    const {
        status = 200,
        body = {
            token: "admin-real-token",
            user: {
                id: 1,
                username: "admin",
                role: "admin",
            },
        },
        onLogin,
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

    await page.route("**/api/admin/login", async (route) => {
        onLogin?.({
            body: route.request().postDataJSON(),
            headers: route.request().headers(),
        });

        await route.fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify(body),
        });
    });
}

async function openLoginPage(page, options = {}) {
    await setupMocks(page, options);

    await page.goto(`${FRONT_URL}${LOGIN_PATH}`);
    await page.waitForLoadState("domcontentloaded");

    if (!(await page.locator(".login-container").count())) {
        await page.screenshot({
            path: "login-page-wrong-route.png",
            fullPage: true,
        });

        throw new Error(
            `LoginPage не найдена. Текущий URL: ${page.url()}. Проверь LOGIN_PATH в тесте.`
        );
    }

    await expect(page.locator(".login-container")).toBeVisible({
        timeout: 15000,
    });
}

async function fillLoginForm(page, data = {}) {
    const {
        phone = "9781234567",
        password = "admin-password",
    } = data;

    await page.getByPlaceholder("+7 (___) ___-__-__").fill(phone);
    await page.getByPlaceholder("Пароль").fill(password);
}

test.describe("LoginPage", () => {
    test("отображает форму входа администратора", async ({ page }) => {
        await openLoginPage(page);

        await expect(page.getByRole("heading", {
            name: "Вход для администратора",
        })).toBeVisible();

        await expect(page.getByPlaceholder("+7 (___) ___-__-__")).toBeVisible();
        await expect(page.getByPlaceholder("Пароль")).toBeVisible();

        await expect(page.getByRole("button", {
            name: "Войти",
        })).toBeVisible();
    });

    test("маска телефона форматирует номер", async ({ page }) => {
        await openLoginPage(page);

        const phoneInput = page.getByPlaceholder("+7 (___) ___-__-__");

        await phoneInput.fill("9781234567");

        await expect(phoneInput).toHaveValue("+7 (978) 123-45-67");
    });

    test("браузерная required-валидация не отправляет пустую форму", async ({ page }) => {
        let loginCalled = false;

        await openLoginPage(page, {
            onLogin: () => {
                loginCalled = true;
            },
        });

        await page.getByRole("button", {
            name: "Войти",
        }).click();

        await expect
            .poll(() => loginCalled, {
                timeout: 1000,
            })
            .toBe(false);

        await expect(page.getByPlaceholder("+7 (___) ___-__-__")).toBeFocused();
    });

    test("показывает ошибку, если номер короткий", async ({ page }) => {
        let loginCalled = false;

        await openLoginPage(page, {
            onLogin: () => {
                loginCalled = true;
            },
        });

        await page.getByPlaceholder("+7 (___) ___-__-__").fill("978");
        await page.getByPlaceholder("Пароль").fill("admin-password");

        await page.getByRole("button", {
            name: "Войти",
        }).click();

        await expect(page.locator(".error-message")).toHaveText(
            "Введите корректный номер телефона"
        );

        await expect
            .poll(() => loginCalled, {
                timeout: 1000,
            })
            .toBe(false);
    });

    test("успешно логинится, сохраняет токен и роль", async ({ page }) => {
        let loginRequest = null;

        await openLoginPage(page, {
            onLogin: (data) => {
                loginRequest = data;
            },
        });

        await fillLoginForm(page, {
            phone: "9781234567",
            password: "secret123",
        });

        await page.getByRole("button", {
            name: "Войти",
        }).click();

        await expect
            .poll(() => loginRequest, {
                timeout: 10000,
            })
            .toEqual(
                expect.objectContaining({
                    body: {
                        phone: "79781234567",
                        password: "secret123",
                    },
                })
            );

        await expect
            .poll(async () => {
                return await page.evaluate(() => localStorage.getItem("authToken"));
            })
            .toBe("admin-real-token");

        await expect
            .poll(async () => {
                return await page.evaluate(() => localStorage.getItem("userRole"));
            })
            .toBe("admin");

        await expect(page).toHaveURL(/\/dashboard/);
    });

    test("если API вернул ошибку, показывает сообщение сервера", async ({ page }) => {
        await openLoginPage(page, {
            status: 401,
            body: {
                message: "Доступ запрещён",
            },
        });

        await fillLoginForm(page);

        await page.getByRole("button", {
            name: "Войти",
        }).click();

        await expect(page.locator(".error-message")).toHaveText("Доступ запрещён");

        await expect(page).toHaveURL(`${FRONT_URL}/`);
    });

    test("если API вернул ошибку без message, показывает fallback", async ({ page }) => {
        await openLoginPage(page, {
            status: 500,
            body: {},
        });

        await fillLoginForm(page);

        await page.getByRole("button", {
            name: "Войти",
        }).click();

        await expect(page.locator(".error-message")).toHaveText(
            "Неверный логин или пароль."
        );
    });

    test("после ошибки можно снова редактировать поля", async ({ page }) => {
        await openLoginPage(page, {
            status: 401,
            body: {
                message: "Неверные данные",
            },
        });

        await fillLoginForm(page, {
            phone: "9781112233",
            password: "bad-password",
        });

        await page.getByRole("button", {
            name: "Войти",
        }).click();

        await expect(page.locator(".error-message")).toHaveText("Неверные данные");

        await page.getByPlaceholder("Пароль").fill("new-password");

        await expect(page.getByPlaceholder("Пароль")).toHaveValue("new-password");
    });
});