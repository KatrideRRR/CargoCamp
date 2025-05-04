// tests/chatPage.spec.js
import { test, expect } from '@playwright/test';

test.describe('ChatPage', () => {
    test.beforeEach(async ({ page }) => {
        // Авторизация и переход на страницу чата
        await page.goto('http://localhost:3000/login');
        await page.fill('input[id="phone"]', '89786864117');
        await page.fill('input[id="password"]', '11jan1999');
        await page.click('button[type="submit"]');
        await page.waitForURL('**/profile');

        // Переход к странице чата конкретного заказа
        await page.goto('http://localhost:3000/messages/445');
        await expect(page.locator('.chat-header')).toContainText('Чат для заказа #445');
    });

    test('отображение страницы', async ({ page }) => {
        await expect(page.locator('.chat-page')).toBeVisible();
        await expect(page.locator('.chat-input')).toBeVisible();
    });

    test('отправка сообщения', async ({ page }) => {
        const testMessage = 'Тестовое сообщение ' + Date.now();

        await page.fill('textarea.chat-input', testMessage);
        await page.click('button.chat-send-button');

        const sentMessages = page.locator('.chat-message-sent');
        await expect(sentMessages.last()).toContainText(testMessage);
    });

    test('получение сообщения по WebSocket', async ({ page }) => {
        const message = {
            id: Date.now(),
            content: 'Сообщение от второго пользователя',
            senderId: 38, // не currentUser
            receiverId: 39,
            orderId: 445,
        };

        // Ждём пока socket станет доступен
        await page.waitForFunction(() => window.socket && window.socket.listeners?.('receiveMessage')?.length);

        // Вызовем подписчиков вручную
        await page.evaluate((msg) => {
            const listeners = window.socket.listeners('receiveMessage');
            if (listeners?.length) {
                listeners.forEach(cb => cb(msg));
            }
        }, message);

        await expect(page.locator('.chat-message-received')).toContainText(message.content);
    });

});
