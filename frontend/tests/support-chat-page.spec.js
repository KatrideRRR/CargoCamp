import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3000";

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
        sendStatus = 200,
        sendBody = null,
        readStatus = 200,
        onGetMessages,
        onSendMessage,
        onRead,
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
                        senderRole: "user",
                        text: requestBody.text,
                        createdAt: "2026-07-01T10:05:00.000Z",
                    }
                ),
            });

            return;
        }

        await route.fallback();
    });

    await page.route("**/api/support/read", async (route) => {
        onRead?.();

        await route.fulfill({
            status: readStatus,
            contentType: "application/json",
            body: JSON.stringify({
                success: true,
            }),
        });
    });
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
        let readCalls = 0;

        await openSupportChatPage(page, {
            onRead: () => {
                readCalls += 1;
            },
        });

        await expect
            .poll(() => readCalls, {
                timeout: 10000,
            })
            .toBeGreaterThanOrEqual(1);
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
            "Не удалось загрузить чат поддержки"
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
            .toEqual({
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
            .toEqual({
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
            .toEqual({
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

        await expect(input).toHaveValue(/Первая строка/);
    });

    test("при ошибке отправки показывает ошибку и возвращает текст в поле", async ({ page }) => {
        await openSupportChatPage(page, {
            sendStatus: 500,
            sendBody: {
                message: "Server error",
            },
        });

        await sendTextByButton(page, "Сообщение не отправится");

        await expect(page.locator(".support-error")).toHaveText(
            "Не удалось отправить сообщение"
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

        await page.goto(`${FRONT_URL}/profile?platform=web`);
        await page.goto(`${FRONT_URL}/support?platform=web`);

        await expect(page.locator(".support-chat-page")).toBeVisible({
            timeout: 15000,
        });

        await page.getByLabel("Назад").click();

        await expect(page).toHaveURL(/\/profile/);
    });

    test("отображает время сообщения", async ({ page }) => {
        await openSupportChatPage(page);

        const myMessage = page.locator(".support-message-row.mine").filter({
            hasText: "Здравствуйте, у меня вопрос по заказу",
        });

        await expect(myMessage.locator(".support-message-meta span")).toHaveText(/\d{2}:\d{2}/);
    });
});