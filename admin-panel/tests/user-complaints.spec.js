import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3001";

// Если route в App.js другой — поменяй только это:
const COMPLAINTS_PATH = "/users/123/complaints";

const complaintsResponse = {
    username: "Аким",
    complaints: [
        {
            date: "2026-07-01T10:00:00.000Z",
            complaintText: "Пользователь не вышел на связь",
        },
        {
            date: "2026-07-02T11:00:00.000Z",
            complaintText: "Некорректное поведение",
        },
    ],
};

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
        body = complaintsResponse,
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

    await page.route("**/api/admin/users/123/complaints", async (route) => {
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

async function openComplaintsPage(page, options = {}) {
    await setAdminAuth(page);
    await setupMocks(page, options);

    await page.goto(`${FRONT_URL}${COMPLAINTS_PATH}`);
    await page.waitForLoadState("domcontentloaded");

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "user-complaints-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("UserComplaintsPage редиректит на /login. Проверь PrivateRoute.");
    }

    if (!(await page.locator(".complaints-container").count())) {
        await page.screenshot({
            path: "user-complaints-wrong-route.png",
            fullPage: true,
        });

        throw new Error(
            `UserComplaintsPage не найдена. Текущий URL: ${page.url()}. Проверь COMPLAINTS_PATH в тесте.`
        );
    }

    await expect(page.locator(".complaints-container")).toBeVisible({
        timeout: 15000,
    });
}

function rows(page) {
    return page.locator(".complaints-table tbody tr");
}

test.describe("UserComplaintsPage", () => {
    test("отображает заголовок с username и userId", async ({ page }) => {
        await openComplaintsPage(page);

        await expect(page.getByRole("heading", {
            name: "Жалобы на Аким #123",
        })).toBeVisible();
    });

    test("запрашивает жалобы пользователя с authToken", async ({ page }) => {
        let requestData = null;

        await openComplaintsPage(page, {
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
                    url: expect.stringContaining("/api/admin/users/123/complaints"),
                    headers: expect.objectContaining({
                        authorization: "Bearer admin-test-token",
                    }),
                })
            );
    });

    test("отображает таблицу жалоб", async ({ page }) => {
        await openComplaintsPage(page);

        await expect(page.locator(".complaints-table-wrapper")).toBeVisible();
        await expect(page.locator(".complaints-table")).toBeVisible();

        await expect(page.locator("thead")).toContainText("Дата");
        await expect(page.locator("thead")).toContainText("Текст жалобы");

        await expect(rows(page)).toHaveCount(2);

        await expect(rows(page).nth(0)).toContainText("Пользователь не вышел на связь");
        await expect(rows(page).nth(1)).toContainText("Некорректное поведение");
    });

    test("если username пустой, показывает fallback в заголовке", async ({ page }) => {
        await openComplaintsPage(page, {
            body: {
                username: "",
                complaints: complaintsResponse.complaints,
            },
        });

        await expect(page.getByRole("heading", {
            name: "Жалобы на пользователя #123",
        })).toBeVisible();
    });

    test("если жалоб нет, показывает empty state", async ({ page }) => {
        await openComplaintsPage(page, {
            body: {
                username: "Аким",
                complaints: [],
            },
        });

        await expect(page.locator(".complaints-table")).not.toBeVisible();
        await expect(page.locator(".empty-state")).toBeVisible();
        await expect(page.getByText("На этого пользователя нет жалоб.")).toBeVisible();
    });

    test("если complaints не пришли, показывает empty state", async ({ page }) => {
        await openComplaintsPage(page, {
            body: {
                username: "Аким",
            },
        });

        await expect(page.locator(".complaints-table")).not.toBeVisible();
        await expect(page.getByText("На этого пользователя нет жалоб.")).toBeVisible();
    });

    test("если дата или текст жалобы пустые, показывает прочерки", async ({ page }) => {
        await openComplaintsPage(page, {
            body: {
                username: "Аким",
                complaints: [
                    {
                        date: null,
                        complaintText: "",
                    },
                ],
            },
        });

        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page).first()).toContainText("—");
    });

    test("если загрузка жалоб упала, показывает ошибку", async ({ page }) => {
        await openComplaintsPage(page, {
            status: 500,
            body: {
                message: "Ошибка",
            },
        });

        await expect(page.getByRole("heading", {
            name: "Жалобы пользователя #123",
        })).toBeVisible();

        await expect(page.locator(".complaints-message.error")).toHaveText(
            "Не удалось загрузить жалобы"
        );
    });

    test("показывает loading state", async ({ page }) => {
        await setAdminAuth(page);
        await setupMocks(page, {
            delayMs: 1000,
        });

        await page.goto(`${FRONT_URL}${COMPLAINTS_PATH}`);
        await page.waitForLoadState("domcontentloaded");

        if (page.url().includes("/login")) {
            throw new Error("UserComplaintsPage редиректит на /login");
        }

        await expect(page.locator(".complaints-container")).toBeVisible();
        await expect(page.locator(".complaints-message")).toHaveText("Загрузка...");
    });
});