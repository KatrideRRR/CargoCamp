import { test, expect } from "./fixtures/safeTest";
import { mockAppShell } from "./utils/mockAppShell";
import { createMockJwt } from "./utils/mockAuthSession";
const FRONT_URL = "http://localhost:3000";
import { mockChatSocket } from "./utils/mockChatSocket";

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

async function setFakeAuth(page, user = testUser) {
    const fakeToken = createMockJwt(user);

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

    await mockAppShell(page, {
        identity: true,
        benefits: true,
        pendingActs: true,
    });

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

    await page.goto(`${FRONT_URL}${path}`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
    });

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

    test(
        "повторное уведомление о сообщении не увеличивает счётчик",
        async ({ page }) => {
            const connections =
                await mockChatSocket(page);

            await openPageWithBottomMenu(
                page,
                "/?platform=web"
            );

            await expect.poll(
                () => connections.some(
                    (connection) =>
                        connection.clientMessages.some(
                            (message) =>
                                message.includes(
                                    "subscribeToNotifications"
                                )
                        )
                )
            ).toBe(true);

            const connection = connections.find(
                (item) =>
                    item.clientMessages.some(
                        (message) =>
                            message.includes(
                                "subscribeToNotifications"
                            )
                    )
            );

            const notification = {
                id: 901,
                type: "new_message",
                orderId: 101,
                orderType: "regular",
                isRead: false,
            };

            const badge = menuItem(
                page,
                "В работе"
            ).locator(".bottom-menu__badge");

            connection.emit(
                "new_notification",
                notification
            );

            await expect(badge).toHaveText("1");

            connection.emit(
                "new_notification",
                notification
            );

            connection.emit(
                "new_notification",
                {
                    ...notification,
                    id: 902,
                }
            );

            await expect(badge).toHaveText("2");

            connection.emit(
                "new_notification",
                []
            );

            await expect(badge).not.toBeVisible();
        }
    );

    test(
        "восстанавливает счётчики из серверных уведомлений",
        async ({ page }) => {
            const connections =
                await mockChatSocket(page);

            await openPageWithBottomMenu(
                page,
                "/?platform=web"
            );

            await expect.poll(
                () => connections.some(
                    (connection) =>
                        connection.clientMessages.some(
                            (message) =>
                                message.includes(
                                    "subscribeToNotifications"
                                )
                        )
                )
            ).toBe(true);

            const connection = connections.find(
                (item) =>
                    item.clientMessages.some(
                        (message) =>
                            message.includes(
                                "subscribeToNotifications"
                            )
                    )
            );

            const notifications = [
                {
                    id: 901,
                    type: "new_message",
                    isRead: false,
                },
                {
                    id: 902,
                    type: "new_message",
                    isRead: false,
                },
                {
                    id: 903,
                    type: "order_request",
                    isRead: false,
                },
                {
                    id: 904,
                    type: "reservation_cancelled",
                    isRead: false,
                },
                {
                    id: 905,
                    type: "order_request",
                    title: "Бронирование отменено",
                    isRead: false,
                },
                {
                    id: 906,
                    type: "new_message",
                    isRead: true,
                },
            ];

            connection.emit(
                "new_notification",
                notifications
            );

            await expect(
                menuItem(page, "В работе")
                    .locator(".bottom-menu__badge")
            ).toHaveText("2");

            await expect(
                menuItem(page, "Мои заказы")
                    .locator(".bottom-menu__badge")
            ).toHaveText("1");

            connection.emit(
                "new_notification",
                [notifications[1]]
            );

            await expect(
                menuItem(page, "В работе")
                    .locator(".bottom-menu__badge")
            ).toHaveText("1");

            await expect(
                menuItem(page, "Мои заказы")
                    .locator(".bottom-menu__badge")
            ).not.toBeVisible();
        }
    );

    test(
        "просмотр Моих заказов отмечает отклики прочитанными на сервере",
        async ({ page }) => {
            const connections =
                await mockChatSocket(page);

            let readRequestsCalls = 0;

            const findConnection = () =>
                connections.find(
                    (item) =>
                        item.clientMessages.some(
                            (message) =>
                                message.includes(
                                    "subscribeToNotifications"
                                )
                        )
                );

            await page.route(
                "**/api/orders/notifications/read-requests",
                async (route) => {
                    expect(
                        route.request().method()
                    ).toBe("POST");

                    readRequestsCalls += 1;

                    await route.fulfill({
                        status: 200,
                        json: {
                            success: true,
                            updatedCount: 1,
                        },
                    });

                    findConnection()?.emit(
                        "new_notification",
                        [
                            {
                                id: 902,
                                type: "new_message",
                                isRead: false,
                            },
                        ]
                    );
                }
            );

            await openPageWithBottomMenu(
                page,
                "/?platform=web"
            );

            await expect.poll(
                () => Boolean(findConnection())
            ).toBe(true);

            findConnection().emit(
                "new_notification",
                [
                    {
                        id: 901,
                        type: "order_request",
                        isRead: false,
                    },
                    {
                        id: 902,
                        type: "new_message",
                        isRead: false,
                    },
                ]
            );

            const myOrders = menuItem(
                page,
                "Мои заказы"
            );

            await expect(
                myOrders.locator(
                    ".bottom-menu__badge"
                )
            ).toHaveText("1");

            await myOrders.click();

            await expect(page).toHaveURL(
                /\/my-orders\/123/
            );

            await expect.poll(
                () => readRequestsCalls
            ).toBe(1);

            await expect(
                myOrders.locator(
                    ".bottom-menu__badge"
                )
            ).not.toBeVisible();

            await expect(
                menuItem(page, "В работе")
                    .locator(".bottom-menu__badge")
            ).toHaveText("1");
        }
    );

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