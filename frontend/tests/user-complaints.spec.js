import { test, expect } from '@playwright/test';

test.describe('Страница жалоб пользователя', () => {
    test('Должна отображать данные пользователя и список жалоб', async ({ page }) => {
        // Мокаем API-ответ
        await page.route('**/auth/user/123', async route => {
            route.fulfill({
                status: 200,
                body: JSON.stringify({
                    id: 123,
                    username: 'testuser',
                    complaintsCount: 2,
                    complaints: [
                        {
                            date: '2024-05-01T12:00:00Z',
                            complaintText: 'Плохое поведение',
                        },
                        {
                            date: '2024-05-02T15:30:00Z',
                            complaintText: 'Не выполнил задание',
                        },
                    ],
                }),
                headers: { 'Content-Type': 'application/json' },
            });
        });

        await page.goto('/complaints/123');

        await expect(page.getByText('Жалобы на пользователя testuser (ID: 123)')).toBeVisible();
        await expect(page.getByText('Плохое поведение')).toBeVisible();
        await expect(page.getByText('Не выполнил задание')).toBeVisible();
    });

    test('Кнопка "Посмотреть заказы этого пользователя" ведет на правильную страницу', async ({ page }) => {
        await page.route('**/auth/user/123', async route => {
            route.fulfill({
                status: 200,
                body: JSON.stringify({
                    id: 123,
                    username: 'testuser',
                    complaintsCount: 0,
                    complaints: [],
                }),
                headers: { 'Content-Type': 'application/json' },
            });
        });

        await page.goto('/complaints/123');

        const button = page.getByRole('link', { name: /Посмотреть заказы этого пользователя/i });
        await expect(button).toBeVisible();

        // Проверка, что по нажатию будет переход
        await Promise.all([
            page.waitForURL('/user-orders/123'),
            button.click(),
        ]);
    });

});
