import { test, expect } from '@playwright/test';

test.describe('CreateOrderPage', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/create-order');
        await page.evaluate(() => {
            localStorage.setItem('authToken', 'valid-token');
        });
    });

    test('редирект на /login при отсутствии токена', async ({ page }) => {
        await page.evaluate(() => {
            localStorage.removeItem('authToken');
        });
        await page.goto('/create-order');
        await expect(page).toHaveURL(/.*\/login/);
    });

    test('успешное создание заказа', async ({ page }) => {
        await page.addInitScript(() => {
            window.alert = () => {}; // подавить alert
        });

        await page.route('**/api/category', route =>
            route.fulfill({ json: [{ id: 1, name: 'Грузоперевозки и доставка' }] })
        );
        await page.route('**/api/category/subcategory/1', route =>
            route.fulfill({ json: [{ id: 2, name: 'Грузоперевозки' }] })
        );
        await page.route('**/api/orders/', route =>
            route.fulfill({ status: 200, body: JSON.stringify({ success: true }) })
        );

        await page.goto('/create-order');

        await page.getByPlaceholder('Ключевое слово').fill('Электричество');
        await page.getByPlaceholder('Описание работы').fill('Починить розетку');
        await page.getByPlaceholder('Адрес').fill('Москва, Арбат');

        await page.waitForTimeout(1000);
        const suggestions = await page.locator('.suggestions-list div');
        if (await suggestions.count()) {
            await suggestions.nth(0).click();
        }

        await page.locator('select').first().selectOption('1');
        await page.locator('select').nth(1).selectOption('2');
        await page.getByPlaceholder('Введите сумму').fill('1500');
        await page.getByPlaceholder('Выберите дату и время').fill('05/04/2025, 10:45 AM');
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await page.getByRole('button', { name: 'Наличные' }).click();

        const filePath = 'tests/assets/sample.jpg';
        await page.setInputFiles('input[type="file"]', filePath);

        await page.evaluate(() => {
            const menu = document.querySelector('.bottom-menu');
            if (menu) menu.style.display = 'none';
        });

        await page.addInitScript(() => {
            window.alert = () => {}; // Подменяем alert, чтобы он не мешал переходу
        });

        await page.getByRole('button', { name: /Создать заказ/i }).click();
    });

});
