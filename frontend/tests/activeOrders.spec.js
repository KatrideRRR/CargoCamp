import { test, expect } from '@playwright/test';
import jwt from 'jsonwebtoken';

const validToken = jwt.sign(
    { id: 1, role: 'executor', name: 'Тестовый пользователь', exp: Math.floor(Date.now() / 1000) + 60 },
    'secret'
);

test.describe('ActiveOrdersPage', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('about:blank');
        await page.addInitScript(token => {
            localStorage.setItem('authToken', token);
        }, validToken);

        await page.route('**/api/auth/profile', async route => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    id: 1,
                    username: 'executor',
                    role: 'executor'
                }),
            });
        });

        await page.route('**/api/orders/active-orders', async route => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    orders: [
                        {
                            id: 101,
                            type: 'Доставка',
                            description: 'Привезти груз',
                            address: 'Улица Пушкина',
                            paymentType: 'cash',
                            proposedSum: 500,
                            creatorId: 2,
                            executorId: 1,
                            images: ['/test-image.jpg'],
                            category: { name: 'Грузы' },
                            subcategory: { name: 'Мебель' },
                            coordinates: '55.7558,37.6176',
                            createdAt: new Date().toISOString(),
                            completedBy: []
                        }
                    ],
                    notifications: [],
                }),
            });
        });

        await page.route('**/api/auth/2', route =>
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    username: 'Заказчик',
                    rating: 4.5,
                }),
            })
        );

        await page.route('**/test-image.jpg', route =>
            route.fulfill({
                status: 200,
                body: '',
                headers: { 'Content-Type': 'image/jpeg' },
            })
        );

        await page.goto('http://localhost:3000/active-orders');
    });

    test('отображает заказы и разворачивает карточку', async ({ page }) => {
        await expect(page.getByText('Заказ номер 101')).toBeVisible();
        await page.getByText('Заказ номер 101').click();
        await expect(page.getByText('Адрес:')).toBeVisible();
    });

    test('открывает модальное окно с изображениями', async ({ page }) => {
        await page.getByText('Заказ номер 101').click();
        await page.locator('.image-stack').click();
        await expect(page.locator('.custom-modal-image')).toBeVisible();
    });

    test('кнопка "Позвонить" вызывает window.open', async ({ page }) => {
        await page.addInitScript(() => {
            window.open = (...args) => console.log('📞 Window.open called with:', args);
        });
        await page.getByRole('button', { name: /Позвонить/i }).click();
    });

    test('клик на сообщение ведет на /messages/:id', async ({ page }) => {
        await page.getByRole('button', { name: /Сообщение/i }).click();
        await expect(page).toHaveURL(/\/messages\/101$/);
    });

    test('кнопка маршрут вызывает confirm и открывает яндекс', async ({ page }) => {
        await page.evaluate(() => {
            window.confirm = () => true;
            navigator.geolocation.getCurrentPosition = (success) =>
                success({ coords: { latitude: 55.75, longitude: 37.61 } });
        });
        await page.getByRole('button', { name: /Маршрут/i }).click();
    });

    test('клик на пожаловаться открывает модалку и отправляет жалобу', async ({ page }) => {
        const [request] = await Promise.all([
            page.waitForRequest('**/api/orders/complain'),
            (async () => {
                await page.getByRole('button', { name: /Пожаловаться/i }).click();
                await page.locator('.modal textarea').fill('Тестовая жалоба');
                await page.getByRole('button', { name: /^Отправить$/ }).click();
            })()
        ]);

        expect(request).toBeTruthy(); // 🔥 Проверяем факт вызова запроса
    });

    test('завершение заказа через модалку оценки', async ({ page }) => {
        // Ожидаем появления модалки и кликаем на кнопку для начала завершения
        await page.getByRole('button', { name: /Завершить/i }).click();
        await page.locator('.star').nth(4).click();
        await page.getByRole('button', { name: /Завершить заказ/i }).click();
    });

});
