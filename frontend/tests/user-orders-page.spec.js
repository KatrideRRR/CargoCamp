// tests/user-orders-page.spec.js
import { test, expect } from '@playwright/test';

test.describe('UserOrdersPage', () => {
    test.beforeEach(async ({ page }) => {
        // Мокаем профиль авторизованного пользователя
        await page.route('**/auth/profile', async route => {
            route.fulfill({
                status: 200,
                body: JSON.stringify({ id: 2, username: 'Executor' }),
            });
        });

        // Мокаем заказы пользователя
        await page.route('**/orders/creator/*', async route => {
            route.fulfill({
                status: 200,
                body: JSON.stringify([
                    {
                        id: 1,
                        creatorId: 1,
                        createdAt: new Date().toISOString(),
                        type: 'Покраска забора',
                        description: 'Нужно покрасить забор в зелёный цвет',
                        address: 'ул. Примерная, д. 1',
                        proposedSum: 5000,
                        paymentType: 'cash',
                        images: ['/uploads/example.jpg'],
                        executorId: null,
                        status: 'pending',
                    }
                ]),
            });
        });

        // Мокаем информацию о создателе заказа
        await page.route('**/auth/1', async route => {
            route.fulfill({
                status: 200,
                body: JSON.stringify({
                    username: 'Иван',
                    rating: 4.5,
                    complaintsCount: 2,
                }),
            });
        });

        // Навигация на страницу заказов пользователя
        await page.goto('/user-orders/1');
    });

    test('отображает заказ и позволяет открыть модалку', async ({ page }) => {
        await expect(page.locator('.user-order-card')).toHaveCount(1);
        await expect(page.locator('.order-title')).toContainText('Заказ номер 1');

        await expect(page.getByText('Имя заказчика: Иван')).toBeVisible();
        await expect(page.getByText('Рейтинг заказчика: 4.5')).toBeVisible();
        await expect(page.getByRole('link', { name: /Жалобы на создателя/i })).toBeVisible();
        await expect(page.locator('.payment-label')).toHaveText('Наличные');

        // Открытие изображения и модалки
        const image = page.locator('.order-image');
        await expect(image).toBeVisible();
        await image.click();

        const modal = page.locator('.custom-modal');
        await expect(modal).toBeVisible();
        await expect(modal.locator('img')).toBeVisible();

        // ⛏️ Скрываем перекрывающий .bottom-menu
        await page.evaluate(() => {
            const menu = document.querySelector('.bottom-menu');
            if (menu) menu.style.display = 'none';
        });

        // Закрытие модалки
        await page.locator('.custom-close-button').click();
        await expect(modal).toBeHidden();
    });

    test('позволяет отправить запрос на выполнение заказа', async ({ page }) => {
        // ⛏️ Скрываем перекрывающий .bottom-menu до клика
        await page.evaluate(() => {
            const menu = document.querySelector('.bottom-menu');
            if (menu) menu.style.display = 'none';
        });

        const takeButton = page.getByRole('button', { name: /Запросить выполнение/i });
        await expect(takeButton).toBeVisible();
        await takeButton.click();

        // После клика ожидаем, что кнопка пропадёт или изменится
        await expect(takeButton).toBeHidden();
    });
});

