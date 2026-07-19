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
    status: "accepted",
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

function makeUpdatedOrder(order, status) {
    return {
        ...order,
        status,
        updatedAt: new Date().toISOString(),
    };
}

async function setupExpressCardMocks(page, options = {}) {
    const {
        user = executorUser,
        expressOrders = [baseTaxiOrder],
        actionOrder = null,
        actionStatus = 200,
        actionBody = null,
        activeRegular = [],
        onAction,
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
                orders: activeRegular,
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

    await page.route("**/api/express/express-orders/*/on-the-way", async (route) => {
        onAction?.("on-the-way");

        const order = actionOrder || makeUpdatedOrder(expressOrders[0], "on_the_way_to_A");

        await route.fulfill({
            status: actionStatus,
            contentType: "application/json",
            body: JSON.stringify(
                actionBody || {
                    success: true,
                    order,
                }
            ),
        });
    });

    await page.route("**/api/express/express-orders/*/arrived", async (route) => {
        onAction?.("arrived");

        const order = actionOrder || makeUpdatedOrder(expressOrders[0], "arrived_at_A");

        await route.fulfill({
            status: actionStatus,
            contentType: "application/json",
            body: JSON.stringify(
                actionBody || {
                    success: true,
                    order,
                }
            ),
        });
    });

    await page.route("**/api/express/express-orders/*/start-waiting", async (route) => {
        onAction?.("start-waiting");

        const order = actionOrder || makeUpdatedOrder(expressOrders[0], "waiting_at_A");

        await route.fulfill({
            status: actionStatus,
            contentType: "application/json",
            body: JSON.stringify(
                actionBody || {
                    success: true,
                    order,
                }
            ),
        });
    });

    await page.route("**/api/express/express-orders/*/pick-up", async (route) => {
        onAction?.("pick-up");

        const order = actionOrder || makeUpdatedOrder(expressOrders[0], "picked_up");

        await route.fulfill({
            status: actionStatus,
            contentType: "application/json",
            body: JSON.stringify(
                actionBody || {
                    success: true,
                    order,
                }
            ),
        });
    });

    await page.route("**/api/express/express-orders/*/start", async (route) => {
        onAction?.("start");

        const order = actionOrder || makeUpdatedOrder(expressOrders[0], "in_progress");

        await route.fulfill({
            status: actionStatus,
            contentType: "application/json",
            body: JSON.stringify(
                actionBody || {
                    success: true,
                    order,
                }
            ),
        });
    });

    await page.route("**/api/express/express-orders/*/complete", async (route) => {
        onAction?.("complete");

        const order = actionOrder || makeUpdatedOrder(expressOrders[0], "completed");

        await route.fulfill({
            status: actionStatus,
            contentType: "application/json",
            body: JSON.stringify(
                actionBody || {
                    success: true,
                    order,
                }
            ),
        });
    });

    await page.route("**/api/express/express-orders/*/cancel", async (route) => {
        onAction?.("cancel");

        const order = actionOrder || makeUpdatedOrder(expressOrders[0], "cancelled");

        await route.fulfill({
            status: actionStatus,
            contentType: "application/json",
            body: JSON.stringify(
                actionBody || {
                    success: true,
                    order,
                }
            ),
        });
    });
}

async function openActiveOrdersPage(page, options = {}) {
    await setFakeAuth(page, options.user || executorUser);
    await setupExpressCardMocks(page, options);

    const query = options.query || "platform=web&view=performing";

    await page.goto(`${FRONT_URL}/active-orders?${query}`, {

        waitUntil: "domcontentloaded",

        timeout: 30000,

    });

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "express-order-card-redirected-to-login.png",
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

async function confirmAndClick(page, locator, expectedMessage) {
    const dialogPromise = page.waitForEvent("dialog").then(async (dialog) => {
        if (expectedMessage) {
            expect(dialog.message()).toBe(expectedMessage);
        }

        await dialog.accept();
    });

    await locator.click({
        noWaitAfter: true,
    });

    await dialogPromise;
}

async function dismissAndClick(page, locator, expectedMessage) {
    const dialogPromise = page.waitForEvent("dialog").then(async (dialog) => {
        if (expectedMessage) {
            expect(dialog.message()).toBe(expectedMessage);
        }

        await dialog.dismiss();
    });

    await locator.click({
        noWaitAfter: true,
    });

    await dialogPromise;
}

test.describe("ExpressOrderCard", () => {
    test("отображает taxi-карточку исполнителя", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [baseTaxiOrder],
        });

        const card = expressCard(page);

        await expect(card).toBeVisible();
        await expect(card).toHaveClass(/express-taxi/);

        await expect(card).toContainText("Экспресс №201");
        await expect(card).toContainText("Вы исполнитель");
        await expect(card).toContainText("Такси");
        await expect(card.locator(".pay-price")).toHaveText("700 ₽");
        await expect(card.locator(".pay-type")).toHaveText("Наличные");
    });

    test("отображает courier-карточку исполнителя", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [baseCourierOrder],
        });

        const card = expressCard(page, "Экспресс №202");

        await expect(card).toBeVisible();
        await expect(card).toHaveClass(/express-courier/);

        await expect(card).toContainText("Курьер");
        await expect(card.locator(".pay-price")).toHaveText("500 ₽");
        await expect(card.locator(".pay-type")).toHaveText("Гарантия");
    });

    test("показывает роль заказчика", async ({ page }) => {
        await openActiveOrdersPage(page, {
            user: creatorUser,
            query: "platform=web&view=created",
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    creatorId: 1,
                    executorId: 2,
                },
            ],
        });

        const card = expressCard(page);

        await expect(card).toContainText("Вы заказчик");
        await expect(card.locator(".role-badge")).toHaveClass(/creator-role/);
    });

    test("показывает адреса A и B", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [baseTaxiOrder],
        });

        const card = expressCard(page);

        await expect(card).toContainText("Откуда");
        await expect(card).toContainText("Симферополь, улица Пушкина, 1");
        await expect(card).toContainText("Куда");
        await expect(card).toContainText("Симферополь, проспект Кирова, 10");
    });

    test("показывает комментарий, расстояние и время", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [baseTaxiOrder],
        });

        const card = expressCard(page);

        await expect(card.locator(".express-comment")).toContainText("Нужно такси");
        await expect(card.locator(".express-meta")).toContainText("Расстояние: 3.4 км");
        await expect(card.locator(".express-meta")).toContainText("Время: 12 мин");
    });

    test("не показывает комментарий, если description пустой", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    description: "",
                },
            ],
        });

        const card = expressCard(page);

        await expect(card.locator(".express-comment")).not.toBeVisible();
    });

    test("показывает stepper taxi", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [baseTaxiOrder],
        });

        const card = expressCard(page);

        await expect(card.locator(".express-stepPremium")).toHaveCount(6);
        await expect(card).toContainText("Принят");
        await expect(card).toContainText("В пути");
        await expect(card).toContainText("На месте");
        await expect(card).toContainText("Ожидание");
        await expect(card).toContainText("Поездка");
        await expect(card).toContainText("Завершён");
    });

    test("показывает stepper courier", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [baseCourierOrder],
        });

        const card = expressCard(page, "Экспресс №202");

        await expect(card.locator(".express-stepPremium")).toHaveCount(6);
        await expect(card).toContainText("Принят");
        await expect(card).toContainText("В пути");
        await expect(card).toContainText("На месте");
        await expect(card).toContainText("Забрал");
        await expect(card).toContainText("Доставка");
        await expect(card).toContainText("Завершён");
    });

    test("подсвечивает текущий шаг", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "waiting_at_A",
                },
            ],
        });

        const card = expressCard(page);

        await expect(card.locator(".express-stepPremium.active")).toContainText("Ожидание");
        await expect(card.locator(".express-stepPremium.done")).toHaveCount(3);
    });

    test("показывает статус для taxi исполнителя", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "on_the_way_to_A",
                },
            ],
        });

        const card = expressCard(page);

        await expect(card.locator(".express-statusBar")).toHaveText(
            "Вы в пути к клиенту"
        );
    });

    test("показывает статус для taxi заказчика", async ({ page }) => {
        await openActiveOrdersPage(page, {
            user: creatorUser,
            query: "platform=web&view=created",
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "on_the_way_to_A",
                },
            ],
        });

        const card = expressCard(page);

        await expect(card.locator(".express-statusBar")).toHaveText(
            "Исполнитель в пути к вам"
        );
    });

    test("показывает статус для courier исполнителя", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseCourierOrder,
                    status: "picked_up",
                },
            ],
        });

        const card = expressCard(page, "Экспресс №202");

        await expect(card.locator(".express-statusBar")).toHaveText(
            "Заказ у вас"
        );
    });

    test("показывает вторичные кнопки", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [baseTaxiOrder],
        });

        const card = expressCard(page);

        await expect(card.getByRole("button", { name: /Позвонить/i })).toBeVisible();
        await expect(card.getByRole("button", { name: /Чат/i })).toBeVisible();
        await expect(card.getByRole("button", { name: /Проблема/i })).toBeVisible();
        await expect(card.getByRole("button", { name: /Отменить/i })).toBeVisible();
    });

    test("для executor accepted показывает действие Еду к точке A", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "accepted",
                },
            ],
        });

        const card = expressCard(page);

        await expect(card.getByRole("button", { name: "Еду к точке A" })).toBeVisible();
    });

    test("для taxi on_the_way_to_A показывает действие Я на месте", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "on_the_way_to_A",
                },
            ],
        });

        const card = expressCard(page);

        await expect(card.getByRole("button", { name: "Я на месте" })).toBeVisible();
    });

    test("для taxi arrived_at_A показывает действие Начать ожидание", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "arrived_at_A",
                },
            ],
        });

        const card = expressCard(page);

        await expect(card.getByRole("button", { name: "Начать ожидание" })).toBeVisible();
    });

    test("для taxi waiting_at_A показывает действие Клиент в машине", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "waiting_at_A",
                },
            ],
        });

        const card = expressCard(page);

        await expect(card.getByRole("button", { name: "Клиент в машине" })).toBeVisible();
    });

    test("для courier arrived_at_A показывает действие Забрал заказ", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseCourierOrder,
                    status: "arrived_at_A",
                },
            ],
        });

        const card = expressCard(page, "Экспресс №202");

        await expect(card.getByRole("button", { name: "Забрал заказ" })).toBeVisible();
    });

    test("для courier picked_up показывает действие Начать доставку", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseCourierOrder,
                    status: "picked_up",
                },
            ],
        });

        const card = expressCard(page, "Экспресс №202");

        await expect(card.getByRole("button", { name: "Начать доставку" })).toBeVisible();
    });

    test("для in_progress показывает Завершить заказ", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "in_progress",
                },
            ],
        });

        const card = expressCard(page);

        await expect(card.getByRole("button", { name: "Завершить заказ" })).toBeVisible();
    });

    test("у заказчика нет primary action исполнителя", async ({ page }) => {
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

        await expect(card.locator(".express-primaryActionBtn")).not.toBeVisible();
    });

    test("completed не показывает primary action и отмену", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "completed",
                },
            ],
        });

        const card = expressCard(page);

        await expect(card.locator(".express-primaryActionBtn")).not.toBeVisible();
        await expect(card.getByRole("button", { name: /Отменить/i })).not.toBeVisible();
        await expect(card.locator(".express-statusBar")).toHaveText("Заказ завершён");
    });

    test("cancelled не показывает отмену", async ({ page }) => {
        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "cancelled",
                },
            ],
        });

        const card = expressCard(page);

        await expect(card.getByRole("button", { name: /Отменить/i })).not.toBeVisible();
        await expect(card.locator(".express-statusBar")).toHaveText("Заказ отменён");
    });

    test("действие Еду к точке A вызывает API", async ({ page }) => {
        let action = null;

        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "accepted",
                },
            ],
            actionOrder: makeUpdatedOrder(baseTaxiOrder, "on_the_way_to_A"),
            onAction: (name) => {
                action = name;
            },
        });

        const card = expressCard(page);

        await confirmAndClick(
            page,
            card.getByRole("button", { name: "Еду к точке A" }),
            "Подтвердить, что вы выехали к точке A?"
        );

        await expect
            .poll(() => action, {
                timeout: 10000,
            })
            .toBe("on-the-way");
    });

    test("отмена confirm не вызывает API", async ({ page }) => {
        let action = null;

        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "accepted",
                },
            ],
            onAction: (name) => {
                action = name;
            },
        });

        const card = expressCard(page);

        await dismissAndClick(
            page,
            card.getByRole("button", { name: "Еду к точке A" }),
            "Подтвердить, что вы выехали к точке A?"
        );

        expect(action).toBeNull();
    });

    test("действие Я на месте вызывает arrived", async ({ page }) => {
        let action = null;

        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "on_the_way_to_A",
                },
            ],
            actionOrder: makeUpdatedOrder(baseTaxiOrder, "arrived_at_A"),
            onAction: (name) => {
                action = name;
            },
        });

        const card = expressCard(page);

        await confirmAndClick(
            page,
            card.getByRole("button", { name: "Я на месте" }),
            "Подтвердить, что вы прибыли на место?"
        );

        await expect
            .poll(() => action, {
                timeout: 10000,
            })
            .toBe("arrived");
    });

    test("действие Забрал заказ вызывает pick-up", async ({ page }) => {
        let action = null;

        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseCourierOrder,
                    status: "arrived_at_A",
                },
            ],
            actionOrder: makeUpdatedOrder(baseCourierOrder, "picked_up"),
            onAction: (name) => {
                action = name;
            },
        });

        const card = expressCard(page, "Экспресс №202");

        await confirmAndClick(
            page,
            card.getByRole("button", { name: "Забрал заказ" }),
            "Подтвердить, что вы забрали заказ?"
        );

        await expect
            .poll(() => action, {
                timeout: 10000,
            })
            .toBe("pick-up");
    });

    test("действие Завершить заказ вызывает complete", async ({ page }) => {
        let action = null;

        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "in_progress",
                },
            ],
            actionOrder: makeUpdatedOrder(baseTaxiOrder, "completed"),
            onAction: (name) => {
                action = name;
            },
        });

        const card = expressCard(page);

        await confirmAndClick(
            page,
            card.getByRole("button", { name: "Завершить заказ" }),
            "Подтвердить завершение заказа?"
        );

        await expect
            .poll(() => action, {
                timeout: 10000,
            })
            .toBe("complete");
    });

    test("кнопка Отменить вызывает cancel", async ({ page }) => {
        let action = null;

        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "accepted",
                },
            ],
            actionOrder: makeUpdatedOrder(baseTaxiOrder, "cancelled"),
            onAction: (name) => {
                action = name;
            },
        });

        const card = expressCard(page);

        await confirmAndClick(
            page,
            card.getByRole("button", { name: "Отменить" }),
            "Вы уверены, что хотите отменить заказ?"
        );

        await expect
            .poll(() => action, {
                timeout: 10000,
            })
            .toBe("cancel");
    });

    test("при 409 показывает alert и обновляет данные", async ({ page }) => {
        let action = null;

        await openActiveOrdersPage(page, {
            expressOrders: [
                {
                    ...baseTaxiOrder,
                    status: "accepted",
                },
            ],
            actionStatus: 409,
            actionBody: {
                message: "Статус уже изменился",
            },
            onAction: (name) => {
                action = name;
            },
        });

        const card = expressCard(page);

        const dialogs = [];

        page.on("dialog", async (dialog) => {
            dialogs.push(dialog.message());
            await dialog.accept();
        });

        await card.getByRole("button", { name: "Еду к точке A" }).click({
            noWaitAfter: true,
        });

        await expect
            .poll(() => action, {
                timeout: 10000,
            })
            .toBe("on-the-way");

        await expect
            .poll(() => dialogs, {
                timeout: 10000,
            })
            .toContain("Статус уже изменился");

        expect(dialogs).toContain("Подтвердить, что вы выехали к точке A?");
    });
});