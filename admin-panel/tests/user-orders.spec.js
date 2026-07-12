import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3001";

// Если route в App.js другой — поменяй только это:
const USER_ORDERS_PATH = "/users/123/orders";

const orders = [
    {
        id: 101,
        createdAt: "2026-07-01T10:00:00.000Z",
        status: "pending",
        adminDeleted: false,
        creatorHidden: false,
    },
    {
        id: 202,
        createdAt: "2026-07-02T11:00:00.000Z",
        status: "active",
        adminDeleted: true,
        creatorHidden: false,
    },
    {
        id: 303,
        createdAt: "2026-07-03T12:00:00.000Z",
        status: "completed",
        adminDeleted: false,
        creatorHidden: true,
    },
    {
        id: 404,
        createdAt: "2026-07-04T13:00:00.000Z",
        status: "pending_payment",
        adminDeleted: false,
        creatorHidden: false,
    },
];

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
            orders,
        },
        delayMs = 0,
        onFetch,
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

    await page.route("**/api/admin/users/123/orders", async (route) => {
        onFetch?.({
            url: route.request().url(),
            headers: route.request().headers(),
        });

        if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        await route.fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify(body),
        });
    });
}

async function openUserOrdersPage(page, options = {}) {
    await setAdminAuth(page);
    await setupMocks(page, options);

    await page.goto(`${FRONT_URL}${USER_ORDERS_PATH}`);
    await page.waitForLoadState("domcontentloaded");

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "user-orders-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("UserOrdersPage редиректит на /login. Проверь PrivateRoute.");
    }

    if (!(await page.locator(".orders-container").count())) {
        await page.screenshot({
            path: "user-orders-wrong-route.png",
            fullPage: true,
        });

        throw new Error(
            `UserOrdersPage не найдена. Текущий URL: ${page.url()}. Проверь USER_ORDERS_PATH в тесте.`
        );
    }

    await expect(page.locator(".orders-container")).toBeVisible({
        timeout: 15000,
    });
}

function rows(page) {
    return page.locator(".orders-table tbody tr");
}

test.describe("UserOrdersPage", () => {
    test("отображает заголовок страницы", async ({ page }) => {
        await openUserOrdersPage(page);

        await expect(page.getByRole("heading", {
            name: "Заказы пользователя #123",
        })).toBeVisible();
    });

    test("запрашивает заказы пользователя с authToken", async ({ page }) => {
        let requestData = null;

        await openUserOrdersPage(page, {
            onFetch: (data) => {
                requestData = data;
            },
        });

        await expect
            .poll(() => requestData, {
                timeout: 10000,
            })
            .toEqual(
                expect.objectContaining({
                    url: expect.stringContaining("/api/admin/users/123/orders"),
                    headers: expect.objectContaining({
                        authorization: "Bearer admin-test-token",
                    }),
                })
            );
    });

    test("отображает toolbar с поиском и кнопкой создания заказа", async ({ page }) => {
        await openUserOrdersPage(page);

        await expect(page.locator(".orders-toolbar")).toBeVisible();

        await expect(page.getByPlaceholder("Поиск по ID заказа")).toBeVisible();

        await expect(page.getByRole("button", {
            name: "Создать заказ",
        })).toBeVisible();
    });

    test("отображает таблицу заказов пользователя", async ({ page }) => {
        await openUserOrdersPage(page);

        await expect(page.locator(".orders-table-wrapper")).toBeVisible();
        await expect(page.locator(".orders-table")).toBeVisible();

        await expect(page.locator("thead")).toContainText("ID заказа");
        await expect(page.locator("thead")).toContainText("Дата создания");
        await expect(page.locator("thead")).toContainText("Статус");
        await expect(page.locator("thead")).toContainText("Видимость");
        await expect(page.locator("thead")).toContainText("Действия");

        await expect(rows(page)).toHaveCount(4);

        await expect(rows(page).nth(0)).toContainText("101");
        await expect(rows(page).nth(0)).toContainText("pending");
        await expect(rows(page).nth(0)).toContainText("Видимый");

        await expect(rows(page).nth(1)).toContainText("202");
        await expect(rows(page).nth(1)).toContainText("active");
        await expect(rows(page).nth(1)).toContainText("Удалён админом");

        await expect(rows(page).nth(2)).toContainText("303");
        await expect(rows(page).nth(2)).toContainText("completed");
        await expect(rows(page).nth(2)).toContainText("Скрыт пользователем");

        await expect(rows(page).nth(3)).toContainText("404");
        await expect(rows(page).nth(3)).toContainText("pending_payment");
    });

    test("ставит правильные классы статусов", async ({ page }) => {
        await openUserOrdersPage(page);

        await expect(rows(page).nth(0).locator(".status-badge")).toHaveClass(/pending/);
        await expect(rows(page).nth(1).locator(".status-badge")).toHaveClass(/active/);
        await expect(rows(page).nth(2).locator(".status-badge")).toHaveClass(/completed/);
        await expect(rows(page).nth(3).locator(".status-badge")).toHaveClass(/pending-payment/);
    });

    test("ставит правильные классы видимости", async ({ page }) => {
        await openUserOrdersPage(page);

        await expect(rows(page).nth(0).locator(".admin-order-visibility-badge")).toHaveClass(/visible/);
        await expect(rows(page).nth(1).locator(".admin-order-visibility-badge")).toHaveClass(/admin-deleted/);
        await expect(rows(page).nth(2).locator(".admin-order-visibility-badge")).toHaveClass(/creator-hidden/);
    });

    test("ищет заказ по ID", async ({ page }) => {
        await openUserOrdersPage(page);

        await page.getByPlaceholder("Поиск по ID заказа").fill("202");

        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page).first()).toContainText("202");
        await expect(rows(page).first()).toContainText("Удалён админом");
    });

    test("сбрасывает поиск при очистке поля", async ({ page }) => {
        await openUserOrdersPage(page);

        const search = page.getByPlaceholder("Поиск по ID заказа");

        await search.fill("202");
        await expect(rows(page)).toHaveCount(1);

        await search.fill("");
        await expect(rows(page)).toHaveCount(4);
    });

    test("если поиск ничего не нашёл, показывает empty state", async ({ page }) => {
        await openUserOrdersPage(page);

        await page.getByPlaceholder("Поиск по ID заказа").fill("999");

        await expect(page.locator(".orders-table")).not.toBeVisible();
        await expect(page.getByText("У пользователя нет заказов.")).toBeVisible();
    });

    test("кнопка Создать заказ ведёт на create-order пользователя", async ({ page }) => {
        await openUserOrdersPage(page);

        await page.getByRole("button", {
            name: "Создать заказ",
        }).click();

        await expect(page).toHaveURL(/\/create-order\/123/);
    });

    test("кнопка Подробнее ведёт в детали заказа", async ({ page }) => {
        await openUserOrdersPage(page);

        await rows(page).nth(1).getByRole("button", {
            name: "Подробнее",
        }).click();

        await expect(page).toHaveURL(/\/orders\/202/);
    });

    test("если заказов нет, показывает empty state", async ({ page }) => {
        await openUserOrdersPage(page, {
            body: {
                orders: [],
            },
        });

        await expect(page.locator(".orders-table")).not.toBeVisible();
        await expect(page.locator(".empty-state")).toBeVisible();
        await expect(page.getByText("У пользователя нет заказов.")).toBeVisible();
    });

    test("если orders не пришли, показывает empty state", async ({ page }) => {
        await openUserOrdersPage(page, {
            body: {},
        });

        await expect(page.locator(".orders-table")).not.toBeVisible();
        await expect(page.getByText("У пользователя нет заказов.")).toBeVisible();
    });

    test("если загрузка заказов упала, показывает ошибку", async ({ page }) => {
        await openUserOrdersPage(page, {
            status: 500,
            body: {
                message: "Ошибка",
            },
        });

        await expect(page.getByRole("heading", {
            name: "Заказы пользователя #123",
        })).toBeVisible();

        await expect(page.locator(".orders-message.error")).toHaveText(
            "Не удалось загрузить заказы"
        );
    });

    test("показывает loading state", async ({ page }) => {
        await setAdminAuth(page);
        await setupMocks(page, {
            delayMs: 1000,
        });

        await page.goto(`${FRONT_URL}${USER_ORDERS_PATH}`);
        await page.waitForLoadState("domcontentloaded");

        if (page.url().includes("/login")) {
            throw new Error("UserOrdersPage редиректит на /login");
        }

        await expect(page.locator(".orders-container")).toBeVisible();
        await expect(page.locator(".orders-message")).toHaveText("Загрузка...");
    });

    test("корректно показывает неизвестный статус", async ({ page }) => {
        await openUserOrdersPage(page, {
            body: {
                orders: [
                    {
                        id: 505,
                        createdAt: "2026-07-05T10:00:00.000Z",
                        status: "custom_status",
                        adminDeleted: false,
                        creatorHidden: false,
                    },
                ],
            },
        });

        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page).first()).toContainText("505");
        await expect(rows(page).first()).toContainText("custom_status");
        await expect(rows(page).first().locator(".status-badge")).toHaveClass(/^status-badge$/);
    });
});