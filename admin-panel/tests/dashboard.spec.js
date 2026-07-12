import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3001";

// Если Dashboard route другой — поменяй только это:
const DASHBOARD_PATH = "/dashboard";

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

async function openDashboard(page) {
    await setAdminAuth(page);

    await page.goto(`${FRONT_URL}${DASHBOARD_PATH}`);
    await page.waitForLoadState("domcontentloaded");

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "dashboard-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("Dashboard редиректит на /login. Проверь PrivateRoute.");
    }

    if (!(await page.locator(".dashboard-page").count())) {
        await page.screenshot({
            path: "dashboard-wrong-route.png",
            fullPage: true,
        });

        throw new Error(
            `Dashboard не найден. Текущий URL: ${page.url()}. Проверь DASHBOARD_PATH в тесте.`
        );
    }

    await expect(page.locator(".dashboard-page")).toBeVisible({
        timeout: 15000,
    });
}

test.describe("Dashboard", () => {
    test("отображает панель администратора", async ({ page }) => {
        await openDashboard(page);

        await expect(page.locator(".dashboard-container")).toBeVisible();

        await expect(page.getByRole("heading", {
            name: "Панель администратора",
        })).toBeVisible();

        await expect(page.locator(".dashboard-title")).toHaveText(
            "Панель администратора"
        );
    });

    test("отображает основные ссылки навигации", async ({ page }) => {
        await openDashboard(page);

        await expect(page.locator(".dashboard-nav")).toBeVisible();

        await expect(page.getByRole("link", {
            name: "Пользователи",
        })).toBeVisible();

        await expect(page.getByRole("link", {
            name: "Заказы",
        })).toBeVisible();

        await expect(page.getByRole("link", {
            name: "Поддержка",
        })).toBeVisible();
    });

    test("ссылки имеют правильные href", async ({ page }) => {
        await openDashboard(page);

        await expect(page.getByRole("link", {
            name: "Пользователи",
        })).toHaveAttribute("href", "/users");

        await expect(page.getByRole("link", {
            name: "Заказы",
        })).toHaveAttribute("href", "/orders");

        await expect(page.getByRole("link", {
            name: "Поддержка",
        })).toHaveAttribute("href", "/support");
    });

    test("переходит на страницу пользователей", async ({ page }) => {
        await openDashboard(page);

        await page.getByRole("link", {
            name: "Пользователи",
        }).click();

        await expect(page).toHaveURL(/\/users/);
    });

    test("переходит на страницу заказов", async ({ page }) => {
        await openDashboard(page);

        await page.getByRole("link", {
            name: "Заказы",
        }).click();

        await expect(page).toHaveURL(/\/orders/);
    });

    test("переходит на страницу поддержки", async ({ page }) => {
        await openDashboard(page);

        await page.getByRole("link", {
            name: "Поддержка",
        }).click();

        await expect(page).toHaveURL(/\/support/);
    });
});