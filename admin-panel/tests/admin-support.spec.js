import { test, expect } from "@playwright/test";

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
    await page.addInitScript(() => {
        const adminUser = {
            id: 1,
            username: "admin",
            name: "admin",
            role: "admin",
            isAdmin: true,
        };

        const token = "admin-test-token";

        localStorage.setItem("authToken", token);
        localStorage.setItem("adminToken", token);
        localStorage.setItem("token", token);

        // ВАЖНО: это проверяет PrivateRoute в admin-panel
        localStorage.setItem("userRole", "admin");

        localStorage.setItem("user", JSON.stringify(adminUser));
        localStorage.setItem("adminUser", JSON.stringify(adminUser));
        localStorage.setItem("currentUser", JSON.stringify(adminUser));
    });
}

async function setupMocks(page, options = {}) {
    const {
        chatsStatus = 200,
        chatsBody = chats,
        messagesStatus = 200,
        messagesMap = messagesByUser,
        sendStatus = 200,
        sendBody = {
            id: 99,
            text: "Ответ администратора",
            senderRole: "admin",
            createdAt: "2026-07-01T10:25:00.000Z",
            sender: {
                username: "Администратор",
            },
        },
        onSend,
        onRead,
        onFetchChats,
        onFetchMessages,
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

    await page.route("**/api/admin/support/chats/*/read", async (route) => {
        const url = route.request().url();
        const match = url.match(/\/admin\/support\/chats\/(\d+)\/read/);
        const userId = match?.[1];

        onRead?.(Number(userId));

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                success: true,
            }),
        });
    });
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
            onRead: (userId) => {
                readCalls.push(userId);
            },
        });

        await expect
            .poll(() => readCalls, {
                timeout: 10000,
            })
            .toContain(101);

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
            .toEqual({
                userId: 101,
                body: {
                    text: "Ответ администратора",
                },
            });

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
            .toEqual({
                userId: 101,
                body: {
                    text: "Ответ через Enter",
                },
            });

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
            "Не удалось отправить ответ"
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
            "Не удалось загрузить сообщения"
        );
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