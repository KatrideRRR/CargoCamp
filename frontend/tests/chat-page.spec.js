const {
    test,
    expect,
} = require("./fixtures/safeTest");

const {
    mockSuccessfulChatSend,
    mockChatSendAfterFailure,
} = require("./utils/mockChatSend");

const FRONT_URL = "http://localhost:3000";

const testUser = {
    id: 1,
    username: "executor",
    role: "executor",
    phone: "+79990000001",
};

const customerUser = {
    id: 2,
    username: "Заказчик",
    rating: 4.5,
    phone: "+79990000002",
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

    // Яндекс.Карты не загружаем из интернета.
    await page.route(
        "https://api-maps.yandex.ru/2.1/**",
        async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/javascript",
                body: "",
            });
        }
    );

    // Google Fonts также заменяем локальным ответом.
    await page.route(
        "https://fonts.googleapis.com/**",
        async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "text/css",
                body: "",
            });
        }
    );

    // Тестовый пользователь без задолженности.
    await page.route(
        "**/api/orders/me/status",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    debt: 0,
                },
            });
        }
    );

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

    /*
 * Новая синхронизация чата.
 *
 * Сервер возвращает сообщения,
 * которые появились после afterId.
 */
    await page.route(
        "**/api/messages/sync/*/101**",
        async (route) => {
            const url = new URL(route.request().url());

            const afterId = Number(
                url.searchParams.get("afterId") || 0
            );

            const batch = messages.filter(
                (message) => Number(message.id) > afterId
            );

            const nextCursor = batch.length
                ? Number(batch[batch.length - 1].id)
                : afterId;

            await route.fulfill({
                status: 200,
                json: {
                    messages: batch,
                    nextCursor,
                    hasMore: false,
                },
            });
        }
    );

    /*
     * Проверка прочтения исходящих сообщений.
     */
    await page.route(
        "**/api/messages/read-state/*/101",
        async (route) => {
            const url = new URL(route.request().url());

            const orderType =
                url.pathname.split("/")[4];

            await route.fulfill({
                status: 200,
                json: {
                    orderId: 101,
                    orderType,
                    readerId: customerUser.id,
                    lastReadMessageId: 0,
                    readAt: null,
                },
            });
        }
    );

    /*
     * Подтверждение прочтения входящих сообщений.
     */
    await page.route(
        "**/api/messages/read/*/101",
        async (route) => {
            const url = new URL(route.request().url());

            const orderType =
                url.pathname.split("/")[4];

            const body = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                json: {
                    orderId: 101,
                    orderType,
                    readerId: testUser.id,
                    lastReadMessageId: body.throughId,
                    readAt: "2026-07-01T10:20:00.000Z",
                },
            });
        }
    );

    await page.route("**/api/disputes/order/*/101", async (route) => {
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
        const requests = await mockSuccessfulChatSend(page, 999);

        const input = page.locator(".chat-input");

        const sendButton = page.getByRole("button", {
            name: "Отправить сообщение",
        });

        await input.fill("  Тестовое сообщение  ");

        await expect(sendButton).toBeEnabled();

        await sendButton.click();

        // Убеждаемся, что POST действительно отправился.
        await expect.poll(() => requests.length).toBe(1);

        // Проверяем содержимое запроса.
        expect(requests[0]).toMatchObject({
            content: "Тестовое сообщение",
            receiverId: customerUser.id,
            orderId: "101",
            orderType: "regular",
            replyToMessageId: null,
        });

        // Каждая отправка должна иметь UUID версии 4.
        expect(requests[0].clientMessageId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        );

        // Сообщение должно появиться на экране один раз.
        await expect(
            page.locator(".chat-message-sent").filter({
                hasText: "Тестовое сообщение",
            })
        ).toHaveCount(1);

        // После подтверждения поле очищается.
        await expect(input).toHaveValue("");
    });

    test("отправляет сообщение по Enter", async ({ page }) => {
        const requests = await mockSuccessfulChatSend(page, 1000);

        const input = page.locator(".chat-input");

        await input.fill("Сообщение через Enter");

        await input.press("Enter");

        // Должен произойти ровно один POST.
        await expect.poll(() => requests.length).toBe(1);

        expect(requests[0]).toMatchObject({
            content: "Сообщение через Enter",
            receiverId: customerUser.id,
            orderId: "101",
            orderType: "regular",
            replyToMessageId: null,
        });

        expect(requests[0].clientMessageId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        );

        await expect(
            page.locator(".chat-message-sent").filter({
                hasText: "Сообщение через Enter",
            })
        ).toHaveCount(1);

        await expect(input).toHaveValue("");
    });

    test("Shift+Enter не отправляет сообщение", async ({ page }) => {
        const requests = await mockSuccessfulChatSend(page, 1001);

        const input = page.locator(".chat-input");

        const sendButton = page.getByRole("button", {
            name: "Отправить сообщение",
        });

        await input.fill("Первая строка");

        await input.press("Shift+Enter");

        // Shift+Enter должен добавить перенос строки.
        await expect(input).toHaveValue("Первая строка\n");

        // Даём браузеру обработать возможный запрос.
        await page.waitForTimeout(250);

        // Ни один POST отправляться не должен.
        expect(requests).toHaveLength(0);

        // Текст остаётся доступным для отправки.
        await expect(sendButton).toBeEnabled();
    });

    test("после ошибки 500 повторяет сообщение с тем же UUID", async ({ page }) => {
        const requests = await mockChatSendAfterFailure(page, {
            firstStatus: 500,
            firstMessage: "Внутренняя ошибка сервера",
            messageId: 1002,
        });

        const input = page.locator(".chat-input");

        const sendButton = page.getByRole("button", {
            name: "Отправить сообщение",
        });

        const message = "Сообщение после ошибки сервера";

        await input.fill(message);

        // Первая попытка: сервер отвечает 500.
        await sendButton.click();

        await expect.poll(() => requests.length).toBe(1);

        await expect(
            page.locator(".chat-send-status--error")
        ).toContainText("Нет подтверждения отправки");

        // Текст после ошибки не должен исчезнуть.
        await expect(input).toHaveValue(message);

        const originalId = requests[0].clientMessageId;

        expect(originalId).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
        );

        // Вторая попытка: сервер отвечает успешно.
        await expect(sendButton).toBeEnabled();

        await sendButton.click();

        await expect.poll(() => requests.length).toBe(2);

        // Проверяем, что новый UUID НЕ создавался.
        expect(requests[1].clientMessageId).toBe(originalId);

        expect(requests[1]).toMatchObject({
            content: message,
            receiverId: customerUser.id,
            orderId: "101",
            orderType: "regular",
            replyToMessageId: null,
        });

        // На экране должно быть одно сообщение.
        await expect(
            page.locator(".chat-message-sent").filter({
                hasText: message,
            })
        ).toHaveCount(1);

        // Поле очищается только после подтверждения.
        await expect(input).toHaveValue("");

        await expect(
            page.locator(".chat-send-status--error")
        ).not.toBeVisible();
    });

    test("после ошибки 400 исправленное сообщение получает новый UUID", async ({ page }) => {
        const requests = await mockChatSendAfterFailure(page, {
            firstStatus: 400,
            firstMessage: "Тестовая ошибка валидации",
            messageId: 1003,
        });

        const input = page.locator(".chat-input");

        const sendButton = page.getByRole("button", {
            name: "Отправить сообщение",
        });

        // Первая попытка отклоняется сервером.
        await input.fill("Первоначальный текст");

        await sendButton.click();

        await expect.poll(() => requests.length).toBe(1);

        await expect(
            page.locator(".chat-send-status--error")
        ).toContainText("Тестовая ошибка валидации");

        const rejectedId = requests[0].clientMessageId;

        // Пользователь исправляет сообщение.
        await input.fill("Исправленный текст");

        await expect(sendButton).toBeEnabled();

        await sendButton.click();

        await expect.poll(() => requests.length).toBe(2);

        // После окончательного отклонения
        // создаётся новое логическое сообщение.
        expect(requests[1].clientMessageId).not.toBe(rejectedId);

        expect(requests[1]).toMatchObject({
            content: "Исправленный текст",
            receiverId: customerUser.id,
            orderId: "101",
            orderType: "regular",
            replyToMessageId: null,
        });

        await expect(
            page.locator(".chat-message-sent").filter({
                hasText: "Исправленный текст",
            })
        ).toHaveCount(1);

        await expect(input).toHaveValue("");
    });

    test("после перезагрузки сохраняет UUID неподтверждённого сообщения", async ({ page }) => {
        const requests = await mockChatSendAfterFailure(page, {
            firstStatus: 500,
            firstMessage: "Временная ошибка сервера",
            messageId: 1004,
        });

        const message = "Сообщение с восстановлением после перезагрузки";

        const input = page.locator(".chat-input");

        const sendButton = page.getByRole("button", {
            name: "Отправить сообщение",
        });

        // Первая попытка заканчивается ошибкой 500.
        await input.fill(message);
        await sendButton.click();

        await expect.poll(() => requests.length).toBe(1);

        await expect(
            page.locator(".chat-send-status--error")
        ).toContainText("Нет подтверждения отправки");

        const originalId = requests[0].clientMessageId;

        // Проверяем, что сообщение сохранено локально.
        const saved = await page.evaluate(() => {
            const key = Object.keys(localStorage).find(
                (item) => item.startsWith("cc:chat:pending:v1:")
            );

            return {
                key,
                value: key
                    ? JSON.parse(localStorage.getItem(key))
                    : null,
            };
        });

        expect(saved.key).toBeTruthy();
        expect(saved.value).toMatchObject({
            content: message,
            clientMessageId: originalId,
            orderId: "101",
            orderType: "regular",
        });

        // Пользователь перезагружает страницу.
        await page.reload({
            waitUntil: "domcontentloaded",
        });

        // Текст должен восстановиться.
        await expect(input).toHaveValue(message);

        await expect(
            page.locator(".chat-send-status--error")
        ).toContainText("Есть сообщение без подтверждения отправки");

        // Повторяем отправку.
        await expect(sendButton).toBeEnabled();
        await sendButton.click();

        await expect.poll(() => requests.length).toBe(2);

        // UUID не должен измениться.
        expect(requests[1].clientMessageId).toBe(originalId);

        expect(requests[1]).toMatchObject({
            content: message,
            receiverId: customerUser.id,
            orderId: "101",
            orderType: "regular",
            replyToMessageId: null,
        });

        // Сообщение отображается только один раз.
        await expect(
            page.locator(".chat-message-sent").filter({
                hasText: message,
            })
        ).toHaveCount(1);

        await expect(input).toHaveValue("");

        // После подтверждения неподтверждённая копия удаляется.
        await expect.poll(() =>
            page.evaluate((key) => {
                return localStorage.getItem(key);
            }, saved.key)
        ).toBeNull();

        await expect(
            page.locator(".chat-send-status--error")
        ).not.toBeVisible();
    });

    test("двойное нажатие Отправить создаёт только один запрос", async ({ page }) => {
        const requests = [];

        // Искусственно задерживаем ответ сервера.
        let releaseResponse;

        const responseGate = new Promise((resolve) => {
            releaseResponse = resolve;
        });

        await page.route("**/api/messages", async (route) => {
            const request = route.request();

            if (request.method() !== "POST") {
                await route.fulfill({
                    status: 405,
                    json: {
                        message: "Метод не поддерживается",
                    },
                });
                return;
            }

            const body = request.postDataJSON();

            requests.push(body);

            // Ответ пока не возвращаем.
            await responseGate;

            await route.fulfill({
                status: 201,
                json: {
                    id: 1005,
                    content: body.content,
                    senderId: testUser.id,
                    receiverId: customerUser.id,
                    orderId: 101,
                    orderType: "regular",
                    clientMessageId: body.clientMessageId,
                    replyToMessageId: body.replyToMessageId,
                    createdAt: "2026-07-01T10:30:00.000Z",
                    readAt: null,
                },
            });
        });

        const message = "Проверка двойной отправки";

        const input = page.locator(".chat-input");

        const sendButton = page.getByRole("button", {
            name: "Отправить сообщение",
        });

        await input.fill(message);

        await expect(sendButton).toBeEnabled();

        // Два нажатия в одном цикле JavaScript.
        // Это проверяет защиту ещё до обновления React.
        await page.evaluate(() => {
            const button = document.querySelector(
                ".chat-send-button"
            );

            if (!button) {
                throw new Error("Кнопка отправки не найдена");
            }

            button.click();
            button.click();
        });

        try {
            await expect.poll(() => requests.length).toBe(1);

            // Пока запрос выполняется, кнопка заблокирована.
            await expect(sendButton).toBeDisabled();

            expect(requests).toHaveLength(1);

            expect(requests[0]).toMatchObject({
                content: message,
                receiverId: customerUser.id,
                orderId: "101",
                orderType: "regular",
                replyToMessageId: null,
            });

            expect(requests[0].clientMessageId).toMatch(
                /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
            );
        } finally {
            // Разрешаем серверу ответить,
            // даже если проверка завершилась ошибкой.
            releaseResponse();
        }

        // После ответа сообщение появляется на экране.
        await expect(
            page.locator(".chat-message-sent").filter({
                hasText: message,
            })
        ).toHaveCount(1);

        await expect(input).toHaveValue("");

        await expect(sendButton).toBeDisabled();

        // Проверяем, что второго запроса не было.
        expect(requests).toHaveLength(1);
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