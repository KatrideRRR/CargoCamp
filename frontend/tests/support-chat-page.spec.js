const {
    test,
    expect,
} = require("./fixtures/safeTest");

const {
    mockChatSocket,
} = require("./utils/mockChatSocket");

const FRONT_URL = "http://localhost:3000";

const UUID_V4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const testUser = {
    id: 123,
    userId: 123,
    username: "testuser",
    role: "customer",
};

const initialMessages = [
    {
        id: 1,
        senderRole: "user",
        text: "Здравствуйте, у меня вопрос по заказу",
        createdAt: "2026-07-01T10:00:00.000Z",
    },
    {
        id: 2,
        senderRole: "admin",
        text: "Здравствуйте! Подскажите номер заказа.",
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

async function setupSupportMocks(page, options = {}) {
    const {
        user = testUser,
        messages = initialMessages,
        messagesStatus = 200,
        messagesBody = messages,
        sendStatus = 201,
        sendBody = null,
        readStatus = 200,
        onGetMessages,
        onSendMessage,
        onRead,
    } = options;

// Поддельный Socket.IO.
// Позволяет тестам отправлять события в браузер.
    const socketConnections = await mockChatSocket(page);

    options.onSocketConnections?.(socketConnections);

    // Яндекс.Карты.
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

    // Google Fonts.
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

    // Проверка задолженности вымышленного пользователя.
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

    // Дополнительные методы получения профиля.
    await page.route(
        "**/api/auth/me",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: user,
            });
        }
    );

    await page.route(
        "**/api/users/me",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: user,
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

    await page.route("**/api/auth/profile", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(user),
        });
    });

    await page.route("**/api/support/messages", async (route) => {
        const method = route.request().method();

        if (method === "GET") {
            onGetMessages?.();

            await route.fulfill({
                status: messagesStatus,
                contentType: "application/json",
                body: JSON.stringify(messagesBody),
            });

            return;
        }

        if (method === "POST") {
            const requestBody = route.request().postDataJSON();
            onSendMessage?.(requestBody);

            await route.fulfill({
                status: sendStatus,
                contentType: "application/json",
                body: JSON.stringify(
                    sendBody || {
                        id: 3,
                        userId: user.id,
                        senderRole: "user",
                        text: requestBody.text,
                        clientMessageId: requestBody.clientMessageId,
                        isReadByAdmin: false,
                        createdAt: "2026-07-01T10:05:00.000Z",
                    }
                ),
            });

            return;
        }

        await route.fallback();
    });

    await page.route(
        "**/api/support/read",
        async (route) => {
            const request = route.request();

            if (request.method() !== "PATCH") {
                await route.fulfill({
                    status: 405,
                    json: {
                        message: "Метод не поддерживается",
                    },
                });
                return;
            }

            const body = request.postDataJSON();

            onRead?.({
                method: request.method(),
                body,
            });

            await route.fulfill({
                status: readStatus,
                json: {
                    success: readStatus === 200,
                    updated: 1,
                    throughId: body.throughId,
                },
            });
        }
    );
}

async function openSupportChatPage(page, options = {}) {
    await setFakeAuth(page, options.user || testUser);
    await setupSupportMocks(page, options);

    const query = options.query || "platform=web";

    await page.goto(`${FRONT_URL}/support?${query}`, {

        waitUntil: "domcontentloaded",

        timeout: 30000,

    });

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "support-chat-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("SupportChatPage редиректит на /login. Fake JWT не применился или роут другой.");
    }

    await expect(page.locator(".support-chat-page")).toBeVisible({
        timeout: 15000,
    });
}

async function sendTextByButton(page, text) {
    const input = page.getByPlaceholder("Напишите сообщение...");

    await input.fill(text);

    await page.getByRole("button", {
        name: "Отправить",
    }).click();
}

function makeSupportMessage(body, id) {
    return {
        id,
        userId: testUser.id,
        senderRole: "user",
        text: body.text,
        clientMessageId: body.clientMessageId,
        isReadByAdmin: false,
        createdAt: "2026-07-01T11:00:00.000Z",
    };
}

/*
 * Перехватываем только POST отправки.
 * GET истории продолжает обрабатываться
 * существующим setupSupportMocks().
 */
async function interceptSupportPosts(page, responder) {
    const requests = [];

    await page.route(
        "**/api/support/messages",
        async (route) => {
            if (route.request().method() !== "POST") {
                await route.fallback();
                return;
            }

            const body = route.request().postDataJSON();

            requests.push(body);

            const attempt = requests.length;

            const result = await responder?.(
                body,
                attempt
            ) || {};

            await route.fulfill({
                status: result.status ?? 201,
                json: result.json ??
                    makeSupportMessage(
                        body,
                        500 + attempt
                    ),
            });
        }
    );

    return requests;
}

/*
 * Открываем страницу и дожидаемся
 * подключения к поддельному Socket.IO.
 */
async function openSupportSocketPage(page, options = {}) {
    let connections = [];

    await openSupportChatPage(page, {
        ...options,

        onSocketConnections: (value) => {
            connections = value;
        },
    });

    const connectedSocket = () =>
        connections.find((connection) =>
            connection.clientMessages.some(
                (message) =>
                    message.startsWith("42") &&
                    message.includes(
                        '"subscribeSupportChat"'
                    )
            )
        );

    await expect.poll(
        () => Boolean(connectedSocket()),
        {
            timeout: 10000,
        }
    ).toBe(true);

    return connectedSocket();
}

test.describe("SupportChatPage", () => {
    test("отображает шапку и информационный блок", async ({ page }) => {
        await openSupportChatPage(page);

        await expect(page.locator(".support-chat-header")).toBeVisible();
        await expect(page.getByRole("heading", { name: "Поддержка CargoCamp" })).toBeVisible();

        await expect(page.locator(".support-header-info")).toContainText(
            "Поможем с заказами, оплатой и работой приложения"
        );

        await expect(page.locator(".support-info-card")).toContainText("Здравствуйте!");
        await expect(page.locator(".support-info-card")).toContainText(
            "Не отправляйте в чат данные банковских карт"
        );
    });

    test("при открытии скрывает нижнее меню через body class", async ({ page }) => {
        await openSupportChatPage(page);

        await expect(page.locator("body")).toHaveClass(/hide-bottom-menu/);
    });

    test("загружает сообщения поддержки", async ({ page }) => {
        await openSupportChatPage(page);

        await expect(page.locator(".support-messages-list")).toBeVisible();

        await expect(page.getByText("Здравствуйте, у меня вопрос по заказу")).toBeVisible();
        await expect(page.getByText("Здравствуйте! Подскажите номер заказа.")).toBeVisible();

        await expect(page.locator(".support-message-row.mine")).toHaveCount(1);
        await expect(page.locator(".support-message-row.admin")).toHaveCount(1);
    });

    test("сообщение пользователя отображается справа как mine", async ({ page }) => {
        await openSupportChatPage(page);

        const myMessage = page.locator(".support-message-row.mine").filter({
            hasText: "Здравствуйте, у меня вопрос по заказу",
        });

        await expect(myMessage).toBeVisible();
        await expect(myMessage.locator(".support-message-meta")).toBeVisible();
    });

    test("сообщение поддержки отображается с автором Поддержка", async ({ page }) => {
        await openSupportChatPage(page);

        const adminMessage = page.locator(".support-message-row.admin").filter({
            hasText: "Здравствуйте! Подскажите номер заказа.",
        });

        await expect(adminMessage).toBeVisible();
        await expect(adminMessage.locator(".support-message-author")).toHaveText("Поддержка");
        await expect(adminMessage.locator(".support-message-avatar")).toBeVisible();
    });

    test("после загрузки помечает сообщения прочитанными", async ({ page }) => {
        const readRequests = [];

        await openSupportChatPage(page, {
            onRead: (request) => {
                readRequests.push(request);
            },
        });

        await expect.poll(
            () => readRequests.length
        ).toBeGreaterThanOrEqual(1);

        expect(readRequests[0]).toMatchObject({
            method: "PATCH",
            body: {
                throughId: 2,
            },
        });
    });

    test("показывает пустое состояние, если сообщений нет", async ({ page }) => {
        await openSupportChatPage(page, {
            messages: [],
        });

        await expect(page.locator(".support-empty")).toBeVisible();
        await expect(page.locator(".support-empty")).toContainText("Чат поддержки");
        await expect(page.locator(".support-empty")).toContainText(
            "Напишите первое сообщение"
        );
    });

    test("показывает ошибку, если чат не загрузился", async ({ page }) => {
        await openSupportChatPage(page, {
            messagesStatus: 500,
            messagesBody: {
                message: "Server error",
            },
        });

        await expect(page.locator(".support-error")).toHaveText(
            "Не удалось обновить переписку поддержки"
        );
    });

    test("поле ввода и кнопка отправки отображаются всегда", async ({ page }) => {
        await openSupportChatPage(page);

        await expect(page.locator(".support-chat-input-wrap")).toBeVisible();
        await expect(page.getByPlaceholder("Напишите сообщение...")).toBeVisible();
        await expect(page.getByRole("button", { name: "Отправить" })).toBeVisible();
    });

    test("кнопка отправки отключена на пустом сообщении", async ({ page }) => {
        await openSupportChatPage(page);

        await expect(page.getByRole("button", { name: "Отправить" })).toBeDisabled();

        await page.getByPlaceholder("Напишите сообщение...").fill("   ");

        await expect(page.getByRole("button", { name: "Отправить" })).toBeDisabled();
    });

    test("отправляет сообщение по кнопке", async ({ page }) => {
        let sentBody = null;

        await openSupportChatPage(page, {
            onSendMessage: (body) => {
                sentBody = body;
            },
        });

        await sendTextByButton(page, "Нужна помощь с оплатой");

        await expect
            .poll(() => sentBody, {
                timeout: 10000,
            })
            .toMatchObject({
                text: "Нужна помощь с оплатой",
            });

        await expect(page.getByText("Нужна помощь с оплатой")).toBeVisible();
        await expect(page.getByPlaceholder("Напишите сообщение...")).toHaveValue("");
    });

    test("обрезает пробелы при отправке сообщения", async ({ page }) => {
        let sentBody = null;

        await openSupportChatPage(page, {
            onSendMessage: (body) => {
                sentBody = body;
            },
        });

        await sendTextByButton(page, "   Текст с пробелами   ");

        await expect
            .poll(() => sentBody, {
                timeout: 10000,
            })
            .toMatchObject({
                text: "Текст с пробелами",
            });
    });

    test("отправляет сообщение по Enter", async ({ page }) => {
        let sentBody = null;

        await openSupportChatPage(page, {
            onSendMessage: (body) => {
                sentBody = body;
            },
        });

        const input = page.getByPlaceholder("Напишите сообщение...");

        await input.fill("Отправка через Enter");
        await input.press("Enter");

        await expect
            .poll(() => sentBody, {
                timeout: 10000,
            })
            .toMatchObject({
                text: "Отправка через Enter",
            });

        await expect(page.getByText("Отправка через Enter")).toBeVisible();
    });

    test("Shift+Enter не отправляет сообщение", async ({ page }) => {
        let sentBody = null;

        await openSupportChatPage(page, {
            onSendMessage: (body) => {
                sentBody = body;
            },
        });

        const input = page.getByPlaceholder("Напишите сообщение...");

        await input.fill("Первая строка");
        await input.press("Shift+Enter");

        expect(sentBody).toBeNull();

        await expect(input).toHaveValue("Первая строка\n");
    });

    test("при ошибке отправки показывает ошибку и возвращает текст в поле", async ({ page }) => {
        await openSupportChatPage(page, {
            sendStatus: 500,
            sendBody: {
                message: "Server error",
            },
        });

        await sendTextByButton(page, "Сообщение не отправится");

        await expect(
            page.locator(".support-error")
        ).toContainText(
            "Нет подтверждения отправки"
        );

        await expect(page.getByPlaceholder("Напишите сообщение...")).toHaveValue(
            "Сообщение не отправится"
        );
    });

    test("не отправляет пустое сообщение", async ({ page }) => {
        let sentBody = null;

        await openSupportChatPage(page, {
            onSendMessage: (body) => {
                sentBody = body;
            },
        });

        await page.getByPlaceholder("Напишите сообщение...").fill("   ");

        await expect(page.getByRole("button", { name: "Отправить" })).toBeDisabled();

        expect(sentBody).toBeNull();
    });

    test("кнопка Назад возвращает на предыдущую страницу", async ({ page }) => {
        await setFakeAuth(page);
        await setupSupportMocks(page);

        await page.goto(`${FRONT_URL}/?platform=web`);
        await page.goto(`${FRONT_URL}/support?platform=web`);

        await expect(page.locator(".support-chat-page")).toBeVisible({
            timeout: 15000,
        });

        await page.getByLabel("Назад").click();

        await expect(page).toHaveURL(
            `${FRONT_URL}/?platform=web`
        );
    });

    test("восстанавливает черновик поддержки после перезагрузки", async ({ page }) => {
        await openSupportChatPage(page);

        const input = page.locator(".support-chat-input");

        const draft = "Черновик сообщения в поддержку";

        await input.fill(draft);

        await expect.poll(() =>
            page.evaluate(() =>
                localStorage.getItem(
                    "cc:support:user:draft:123"
                )
            )
        ).toBe(draft);

        await page.reload({
            waitUntil: "domcontentloaded",
        });

        await expect(input).toHaveValue(draft);

        await expect(
            page.getByRole("button", {
                name: "Отправить",
            })
        ).toBeEnabled();
    });

    test("после ошибки сервера повторяет поддержку с прежним UUID", async ({ page }) => {
        await openSupportChatPage(page);

        const requests = await interceptSupportPosts(
            page,
            (_, attempt) => {
                if (attempt === 1) {
                    return {
                        status: 500,
                        json: {
                            message: "Временная ошибка сервера",
                        },
                    };
                }

                return {};
            }
        );

        const message = "Сообщение после ошибки сервера";

        const input = page.locator(".support-chat-input");

        const sendButton = page.getByRole("button", {
            name: "Отправить",
        });

        await input.fill(message);

        // Первая отправка заканчивается ошибкой.
        await sendButton.click();

        await expect.poll(
            () => requests.length
        ).toBe(1);

        await expect(
            page.locator(".support-error")
        ).toContainText(
            "Нет подтверждения отправки"
        );

        const originalId =
            requests[0].clientMessageId;

        expect(originalId).toMatch(UUID_V4);

        // Неподтверждённое сообщение сохранено.
        const pending = await page.evaluate(() =>
            JSON.parse(
                localStorage.getItem(
                    "cc:support:user:pending:123"
                ) || "null"
            )
        );

        expect(pending).toMatchObject({
            text: message,
            clientMessageId: originalId,
        });

        // Перезагружаем приложение.
        await page.reload({
            waitUntil: "domcontentloaded",
        });

        await expect(input).toHaveValue(message);

        // Повторяем отправку.
        await expect(sendButton).toBeEnabled();

        await sendButton.click();

        await expect.poll(
            () => requests.length
        ).toBe(2);

        // Важнейшая проверка: UUID тот же.
        expect(
            requests[1].clientMessageId
        ).toBe(originalId);

        expect(requests[1].text).toBe(message);

        // На экране одна копия сообщения.
        await expect(
            page.locator(".support-message-row.mine")
                .filter({
                    hasText: message,
                })
        ).toHaveCount(1);

        await expect(input).toHaveValue("");

        // Pending удаляется после подтверждения.
        await expect.poll(() =>
            page.evaluate(() =>
                localStorage.getItem(
                    "cc:support:user:pending:123"
                )
            )
        ).toBeNull();

        await expect(
            page.locator(".support-error")
        ).not.toBeVisible();
    });

    test("не отправляет другой текст при неподтверждённом сообщении", async ({ page }) => {
        await openSupportChatPage(page);

        const requests = await interceptSupportPosts(
            page,
            () => ({
                status: 500,
                json: {
                    message: "Нет ответа сервера",
                },
            })
        );

        const input = page.locator(".support-chat-input");

        const button = page.getByRole("button", {
            name: "Отправить",
        });

        await input.fill("Первоначальное сообщение");

        await button.click();

        await expect.poll(
            () => requests.length
        ).toBe(1);

        await expect(
            page.locator(".support-error")
        ).toContainText(
            "Нет подтверждения отправки"
        );

        const originalId =
            requests[0].clientMessageId;

        // Пользователь пытается отправить другой текст.
        await input.fill("Совершенно другое сообщение");

        await button.click();

        // Приложение должно заблокировать отправку.
        await expect(
            page.locator(".support-error")
        ).toContainText(
            "Верните исходный текст"
        );

        expect(requests).toHaveLength(1);

        // Предыдущий идентификатор сохранился.
        const pending = await page.evaluate(() =>
            JSON.parse(
                localStorage.getItem(
                    "cc:support:user:pending:123"
                ) || "null"
            )
        );

        expect(pending).toMatchObject({
            text: "Первоначальное сообщение",
            clientMessageId: originalId,
        });
    });

    test("двойное нажатие в поддержке создаёт один запрос", async ({ page }) => {
        await openSupportChatPage(page);

        let releaseResponse;

        const responseGate = new Promise(
            (resolve) => {
                releaseResponse = resolve;
            }
        );

        const requests = await interceptSupportPosts(
            page,
            async () => {
                // Искусственно задерживаем ответ.
                await responseGate;

                return {};
            }
        );

        const message = "Проверка двойной отправки";

        const input = page.locator(".support-chat-input");

        const button = page.getByRole("button", {
            name: "Отправить",
        });

        await input.fill(message);

        // Два нажатия подряд в одном цикле JS.
        await page.evaluate(() => {
            const button = document.querySelector(
                ".support-send-button"
            );

            if (!button) {
                throw new Error(
                    "Кнопка отправки не найдена"
                );
            }

            button.click();
            button.click();
        });

        try {
            await expect.poll(
                () => requests.length
            ).toBe(1);

            await expect(button).toBeDisabled();

            expect(requests[0]).toMatchObject({
                text: message,
            });

            expect(
                requests[0].clientMessageId
            ).toMatch(UUID_V4);

            // Пока первый запрос выполняется,
            // второго запроса быть не должно.
            expect(requests).toHaveLength(1);
        } finally {
            // Обязательно завершаем задержанный ответ.
            releaseResponse();
        }

        await expect(
            page.locator(".support-message-row.mine")
                .filter({
                    hasText: message,
                })
        ).toHaveCount(1);

        await expect(input).toHaveValue("");

        expect(requests).toHaveLength(1);
    });

    test("получает ответы поддержки через Socket.IO без дублей", async ({ page }) => {
        const readRequests = [];

        const socket = await openSupportSocketPage(
            page,
            {
                onRead: (request) => {
                    readRequests.push(request);
                },
            }
        );

        const adminMessage = {
            id: 77,
            userId: testUser.id,
            senderRole: "admin",
            text: "Ответ поддержки через Socket.IO",
            createdAt: "2026-07-01T12:00:00.000Z",
        };

        socket.emit("support:reply", {
            userId: testUser.id,
            message: adminMessage,
        });

        const adminRow = page.locator(
            ".support-message-row.admin"
        ).filter({
            hasText: adminMessage.text,
        });

        await expect(adminRow).toBeVisible();

        // Повторная доставка того же сообщения.
        socket.emit("support:reply", {
            userId: testUser.id,
            message: adminMessage,
        });

        await expect(adminRow).toHaveCount(1);

        // Событие чужого пользователя игнорируется.
        socket.emit("support:new_message", {
            userId: 999,
            message: {
                id: 79,
                senderRole: "admin",
                text: "Чужое сообщение поддержки",
                createdAt: "2026-07-01T12:01:00.000Z",
            },
        });

        await expect(
            page.getByText(
                "Чужое сообщение поддержки"
            )
        ).toHaveCount(0);

        // Второй поддерживаемый тип события.
        socket.emit("support:new_message", {
            userId: testUser.id,
            message: {
                id: 78,
                senderRole: "admin",
                text: "Ещё один ответ администратора",
                createdAt: "2026-07-01T12:02:00.000Z",
            },
        });

        await expect(
            page.getByText(
                "Ещё один ответ администратора"
            )
        ).toBeVisible();

        // Администраторские сообщения отмечаются
        // прочитанными через поддельный PATCH.
        await expect.poll(
            () => readRequests.some(
                (request) =>
                    request.method === "PATCH" &&
                    request.body.throughId === 78
            )
        ).toBe(true);

        // Первое сообщение не задублировалось.
        await expect(adminRow).toHaveCount(1);
    });

    test("обновляет галочки после подтверждения поддержки", async ({ page }) => {
        const socket = await openSupportSocketPage(page);

        const myMessage = page.locator(
            ".support-message-row.mine"
        ).filter({
            hasText: initialMessages[0].text,
        });

        await expect(myMessage).toBeVisible();

        // Текст внутри SVG-иконки галочки.
        const checkTitle = myMessage.locator(
            ".support-message-meta svg title"
        );

        // Сначала сообщение только сохранено.
        await expect(checkTitle).toHaveText(
            "Сохранено на сервере"
        );

        // Чужое подтверждение прочтения.
        // Оно не должно менять состояние сообщения.
        socket.emit("support:read", {
            userId: 999,
            readerRole: "admin",
            throughId: 1,
        });

        await expect(checkTitle).toHaveText(
            "Сохранено на сервере"
        );

        // Настоящий участник тестового чата:
        // администратор прочитал сообщение.
        socket.emit("support:read", {
            userId: testUser.id,
            readerRole: "admin",
            throughId: 1,
        });

        // Иконка должна смениться на две галочки.
        await expect(checkTitle).toHaveText(
            "Прочитано поддержкой"
        );

        // В интерфейсе всё ещё одно сообщение.
        await expect(myMessage).toHaveCount(1);
    });

    test("дозагружает сообщения поддержки после восстановления связи", async ({ page }) => {
        await openSupportChatPage(page);

        await expect(
            page.getByText(initialMessages[0].text)
        ).toBeVisible();

        const newMessage = {
            id: 88,
            senderRole: "admin",
            text: "Сообщение после восстановления связи",
            createdAt: "2026-07-01T12:10:00.000Z",
        };

        let refreshRequests = 0;

        // Подменяем только повторное получение истории.
        await page.route(
            "**/api/support/messages",
            async (route) => {
                if (route.request().method() !== "GET") {
                    await route.fallback();
                    return;
                }

                refreshRequests++;

                await route.fulfill({
                    status: 200,
                    json: [
                        ...initialMessages,
                        newMessage,
                    ],
                });
            }
        );

        // Имитируем возвращение интернета.
        await page.evaluate(() => {
            window.dispatchEvent(
                new Event("online")
            );
        });

        await expect.poll(
            () => refreshRequests
        ).toBeGreaterThanOrEqual(1);

        await expect(
            page.getByText(newMessage.text)
        ).toBeVisible();

        // Старые сообщения не дублируются.
        await expect(
            page.locator(".support-message-row")
        ).toHaveCount(3);

        await expect(
            page.getByText(initialMessages[0].text)
        ).toHaveCount(1);
    });

    test("сохраняет историю поддержки при ошибке и восстанавливается", async ({ page }) => {
        await openSupportChatPage(page);

        await expect(
            page.getByText(initialMessages[0].text)
        ).toBeVisible();

        let networkUnavailable = true;

        const recoveredMessage = {
            id: 89,
            senderRole: "admin",
            text: "Поддержка снова на связи",
            createdAt: "2026-07-01T12:20:00.000Z",
        };

        await page.route(
            "**/api/support/messages",
            async (route) => {
                if (route.request().method() !== "GET") {
                    await route.fallback();
                    return;
                }

                if (networkUnavailable) {
                    await route.fulfill({
                        status: 503,
                        json: {
                            message: "Сервис недоступен",
                        },
                    });
                    return;
                }

                await route.fulfill({
                    status: 200,
                    json: [
                        ...initialMessages,
                        recoveredMessage,
                    ],
                });
            }
        );

        // Повторная загрузка заканчивается ошибкой.
        await page.evaluate(() => {
            window.dispatchEvent(
                new Event("online")
            );
        });

        await expect(
            page.locator(".support-error")
        ).toContainText(
            "Не удалось обновить переписку поддержки"
        );

        // Ранее полученная история не исчезла.
        await expect(
            page.getByText(initialMessages[0].text)
        ).toBeVisible();

        await expect(
            page.getByText(initialMessages[1].text)
        ).toBeVisible();

        // Восстанавливаем вымышленное соединение.
        networkUnavailable = false;

        await page.evaluate(() => {
            window.dispatchEvent(
                new Event("online")
            );
        });

        await expect(
            page.getByText(recoveredMessage.text)
        ).toBeVisible();

        await expect(
            page.locator(".support-error")
        ).not.toBeVisible();

        await expect(
            page.locator(".support-message-row")
        ).toHaveCount(3);
    });



    test("отображает время сообщения", async ({ page }) => {
        await openSupportChatPage(page);

        const myMessage = page.locator(".support-message-row.mine").filter({
            hasText: "Здравствуйте, у меня вопрос по заказу",
        });

        await expect(myMessage.locator(".support-message-meta span")).toHaveText(/\d{2}:\d{2}/);
    });
});