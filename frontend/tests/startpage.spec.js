import { test, expect } from '@playwright/test';
import jwt from 'jsonwebtoken';

test.describe('StartPage', () => {
    test.beforeEach(async ({ page }) => {
        // Предзагрузка контекста авторизации (можно замокать или через localStorage)
        await page.goto('http://localhost:3001/');
        await page.evaluate(() => {
            localStorage.setItem('user', JSON.stringify({ id: 1 }));
        });
        await page.reload();
    });

    test('отображает заголовок и подзаголовок', async ({ page }) => {
        await expect(page.getByText('Добро пожаловать!')).toBeVisible();
        await expect(page.getByText('Кем вы хотите быть сегодня?')).toBeVisible();
    });

    test('отображаются кнопки ролей', async ({ page }) => {
        await expect(page.getByRole('button', { name: /я заказчик/i })).toBeVisible();
        await expect(page.getByRole('button', { name: /я исполнитель/i })).toBeVisible();
    });

    test('авторизованный пользователь переходит на /my-orders/:id', async ({ page }) => {
        // 1. Создаём валидный токен
        const token = jwt.sign(
            { id: 1, role: 'customer', name: 'Test User', exp: Math.floor(Date.now() / 1000) + 60 },
            'your_secret_key_here' // секрет может быть любым, т.к. в твоём коде verify не используется
        );

        // 2. Устанавливаем токен перед загрузкой страницы
        await page.goto('about:blank'); // Загружаем пустую страницу перед тем, как установить токен
        await page.addInitScript((token) => {
            localStorage.setItem('authToken', token); // Устанавливаем токен в localStorage
        }, token);

        // 3. Загружаем стартовую страницу
        await page.goto('http://localhost:3001/'); // Переходим на стартовую страницу

        // 4. Кликаем по кнопке "Я заказчик"
        await page.getByText('Я заказчик').click();

        // 5. Проверяем, что перешли на нужный URL
        await expect(page).toHaveURL(/\/my-orders\/1$/); // Проверяем, что URL соответствует /my-orders/1
    });

    test('неавторизованный пользователь редиректится на /login', async ({ page }) => {
        // Удаляем пользователя из localStorage до загрузки страницы
        await page.addInitScript(() => {
            localStorage.removeItem('user');
        });

        await page.goto('http://localhost:3001/');
        await page.getByText('Я заказчик').click();

        // Проверяем, что был редирект на /login
        await expect(page).toHaveURL(/\/login/);
    });


    test('переход на /orders при нажатии "Я исполнитель"', async ({ page }) => {
        await page.getByRole('button', { name: /я исполнитель/i }).click();
        await expect(page).toHaveURL(/\/orders$/);
    });
});
