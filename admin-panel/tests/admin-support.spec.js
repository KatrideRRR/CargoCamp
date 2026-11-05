const {
    test,
    expect,
} = require("./fixtures/safeTest");

const {
    mockAdminSocket,
} = require("./utils/mockAdminSocket");

const UUID_V4 =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FRONT_URL = "http://localhost:3001";

// Если route другой — поменяй только это:
const SUPPORT_PATH = "/support";

const chats = [
    {
        userId: 101,
        unreadCount: 2,
        lastMessageAt: "2026-07-01T10:20:00.000Z",
        user: {
            id: 101,
            username: "Аким",
            phone: "+79781234567",
            avatar: "",
        },
    },
    {
        userId: 202,
        unreadCount: 0,
        lastMessageAt: "2026-07-01T09:10:00.000Z",
        user: {
            id: 202,
            username: "Иван",
            phone: "",
            avatar: "",
        },
    },
];

const messagesByUser = {
    101: [
        {
            id: 1,
            text: "Здравствуйте, нужна помощь по заказу",
            senderRole: "user",
            createdAt: "2026-07-01T10:15:00.000Z",
            sender: {
                username: "Аким",
            },
        },
        {
            id: 2,
            text: "Здравствуйте, сейчас проверим",
            senderRole: "admin",
            createdAt: "2026-07-01T10:16:00.000Z",
            sender: {
                username: "Администратор",
            },
        },
    ],
    202: [
        {
            id: 3,
            text: "Не могу открыть чат",
            senderRole: "user",
            createdAt: "2026-07-01T09:05:00.000Z",
            sender: {
                username: "Иван",
            },
        },
    ],
};

async function setAdminAuth(page) {
    const adminUser = {
        id: 1,
        username: "test-admin",
        name: "Тестовый администратор",
        role: "admin",
        isAdmin: true,
    };

    const encode = (value) =>
        Buffer.from(JSON.stringify(value))
            .toString("base64url");

    const token = [
        encode({
            alg: "none",
            typ: "JWT",
        }),
        encode({
            id: adminUser.id,
            role: "admin",
            exp:
                Math.floor(Date.now() / 1000) +
                24 * 60 * 60,
        }),
        "",
    ].join(".");

    await page.addInitScript(
        ({ token, adminUser }) => {
            localStorage.setItem("authToken", token);
            localStorage.setItem("adminToken", token);
            localStorage.setItem("token", token);
            localStorage.setItem("userRole", "admin");

            localStorage.setItem(
                "user",
                JSON.stringify(adminUser)
            );

            localStorage.setItem(
                "adminUser",
                JSON.stringify(adminUser)
            );

            localStorage.setItem(
                "currentUser",
                JSON.stringify(adminUser)
            );
        },
        {
            token,
            adminUser,
        }
    );
}

async function setupMocks(page, options = {}) {
    const {
        chatsStatus = 200,
        chatsBody = chats,
        messagesStatus = 200,
        messagesMap = messagesByUser,
        sendStatus = 201,
        sendBody = {
            id: 99,
            text: "Ответ администратора",
            senderRole: "admin",
            createdAt: "2026-07-01T10:25:00.000Z",
            userId: 101,
            senderId: 1,
            isReadByUser: false,
            sender: {
                username: "Администратор",
            },
        },
        onSend,
        onRead,
        onFetchChats,
        onFetchMessages,
    } = options;

    const socketConnections = await mockAdminSocket(page);

    options.onSocketConnections?.(socketConnections);

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

    await page.route("**/api/admin/support/chats", async (route) => {
        if (route.request().method() !== "GET") {
            await route.fallback();
            return;
        }

        onFetchChats?.();

        await route.fulfill({
            status: chatsStatus,
            contentType: "application/json",
            body: JSON.stringify(chatsBody),
        });
    });

    await page.route("**/api/admin/support/chats/*/messages", async (route) => {
        const method = route.request().method();
        const url = route.request().url();

        const match = url.match(/\/admin\/support\/chats\/(\d+)\/messages/);
        const userId = match?.[1];

        if (method === "GET") {
            onFetchMessages?.(Number(userId));

            await route.fulfill({
                status: messagesStatus,
                contentType: "application/json",
                body: JSON.stringify(messagesMap?.[userId] || messagesMap?.[Number(userId)] || []),
            });

            return;
        }

        if (method === "POST") {
            onSend?.({
                userId: Number(userId),
                body: route.request().postDataJSON(),
            });

            await route.fulfill({
                status: sendStatus,
                contentType: "application/json",
                body: JSON.stringify(sendBody),
            });

            return;
        }

        await route.fallback();
    });

    await page.route(
        "**/api/admin/support/chats/*/read",
        async (route) => {
            const request = route.request();

            const match = request.url().match(
                /\/admin\/support\/chats\/(\d+)\/read/
            );

            const userId = Number(match?.[1]);

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
                userId,
                method: "PATCH",
                body,
            });

            await route.fulfill({
                status: 200,
                json: {
                    success: true,
                    updated: 1,
                    throughId: body.throughId,
                },
            });
        }
    );
}

async function openSupportPage(page, options = {}) {
    await setAdminAuth(page);
    await setupMocks(page, options);

    await page.goto(`${FRONT_URL}${SUPPORT_PATH}`);
    await page.waitForLoadState("domcontentloaded");

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "admin-support-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("AdminSupportPage редиректит на /login. Проверь PrivateRoute.");
    }

    if (!(await page.locator(".admin-support-page").count())) {
        await page.screenshot({
            path: "admin-support-wrong-route.png",
            fullPage: true,
        });

        throw new Error(
            `AdminSupportPage не найдена. Текущий URL: ${page.url()}. Проверь SUPPORT_PATH в тесте.`
        );
    }

    await expect(page.locator(".admin-support-page")).toBeVisible({
        timeout: 15000,
    });
}

async function mockAdminSendAttempts(page, responder = async () => ({})) {
    const attempts = [];

    await page.route(
        "**/api/admin/support/chats/*/messages",
        async (route) => {
            const request = route.request();

            // GET истории обрабатывается старым моком.
            if (request.method() !== "POST") {
                await route.fallback();
                return;
            }

            const match = new URL(request.url()).pathname.match(
                /\/admin\/support\/chats\/(\d+)\/messages$/
            );

            if (!match) {
                await route.fallback();
                return;
            }

            const payload = {
                userId: Number(match[1]),
                body: request.postDataJSON(),
            };

            attempts.push(payload);

            const result =
                (await responder(payload, attempts.length)) || {};

            await route.fulfill({
                status: result.status ?? 201,
                json: result.json ?? {
                    id: 600 + attempts.length,
                    userId: payload.userId,
                    senderId: 1,
                    senderRole: "admin",
                    text: payload.body.text,
                    clientMessageId: payload.body.clientMessageId,
                    isReadByUser: false,
                    createdAt: "2026-07-01T11:00:00.000Z",
                    sender: {
                        username: "Администратор",
                    },
                },
            });
        }
    );

    return attempts;
}

async function openAdminSocketPage(page, options = {}) {
    let connections = [];

    await openSupportPage(page, {
        ...options,

        onSocketConnections: (value) => {
            connections = value;
        },
    });

    const getConnectedSocket = () =>
        connections.find((connection) =>
            connection.clientMessages.some(
                (message) =>
                    message.startsWith("42") &&
                    message.includes('"subscribeAdminSupport"')
            )
        );

    await expect.poll(
        () => Boolean(getConnectedSocket()),
        {
            timeout: 10000,
        }
    ).toBe(true);

    // Первый диалог полностью загружен.
    await expect(
        page.locator(".admin-support-message-row")
    ).toHaveCount(2);

    return getConnectedSocket();
}

test.describe("AdminSupportPage", () => {
    test("отображает страницу поддержки", async ({ page }) => {
        await openSupportPage(page);

        await expect(page.getByRole("heading", {
            name: /Поддержка/i,
        })).toBeVisible();

        await expect(page.getByText("Диалоги пользователей с администрацией CargoCamp")).toBeVisible();

        await expect(page.getByRole("button", {
            name: /Обновить/i,
        })).toBeVisible();

        await expect(page.locator(".admin-support-sidebar-title")).toContainText("Чаты");
        await expect(page.locator(".admin-support-sidebar-title")).toContainText("2");
    });

    test("загружает список чатов и выбирает первый чат", async ({ page }) => {
        await openSupportPage(page);

        await expect(page.locator(".admin-support-chat-item")).toHaveCount(2);

        const firstChat = page.locator(".admin-support-chat-item").first();

        await expect(firstChat).toHaveClass(/active/);
        await expect(firstChat).toContainText("Аким");
        await expect(firstChat).toContainText("+79781234567");
        await expect(firstChat).toContainText("2");

        const secondChat = page.locator(".admin-support-chat-item").nth(1);

        await expect(secondChat).toContainText("Иван");
        await expect(secondChat).toContainText("Телефон не указан");
    });

    test("показывает сообщения выбранного пользователя", async ({ page }) => {
        await openSupportPage(page);

        await expect(page.locator(".admin-support-chat-header")).toContainText("Аким");
        await expect(page.locator(".admin-support-chat-header")).toContainText("ID: 101");
        await expect(page.locator(".admin-support-chat-header")).toContainText("+79781234567");

        await expect(page.locator(".admin-support-message-row")).toHaveCount(2);

        const userMessage = page.locator(".admin-support-message-row.user").first();
        await expect(userMessage).toContainText("Аким");
        await expect(userMessage).toContainText("Здравствуйте, нужна помощь по заказу");

        const adminMessage = page.locator(".admin-support-message-row.mine").first();
        await expect(adminMessage).toContainText("Администратор");
        await expect(adminMessage).toContainText("Здравствуйте, сейчас проверим");
    });

    test("после открытия чата помечает его прочитанным", async ({ page }) => {
        const readCalls = [];

        await openSupportPage(page, {
            onRead: (request) => {
                readCalls.push(request);
            },
        });

        await expect.poll(() =>
            readCalls.some((request) =>
                request.userId === 101 &&
                request.method === "PATCH" &&
                request.body.throughId === 1
            )
        ).toBe(true);

        await expect(
            page.locator(".admin-support-chat-item").first().locator(".admin-support-unread")
        ).toHaveCount(0);
    });

    test("переключает чат и загружает сообщения другого пользователя", async ({ page }) => {
        await openSupportPage(page);

        await page.locator(".admin-support-chat-item").nth(1).click();

        await expect(page.locator(".admin-support-chat-item").nth(1)).toHaveClass(/active/);

        await expect(page.locator(".admin-support-chat-header")).toContainText("Иван");
        await expect(page.locator(".admin-support-chat-header")).toContainText("ID: 202");

        await expect(page.locator(".admin-support-message-row")).toHaveCount(1);
        await expect(page.locator(".admin-support-message-row.user")).toContainText("Не могу открыть чат");
    });

    test("отправляет сообщение кнопкой Отправить", async ({ page }) => {
        let sentPayload = null;

        await openSupportPage(page, {
            onSend: (payload) => {
                sentPayload = payload;
            },
        });

        const textarea = page.getByPlaceholder("Написать ответ пользователю...");

        await textarea.fill("Ответ администратора");

        await expect(page.getByRole("button", {
            name: /Отправить/i,
        })).toBeEnabled();

        await page.getByRole("button", {
            name: /Отправить/i,
        }).click();

        await expect
            .poll(() => sentPayload, {
                timeout: 10000,
            })
            .toMatchObject({
                userId: 101,
                body: {
                    text: "Ответ администратора",
                },
            });
        expect(
            sentPayload.body.clientMessageId
        ).toMatch(UUID_V4);

        await expect(textarea).toHaveValue("");
        await expect(page.locator(".admin-support-message-row.mine").last()).toContainText(
            "Ответ администратора"
        );
    });

    test("отправляет сообщение по Enter", async ({ page }) => {
        let sentPayload = null;

        await openSupportPage(page, {
            onSend: (payload) => {
                sentPayload = payload;
            },
            sendBody: {
                id: 100,
                text: "Ответ через Enter",
                senderRole: "admin",
                createdAt: "2026-07-01T10:30:00.000Z",
                sender: {
                    username: "Администратор",
                },
            },
        });

        const textarea = page.getByPlaceholder("Написать ответ пользователю...");

        await textarea.fill("Ответ через Enter");
        await textarea.press("Enter");

        await expect
            .poll(() => sentPayload, {
                timeout: 10000,
            })
            .toMatchObject({
                userId: 101,
                body: {
                    text: "Ответ через Enter",
                },
            });
        expect(
            sentPayload.body.clientMessageId
        ).toMatch(UUID_V4);

        await expect(page.locator(".admin-support-message-row.mine").last()).toContainText(
            "Ответ через Enter"
        );
    });

    test("Shift+Enter не отправляет сообщение", async ({ page }) => {
        let sendCount = 0;

        await openSupportPage(page, {
            onSend: () => {
                sendCount += 1;
            },
        });

        const textarea = page.getByPlaceholder("Написать ответ пользователю...");

        await textarea.fill("Первая строка");
        await textarea.press("Shift+Enter");

        await expect
            .poll(() => sendCount, {
                timeout: 1000,
            })
            .toBe(0);

        await expect(textarea).toHaveValue(/Первая строка/);
    });

    test("кнопка отправки disabled при пустом сообщении", async ({ page }) => {
        await openSupportPage(page);

        const sendButton = page.getByRole("button", {
            name: /Отправить/i,
        });

        await expect(sendButton).toBeDisabled();

        await page.getByPlaceholder("Написать ответ пользователю...").fill("   ");

        await expect(sendButton).toBeDisabled();

        await page.getByPlaceholder("Написать ответ пользователю...").fill("Текст");

        await expect(sendButton).toBeEnabled();
    });

    test("если отправка упала, показывает ошибку и возвращает текст", async ({ page }) => {
        await openSupportPage(page, {
            sendStatus: 500,
            sendBody: {
                message: "Ошибка отправки",
            },
        });

        const textarea = page.getByPlaceholder("Написать ответ пользователю...");

        await textarea.fill("Не отправилось");

        await page.getByRole("button", {
            name: /Отправить/i,
        }).click();

        await expect(page.locator(".admin-support-error")).toHaveText(
            "Нет подтверждения отправки. Повторите отправку того же текста."
        );

        await expect(textarea).toHaveValue("Не отправилось");
    });

    test("кнопка Обновить перезагружает список чатов", async ({ page }) => {
        let fetchCount = 0;

        await openSupportPage(page, {
            onFetchChats: () => {
                fetchCount += 1;
            },
        });

        await page.getByRole("button", {
            name: /Обновить/i,
        }).click();

        await expect
            .poll(() => fetchCount, {
                timeout: 10000,
            })
            .toBeGreaterThanOrEqual(2);
    });

    test("показывает empty state, если чатов нет", async ({ page }) => {
        await openSupportPage(page, {
            chatsBody: [],
            messagesMap: {},
        });

        await expect(page.locator(".admin-support-sidebar-title")).toContainText("0");
        await expect(page.getByText("Пока нет обращений")).toBeVisible();

        await expect(page.getByRole("heading", {
            name: "Выберите чат",
        })).toBeVisible();

        await expect(page.getByText("Здесь появится переписка с пользователем.")).toBeVisible();
    });

    test("показывает empty state, если сообщений нет", async ({ page }) => {
        await openSupportPage(page, {
            messagesMap: {
                101: [],
                202: [],
            },
        });

        await expect(page.getByText("Сообщений пока нет")).toBeVisible();
    });

    test("если загрузка чатов упала, показывает ошибку", async ({ page }) => {
        await openSupportPage(page, {
            chatsStatus: 500,
            chatsBody: {
                message: "Ошибка",
            },
        });

        await expect(page.locator(".admin-support-error")).toHaveText(
            "Не удалось загрузить чаты поддержки"
        );

        await expect(page.getByText("Пока нет обращений")).toBeVisible();
    });

    test("если загрузка сообщений упала, показывает ошибку", async ({ page }) => {
        await openSupportPage(page, {
            messagesStatus: 500,
            messagesMap: {},
        });

        await expect(page.locator(".admin-support-error")).toHaveText(
            "Не удалось обновить переписку"
        );
    });

    test("сохраняет черновики разных чатов после переключения и перезагрузки", async ({ page }) => {
        await openSupportPage(page);

        const input = page.getByPlaceholder(
            "Написать ответ пользователю..."
        );

        await expect(
            page.locator(".admin-support-chat-header")
        ).toContainText("ID: 101");

        const firstDraft = "Черновик первого пользователя";
        const secondDraft = "Черновик второго пользователя";

        await input.fill(firstDraft);

        await expect.poll(() =>
            page.evaluate(() =>
                localStorage.getItem(
                    "cc:support:admin:1:101:draft"
                )
            )
        ).toBe(firstDraft);

        // Переключаемся на второй диалог.
        await page.locator(
            ".admin-support-chat-item"
        ).nth(1).click();

        await expect(
            page.locator(".admin-support-chat-header")
        ).toContainText("ID: 202");

        await expect(input).toHaveValue("");

        await input.fill(secondDraft);

        // Возвращаемся к первому.
        await page.locator(
            ".admin-support-chat-item"
        ).first().click();

        await expect(input).toHaveValue(firstDraft);

        // Проверяем восстановление после перезагрузки.
        await page.reload({
            waitUntil: "domcontentloaded",
        });

        await expect(
            page.locator(".admin-support-chat-header")
        ).toContainText("ID: 101");

        await expect(input).toHaveValue(firstDraft);

        // Черновик второго пользователя тоже сохранился.
        await page.locator(
            ".admin-support-chat-item"
        ).nth(1).click();

        await expect(input).toHaveValue(secondDraft);
    });

    test("после ошибки 500 повторяет ответ с прежним UUID", async ({ page }) => {
        await openSupportPage(page);

        const attempts = await mockAdminSendAttempts(
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

        const message = "Ответ после ошибки сервера";

        const input = page.getByPlaceholder(
            "Написать ответ пользователю..."
        );

        const button = page.getByRole("button", {
            name: "Отправить",
        });

        await input.fill(message);
        await button.click();

        await expect.poll(
            () => attempts.length
        ).toBe(1);

        await expect(
            page.locator(".admin-support-error")
        ).toContainText("Нет подтверждения отправки");

        const originalUUID =
            attempts[0].body.clientMessageId;

        expect(originalUUID).toMatch(UUID_V4);

        const pendingKey =
            "cc:support:admin:1:101:pending";

        const pending = await page.evaluate(
            (key) => JSON.parse(
                localStorage.getItem(key) || "null"
            ),
            pendingKey
        );

        expect(pending).toMatchObject({
            text: message,
            clientMessageId: originalUUID,
        });

        // Перезагружаем админку.
        await page.reload({
            waitUntil: "domcontentloaded",
        });

        await expect(
            page.locator(".admin-support-chat-header")
        ).toContainText("ID: 101");

        await expect(input).toHaveValue(message);

        // Повторная отправка.
        await expect(button).toBeEnabled();
        await button.click();

        await expect.poll(
            () => attempts.length
        ).toBe(2);

        expect(attempts[1]).toMatchObject({
            userId: 101,
            body: {
                text: message,
                clientMessageId: originalUUID,
            },
        });

        await expect(
            page.locator(".admin-support-message-row.mine")
                .filter({ hasText: message })
        ).toHaveCount(1);

        await expect(input).toHaveValue("");

        await expect.poll(() =>
            page.evaluate(
                (key) => localStorage.getItem(key),
                pendingKey
            )
        ).toBeNull();

        await expect(
            page.locator(".admin-support-error")
        ).not.toBeVisible();
    });

    test("не заменяет текст неподтверждённого ответа", async ({ page }) => {
        await openSupportPage(page);

        const attempts = await mockAdminSendAttempts(
            page,
            () => ({
                status: 500,
                json: {
                    message: "Нет подтверждения сервера",
                },
            })
        );

        const input = page.getByPlaceholder(
            "Написать ответ пользователю..."
        );

        const button = page.getByRole("button", {
            name: "Отправить",
        });

        await input.fill("Первоначальный ответ");
        await button.click();

        await expect.poll(
            () => attempts.length
        ).toBe(1);

        await expect(
            page.locator(".admin-support-error")
        ).toContainText("Нет подтверждения отправки");

        const originalUUID =
            attempts[0].body.clientMessageId;

        await input.fill("Совершенно другой ответ");
        await button.click();

        await expect(
            page.locator(".admin-support-error")
        ).toContainText(
            "Повторите отправку исходного текста"
        );

        // Второго запроса быть не должно.
        expect(attempts).toHaveLength(1);

        const pending = await page.evaluate(() =>
            JSON.parse(
                localStorage.getItem(
                    "cc:support:admin:1:101:pending"
                ) || "null"
            )
        );

        expect(pending).toMatchObject({
            text: "Первоначальный ответ",
            clientMessageId: originalUUID,
        });
    });

    test("двойное нажатие администратора создаёт один запрос", async ({ page }) => {
        await openSupportPage(page);

        let releaseResponse;

        const responseGate = new Promise(
            (resolve) => {
                releaseResponse = resolve;
            }
        );

        const attempts = await mockAdminSendAttempts(
            page,
            async () => {
                await responseGate;
                return {};
            }
        );

        const message = "Проверка двойной отправки";

        const input = page.getByPlaceholder(
            "Написать ответ пользователю..."
        );

        const button = page.getByRole("button", {
            name: "Отправить",
        });

        await input.fill(message);

        // Два клика в одном цикле JavaScript.
        await page.evaluate(() => {
            const button = document.querySelector(
                '.admin-support-input-wrap button[type="submit"]'
            );

            if (!button) {
                throw new Error("Кнопка отправки не найдена");
            }

            button.click();
            button.click();
        });

        try {
            await expect.poll(
                () => attempts.length
            ).toBe(1);

            await expect(button).toBeDisabled();

            expect(attempts[0]).toMatchObject({
                userId: 101,
                body: {
                    text: message,
                },
            });

            expect(
                attempts[0].body.clientMessageId
            ).toMatch(UUID_V4);
        } finally {
            releaseResponse();
        }

        await expect(
            page.locator(".admin-support-message-row.mine")
                .filter({ hasText: message })
        ).toHaveCount(1);

        await expect(input).toHaveValue("");

        expect(attempts).toHaveLength(1);
    });

    test("не переносит ответ в другой чат при переключении во время отправки", async ({ page }) => {
        await openSupportPage(page);

        const input = page.getByPlaceholder(
            "Написать ответ пользователю..."
        );

        const chatItems = page.locator(
            ".admin-support-chat-item"
        );

        // Сначала сохраняем черновик второго пользователя.
        await chatItems.nth(1).click();

        await expect(
            page.locator(".admin-support-chat-header")
        ).toContainText("ID: 202");

        await input.fill("Черновик второго пользователя");

        // Возвращаемся к первому.
        await chatItems.first().click();

        await expect(
            page.locator(".admin-support-chat-header")
        ).toContainText("ID: 101");

        let releaseResponse;

        const responseGate = new Promise(
            (resolve) => {
                releaseResponse = resolve;
            }
        );

        const attempts = await mockAdminSendAttempts(
            page,
            async () => {
                await responseGate;
                return {};
            }
        );

        const message = "Ответ первому пользователю";

        await input.fill(message);

        await page.getByRole("button", {
            name: "Отправить",
        }).click();

        let responsePromise;

        try {
            await expect.poll(
                () => attempts.length
            ).toBe(1);

            expect(attempts[0].userId).toBe(101);

            // Запрос ещё выполняется.
            await chatItems.nth(1).click();

            await expect(
                page.locator(".admin-support-chat-header")
            ).toContainText("ID: 202");

            await expect(input).toHaveValue(
                "Черновик второго пользователя"
            );

            // Подписываемся на ответ до его освобождения.
            responsePromise = page.waitForResponse(
                (response) =>
                    response.request().method() === "POST" &&
                    new URL(response.url()).pathname ===
                    "/api/admin/support/chats/101/messages"
            );

        } finally {
            releaseResponse();
        }

        await responsePromise;

        // Администратор остался во втором чате.
        await expect(
            page.locator(".admin-support-chat-header")
        ).toContainText("ID: 202");

        // Ответ первому пользователю не появился во втором.
        await expect(
            page.getByText(message)
        ).toHaveCount(0);

        // Черновик второго пользователя не испорчен.
        await expect(input).toHaveValue(
            "Черновик второго пользователя"
        );

        await expect(
            page.locator(".admin-support-message-row")
        ).toHaveCount(1);

        // Подтверждённая отправка первого чата очищена.
        await expect.poll(() =>
            page.evaluate(() =>
                localStorage.getItem(
                    "cc:support:admin:1:101:pending"
                )
            )
        ).toBeNull();

        expect(attempts).toHaveLength(1);
    });

    test("получает сообщение пользователя через Socket.IO без дублей", async ({ page }) => {
        const readRequests = [];

        const socket = await openAdminSocketPage(page, {
            onRead: (request) => {
                readRequests.push(request);
            },
        });

        const incomingMessage = {
            id: 550,
            userId: 101,
            senderId: 101,
            senderRole: "user",
            text: "Новое обращение через Socket.IO",
            isReadByAdmin: false,
            createdAt: "2026-07-01T12:00:00.000Z",
            sender: {
                username: "Аким",
            },
        };

        socket.emit("support:new_message", {
            userId: 101,
            message: incomingMessage,
        });

        const newRow = page.locator(
            ".admin-support-message-row.user"
        ).filter({
            hasText: incomingMessage.text,
        });

        await expect(newRow).toBeVisible();

        // Доставка того же сообщения повторяется.
        socket.emit("support:new_message", {
            userId: 101,
            message: incomingMessage,
        });

        await expect(newRow).toHaveCount(1);

        // Админка подтверждает прочтение нового сообщения.
        await expect.poll(() =>
            readRequests.some(
                (request) =>
                    request.userId === 101 &&
                    request.method === "PATCH" &&
                    request.body.throughId === 550
            )
        ).toBe(true);

        // Сообщение из другого чата
        // не должно появиться в открытой переписке.
        socket.emit("support:new_message", {
            userId: 202,
            message: {
                id: 551,
                senderRole: "user",
                text: "Обращение другого пользователя",
                createdAt: "2026-07-01T12:01:00.000Z",
            },
        });

        await expect(
            page.getByText("Обращение другого пользователя")
        ).toHaveCount(0);

        await expect(newRow).toHaveCount(1);
    });

    test("получает ответ другого администратора через Socket.IO", async ({ page }) => {
        const socket = await openAdminSocketPage(page);

        const adminReply = {
            id: 560,
            userId: 101,
            senderId: 777,
            senderRole: "admin",
            text: "Ответ второго администратора",
            isReadByUser: false,
            createdAt: "2026-07-01T12:10:00.000Z",
            sender: {
                username: "Второй администратор",
            },
        };

        socket.emit("support:admin_reply", {
            userId: 101,
            message: adminReply,
        });

        const replyRow = page.locator(
            ".admin-support-message-row.mine"
        ).filter({
            hasText: adminReply.text,
        });

        await expect(replyRow).toBeVisible();

        // Повторная доставка не создаёт копию.
        socket.emit("support:admin_reply", {
            userId: 101,
            message: adminReply,
        });

        await expect(replyRow).toHaveCount(1);

        // Ответ администратора другого диалога
        // не появляется в текущем чате.
        socket.emit("support:admin_reply", {
            userId: 202,
            message: {
                id: 561,
                senderRole: "admin",
                text: "Ответ из другого диалога",
                createdAt: "2026-07-01T12:11:00.000Z",
            },
        });

        await expect(
            page.getByText("Ответ из другого диалога")
        ).toHaveCount(0);

        await expect(
            page.locator(".admin-support-chat-header")
        ).toContainText("ID: 101");

        await expect(replyRow).toHaveCount(1);
    });

    test("обновляет галочки после прочтения пользователем", async ({ page }) => {
        const socket = await openAdminSocketPage(page);

        const sentMessage = page.locator(
            ".admin-support-message-row.mine"
        ).filter({
            hasText: "Здравствуйте, сейчас проверим",
        });

        await expect(sentMessage).toBeVisible();

        const check = sentMessage.locator(
            ".admin-support-message-time span[title]"
        );

        // Сообщение сохранено на сервере.
        await expect(check).toHaveAttribute(
            "title",
            "Сохранено на сервере"
        );

        await expect(check).toContainText("✓");

        // Пользователь другого чата прислал прочтение.
        socket.emit("support:read", {
            userId: 202,
            readerRole: "user",
            throughId: 2,
        });

        await expect(check).toHaveAttribute(
            "title",
            "Сохранено на сервере"
        );

        // Теперь сообщение прочитал нужный пользователь.
        socket.emit("support:read", {
            userId: 101,
            readerRole: "user",
            throughId: 2,
        });

        await expect(check).toHaveAttribute(
            "title",
            "Прочитано пользователем"
        );

        await expect(check).toContainText("✓✓");

        await expect(sentMessage).toHaveCount(1);
    });

    test("сохраняет историю при сетевой ошибке и восстанавливает синхронизацию", async ({ page }) => {
        await openSupportPage(page);

        await expect(
            page.locator(".admin-support-message-row")
        ).toHaveCount(2);

        let networkUnavailable = true;
        let syncRequests = 0;

        const recoveredMessage = {
            id: 590,
            userId: 101,
            senderId: 101,
            senderRole: "user",
            text: "Сообщение после восстановления сети",
            createdAt: "2026-07-01T12:30:00.000Z",
            sender: {
                username: "Аким",
            },
        };

        // Подменяем только повторные GET выбранного чата.
        await page.route(
            "**/api/admin/support/chats/101/messages",
            async (route) => {
                if (route.request().method() !== "GET") {
                    await route.fallback();
                    return;
                }

                syncRequests++;

                if (networkUnavailable) {
                    await route.fulfill({
                        status: 503,
                        json: {
                            message: "Временная ошибка сети",
                        },
                    });
                    return;
                }

                await route.fulfill({
                    status: 200,
                    json: [
                        ...messagesByUser[101],
                        recoveredMessage,
                    ],
                });
            }
        );

        // Имитируем восстановление подключения,
        // но тестовый сервер пока недоступен.
        await page.evaluate(() => {
            window.dispatchEvent(
                new Event("online")
            );
        });

        await expect.poll(
            () => syncRequests
        ).toBeGreaterThanOrEqual(1);

        await expect(
            page.locator(".admin-support-error")
        ).toContainText(
            "Не удалось обновить переписку"
        );

        // Уже загруженные сообщения не исчезли.
        await expect(
            page.locator(".admin-support-message-row")
        ).toHaveCount(2);

        // Теперь сервер снова отвечает.
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
            page.locator(".admin-support-message-row")
        ).toHaveCount(3);

        // Старые сообщения не задублировались.
        await expect(
            page.getByText(
                "Здравствуйте, нужна помощь по заказу"
            )
        ).toHaveCount(1);

        await expect(
            page.locator(".admin-support-error")
        ).not.toBeVisible();
    });


    test("если у пользователя нет username, показывает Пользователь #id", async ({ page }) => {
        await openSupportPage(page, {
            chatsBody: [
                {
                    userId: 303,
                    unreadCount: 0,
                    lastMessageAt: "2026-07-01T11:00:00.000Z",
                    user: null,
                },
            ],
            messagesMap: {
                303: [],
            },
        });

        await expect(page.locator(".admin-support-chat-item")).toContainText("Пользователь #303");
        await expect(page.locator(".admin-support-chat-header")).toContainText("Пользователь #303");
    });
});