import { test, expect } from '@playwright/test';

test.describe('OrderHistoryPage', () => {
    const userId = 1;
    const pageUrl = `http://localhost:3000/orders-history/${userId}`;

    test('показывает список завершённых заказов', async ({ page }) => {
        await page.route(`**/orders/completed/${userId}`, async route => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([
                    {
                        id: 123,
                        type: 'Грузоперевозка',
                        description: 'Перевезти диван',
                        address: 'г. Москва, ул. Примерная, 12',
                        proposedSum: 3000,
                        creatorId: 5,
                        executorId: 10,
                        completedAt: new Date('2024-05-01T12:00:00Z').toISOString(),
                        contractPath: 'uploads/contracts/contract_123.pdf',
                    },
                ]),
            });
        });

        await page.goto(pageUrl);

        await expect(page.getByText('История завершенных заказов (1)')).toBeVisible();
        await expect(page.getByText('№ заказа: 123')).toBeVisible();
        await expect(page.getByText('Перевезти диван')).toBeVisible();
        await expect(page.getByText('г. Москва, ул. Примерная, 12')).toBeVisible();
        await expect(page.getByRole('link', { name: /Скачать договор/i })).toHaveAttribute('href', /contract_123\.pdf$/);
    });

    test('показывает сообщение при отсутствии заказов', async ({ page }) => {
        await page.route(`**/orders/completed/${userId}`, async route => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([]),
            });
        });

        await page.goto(pageUrl);

        await expect(page.getByText('Завершенных заказов нет.')).toBeVisible();
    });

    test('показывает ошибку при сбое API', async ({ page }) => {
        await page.route(`**/orders/completed/${userId}`, async route => {
            route.fulfill({
                status: 500,
                contentType: 'application/json',
                body: JSON.stringify({ message: 'Ошибка сервера' }),
            });
        });

        await page.goto(pageUrl);

        await expect(page.getByText('Ошибка: Ошибка сервера')).toBeVisible();
    });
});
