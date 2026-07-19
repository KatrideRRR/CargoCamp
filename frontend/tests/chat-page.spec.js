import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3000";

const testUser = {
    id: 1,
    username: "executor",
    role: "executor",
    phone: "+79786864118",
};

const customerUser = {
    id: 2,
    username: "Заказчик",
    rating: 4.5,
    phone: "+79780032978",
    avatar: null,
};

const regularOrder = {
    id: 101,
    description: "Привезти груз",
    address: "Улица Пушкина",
    paymentType: "cash",
    proposedSum: 500,
    creatorId: 2,
    executorId: 1,
    coordinates: "55.7558,37.6176",
    createdAt: "2026-07-01T10:00:00.000Z",
    status: "active",
};

const expressOrder = {
    id: 101,
    type: "taxi",
    status: "accepted",
    creatorId: 2,
    executorId: 1,

    fromAddress: "Симферополь, улица Пушкина, 1",
    toAddress: "Симферополь, проспект Кирова, 10",

    fromLat: 44.9525,
    fromLng: 34.1028,
    toLat: 44.9489,
    toLng: 34.0987,
};

const initialMessages = [
    {
        id: 1,
        content: "Здравствуйте, заказ актуален?",
        senderId: 2,
        receiverId: 1,
        orderId: 101,
        orderType: "regular",
        createdAt: "2026-07-01T10:01:00.000Z",
    },
    {
        id: 2,
        content: "Да, актуален. Можно начинать.",
        senderId: 1,
        receiverId: 2,
        orderId: 101,
        orderType: "regular",
        createdAt: "2026-07-01T10:02:00.000Z",
    },
];

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

async function setFakeAuth(page) {
    const fakeToken = createFakeJwt({
        id: testUser.id,
        role: testUser.role,
        name: testUser.username,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
    });

    await page.addInitScript(({ token, user }) => {
        localStorage.setItem("authToken", token);

        localStorage.setItem("user", JSON.stringify(user));
        localStorage.setItem("currentUser", JSON.stringify(user));
        localStorage.setItem("userData", JSON.stringify(user));
    }, {
        token: fakeToken,
        user: testUser,
    });
}

async function setupChatMocks(page, options = {}) {
    const {
        messages = initialMessages,
        order = regularOrder,
        otherUser = customerUser,
        dispute = null,
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

    page.on("requestfailed", (request) => {
        const url = request.url();

        if (
            url.startsWith("tel:") ||
            url.includes("yastatic.net") ||
            url.includes("maps-front")
        ) {
            return;
        }

        console.log("[REQUEST FAILED]", url, request.failure()?.errorText);
    });

    await page.route("**/api/auth/profile", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(testUser),
        });
    });

    await page.route("**/api/auth/me", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(testUser),
        });
    });

    await page.route("**/api/users/me", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(testUser),
        });
    });

    await page.route("**/api/orders/101", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(order),
        });
    });

    await page.route("**/api/express/express-orders/101", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                success: true,
                order,
            }),
        });
    });

    await page.route("**/api/auth/2", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(otherUser),
        });
    });

    await page.route("**/api/auth/user/2", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(otherUser),
        });
    });

    await page.route("**/api/messages/regular/101", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(messages),
        });
    });

    await page.route("**/api/messages/express/101", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(messages),
        });
    });

    await page.route("**/api/disputes/order/101", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                dispute: options.dispute || null,
            }),
        });
    });
}

async function openChatPage(page, options = {}) {
    const {
        orderType = "regular",
    } = options;

    await setFakeAuth(page);
    await setupChatMocks(page, options);

    await page.goto(`${FRONT_URL}/messages/${orderType}/101?platform=web`, {

        waitUntil: "domcontentloaded",

        timeout: 30000,

    });

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "chat-page-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error(
            "После fake JWT произошёл редирект на /login. Нужно проверить UserProvider/userContext."
        );
    }

    await expect(page.locator(".chat-page")).toBeVisible({
        timeout: 15000,
    });

    await expect(page.locator(".chat-loading")).not.toBeVisible({
        timeout: 15000,
    });
}

function chatDisputeModal(page) {
    return page.locator(".chat-dispute-content");
}

async function clickChatDisputeSubmit(page) {
    await page.evaluate(() => {
        const button = document.querySelector(
            ".chat-dispute-content .chat-dispute-submit"
        );

        if (!button) {
            throw new Error("Кнопка отправки спора не найдена");
        }

        button.click();
    });
}

async function clickBySelector(page, selector, errorMessage) {
    await page.evaluate(
        ({ selector, errorMessage }) => {
            const element = document.querySelector(selector);

            if (!element) {
                throw new Error(errorMessage || `Элемент не найден: ${selector}`);
            }

            element.click();
        },
        { selector, errorMessage }
    );
}

async function clickSendMessage(page) {
    await page.evaluate(() => {
        const button = document.querySelector(".chat-send-button");

        if (!button) {
            throw new Error("Кнопка отправки сообщения не найдена");
        }

        button.click();
    });
}

async function clickRouteButton(page) {
    await clickBySelector(
        page,
        ".chat-order-btn.route",
        "Кнопка Маршрут не найдена"
    );
}

async function clickDisputeButton(page) {
    await clickBySelector(
        page,
        ".chat-order-btn.dispute",
        "Кнопка Спор не найдена"
    );
}

test.describe("ChatPage", () => {
    test.beforeEach(async ({ page }) => {
        await openChatPage(page);
    });

    test("отображает страницу чата", async ({ page }) => {
        await expect(page.locator(".chat-page")).toBeVisible();

        await expect(page.locator(".chat-header")).toBeVisible();
        await expect(page.getByText("Заказчик")).toBeVisible();

        await expect(page.locator(".chat-header-subtitle")).toHaveText("Заказ #101");
        await expect(page.locator(".chat-order-title")).toHaveText("Заказ #101");

        await expect(page.getByText("В процессе")).toBeVisible();

        await expect(page.getByRole("button", { name: /Маршрут/i })).toBeVisible();
        await expect(
            page.getByRole("link", { name: /Позвонить/i })
        ).toBeVisible();
        await expect(page.getByRole("button", { name: /^Спор$/i })).toBeVisible();

        await expect(page.locator(".chat-input")).toBeVisible();
        await expect(page.getByRole("button", { name: /Отправить сообщение/i })).toBeDisabled();
    });

    test("отображает входящие и исходящие сообщения", async ({ page }) => {
        await expect(page.getByText("Здравствуйте, заказ актуален?")).toBeVisible();
        await expect(page.getByText("Да, актуален. Можно начинать.")).toBeVisible();

        await expect(page.locator(".chat-message-received")).toContainText(
            "Здравствуйте, заказ актуален?"
        );

        await expect(page.locator(".chat-message-sent")).toContainText(
            "Да, актуален. Можно начинать."
        );

        await expect(page.locator(".chat-checks")).toBeVisible();
    });

    test("показывает пустое состояние, если сообщений нет", async ({ page }) => {
        await openChatPage(page, {
            messages: [],
        });

        await expect(page.getByText("Сообщений пока нет")).toBeVisible();
        await expect(page.getByText("Напишите первым по этому заказу")).toBeVisible();
    });

    test("кнопка отправки заблокирована при пустом сообщении", async ({ page }) => {
        const sendButton = page.getByRole("button", {
            name: /Отправить сообщение/i,
        });

        await expect(sendButton).toBeDisabled();

        await page.locator(".chat-input").fill("Новое сообщение");

        await expect(sendButton).toBeEnabled();

        await page.locator(".chat-input").fill("");

        await expect(sendButton).toBeDisabled();
    });

    test("отправляет сообщение кнопкой", async ({ page }) => {
        let messageRequestBody = null;

        await page.route("**/api/messages", async (route) => {
            messageRequestBody = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    id: 999,
                    content: messageRequestBody.content,
                    senderId: testUser.id,
                    receiverId: customerUser.id,
                    orderId: 101,
                    orderType: "regular",
                    createdAt: "2026-07-01T10:10:00.000Z",
                }),
            });
        });

        const input = page.locator(".chat-input");
        const sendButton = page.locator(".chat-send-button");

        await input.fill("Тестовое сообщение");

        await expect(sendButton).toBeEnabled();

        await clickSendMessage(page);

        await expect
            .poll(() => messageRequestBody, {
                timeout: 5000,
            })
            .toEqual({
                content: "Тестовое сообщение",
                receiverId: customerUser.id,
                orderId: "101",
                orderType: "regular",
            });

        await expect(page.locator(".chat-message-sent").last()).toContainText(
            "Тестовое сообщение"
        );

        await expect(page.locator(".chat-input")).toHaveValue("");
    });

    test("отправляет сообщение по Enter", async ({ page }) => {
        let messageRequestBody = null;

        await page.route("**/api/messages", async (route) => {
            messageRequestBody = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    id: 1000,
                    content: messageRequestBody.content,
                    senderId: testUser.id,
                    receiverId: customerUser.id,
                    orderId: 101,
                    orderType: "regular",
                    createdAt: "2026-07-01T10:11:00.000Z",
                }),
            });
        });

        await page.locator(".chat-input").fill("Сообщение через Enter");
        await page.locator(".chat-input").press("Enter");

        await expect
            .poll(() => messageRequestBody, {
                timeout: 5000,
            })
            .toEqual({
                content: "Сообщение через Enter",
                receiverId: customerUser.id,
                orderId: "101",
                orderType: "regular",
            });

        await expect(
            page.locator(".chat-message-sent").last()
        ).toContainText("Сообщение через Enter");

        await expect(page.locator(".chat-message-sent").last()).toContainText(
            "Сообщение через Enter"
        );
    });

    test("Shift+Enter не отправляет сообщение", async ({ page }) => {
        let wasMessageSent = false;

        await page.route("**/api/messages", async (route) => {
            wasMessageSent = true;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    id: 1001,
                    content: "Не должно отправиться",
                    senderId: testUser.id,
                    receiverId: customerUser.id,
                    orderId: 101,
                    orderType: "regular",
                    createdAt: "2026-07-01T10:12:00.000Z",
                }),
            });
        });

        await page.locator(".chat-input").fill("Первая строка");
        await page.locator(".chat-input").press("Shift+Enter");

        await page.waitForTimeout(300);

        expect(wasMessageSent).toBe(false);
    });

    test("показывает ошибку, если отправка сообщения не удалась", async ({ page }) => {
        await page.route("**/api/messages", async (route) => {
            await route.fulfill({
                status: 500,
                contentType: "application/json",
                body: JSON.stringify({
                    message: "Server error",
                }),
            });
        });

        await page.locator(".chat-input").fill("Сообщение с ошибкой");

        await clickSendMessage(page);

        await expect(page.getByText("Ошибка: Не удалось отправить сообщение.")).toBeVisible();
    });

    test("кнопка Позвонить содержит корректную tel-ссылку", async ({ page }) => {
        const callLink = page.getByRole("link", {
            name: /Позвонить/i,
        });

        await expect(callLink).toBeVisible();

        await expect(callLink).toHaveAttribute(
            "href",
            "tel:+79780032978"
        );
    });

    test("кнопка Маршрут открывает Яндекс.Навигатор", async ({ page }) => {
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

        await clickRouteButton(page);

        await expect
            .poll(
                () => page.evaluate(() => window.__openedUrl),
                {
                    timeout: 10000,
                }
            )
            .toContain("https://yandex.ru/navi/");
    });

    test("в чате express-заказа открывает маршрут к точке A", async ({ page }) => {
        await openChatPage(page, {
            orderType: "express",
            order: {
                id: 101,
                type: "taxi",
                status: "accepted",
                creatorId: 2,
                executorId: 1,
                fromAddress: "Симферополь, улица Пушкина, 1",
                toAddress: "Симферополь, проспект Кирова, 10",
                fromLat: 44.9525,
                fromLng: 34.1028,
                toLat: 44.9489,
                toLng: 34.0987,
            },
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

        await clickRouteButton(page);

        await expect
            .poll(
                () => page.evaluate(() => window.__openedUrl),
                {
                    timeout: 10000,
                }
            )
            .not.toBeNull();

        const openedUrl = await page.evaluate(
            () => window.__openedUrl
        );

        expect(openedUrl).toContain("https://yandex.ru/navi/");
        expect(openedUrl).toContain("44.9525");
        expect(openedUrl).toContain("34.1028");
    });

    test("показывает alert, если координаты заказа некорректные", async ({ page }) => {
        await openChatPage(page, {
            order: {
                ...regularOrder,
                coordinates: null,
            },
        });

        const routeButton = page.locator(".chat-order-btn.route");

        await expect(routeButton).toBeVisible();
        await expect(routeButton).toBeEnabled();

        let alertText = null;

        page.once("dialog", async (dialog) => {
            alertText = dialog.message();
            await dialog.accept();
        });

        await routeButton.click();

        await expect
            .poll(() => alertText, {
                timeout: 5000,
            })
            .toContain("Координаты заказа не найдены");
    });

    test("открывает модалку спора", async ({ page }) => {
        await clickDisputeButton(page);

        const modal = chatDisputeModal(page);

        await expect(modal.getByRole("heading", { name: "Открыть спор" })).toBeVisible();
        await expect(modal.getByText("Заказ №101")).toBeVisible();

        await expect(
            modal.getByPlaceholder("Например: работа выполнена не полностью")
        ).toBeVisible();

        await expect(
            modal.getByPlaceholder("Опишите подробно, в чём проблема")
        ).toBeVisible();
    });

    test("закрывает модалку спора", async ({ page }) => {
        await clickDisputeButton(page);

        const modal = chatDisputeModal(page);

        await expect(modal.getByRole("heading", { name: "Открыть спор" })).toBeVisible();

        await modal.locator(".chat-dispute-cancel").click({ force: true });

        await expect(modal.getByRole("heading", { name: "Открыть спор" })).not.toBeVisible();
    });

    test("не отправляет спор без краткой причины", async ({ page }) => {
        let disputeOpenCalled = false;

        await page.route("**/api/disputes/open", async (route) => {
            disputeOpenCalled = true;

            await route.fulfill({
                status: 400,
                contentType: "application/json",
                body: JSON.stringify({
                    message: "Не должно было отправиться",
                }),
            });
        });

        await clickDisputeButton(page);

        const modal = chatDisputeModal(page);

        await expect(modal.getByRole("heading", { name: "Открыть спор" })).toBeVisible();

        page.once("dialog", async (dialog) => {
            await dialog.accept();
        });

        await clickChatDisputeSubmit(page);

        await page.waitForTimeout(500);

        expect(disputeOpenCalled).toBe(false);

        await expect(modal.getByRole("heading", { name: "Открыть спор" })).toBeVisible();
    });

    test("отправляет спор", async ({ page }) => {
        let disputeRequestBody = null;

        await page.route("**/api/disputes/open", async (route) => {
            disputeRequestBody = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    dispute: {
                        id: 555,
                        orderId: 101,
                        status: "open",
                        reason: "Работа выполнена плохо",
                        description: "Исполнитель повредил груз",
                    },
                }),
            });
        });

        await clickDisputeButton(page);

        const modal = chatDisputeModal(page);

        await modal
            .getByPlaceholder("Например: работа выполнена не полностью")
            .fill("Работа выполнена плохо");

        await modal
            .getByPlaceholder("Опишите подробно, в чём проблема")
            .fill("Исполнитель повредил груз");

        const dialogPromise = page.waitForEvent("dialog");

        await clickChatDisputeSubmit(page);

        const dialog = await dialogPromise;

        expect(dialog.message()).toContain("Спор успешно открыт");

        await dialog.accept();

        expect(disputeRequestBody).toEqual({
            orderId: 101,
            reasonCode: "poor_quality",
            reason: "Работа выполнена плохо",
            description: "Исполнитель повредил груз",
        });

        await expect(page.getByRole("button", { name: /Спор открыт/i })).toBeVisible();
    });

    test("если спор уже открыт, показывает информацию о споре", async ({ page }) => {
        await openChatPage(page, {
            dispute: {
                id: 777,
                orderId: 101,
                status: "open",
                reason: "Работа выполнена плохо",
                description: "Есть повреждения",
            },
        });

        await expect(page.getByRole("button", { name: /Спор открыт/i })).toBeVisible();

        let alertText = "";

        page.once("dialog", async (dialog) => {
            alertText = dialog.message();
            await dialog.accept();
        });

        await clickDisputeButton(page);

        await expect
            .poll(() => alertText, {
                timeout: 5000,
            })
            .toContain("Спор уже открыт");

        expect(alertText).toContain("Статус: open");
        expect(alertText).toContain("Причина: Работа выполнена плохо");
        expect(alertText).toContain("Описание: Есть повреждения");
    });

    test("для express-заказа кнопка спора не отображается", async ({ page }) => {
        await openChatPage(page, {
            orderType: "express",
            order: {
                ...regularOrder,
                id: 101,
                type: "express",
                status: "active",
            },
        });

        await expect(page.getByRole("button", { name: /^Спор$/i })).not.toBeVisible();
    });

    test("показывает ошибку, если данные чата не загрузились", async ({ page }) => {
        await setFakeAuth(page);

        await page.route("**/api/orders/101", async (route) => {
            await route.fulfill({
                status: 500,
                contentType: "application/json",
                body: JSON.stringify({
                    message: "Server error",
                }),
            });
        });

        await page.goto(`${FRONT_URL}/messages/regular/101?platform=web`);

        await expect(page.getByText("Ошибка: Не удалось загрузить данные чата.")).toBeVisible({
            timeout: 15000,
        });
    });
});