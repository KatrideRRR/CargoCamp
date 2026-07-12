import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3001";

// Если route в App.js другой — поменяй только это:
const CREATE_USER_PATH = "/create-user";

async function setAdminAuth(page) {
    await page.addInitScript(() => {
        const adminUser = {
            id: 1,
            username: "admin",
            name: "admin",
            role: "admin",
            isAdmin: true,
        };

        const token = "admin-test-token";

        localStorage.setItem("authToken", token);
        localStorage.setItem("adminToken", token);
        localStorage.setItem("token", token);

        // Это проверяет PrivateRoute в admin-panel
        localStorage.setItem("userRole", "admin");

        localStorage.setItem("user", JSON.stringify(adminUser));
        localStorage.setItem("adminUser", JSON.stringify(adminUser));
        localStorage.setItem("currentUser", JSON.stringify(adminUser));
    });
}

async function setupMocks(page, options = {}) {
    const {
        status = 200,
        body = {
            message: "Пользователь успешно создан",
        },
        onCreate,
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

    await page.route("**/api/admin/create-user", async (route) => {
        onCreate?.({
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

async function openCreateUserPage(page, options = {}) {
    await setAdminAuth(page);
    await setupMocks(page, options);

    await page.goto(`${FRONT_URL}${CREATE_USER_PATH}`);
    await page.waitForLoadState("domcontentloaded");

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "create-user-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("CreateUserPage редиректит на /login. Проверь PrivateRoute.");
    }

    if (!(await page.locator(".create-user-page").count())) {
        await page.screenshot({
            path: "create-user-wrong-route.png",
            fullPage: true,
        });

        throw new Error(
            `CreateUserPage не найдена. Текущий URL: ${page.url()}. Проверь CREATE_USER_PATH в тесте.`
        );
    }

    await expect(page.locator(".create-user-page")).toBeVisible({
        timeout: 15000,
    });
}

async function fillCreateUserForm(page, data = {}) {
    const {
        username = "Аким",
        phone = "+79781234567",
        password = "test-password-123",
    } = data;

    await page.getByLabel("Имя").fill(username);
    await page.getByLabel("Номер телефона").fill(phone);
    await page.getByLabel("Пароль").fill(password);
}

test.describe("CreateUserPage", () => {
    test("отображает форму создания пользователя", async ({ page }) => {
        await openCreateUserPage(page);

        await expect(page.getByRole("heading", {
            name: "Создать нового пользователя",
        })).toBeVisible();

        await expect(page.getByLabel("Имя")).toBeVisible();
        await expect(page.getByLabel("Номер телефона")).toBeVisible();
        await expect(page.getByLabel("Пароль")).toBeVisible();

        await expect(page.getByPlaceholder("Введите имя")).toBeVisible();
        await expect(page.getByPlaceholder("+7XXXXXXXXXX")).toBeVisible();
        await expect(page.getByPlaceholder("Введите пароль")).toBeVisible();

        await expect(page.getByRole("button", {
            name: "Создать пользователя",
        })).toBeVisible();
    });

    test("поля формы обновляются при вводе", async ({ page }) => {
        await openCreateUserPage(page);

        await fillCreateUserForm(page, {
            username: "Иван",
            phone: "+79990001122",
            password: "secret123",
        });

        await expect(page.getByLabel("Имя")).toHaveValue("Иван");
        await expect(page.getByLabel("Номер телефона")).toHaveValue("+79990001122");
        await expect(page.getByLabel("Пароль")).toHaveValue("secret123");
    });

    test("браузерная required-валидация не отправляет пустую форму", async ({ page }) => {
        let createCalled = false;

        await openCreateUserPage(page, {
            onCreate: () => {
                createCalled = true;
            },
        });

        await page.getByRole("button", {
            name: "Создать пользователя",
        }).click();

        await expect
            .poll(() => createCalled, {
                timeout: 1000,
            })
            .toBe(false);

        await expect(page.getByLabel("Имя")).toBeFocused();
    });

    test("создаёт пользователя и отправляет правильный payload", async ({ page }) => {
        let createRequest = null;

        await openCreateUserPage(page, {
            onCreate: (data) => {
                createRequest = data;
            },
        });

        await fillCreateUserForm(page, {
            username: "Аким",
            phone: "+79781234567",
            password: "qwerty123",
        });

        const dialogPromise = page.waitForEvent("dialog").then(async (dialog) => {
            expect(dialog.message()).toBe("Пользователь успешно создан");
            await dialog.accept();
        });

        await page.getByRole("button", {
            name: "Создать пользователя",
        }).click({
            noWaitAfter: true,
        });

        await dialogPromise;

        await expect
            .poll(() => createRequest, {
                timeout: 10000,
            })
            .toEqual(
                expect.objectContaining({
                    body: {
                        username: "Аким",
                        phone: "+79781234567",
                        password: "qwerty123",
                    },
                    headers: expect.objectContaining({
                        authorization: "Bearer admin-test-token",
                    }),
                })
            );

        await expect(page).toHaveURL(/\/users/);
    });

    test("если API вернул ошибку, показывает сообщение сервера", async ({ page }) => {
        await openCreateUserPage(page, {
            status: 400,
            body: {
                message: "Пользователь с таким телефоном уже существует",
            },
        });

        await fillCreateUserForm(page);

        await page.getByRole("button", {
            name: "Создать пользователя",
        }).click();

        await expect(page.locator(".error-message")).toHaveText(
            "Пользователь с таким телефоном уже существует"
        );
    });

    test("если API вернул ошибку без message, показывает fallback", async ({ page }) => {
        await openCreateUserPage(page, {
            status: 500,
            body: {},
        });

        await fillCreateUserForm(page);

        await page.getByRole("button", {
            name: "Создать пользователя",
        }).click();

        await expect(page.locator(".error-message")).toHaveText(
            "Ошибка при создании пользователя"
        );
    });

    test("после ошибки можно исправить данные и создать пользователя", async ({ page }) => {
        let attempt = 0;

        await openCreateUserPage(page, {
            onCreate: () => {
                attempt += 1;
            },
            status: 400,
            body: {
                message: "Ошибка первого запроса",
            },
        });

        await fillCreateUserForm(page, {
            username: "Первый",
            phone: "+70000000000",
            password: "bad",
        });

        await page.getByRole("button", {
            name: "Создать пользователя",
        }).click();

        await expect(page.locator(".error-message")).toHaveText("Ошибка первого запроса");
        await expect.poll(() => attempt).toBe(1);
    });
});