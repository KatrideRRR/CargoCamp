import { test, expect } from "./fixtures/safeTest";
import { setAdminAuth } from "./utils/adminTestAuth";

import {
    mockUsersNavigation,
    mockOrdersNavigation,
    mockSupportNavigation,
} from "./utils/mockAdminNavigation";

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

        await mockUsersNavigation(page);

        await page.getByRole("link", {
            name: "Пользователи",
        }).click();

        await expect(page).toHaveURL(/\/users/);
        await expect(
            page.locator(".users-container")
        ).toBeVisible();
    });

    test("переходит на страницу заказов", async ({ page }) => {
        await openDashboard(page);

        await mockOrdersNavigation(page);

        await page.getByRole("link", {
            name: "Заказы",
        }).click();

        await expect(page).toHaveURL(/\/orders/);
        await expect(
            page.locator(".orders-container")
        ).toBeVisible();
    });

    test(
        "переходит из Dashboard в проверку личности",
        async ({ page }) => {
            await openDashboard(page);

            await page.route(
                "**/api/admin/identity/pending",
                async (route) => {
                    await route.fulfill({
                        status: 200,
                        json: {
                            success: true,
                            applications: [],
                        },
                    });
                }
            );

            await page.route(
                "**/api/admin/identity/verified**",
                async (route) => {
                    await route.fulfill({
                        status: 200,
                        json: {
                            success: true,
                            users: [],
                            total: 0,
                        },
                    });
                }
            );

            await page.getByRole("link", {
                name: "Проверка личности",
            }).click();

            await expect(page).toHaveURL(
                /\/identity$/
            );

            await expect(
                page.locator(".admin-identity-page")
            ).toBeVisible();

            await expect(
                page.locator(".admin-identity-container")
            ).toBeVisible();
        }
    );

    test(
        "переходит из Dashboard в проверку льгот",
        async ({ page }) => {
            await openDashboard(page);

            await page.route(
                "**/api/admin/benefits/pending",
                async (route) => {
                    await route.fulfill({
                        status: 200,
                        json: {
                            success: true,
                            applications: [],
                        },
                    });
                }
            );

            await page.getByRole("link", {
                name: "Проверка льгот",
            }).click();

            await expect(page).toHaveURL(
                /\/benefits$/
            );

            await expect(
                page.locator(".admin-benefits-page")
            ).toBeVisible();

            await expect(
                page.locator(".admin-benefits-container")
            ).toBeVisible();
        }
    );

    test("переходит на страницу поддержки", async ({ page }) => {
        await openDashboard(page);

        await mockSupportNavigation(page);

        await page.getByRole("link", {
            name: "Поддержка",
        }).click();

        await expect(page).toHaveURL(/\/support/);
    });
});