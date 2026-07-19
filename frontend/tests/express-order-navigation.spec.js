import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3000";

const executorUser = {
    id: 2,
    username: "executor",
    role: "executor",
};

const creatorUser = {
    id: 1,
    username: "creator",
    role: "customer",
};

const baseTaxiOrder = {
    id: 201,
    type: "taxi",
    status: "accepted",
    creatorId: 1,
    executorId: 2,
    totalPrice: 700,
    paymentType: "cash",

    fromAddress: "Симферополь, улица Пушкина, 1",
    toAddress: "Симферополь, проспект Кирова, 10",

    fromLat: 44.9521,
    fromLng: 34.1024,
    toLat: 44.9482,
    toLng: 34.1001,

    description: "Нужно такси",
    distanceKm: 3.4,
    estimatedTimeMin: 12,
    createdAt: "2026-07-01T10:00:00.000Z",
    updatedAt: "2026-07-01T10:00:00.000Z",
};

const baseCourierOrder = {
    id: 202,
    type: "courier",
    status: "picked_up",
    creatorId: 1,
    executorId: 2,
    totalPrice: 500,
    paymentType: "guarantee",

    fromAddress: "Симферополь, центр",
    toAddress: "Симферополь, вокзал",

    fromLat: 44.9525,
    fromLng: 34.1028,
    toLat: 44.9642,
    toLng: 34.0874,

    description: "Доставить документы",
    distanceKm: 5.1,
    estimatedTimeMin: 18,
    createdAt: "2026-07-02T10:00:00.000Z",
    updatedAt: "2026-07-02T10:00:00.000Z",
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

async function setFakeAuth(page, user = executorUser) {
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

async function setupMocks(page, options = {}) {
    const {
        user = executorUser,
        expressOrders = [baseTaxiOrder],
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

    await page.route("**/api/auth/1", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(creatorUser),
        });
    });

    await page.route("**/api/auth/user/1", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(creatorUser),
        });
    });

    await page.route("**/api/auth/2", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(executorUser),
        });
    });

    await page.route("**/api/auth/user/2", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(executorUser),
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
                success: true,
                orders: expressOrders,
            }),
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

    await page.route("**/api/orders/me/status", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                debt: 0,
            }),
        });
    });
}

async function openActiveOrdersPage(page, options = {}) {
    await setFakeAuth(page, options.user || executorUser);
    await setupMocks(page, options);

    const query = options.query || "platform=web&view=performing";

    await page.goto(`${FRONT_URL}/active-orders?${query}`, {

        waitUntil: "domcontentloaded",

        timeout: 30000,

    });

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "express-route-buttons-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("ActiveOrdersPage редиректит на /login. Fake JWT не применился.");
    }

    await expect(page.locator(".order-card.express-card").first()).toBeVisible({
        timeout: 15000,
    });
}

function expressCard(page, text = "Экспресс №201") {
    return page.locator(".order-card.express-card").filter({
        hasText: text,
    });
}

test.describe("Навигация экспресс-заказа", () => {
    test("для accepted показывает маршрут к точке A", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "accepted",
                },
            ],
        });

        const card = expressCard(page);

        await expect(
            card.getByRole("button", {
                name: /Маршрут к A/i,
            })
        ).toBeVisible();

        await expect(
            card.getByRole("button", {
                name: /Маршрут к B/i,
            })
        ).not.toBeVisible();
    });

    test("для taxi on_the_way_to_A показывает маршрут к точке A", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "on_the_way_to_A",
                },
            ],
        });

        const card = expressCard(page);

        await expect(
            card.getByRole("button", {
                name: /Маршрут к A/i,
            })
        ).toBeVisible();
    });

    test("для taxi in_progress показывает маршрут к точке B", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "in_progress",
                },
            ],
        });

        const card = expressCard(page);

        await expect(
            card.getByRole("button", {
                name: /Маршрут к B/i,
            })
        ).toBeVisible();

        await expect(
            card.getByRole("button", {
                name: /Маршрут к A/i,
            })
        ).not.toBeVisible();
    });

    test("для courier picked_up показывает маршрут к точке B", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseCourierOrder,
                    status: "picked_up",
                },
            ],
        });

        const card = expressCard(page, "Экспресс №202");

        await expect(
            card.getByRole("button", {
                name: /Маршрут к B/i,
            })
        ).toBeVisible();
    });

    test("у заказчика кнопка маршрута не отображается", async ({ page }) => {
        await openActiveOrdersPage(page, {
            user: creatorUser,
            query: "platform=web&view=created",
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "accepted",
                },
            ],
        });

        const card = expressCard(page);

        await expect(card).toBeVisible();

        await expect(
            card.getByRole("button", {
                name: /Маршрут к [AB]/i,
            })
        ).not.toBeVisible();
    });

    test("маршрут к A открывает координаты точки отправления", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "accepted",
                },
            ],
        });

        await page.evaluate(() => {
            window.__openedUrl = null;

            window.confirm = () => true;

            window.open = (url) => {
                window.__openedUrl = String(url);

                return {
                    closed: false,
                    focus() {},
                };
            };
        });

        const card = expressCard(page);

        await card.getByRole("button", {
            name: /Маршрут к A/i,
        }).click();

        await expect
            .poll(() =>
                page.evaluate(() => window.__openedUrl)
            )
            .toContain("https://yandex.ru/navi/");

        const openedUrl = await page.evaluate(
            () => window.__openedUrl
        );

        expect(openedUrl).toContain("44.9521");
        expect(openedUrl).toContain("34.1024");
    });

    test("маршрут к B открывает координаты точки назначения", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "in_progress",
                },
            ],
        });

        await page.evaluate(() => {
            window.__openedUrl = null;

            window.confirm = () => true;

            window.open = (url) => {
                window.__openedUrl = String(url);

                return {
                    closed: false,
                    focus() {},
                };
            };
        });

        const card = expressCard(page);

        await card.getByRole("button", {
            name: /Маршрут к B/i,
        }).click();

        await expect
            .poll(() =>
                page.evaluate(() => window.__openedUrl)
            )
            .toContain("https://yandex.ru/navi/");

        const openedUrl = await page.evaluate(
            () => window.__openedUrl
        );

        expect(openedUrl).toContain("44.9482");
        expect(openedUrl).toContain("34.1001");
    });

    test("отмена подтверждения не открывает маршрут", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "accepted",
                },
            ],
        });

        await page.evaluate(() => {
            window.__openedUrl = null;

            window.confirm = () => false;

            window.open = (url) => {
                window.__openedUrl = String(url);

                return {
                    closed: false,
                    focus() {},
                };
            };
        });

        const card = expressCard(page);

        await card.getByRole("button", {
            name: /Маршрут к A/i,
        }).click();

        await page.waitForTimeout(200);

        const openedUrl = await page.evaluate(
            () => window.__openedUrl
        );

        expect(openedUrl).toBeNull();
    });

    test("при отсутствии координат показывает предупреждение", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "accepted",

                    fromLat: null,
                    fromLng: null,
                    from_lat: null,
                    from_lng: null,

                    fromCoordinates: null,
                    from_coordinates: null,
                    pickupCoordinates: null,
                },
            ],
        });

        const card = expressCard(page);

        const routeButton = card.getByRole("button", {
            name: /Маршрут к A/i,
        });

        await expect(routeButton).toBeVisible();
        await expect(routeButton).toBeEnabled();

        let alertMessage = null;

        page.once("dialog", async (dialog) => {
            alertMessage = dialog.message();
            await dialog.accept();
        });

        await routeButton.click();

        await expect
            .poll(() => alertMessage, {
                timeout: 5000,
            })
            .toBe("Координаты заказа не найдены");
    });

    test("кнопка маршрута имеет type button и общий CSS-класс", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "accepted",
                },
            ],
        });

        const card = expressCard(page);

        const button = card.getByRole("button", {
            name: /Маршрут к A/i,
        });

        await expect(button).toHaveAttribute("type", "button");
        await expect(button).toHaveClass(/express-secondaryBtn/);
    });
});