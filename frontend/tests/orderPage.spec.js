import { test, expect } from '@playwright/test';

test.describe('OrderPage', () => {
    const mockOrder = {
        id: 101,
        type: 'Доставка',
        description: 'Привезти груз',
        address: 'Улица Пушкина',
        paymentType: 'cash',
        proposedSum: 500,
        creatorId: 1,
        executorId: null,
        images: ['/test-image.jpg'],
        category: { name: 'Грузы' },
        subcategory: { name: 'Мебель' },
        coordinates: '55.7558,37.6176',
        createdAt: new Date().toISOString(),
        completedBy: [],
        status: 'pending', // важно: должен быть доступен для запроса

    };

    const mockUser = {
        id: 1,
        username: 'Иван',
        rating: 4.7,
        complaintsCount: 2
    };

    const mockViewer = {
        id: 2,
        username: 'Артем'
    };

    test.beforeEach(async ({ page }) => {
        await page.route('**/orders/101', route => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(mockOrder)
            });
        });

        await page.route('**/auth/1', route => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(mockUser)
            });
        });

        await page.route('**/auth/profile', route => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(mockViewer)
            });
        });

        await page.goto('/order/101');
    });

    test('отображение страницы и самого заказа', async ({ page }) => {
        await expect(page.getByText('Привезти груз')).toBeVisible();
    });

    test('клик на жалобы с переходом на страницу жалоб', async ({ page }) => {
        const complaintsLink = page.getByRole('link', { name: /Жалобы/i });
        await expect(complaintsLink).toHaveAttribute('href', '/complaints/1');
        await complaintsLink.click();
        await expect(page).toHaveURL('/complaints/1');
    });

    test('клик на изображение с открытием модалки просмотра', async ({ page }) => {
        await page.locator('img.order-image').first().click();
        await expect(page.locator('.custom-modal')).toBeVisible();
        await expect(page.locator('.custom-modal img')).toHaveAttribute('src', expect.stringContaining('image1.jpg'));
    });

    test('кнопка "Запросить выполнение" появляется и работает', async ({ page }) => {
        // Мимикрируем логин, добавляем токен вручную в localStorage
        await page.addInitScript(() => {
            localStorage.setItem('authToken', 'mock-token');
        });

        // Мокаем POST-запрос
        let requestReceived = false;
        await page.route('**/orders/101/request', async route => {
            requestReceived = true;
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true })
            });
        });

        // Переход на страницу
        await page.goto('/order/101');

        // Проверка наличия кнопки
        const requestButton = page.getByRole('button', { name: 'Запросить выполнение' });
        await expect(requestButton).toBeVisible();

        // Обработка alert
        page.once('dialog', async dialog => {
            expect(dialog.message()).toContain('Вы не авторизованы! Пожалуйста, войдите в систему.');
            await dialog.dismiss();
        });

        // Клик по кнопке
        await requestButton.click();

        // Проверка, что запрос был выполнен
        expect(requestReceived).toBe(true);
    });

});
