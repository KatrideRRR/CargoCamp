const { test, expect } = require("@playwright/test");
const { login } = require("./utils/auth");

test.describe("ChatPage", () => {

    test.beforeEach(async ({ page }) => {
        // Универсальный логин
        await login(page);

        // Переход к чату заказа
        await page.goto("http://localhost:3000/messages/8");

        await expect(page.locator(".chat-header"))
            .toContainText("Чат для заказа #8");
    });

    test("отображение страницы", async ({ page }) => {
        await expect(page.locator(".chat-page")).toBeVisible();
        await expect(page.locator(".chat-input")).toBeVisible();
    });

    test("отправка сообщения", async ({ page }) => {
        const testMessage = "Тестовое сообщение " + Date.now();

        await page.fill("textarea.chat-input", testMessage);
        await page.click("button.chat-send-button");

        const sentMessages = page.locator(".chat-message-sent");
        await expect(sentMessages.last()).toContainText(testMessage);
    });

    test("получение сообщения по WebSocket", async ({ page }) => {
        const message = {
            id: Date.now(),
            content: "Сообщение от второго пользователя",
            senderId: 4,
            receiverId: 6,
            orderId: 8,
        };

        // Ждём появление socket
        await page.waitForFunction(
            () => window.socket && window.socket.listeners?.("receiveMessage")?.length
        );

        // Пробрасываем сообщение вручную
        await page.evaluate((msg) => {
            const listeners = window.socket.listeners("receiveMessage");
            if (listeners?.length) listeners.forEach(cb => cb(msg));
        }, message);

        await expect(page.locator(".chat-message-received"))
            .toContainText(message.content);
    });

});