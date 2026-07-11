import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3000";

const creator = {
    id: 1,
    username: "Иван",
    rating: 4.7,
    complaintsCount: 2,
};

const viewer = {
    id: 2,
    username: "Артем",
    role: "executor",
    debt: 0,
};

const regularOrder = {
    id: 101,
    type: "Доставка",
    description: "Привезти груз аккуратно и быстро",
    address: "Симферополь, улица Пушкина, 1",
    paymentType: "cash",
    proposedSum: 500,
    creatorId: 1,
    executorId: null,
    images: ["/uploads/orders/101/photo1.jpg", "/uploads/orders/101/photo2.jpg"],
    category: { name: "Грузы" },
    subcategory: { name: "Мебель" },
    service: { name: "Перевозка" },
    createdAt: "2026-07-01T10:00:00.000Z",
    status: "pending",
    is_highlighted: false,
    is_recommended: true,
};

const ownRegularOrder = {
    ...regularOrder,
    creatorId: 2,
};

const acceptedRegularOrder = {
    ...regularOrder,
    executorId: 5,
};

const expressOrder = {
    id: 201,
    type: "taxi",
    status: "created",
    creatorId: 1,
    executorId: null,
    createdAt: "2026-07-02T10:00:00.000Z",
    totalPrice: 700,
    paymentType: "cash",
    fromAddress: "Симферополь, улица Пушкина, 1",
    toAddress: "Симферополь, проспект Кирова, 10",
    fromLat: 44.9521,
    fromLng: 34.1024,
    toLat: 44.9489,
    toLng: 34.0987,
    description: "Нужно доехать до центра",
    images: ["/uploads/express/201/photo1.jpg", "/uploads/express/201/photo2.jpg"],
};

const ownExpressOrder = {
    ...expressOrder,
    creatorId: 2,
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

async function setFakeAuth(page, user = viewer) {
    const fakeToken = createFakeJwt({
        id: user.id,
        role: user.role || "executor",
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

async function setupOrderMocks(page, options = {}) {
    const {
        order = regularOrder,
        creatorBody = creator,
        profileBody = viewer,
        orderStatus = 200,
        profileStatus = 200,
        creatorStatus = 200,
        requestStatusBody = { debt: 0 },
        requestPostStatus = 200,
        requestPostBody = { success: true },
        express = false,
        acceptStatus = 200,
        acceptBody = { success: true },
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
            status: profileStatus,
            contentType: "application/json",
            body: JSON.stringify(profileBody),
        });
    });

    await page.route("**/api/auth/1", async (route) => {
        await route.fulfill({
            status: creatorStatus,
            contentType: "application/json",
            body: JSON.stringify(creatorBody),
        });
    });

    await page.route("**/api/orders/101", async (route) => {
        await route.fulfill({
            status: orderStatus,
            contentType: "application/json",
            body: JSON.stringify(order),
        });
    });

    await page.route("**/api/express/express-orders/201", async (route) => {
        await route.fulfill({
            status: orderStatus,
            contentType: "application/json",
            body: JSON.stringify({
                success: true,
                order,
            }),
        });
    });

    await page.route("**/api/orders/me/status", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(requestStatusBody),
        });
    });

    await page.route("**/api/orders/101/request", async (route) => {
        await route.fulfill({
            status: requestPostStatus,
            contentType: "application/json",
            body: JSON.stringify(requestPostBody),
        });
    });

    await page.route("**/api/express/express-orders/201/accept", async (route) => {
        await route.fulfill({
            status: acceptStatus,
            contentType: "application/json",
            body: JSON.stringify(acceptBody),
        });
    });

    // На случай, если ExpressRouteButtons внутри делает служебные запросы.
    await page.route("**/api/express/express-orders/201/**", async (route) => {
        if (route.request().url().includes("/accept")) {
            await route.continue();
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                success: true,
            }),
        });
    });
}

async function openRegularOrderPage(page, options = {}) {
    await setFakeAuth(page, options.profileBody || viewer);
    await setupOrderMocks(page, {
        ...options,
        express: false,
    });

    const query = options.query || "platform=web";

    await page.goto(`${FRONT_URL}/order/101?${query}`);

    await page.waitForLoadState("domcontentloaded");

    if (options.waitForPage === false) {
        return;
    }

    await expect(page.getByText("Загрузка...")).not.toBeVisible({
        timeout: 15000,
    });
}

async function openExpressOrderPage(page, options = {}) {
    await setFakeAuth(page, options.profileBody || viewer);
    await setupOrderMocks(page, {
        ...options,
        order: options.order || expressOrder,
        express: true,
    });

    const query = options.query || "platform=web";

    await page.goto(`${FRONT_URL}/express-order/201?${query}`);

    await page.waitForLoadState("domcontentloaded");

    if (options.waitForPage === false) {
        return;
    }

    await expect(page.getByText("Загрузка...")).not.toBeVisible({
        timeout: 15000,
    });
}

async function openRequestModal(page) {
    await page.getByRole("button", { name: "Запросить выполнение" }).click();

    await expect(page.locator(".request-order-content")).toBeVisible({
        timeout: 10000,
    });
}

async function clickByDom(page, selector, textIncludes) {
    await page.evaluate(({ selector, textIncludes }) => {
        const items = Array.from(document.querySelectorAll(selector));
        const element = textIncludes
            ? items.find((item) => item.textContent?.includes(textIncludes))
            : items[0];

        if (!element) {
            throw new Error(`Элемент не найден: ${selector} ${textIncludes || ""}`);
        }

        element.click();
    }, {
        selector,
        textIncludes,
    });
}

test.describe("OrderPage — обычный заказ", () => {
    test.beforeEach(async ({ page }) => {
        await openRegularOrderPage(page);
    });

    test("отображает обычный заказ", async ({ page }) => {
        await expect(page.locator(".orders-page")).toBeVisible();

        await expect(page.locator(".orders-title")).toHaveText("Заказ №101");

        await expect(page.getByText("Привезти груз аккуратно и быстро")).toBeVisible();
        await expect(page.getByText("Симферополь, улица Пушкина, 1")).toBeVisible();

        await expect(page.getByText("Грузы • Мебель • Перевозка")).toBeVisible();

        await expect(page.getByText("500 ₽")).toBeVisible();
        await expect(page.locator(".pay-type")).toHaveText("Наличные");

        await expect(page.locator(".orders-subtitle")).toContainText("от Иван");
        await expect(page.locator(".order-title-row")).toContainText("рейтинг 4.7");
    });

    test("ставит web-класс при platform=web", async ({ page }) => {
        await openRegularOrderPage(page, {
            query: "platform=web",
        });

        await expect(page.locator(".orders-page")).toHaveClass(/orders-page--web/);
    });

    test("ставит ios-класс при platform=ios", async ({ page }) => {
        await openRegularOrderPage(page, {
            query: "platform=ios",
        });

        await expect(page.locator(".orders-page")).toHaveClass(/orders-page--ios/);
    });

    test("ставит android-класс при platform=android", async ({ page }) => {
        await openRegularOrderPage(page, {
            query: "platform=android",
        });

        await expect(page.locator(".orders-page")).toHaveClass(/orders-page--android/);
    });

    test("показывает бейдж Можно взять для чужого pending заказа", async ({ page }) => {
        await expect(page.locator(".order-card")).toHaveClass(/can-take/);
        await expect(page.getByText("Можно взять")).toBeVisible();
        await expect(page.getByRole("button", { name: "Запросить выполнение" })).toBeVisible();
    });

    test("не показывает кнопку запроса для своего заказа", async ({ page }) => {
        await openRegularOrderPage(page, {
            order: ownRegularOrder,
        });

        await expect(page.getByText("Мой заказ")).toBeVisible();
        await expect(page.getByRole("button", { name: "Запросить выполнение" })).not.toBeVisible();
    });

    test("не показывает кнопку запроса, если заказ уже с исполнителем", async ({ page }) => {
        await openRegularOrderPage(page, {
            order: acceptedRegularOrder,
        });

        await expect(page.getByRole("button", { name: "Запросить выполнение" })).not.toBeVisible();
        await expect(page.getByText("Можно взять")).not.toBeVisible();
    });

    test("переходит на страницу жалоб создателя", async ({ page }) => {
        const link = page.getByRole("link", {
            name: /Жалобы/i,
        });

        await expect(link).toHaveAttribute("href", "/complaints/1");

        await link.click();

        await expect(page).toHaveURL(/\/complaints\/1/);
    });

    test("кнопка Назад возвращает назад", async ({ page }) => {
        await page.goto(`${FRONT_URL}/my-orders/2`);
        await page.goto(`${FRONT_URL}/order/101?platform=web`);

        await page.getByRole("button", { name: "Назад" }).click();

        await expect(page).toHaveURL(/\/my-orders\/2/);
    });

    test("открывает и закрывает модалку запроса выполнения", async ({ page }) => {
        await openRequestModal(page);

        await expect(page.locator(".request-order-title")).toHaveText("Запросить выполнение");
        await expect(page.getByPlaceholder("Например: 2500")).toBeVisible();
        await expect(page.getByPlaceholder("Например: могу приехать сегодня после 18:00")).toBeVisible();

        await page.getByRole("button", { name: "Отмена" }).click();

        await expect(page.locator(".request-order-content")).not.toBeVisible();
    });

    test("в поле суммы пропускает только цифры", async ({ page }) => {
        await openRequestModal(page);

        const input = page.getByPlaceholder("Например: 2500");

        await input.fill("25abc00");

        await expect(input).toHaveValue("2500");
    });

    test("кнопка отправки запроса отключена без суммы", async ({ page }) => {
        await openRequestModal(page);

        await expect(page.getByRole("button", { name: "Отправить запрос" })).toBeDisabled();
    });

    test("успешно отправляет запрос на выполнение", async ({ page }) => {
        let statusCalled = false;
        let requestBody = null;

        await page.route("**/api/orders/me/status", async (route) => {
            statusCalled = true;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    debt: 0,
                }),
            });
        });

        await page.route("**/api/orders/101/request", async (route) => {
            requestBody = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                }),
            });
        });

        await openRequestModal(page);

        await page.getByPlaceholder("Например: 2500").fill("2500");
        await page
            .getByPlaceholder("Например: могу приехать сегодня после 18:00")
            .fill("Могу приехать сегодня");

        await page.getByRole("button", { name: "Отправить запрос" }).click();

        await expect
            .poll(() => statusCalled, {
                timeout: 10000,
            })
            .toBe(true);

        await expect
            .poll(() => requestBody, {
                timeout: 10000,
            })
            .toEqual({
                proposedSum: 2500,
                comment: "Могу приехать сегодня",
            });

        await expect(page.locator(".request-order-content")).not.toBeVisible();
    });

    test("при ошибке отправки запроса модалка остаётся открытой", async ({ page }) => {
        await page.route("**/api/orders/101/request", async (route) => {
            await route.fulfill({
                status: 400,
                contentType: "application/json",
                body: JSON.stringify({
                    message: "Нельзя отправить запрос",
                }),
            });
        });

        await openRequestModal(page);

        await page.getByPlaceholder("Например: 2500").fill("2500");

        await page.getByRole("button", { name: "Отправить запрос" }).click();

        await expect(page.locator(".request-order-content")).toBeVisible({
            timeout: 10000,
        });
    });

    test("если нет токена, при запросе выполнения уводит на login", async ({ page }) => {
        await page.evaluate(() => {
            localStorage.removeItem("authToken");
        });

        await page.getByRole("button", { name: "Запросить выполнение" }).click();

        await expect(page).toHaveURL(/\/login/);
    });

    test("открывает модалку изображения и переключает фото", async ({ page }) => {
        await page.locator(".thumbs img").first().click();

        const modal = page.locator(".custom-modal-content");
        const modalImage = page.locator(".custom-modal-image");

        await expect(modal).toBeVisible();
        await expect(modalImage).toHaveAttribute("src", /photo1\.jpg/);

        await clickByDom(page, ".custom-nav-button", "▶");

        await expect(modalImage).toHaveAttribute("src", /photo2\.jpg/);

        await clickByDom(page, ".custom-nav-button", "◀");

        await expect(modalImage).toHaveAttribute("src", /photo1\.jpg/);

        await clickByDom(page, ".custom-close-button");

        await expect(modal).not.toBeVisible();
    });

    test("показывает ошибку, если заказ не загрузился", async ({ page }) => {
        await openRegularOrderPage(page, {
            orderStatus: 500,
            order: {
                message: "Заказ не найден",
            },
        });

        await expect(page.locator(".error-message")).toHaveText(
            "Ошибка: Заказ не найден"
        );
    });

    test("pull-to-refresh повторно загружает заказ и вызывает done", async ({ page }) => {
        let orderCalls = 0;

        await setFakeAuth(page);

        await page.route("**/api/auth/profile", async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(viewer),
            });
        });

        await page.route("**/api/auth/1", async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(creator),
            });
        });

        await page.route("**/api/orders/101", async (route) => {
            orderCalls += 1;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(regularOrder),
            });
        });

        await page.goto(`${FRONT_URL}/order/101?platform=web`);
        await page.waitForLoadState("domcontentloaded");

        await expect(page.locator(".orders-title")).toHaveText("Заказ №101", {
            timeout: 15000,
        });

        await expect
            .poll(() => orderCalls, {
                timeout: 10000,
            })
            .toBeGreaterThanOrEqual(1);

        await page.waitForTimeout(300);

        await page.evaluate(() => {
            window.__pullDone = false;

            window.dispatchEvent(
                new CustomEvent("appPullToRefresh", {
                    detail: {
                        done: () => {
                            window.__pullDone = true;
                        },
                    },
                })
            );
        });

        await expect
            .poll(() => orderCalls, {
                timeout: 10000,
            })
            .toBeGreaterThanOrEqual(2);

        const doneCalled = await page.evaluate(() => window.__pullDone === true);

        expect(doneCalled).toBe(true);
    });
});

test.describe("OrderPage — экспресс-заказ", () => {
    test.beforeEach(async ({ page }) => {
        await openExpressOrderPage(page);
    });

    test("отображает экспресс-заказ", async ({ page }) => {
        await expect(page.locator(".orders-title")).toHaveText("Экспресс №201");

        await expect(page.locator(".order-card")).toContainText("Такси");
        await expect(page.getByText("Можно принять")).toBeVisible();

        await expect(page.locator(".express-detail-route")).toContainText("Симферополь, улица Пушкина, 1");
        await expect(page.locator(".express-detail-route")).toContainText("Симферополь, проспект Кирова, 10");

        await expect(page.getByText("Нужно доехать до центра")).toBeVisible();
        await expect(page.getByText("700 ₽")).toBeVisible();
        await expect(page.getByRole("button", { name: "Принять" })).toBeVisible();
    });

    test("нормализует express order в карточку маршрута", async ({ page }) => {
        await expect(page.locator(".order-card")).toHaveClass(/express-detail-card/);
        await expect(page.locator(".order-card")).toHaveClass(/express-can-take/);

        await expect(page.getByText("Маршрут")).toBeVisible();
        await expect(page.getByText("Точка А")).toBeVisible();
        await expect(page.getByText("Точка Б")).toBeVisible();
        await expect(page.getByText("Ожидает исполнителя")).toBeVisible();
    });

    test("принимает экспресс-заказ после confirm", async ({ page }) => {
        let acceptCalled = false;

        await page.route("**/api/express/express-orders/201/accept", async (route) => {
            acceptCalled = true;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                }),
            });
        });

        page.once("dialog", async (dialog) => {
            expect(dialog.message()).toContain("взять в работу экспресс-заказ №201");
            await dialog.accept();
        });

        await page.getByRole("button", { name: "Принять" }).click();

        await expect
            .poll(() => acceptCalled, {
                timeout: 10000,
            })
            .toBe(true);

        await expect(page).toHaveURL(/\/active-orders/);
    });

    test("не принимает экспресс-заказ при отмене confirm", async ({ page }) => {
        let acceptCalled = false;

        await page.route("**/api/express/express-orders/201/accept", async (route) => {
            acceptCalled = true;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                }),
            });
        });

        page.once("dialog", async (dialog) => {
            await dialog.dismiss();
        });

        await page.getByRole("button", { name: "Принять" }).click();

        expect(acceptCalled).toBe(false);

        await expect(page).not.toHaveURL(/\/active-orders/);
    });

    test("если нет токена, при принятии экспресс-заказа уводит на login", async ({ page }) => {
        await page.evaluate(() => {
            localStorage.removeItem("authToken");
        });

        await page.getByRole("button", { name: "Принять" }).click();

        await expect(page).toHaveURL(/\/login/);
    });

    test("для своего экспресс-заказа показывает кнопку Мои активные", async ({ page }) => {
        await openExpressOrderPage(page, {
            order: ownExpressOrder,
        });

        await expect(page.getByText("Мой заказ")).toBeVisible();
        await expect(page.getByRole("button", { name: "Принять" })).not.toBeVisible();

        await page.getByRole("button", { name: "Мои активные" }).click();

        await expect(page).toHaveURL(/\/active-orders\?view=created/);
    });

    test("показывает ошибку, если экспресс-заказ не загрузился", async ({ page }) => {
        await openExpressOrderPage(page, {
            orderStatus: 500,
            order: {
                message: "Экспресс-заказ не найден",
            },
        });

        await expect(page.locator(".error-message")).toHaveText(
            "Ошибка: Ошибка загрузки заказа"
        );
    });
});