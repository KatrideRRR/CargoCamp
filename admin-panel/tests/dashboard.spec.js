import { test, expect } from "./fixtures/safeTest";
import { setAdminAuth } from "./utils/adminTestAuth";

const FRONT_URL = "http://localhost:3001";

// Если Dashboard route другой — поменяй только это:
const DASHBOARD_PATH = "/dashboard";


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

    test("показывает новые административные разделы", async ({ page }) => {
        await openDashboard(page);

        const identityLink = page.getByRole("link", {
            name: "Проверка личности",
        });

        const benefitsLink = page.getByRole("link", {
            name: "Проверка льгот",
        });

        await expect(identityLink).toBeVisible();
        await expect(benefitsLink).toBeVisible();

        await expect(identityLink).toHaveAttribute(
            "href",
            "/identity"
        );

        await expect(benefitsLink).toHaveAttribute(
            "href",
            "/benefits"
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