import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3001";
const ORDERS_PATH = "/orders";

const regularOrders = [
    {
        id: 101,
        createdAt: "2026-07-01T10:00:00.000Z",
        status: "pending",
        adminDeleted: false,
        creatorHidden: false,
        activeDispute: null,
    },
    {
        id: 202,
        createdAt: "2026-07-02T11:00:00.000Z",
        status: "active",
        adminDeleted: true,
        creatorHidden: false,
        activeDispute: {
            id: 1,
            status: "open",
        },
    },
    {
        id: 303,
        createdAt: "2026-07-03T12:00:00.000Z",
        status: "completed",
        adminDeleted: false,
        creatorHidden: true,
        activeDispute: {
            id: 2,
            status: "in_review",
        },
    },
];

const expressOrders = [
    {
        id: 901,
        type: "taxi",
        fromAddress: "Симферополь, улица Пушкина, 1",
        toAddress: "Симферополь, проспект Кирова, 10",
        totalPrice: 700,
        status: "created",
        creatorId: 10,
        executorId: null,
        createdAt: "2026-07-04T10:00:00.000Z",
    },
    {
        id: 902,
        type: "courier",
        fromAddress: "Алушта",
        toAddress: "Ялта",
        totalPrice: 1200,
        status: "accepted",
        creatorId: 11,
        executorId: 22,
        createdAt: "2026-07-05T10:00:00.000Z",
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
        regularStatus = 200,
        regularBody = regularOrders,
        expressStatus = 200,
        expressBody = expressOrders,
        delayMs = 0,
        onRegularFetch,
        onExpressFetch,
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

    await page.route("**/api/admin/orders", async (route) => {
        onRegularFetch?.({
            url: route.request().url(),
            headers: route.request().headers(),
        });

        if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        await route.fulfill({
            status: regularStatus,
            contentType: "application/json",
            body: JSON.stringify(regularBody),
        });
    });

    await page.route("**/api/admin/express-orders", async (route) => {
        onExpressFetch?.({
            url: route.request().url(),
            headers: route.request().headers(),
        });

        if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        await route.fulfill({
            status: expressStatus,
            contentType: "application/json",
            body: JSON.stringify(expressBody),
        });
    });
}

async function openOrdersPage(page, options = {}) {
    await setAdminAuth(page);
    await setupMocks(page, options);

    await page.goto(`${FRONT_URL}${ORDERS_PATH}`);
    await page.waitForLoadState("domcontentloaded");

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "orders-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("OrdersPage редиректит на /login. Проверь PrivateRoute.");
    }

    if (!(await page.locator(".orders-container").count())) {
        await page.screenshot({
            path: "orders-wrong-route.png",
            fullPage: true,
        });

        throw new Error(
            `OrdersPage не найдена. Текущий URL: ${page.url()}. Проверь ORDERS_PATH в тесте.`
        );
    }

    await expect(page.locator(".orders-container")).toBeVisible({
        timeout: 15000,
    });
}

function regularRows(page) {
    return page.locator(".orders-table tbody tr");
}

test.describe("OrdersPage", () => {
    test("отображает страницу заказов", async ({ page }) => {
        await openOrdersPage(page);

        await expect(page.getByRole("heading", {
            name: "Заказы",
        })).toBeVisible();

        await expect(page.locator(".orders-tabs")).toBeVisible();

        await expect(page.getByRole("button", {
            name: "Обычные",
        })).toHaveClass(/active/);

        await expect(page.getByRole("button", {
            name: "Экспресс",
        })).toBeVisible();

        await expect(page.getByPlaceholder("Поиск по ID обычного заказа")).toBeVisible();
    });

    test("запрашивает обычные и express-заказы с authToken", async ({ page }) => {
        let regularRequest = null;
        let expressRequest = null;

        await openOrdersPage(page, {
            onRegularFetch: (data) => {
                regularRequest = data;
            },
            onExpressFetch: (data) => {
                expressRequest = data;
            },
        });

        await expect
            .poll(() => regularRequest, {
                timeout: 10000,
            })
            .toEqual(
                expect.objectContaining({
                    url: expect.stringContaining("/api/admin/orders"),
                    headers: expect.objectContaining({
                        authorization: "Bearer admin-test-token",
                    }),
                })
            );

        await expect
            .poll(() => expressRequest, {
                timeout: 10000,
            })
            .toEqual(
                expect.objectContaining({
                    url: expect.stringContaining("/api/admin/express-orders"),
                    headers: expect.objectContaining({
                        authorization: "Bearer admin-test-token",
                    }),
                })
            );
    });

    test("по умолчанию показывает обычные заказы", async ({ page }) => {
        await openOrdersPage(page);

        await expect(page.locator(".orders-table")).toBeVisible();
        await expect(regularRows(page)).toHaveCount(3);

        await expect(regularRows(page).nth(0)).toContainText("101");
        await expect(regularRows(page).nth(0)).toContainText("pending");
        await expect(regularRows(page).nth(0)).toContainText("Видимый");
        await expect(regularRows(page).nth(0)).toContainText("Нет спора");

        await expect(regularRows(page).nth(1)).toContainText("202");
        await expect(regularRows(page).nth(1)).toContainText("active");
        await expect(regularRows(page).nth(1)).toContainText("Удалён админом");
        await expect(regularRows(page).nth(1)).toContainText("Спор открыт");

        await expect(regularRows(page).nth(2)).toContainText("303");
        await expect(regularRows(page).nth(2)).toContainText("completed");
        await expect(regularRows(page).nth(2)).toContainText("Скрыт пользователем");
    });

    test("ставит правильные классы статусов обычных заказов", async ({ page }) => {
        await openOrdersPage(page);

        await expect(regularRows(page).nth(0).locator(".status-badge")).toHaveClass(/pending/);
        await expect(regularRows(page).nth(1).locator(".status-badge")).toHaveClass(/active/);
        await expect(regularRows(page).nth(2).locator(".status-badge")).toHaveClass(/completed/);
    });

    test("ставит правильные классы видимости и споров", async ({ page }) => {
        await openOrdersPage(page);

        await expect(regularRows(page).nth(0).locator(".admin-order-visibility-badge")).toHaveClass(/visible/);
        await expect(regularRows(page).nth(1).locator(".admin-order-visibility-badge")).toHaveClass(/admin-deleted/);
        await expect(regularRows(page).nth(2).locator(".admin-order-visibility-badge")).toHaveClass(/creator-hidden/);

        await expect(regularRows(page).nth(0).locator(".admin-dispute-badge")).toHaveClass(/none/);
        await expect(regularRows(page).nth(1).locator(".admin-dispute-badge")).toHaveClass(/open/);
        await expect(regularRows(page).nth(2).locator(".admin-dispute-badge")).toHaveClass(/in_review/);
    });

    test("ищет обычный заказ по ID", async ({ page }) => {
        await openOrdersPage(page);

        await page.getByPlaceholder("Поиск по ID обычного заказа").fill("202");

        await expect(regularRows(page)).toHaveCount(1);
        await expect(regularRows(page).first()).toContainText("202");

        await page.getByPlaceholder("Поиск по ID обычного заказа").fill("999");

        await expect(page.locator(".orders-table")).not.toBeVisible();
        await expect(page.getByText("Нет заказов.")).toBeVisible();
    });

    test("переходит в детали обычного заказа", async ({ page }) => {
        await openOrdersPage(page);

        await regularRows(page).first().getByRole("button", {
            name: "Подробнее",
        }).click();

        await expect(page).toHaveURL(/\/orders\/101/);
    });

    test("переключается на express-заказы", async ({ page }) => {
        await openOrdersPage(page);

        await page.getByRole("button", {
            name: "Экспресс",
        }).click();

        await expect(page.getByRole("button", {
            name: "Экспресс",
        })).toHaveClass(/active/);

        await expect(page.getByPlaceholder("Поиск по ID экспресс-заказа")).toBeVisible();

        await expect(regularRows(page)).toHaveCount(2);

        await expect(regularRows(page).nth(0)).toContainText("901");
        await expect(regularRows(page).nth(0)).toContainText("Такси");
        await expect(regularRows(page).nth(0)).toContainText("Симферополь, улица Пушкина, 1");
        await expect(regularRows(page).nth(0)).toContainText("Симферополь, проспект Кирова, 10");
        await expect(regularRows(page).nth(0)).toContainText("700 ₽");
        await expect(regularRows(page).nth(0)).toContainText("created");
        await expect(regularRows(page).nth(0)).toContainText("10");
        await expect(regularRows(page).nth(0)).toContainText("—");

        await expect(regularRows(page).nth(1)).toContainText("902");
        await expect(regularRows(page).nth(1)).toContainText("Курьер");
        await expect(regularRows(page).nth(1)).toContainText("1200 ₽");
        await expect(regularRows(page).nth(1)).toContainText("accepted");
        await expect(regularRows(page).nth(1)).toContainText("22");
    });

    test("ставит правильные классы статусов express-заказов", async ({ page }) => {
        await openOrdersPage(page);

        await page.getByRole("button", {
            name: "Экспресс",
        }).click();

        await expect(regularRows(page).nth(0).locator(".status-badge")).toHaveClass(/pending/);
        await expect(regularRows(page).nth(1).locator(".status-badge")).toHaveClass(/active/);
    });

    test("ищет express-заказ по ID", async ({ page }) => {
        await openOrdersPage(page);

        await page.getByRole("button", {
            name: "Экспресс",
        }).click();

        await page.getByPlaceholder("Поиск по ID экспресс-заказа").fill("902");

        await expect(regularRows(page)).toHaveCount(1);
        await expect(regularRows(page).first()).toContainText("902");
        await expect(regularRows(page).first()).toContainText("Курьер");
    });

    test("переходит в детали express-заказа", async ({ page }) => {
        await openOrdersPage(page);

        await page.getByRole("button", {
            name: "Экспресс",
        }).click();

        await regularRows(page).first().getByRole("button", {
            name: "Подробнее",
        }).click();

        await expect(page).toHaveURL(/\/express-orders\/901/);
    });

    test("показывает empty state, если обычных заказов нет", async ({ page }) => {
        await openOrdersPage(page, {
            regularBody: [],
        });

        await expect(page.locator(".orders-table")).not.toBeVisible();
        await expect(page.getByText("Нет заказов.")).toBeVisible();
    });

    test("показывает empty state, если express-заказов нет", async ({ page }) => {
        await openOrdersPage(page, {
            expressBody: [],
        });

        await page.getByRole("button", {
            name: "Экспресс",
        }).click();

        await expect(page.locator(".orders-table")).not.toBeVisible();
        await expect(page.getByText("Нет заказов.")).toBeVisible();
    });

    test("если API вернул не массивы, показывает empty state", async ({ page }) => {
        await openOrdersPage(page, {
            regularBody: { rows: [] },
            expressBody: { rows: [] },
        });

        await expect(page.getByText("Нет заказов.")).toBeVisible();

        await page.getByRole("button", {
            name: "Экспресс",
        }).click();

        await expect(page.getByText("Нет заказов.")).toBeVisible();
    });

    test("если загрузка обычных заказов упала, показывает ошибку", async ({ page }) => {
        await openOrdersPage(page, {
            regularStatus: 500,
            regularBody: {
                message: "Ошибка",
            },
        });

        await expect(page.locator(".orders-message.error")).toHaveText(
            "Не удалось загрузить заказы"
        );
    });

    test("если загрузка express-заказов упала, показывает ошибку", async ({ page }) => {
        await openOrdersPage(page, {
            expressStatus: 500,
            expressBody: {
                message: "Ошибка",
            },
        });

        await expect(page.locator(".orders-message.error")).toHaveText(
            "Не удалось загрузить заказы"
        );
    });

    test("показывает loading state", async ({ page }) => {
        await setAdminAuth(page);
        await setupMocks(page, {
            delayMs: 1000,
        });

        await page.goto(`${FRONT_URL}${ORDERS_PATH}`);
        await page.waitForLoadState("domcontentloaded");

        if (page.url().includes("/login")) {
            throw new Error("OrdersPage редиректит на /login");
        }

        await expect(page.locator(".orders-container")).toBeVisible();
        await expect(page.locator(".orders-message")).toHaveText("Загрузка...");
    });

    test("корректно показывает неизвестный express type и пустые поля", async ({ page }) => {
        await openOrdersPage(page, {
            expressBody: [
                {
                    id: 999,
                    type: "delivery",
                    fromAddress: "",
                    toAddress: "",
                    totalPrice: null,
                    status: "in_progress",
                    creatorId: null,
                    executorId: null,
                    createdAt: "2026-07-06T10:00:00.000Z",
                },
            ],
        });

        await page.getByRole("button", {
            name: "Экспресс",
        }).click();

        const row = regularRows(page).first();

        await expect(row).toContainText("999");
        await expect(row).toContainText("delivery");
        await expect(row).toContainText("—");
        await expect(row).toContainText("in_progress");
        await expect(row.locator(".status-badge")).toHaveClass(/active/);
    });
});