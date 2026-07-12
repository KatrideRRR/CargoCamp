import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3001";

// Если route в App.js другой — поменяй только это:
const MESSAGES_PATH = "/555/messages";

const order = {
    id: 555,
    creatorId: 10,
    executorId: 20,
};

const messages = [
    {
        id: 1,
        senderId: 10,
        content: "Здравствуйте, нужно перевезти диван",
        createdAt: "2026-07-01T10:00:00.000Z",
        sender: {
            id: 10,
            username: "Заказчик Аким",
        },
    },
    {
        id: 2,
        senderId: 20,
        content: "Добрый день, могу выполнить",
        createdAt: "2026-07-01T10:05:00.000Z",
        sender: {
            id: 20,
            username: "Исполнитель Иван",
        },
    },
    {
        id: 3,
        senderId: 30,
        content: "Системное сообщение",
        createdAt: "2026-07-01T10:10:00.000Z",
        sender: {
            id: 30,
            username: "Модератор",
        },
    },
];

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

        // Это проверяет PrivateRoute в admin-panel
        localStorage.setItem("userRole", "admin");

        localStorage.setItem("user", JSON.stringify(adminUser));
        localStorage.setItem("adminUser", JSON.stringify(adminUser));
        localStorage.setItem("currentUser", JSON.stringify(adminUser));
    });
}

async function setupMocks(page, options = {}) {
    const {
        messagesStatus = 200,
        messagesBody = messages,
        orderStatus = 200,
        orderBody = order,
        delayMs = 0,
        onMessagesFetch,
        onOrderFetch,
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

    await page.route("**/api/admin/orders/555/messages", async (route) => {
        onMessagesFetch?.({
            url: route.request().url(),
            headers: route.request().headers(),
        });

        if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        await route.fulfill({
            status: messagesStatus,
            contentType: "application/json",
            body: JSON.stringify(messagesBody),
        });
    });

    await page.route("**/api/admin/orders/555", async (route) => {
        onOrderFetch?.({
            url: route.request().url(),
            headers: route.request().headers(),
        });

        if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        await route.fulfill({
            status: orderStatus,
            contentType: "application/json",
            body: JSON.stringify(orderBody),
        });
    });
}

async function openMessagesPage(page, options = {}) {
    await setAdminAuth(page);
    await setupMocks(page, options);

    await page.goto(`${FRONT_URL}${MESSAGES_PATH}`);
    await page.waitForLoadState("domcontentloaded");

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "messages-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("MessagesPage редиректит на /login. Проверь PrivateRoute.");
    }

    if (!(await page.locator(".messages-page").count())) {
        await page.screenshot({
            path: "messages-wrong-route.png",
            fullPage: true,
        });

        throw new Error(
            `MessagesPage не найдена. Текущий URL: ${page.url()}. Проверь MESSAGES_PATH в тесте.`
        );
    }

    await expect(page.locator(".messages-page")).toBeVisible({
        timeout: 15000,
    });
}

test.describe("MessagesPage", () => {
    test("отображает заголовок переписки", async ({ page }) => {
        await openMessagesPage(page);

        await expect(page.getByRole("heading", {
            name: "Переписка по заказу #555",
        })).toBeVisible();

        await expect(page.locator(".messages-title")).toHaveText(
            "Переписка по заказу #555"
        );
    });

    test("запрашивает заказ и сообщения с authToken", async ({ page }) => {
        let messagesRequest = null;
        let orderRequest = null;

        await openMessagesPage(page, {
            onMessagesFetch: (data) => {
                messagesRequest = data;
            },
            onOrderFetch: (data) => {
                orderRequest = data;
            },
        });

        await expect
            .poll(() => messagesRequest, {
                timeout: 10000,
            })
            .toEqual(
                expect.objectContaining({
                    url: expect.stringContaining("/api/admin/orders/555/messages"),
                    headers: expect.objectContaining({
                        authorization: "Bearer admin-test-token",
                    }),
                })
            );

        await expect
            .poll(() => orderRequest, {
                timeout: 10000,
            })
            .toEqual(
                expect.objectContaining({
                    url: expect.stringContaining("/api/admin/orders/555"),
                    headers: expect.objectContaining({
                        authorization: "Bearer admin-test-token",
                    }),
                })
            );
    });

    test("отображает участников заказа", async ({ page }) => {
        await openMessagesPage(page);

        await expect(page.locator(".chat-participants-card")).toBeVisible();

        await expect(page.locator(".participant-chip.creator")).toHaveText(
            "Заказчик: #10"
        );

        await expect(page.locator(".participant-chip.executor")).toHaveText(
            "Исполнитель: #20"
        );
    });

    test("отображает сообщения", async ({ page }) => {
        await openMessagesPage(page);

        await expect(page.locator(".chat-thread")).toBeVisible();
        await expect(page.locator(".chat-row")).toHaveCount(3);

        await expect(page.locator(".chat-text").nth(0)).toHaveText(
            "Здравствуйте, нужно перевезти диван"
        );

        await expect(page.locator(".chat-text").nth(1)).toHaveText(
            "Добрый день, могу выполнить"
        );

        await expect(page.locator(".chat-text").nth(2)).toHaveText(
            "Системное сообщение"
        );
    });

    test("показывает роль заказчика", async ({ page }) => {
        await openMessagesPage(page);

        const row = page.locator(".chat-row.creator").first();

        await expect(row).toBeVisible();
        await expect(row.locator(".chat-role-badge")).toHaveText("Заказчик #10");
        await expect(row.locator(".chat-role-badge")).toHaveClass(/creator/);
        await expect(row.locator(".chat-author-name")).toHaveText("Заказчик Аким");
    });

    test("показывает роль исполнителя", async ({ page }) => {
        await openMessagesPage(page);

        const row = page.locator(".chat-row.executor").first();

        await expect(row).toBeVisible();
        await expect(row.locator(".chat-role-badge")).toHaveText("Исполнитель #20");
        await expect(row.locator(".chat-role-badge")).toHaveClass(/executor/);
        await expect(row.locator(".chat-author-name")).toHaveText("Исполнитель Иван");
    });

    test("показывает нейтральную роль для неизвестного участника", async ({ page }) => {
        await openMessagesPage(page);

        const row = page.locator(".chat-row.neutral").first();

        await expect(row).toBeVisible();
        await expect(row.locator(".chat-role-badge")).toHaveText("Участник #30");
        await expect(row.locator(".chat-role-badge")).toHaveClass(/neutral/);
        await expect(row.locator(".chat-author-name")).toHaveText("Модератор");
    });

    test("берёт senderId из sender.id, если senderId отсутствует", async ({ page }) => {
        await openMessagesPage(page, {
            messagesBody: [
                {
                    id: 10,
                    content: "Сообщение без senderId",
                    createdAt: "2026-07-01T10:00:00.000Z",
                    sender: {
                        id: 10,
                        username: "Заказчик через sender.id",
                    },
                },
            ],
        });

        const row = page.locator(".chat-row.creator").first();

        await expect(row).toBeVisible();
        await expect(row.locator(".chat-role-badge")).toHaveText("Заказчик #10");
        await expect(row.locator(".chat-author-name")).toHaveText("Заказчик через sender.id");
    });

    test("показывает неизвестного участника, если нет senderId", async ({ page }) => {
        await openMessagesPage(page, {
            messagesBody: [
                {
                    id: 11,
                    content: "Без отправителя",
                    createdAt: null,
                    sender: null,
                },
            ],
        });

        const row = page.locator(".chat-row.neutral").first();

        await expect(row).toBeVisible();
        await expect(row.locator(".chat-role-badge")).toHaveText("Неизвестный участник");
        await expect(row.locator(".chat-author-name")).toHaveText("Без имени");
        await expect(row.locator(".chat-text")).toHaveText("Без отправителя");
        await expect(row.locator(".chat-time")).toHaveText("—");
    });

    test("если content пустой, показывает прочерк", async ({ page }) => {
        await openMessagesPage(page, {
            messagesBody: [
                {
                    id: 12,
                    senderId: 10,
                    content: "",
                    createdAt: "2026-07-01T10:00:00.000Z",
                    sender: {
                        id: 10,
                        username: "Заказчик",
                    },
                },
            ],
        });

        await expect(page.locator(".chat-text")).toHaveText("—");
    });

    test("если участников в заказе нет, показывает прочерки", async ({ page }) => {
        await openMessagesPage(page, {
            orderBody: {
                id: 555,
                creatorId: null,
                executorId: null,
            },
            messagesBody: [],
        });

        await expect(page.locator(".participant-chip.creator")).toHaveText(
            "Заказчик: —"
        );

        await expect(page.locator(".participant-chip.executor")).toHaveText(
            "Исполнитель: —"
        );
    });

    test("если сообщений нет, показывает пустое состояние", async ({ page }) => {
        await openMessagesPage(page, {
            messagesBody: [],
        });

        await expect(page.locator(".chat-thread")).not.toBeVisible();
        await expect(page.getByText("Сообщения не найдены.")).toBeVisible();
    });

    test("если загрузка сообщений упала, показывает ошибку", async ({ page }) => {
        await openMessagesPage(page, {
            messagesStatus: 500,
            messagesBody: {
                message: "Ошибка",
            },
        });

        await expect(page.locator(".messages-state-error")).toHaveText(
            "Не удалось загрузить сообщения"
        );
    });

    test("если загрузка заказа упала, показывает ошибку", async ({ page }) => {
        await openMessagesPage(page, {
            orderStatus: 500,
            orderBody: {
                message: "Ошибка",
            },
        });

        await expect(page.locator(".messages-state-error")).toHaveText(
            "Не удалось загрузить сообщения"
        );
    });

    test("показывает loading state", async ({ page }) => {
        await setAdminAuth(page);
        await setupMocks(page, {
            delayMs: 1000,
        });

        await page.goto(`${FRONT_URL}${MESSAGES_PATH}`);
        await page.waitForLoadState("domcontentloaded");

        if (page.url().includes("/login")) {
            throw new Error("MessagesPage редиректит на /login");
        }

        await expect(page.locator(".messages-page")).toBeVisible();
        await expect(page.locator(".messages-state-card")).toHaveText("Загрузка...");
    });
});