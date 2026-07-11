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

async function mockGeolocation(page, options = {}) {
    const {
        latitude = 44.9521,
        longitude = 34.1024,
        shouldFail = false,
        message = "GPS недоступен",
    } = options;

    await page.addInitScript(({ latitude, longitude, shouldFail, message }) => {
        Object.defineProperty(navigator, "geolocation", {
            configurable: true,
            value: {
                getCurrentPosition: (success, error) => {
                    setTimeout(() => {
                        if (shouldFail) {
                            error?.({
                                code: 1,
                                message,
                            });
                            return;
                        }

                        success({
                            coords: {
                                latitude,
                                longitude,
                            },
                        });
                    }, 50);
                },
            },
        });

        window.__openedUrls = [];

        window.open = (url) => {
            window.__openedUrls.push(url);

            return {
                closed: false,
                focus: () => {},
            };
        };
    }, {
        latitude,
        longitude,
        shouldFail,
        message,
    });
}

async function setupMocks(page, options = {}) {
    const {
        user = executorUser,
        expressOrders = [baseTaxiOrder],
        toAStatus = 200,
        toABody = {
            success: true,
            url: "https://yandex.ru/maps/?rtext=my~A",
        },
        atoBStatus = 200,
        atoBBody = {
            success: true,
            url: "https://yandex.ru/maps/?rtext=A~B",
        },
        onToA,
        onAtoB,
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

    await page.route("**/api/express/express-orders/*/route/to-A**", async (route) => {
        const url = new URL(route.request().url());

        onToA?.({
            myLat: url.searchParams.get("myLat"),
            myLng: url.searchParams.get("myLng"),
        });

        await route.fulfill({
            status: toAStatus,
            contentType: "application/json",
            body: JSON.stringify(toABody),
        });
    });

    await page.route("**/api/express/express-orders/*/route/A-to-B", async (route) => {
        onAtoB?.();

        await route.fulfill({
            status: atoBStatus,
            contentType: "application/json",
            body: JSON.stringify(atoBBody),
        });
    });
}

async function openActiveOrdersPage(page, options = {}) {
    await mockGeolocation(page, options.geo || {});
    await setFakeAuth(page, options.user || executorUser);
    await setupMocks(page, options);

    const query = options.query || "platform=web&view=performing";

    await page.goto(`${FRONT_URL}/active-orders?${query}`);
    await page.waitForLoadState("domcontentloaded");

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

async function getOpenedUrls(page) {
    return await page.evaluate(() => window.__openedUrls || []);
}

test.describe("ExpressRouteButtons", () => {
    test("при navMode toA показывает кнопку До точки A", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "accepted",
                },
            ],
        });

        const card = expressCard(page);

        await expect(card.getByRole("button", {
            name: /До точки A/i,
        })).toBeVisible();

        await expect(card.getByRole("button", {
            name: /Маршрут A→B/i,
        })).not.toBeVisible();
    });

    test("при navMode AtoB показывает кнопку Маршрут A→B для taxi in_progress", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "in_progress",
                },
            ],
        });

        const card = expressCard(page);

        await expect(card.getByRole("button", {
            name: /Маршрут A→B/i,
        })).toBeVisible();

        await expect(card.getByRole("button", {
            name: /До точки A/i,
        })).not.toBeVisible();
    });

    test("при navMode AtoB показывает кнопку Маршрут A→B для courier picked_up", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseCourierOrder,
                    status: "picked_up",
                },
            ],
        });

        const card = expressCard(page, "Экспресс №202");

        await expect(card.getByRole("button", {
            name: /Маршрут A→B/i,
        })).toBeVisible();
    });

    test("у заказчика кнопки маршрута не отображаются", async ({ page }) => {
        await openActiveOrdersPage(page, {
            user: creatorUser,
            query: "platform=web&view=created",
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "accepted",
                    creatorId: 1,
                    executorId: 2,
                },
            ],
        });

        const card = expressCard(page);

        await expect(card).toBeVisible();

        await expect(card.getByRole("button", {
            name: /До точки A/i,
        })).not.toBeVisible();

        await expect(card.getByRole("button", {
            name: /Маршрут A→B/i,
        })).not.toBeVisible();
    });

    test("кнопка До точки A получает GPS, вызывает route/to-A и открывает ссылку", async ({ page }) => {
        let routeParams = null;

        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "accepted",
                },
            ],
            geo: {
                latitude: 44.9555,
                longitude: 34.1111,
            },
            onToA: (params) => {
                routeParams = params;
            },
        });

        const card = expressCard(page);

        await card.getByRole("button", {
            name: /До точки A/i,
        }).click();

        await expect
            .poll(() => routeParams, {
                timeout: 10000,
            })
            .toEqual({
                myLat: "44.9555",
                myLng: "34.1111",
            });

        await expect
            .poll(async () => await getOpenedUrls(page), {
                timeout: 10000,
            })
            .toContain("https://yandex.ru/maps/?rtext=my~A");
    });

    test("кнопка Маршрут A→B вызывает route/A-to-B и открывает ссылку", async ({ page }) => {
        let called = false;

        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "in_progress",
                },
            ],
            onAtoB: () => {
                called = true;
            },
        });

        const card = expressCard(page);

        await card.getByRole("button", {
            name: /Маршрут A→B/i,
        }).click();

        await expect
            .poll(() => called, {
                timeout: 10000,
            })
            .toBe(true);

        await expect
            .poll(async () => await getOpenedUrls(page), {
                timeout: 10000,
            })
            .toContain("https://yandex.ru/maps/?rtext=A~B");
    });

    test("при ошибке GPS не вызывает route/to-A", async ({ page }) => {
        let routeCalled = false;

        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "accepted",
                },
            ],
            geo: {
                shouldFail: true,
                message: "User denied Geolocation",
            },
            onToA: () => {
                routeCalled = true;
            },
        });

        const card = expressCard(page);

        await card.getByRole("button", {
            name: /До точки A/i,
        }).click();

        await page.waitForTimeout(500);

        expect(routeCalled).toBe(false);
    });

    test("при ответе без url не открывает новую вкладку", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "in_progress",
                },
            ],
            atoBBody: {
                success: true,
                url: "",
            },
        });

        const card = expressCard(page);

        await card.getByRole("button", {
            name: /Маршрут A→B/i,
        }).click();

        await page.waitForTimeout(500);

        const urls = await getOpenedUrls(page);

        expect(urls).toEqual([]);
    });

    test("при ошибке API не открывает новую вкладку", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "in_progress",
                },
            ],
            atoBStatus: 500,
            atoBBody: {
                message: "Маршрут временно недоступен",
            },
        });

        const card = expressCard(page);

        await card.getByRole("button", {
            name: /Маршрут A→B/i,
        }).click();

        await page.waitForTimeout(500);

        const urls = await getOpenedUrls(page);

        expect(urls).toEqual([]);
    });

    test("кнопка имеет type button и общий CSS-класс", async ({ page }) => {
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
            name: /До точки A/i,
        });

        await expect(button).toHaveAttribute("type", "button");
        await expect(button).toHaveClass(/express-secondaryBtn/);
    });
});