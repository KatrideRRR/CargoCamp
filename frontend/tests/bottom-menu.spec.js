import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3000";

const testUser = {
    id: 123,
    username: "testuser",
    role: "customer",
    debt: 0,
    locationLat: 44.9521,
    locationLng: 34.1024,
    locationAddress: "Симферополь, улица Пушкина, 1",
    preferredCategoryIds: [1],
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

async function setFakeAuth(page, user = testUser) {
    const fakeToken = createFakeJwt({
        id: user.id,
        role: user.role,
        name: user.username,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
    });

    await page.addInitScript(({ token, user }) => {
        localStorage.setItem("authToken", token);
        localStorage.setItem("user", JSON.stringify(user));
        localStorage.setItem("currentUser", JSON.stringify(user));
        localStorage.setItem("userData", JSON.stringify(user));
    }, {
        token: fakeToken,
        user,
    });
}

async function setupBottomMenuMocks(page, options = {}) {
    const {
        user = testUser,
        debt = 0,
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

    await page.route("**/api/auth/profile", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(user),
        });
    });

    await page.route("**/api/auth/me", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(user),
        });
    });

    await page.route("**/api/users/me", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(user),
        });
    });

    await page.route("**/api/orders/me/status", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                debt,
            }),
        });
    });

    await page.route("**/api/orders/all", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([]),
        });
    });

    await page.route("**/api/express/express-orders/available", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                success: true,
                orders: [],
            }),
        });
    });

    await page.route("**/api/category", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([]),
        });
    });

    await page.route("**/api/orders/active-orders", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                orders: [],
            }),
        });
    });

    await page.route("**/api/express/express-orders/me**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                orders: [],
            }),
        });
    });

    await page.route("**/api/orders/creator/*", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([]),
        });
    });

    await page.route("**/api/messages/**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([]),
        });
    });

    await page.route("**/api/disputes/order/**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                dispute: null,
            }),
        });
    });

    await page.route("**/api/orders/101", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                id: 101,
                creatorId: 1,
                executorId: 123,
                status: "active",
                description: "Тестовый заказ",
                address: "Симферополь",
                proposedSum: 1000,
                paymentType: "cash",
            }),
        });
    });

    await page.route("**/api/auth/1", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                id: 1,
                username: "creator",
            }),
        });
    });
}

async function openPageWithBottomMenu(page, path = "/", options = {}) {
    await setFakeAuth(page, options.user || testUser);
    await setupBottomMenuMocks(page, options);

    await page.goto(`${FRONT_URL}${path}`);
    await page.waitForLoadState("domcontentloaded");

    if (options.expectHidden) {
        return;
    }

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "bottom-menu-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("BottomMenu page редиректит на /login. Fake JWT не применился или роут другой.");
    }

    await expect(page.locator(".bottom-menu")).toBeVisible({
        timeout: 15000,
    });
}

function menuItem(page, label) {
    return page.locator(".bottom-menu").getByRole("button", {
        name: label,
        exact: true,
    });
}

test.describe("BottomMenu", () => {
    test("отображает нижнее меню на обычной странице", async ({ page }) => {
        await openPageWithBottomMenu(page, "/?platform=web");

        await expect(page.locator(".bottom-menu")).toBeVisible();
        await expect(page.locator(".bottom-menu__shell")).toBeVisible();
        await expect(page.locator(".bottom-menu__notch")).toHaveCount(1);

        await expect(page.locator(".bottom-menu")).toHaveAttribute(
            "aria-label",
            "Нижнее меню"
        );
    });

    test("показывает основные пункты меню", async ({ page }) => {
        await openPageWithBottomMenu(page, "/?platform=web");

        await expect(menuItem(page, "Старт")).toBeVisible();
        await expect(menuItem(page, "Заказы")).toBeVisible();
        await expect(menuItem(page, "В работе")).toBeVisible();
        await expect(menuItem(page, "Профиль")).toBeVisible();
        await expect(menuItem(page, "Мои заказы")).toBeVisible();

        const menu = page.locator(".bottom-menu");

        await expect(menu.getByText("Старт", { exact: true })).toBeVisible();
        await expect(menu.getByText("Заказы", { exact: true })).toBeVisible();
        await expect(menu.getByText("В работе", { exact: true })).toBeVisible();
        await expect(menu.getByText("Профиль", { exact: true })).toBeVisible();

    });

    test("ставит web-класс при platform=web", async ({ page }) => {
        await openPageWithBottomMenu(page, "/?platform=web");

        await expect(page.locator(".bottom-menu")).toHaveClass(/bottom-menu--web/);
    });

    test("ставит ios-класс при platform=ios", async ({ page }) => {
        await openPageWithBottomMenu(page, "/?platform=ios");

        await expect(page.locator(".bottom-menu")).toHaveClass(/bottom-menu--ios/);
    });

    test("ставит android-класс при platform=android", async ({ page }) => {
        await openPageWithBottomMenu(page, "/?platform=android");

        await expect(page.locator(".bottom-menu")).toHaveClass(/bottom-menu--android/);
    });

    test("на главной активен Старт", async ({ page }) => {
        await openPageWithBottomMenu(page, "/?platform=web");

        await expect(menuItem(page, "Старт")).toHaveClass(/is-active/);
        await expect(menuItem(page, "Заказы")).not.toHaveClass(/is-active/);
        await expect(menuItem(page, "В работе")).not.toHaveClass(/is-active/);
        await expect(menuItem(page, "Профиль")).not.toHaveClass(/is-active/);
    });

    test("на /orders активен пункт Заказы", async ({ page }) => {
        await openPageWithBottomMenu(page, "/orders?platform=web");

        await expect(menuItem(page, "Заказы")).toHaveClass(/is-active/);
        await expect(menuItem(page, "Старт")).not.toHaveClass(/is-active/);
    });

    test("на /active-orders активен пункт В работе", async ({ page }) => {
        await openPageWithBottomMenu(page, "/active-orders?platform=web");

        await expect(menuItem(page, "В работе")).toHaveClass(/is-active/);
    });

    test("на /profile активен пункт Профиль", async ({ page }) => {
        await openPageWithBottomMenu(page, "/profile?platform=web");

        await expect(menuItem(page, "Профиль")).toHaveClass(/is-active/);
    });

    test("на /my-orders активна центральная кнопка", async ({ page }) => {
        await openPageWithBottomMenu(page, "/my-orders/123?platform=web", {
            expectHidden: false,
        });

        await expect(menuItem(page, "Мои заказы")).toHaveClass(/is-active/);
    });

    test("переходит на Старт", async ({ page }) => {
        await openPageWithBottomMenu(page, "/profile?platform=web");

        await menuItem(page, "Старт").click();

        await expect(page).toHaveURL(new RegExp(`${FRONT_URL}/?$`));
    });

    test("переходит на Заказы", async ({ page }) => {
        await openPageWithBottomMenu(page, "/?platform=web");

        await menuItem(page, "Заказы").click();

        await expect(page).toHaveURL(/\/orders/);
    });

    test("переходит на В работе", async ({ page }) => {
        await openPageWithBottomMenu(page, "/?platform=web");

        await menuItem(page, "В работе").click();

        await expect(page).toHaveURL(/\/active-orders/);
    });

    test("переходит на Профиль", async ({ page }) => {
        await openPageWithBottomMenu(page, "/?platform=web");

        await menuItem(page, "Профиль").click();

        await expect(page).toHaveURL(/\/profile/);
    });

    test("центральная кнопка ведёт на Мои заказы текущего пользователя", async ({ page }) => {
        await openPageWithBottomMenu(page, "/?platform=web");

        await menuItem(page, "Мои заказы").click();

        await expect(page).toHaveURL(/\/my-orders\/123/);
    });

    test("показывает badge долга на профиле", async ({ page }) => {
        await openPageWithBottomMenu(page, "/?platform=web", {
            debt: 20000,
        });

        const profileButton = menuItem(page, "Профиль");

        await expect(profileButton.locator(".bottom-menu__badge")).toHaveText("!");
    });

    test("не показывает badge долга, если долга нет", async ({ page }) => {
        await openPageWithBottomMenu(page, "/?platform=web", {
            debt: 0,
        });

        const profileButton = menuItem(page, "Профиль");

        await expect(profileButton.locator(".bottom-menu__badge")).not.toBeVisible();
    });

    test("кнопки имеют type button", async ({ page }) => {
        await openPageWithBottomMenu(page, "/?platform=web");

        await expect(menuItem(page, "Старт")).toHaveAttribute("type", "button");
        await expect(menuItem(page, "Заказы")).toHaveAttribute("type", "button");
        await expect(menuItem(page, "В работе")).toHaveAttribute("type", "button");
        await expect(menuItem(page, "Профиль")).toHaveAttribute("type", "button");
        await expect(menuItem(page, "Мои заказы")).toHaveAttribute("type", "button");
    });

    test("скрывается на /messages", async ({ page }) => {
        await openPageWithBottomMenu(page, "/messages/regular/101?platform=web", {
            expectHidden: true,
        });

        await expect(page.locator(".bottom-menu")).not.toBeVisible({
            timeout: 10000,
        });
    });

    test("скрывается на /chat", async ({ page }) => {
        await openPageWithBottomMenu(page, "/chat/regular/101?platform=web", {
            expectHidden: true,
        });

        await expect(page.locator(".bottom-menu")).not.toBeVisible({
            timeout: 10000,
        });
    });
});