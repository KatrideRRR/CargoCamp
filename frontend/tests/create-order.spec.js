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

        await page.getByPlaceholder('Описание работы').fill('Починить розетку');
        await page.getByPlaceholder('Адрес').fill('Москва, Арбат');

        await page.waitForTimeout(500);
        const suggestions = await page.locator('.suggestions-list div');
        if (await suggestions.count()) {
            await suggestions.first().click();
        }

        await page.locator('select').first().selectOption('1');
        await page.locator('select').nth(1).selectOption('2');
        await page.getByPlaceholder('Введите сумму').fill('1500');

        await page.getByRole('button', { name: /Наличные/ }).click();

        await page.getByRole('textbox', { name: 'Выберите дату и время' }).click();

        const calendar = page.getByRole('listbox', { name: /Month/i });

        const firstAvailableDate = calendar.getByRole('option', { disabled: false }).first();

        await firstAvailableDate.click();

        const timeList = page.getByRole('listbox', { name: 'Time' });
        await timeList.getByRole('option', { disabled: false }).first().click();

        await page.waitForSelector('#date-picker-portal', { state: 'hidden' });

        await page.setInputFiles('input[type="file"]', 'tests/assets/sample.jpg');

        await page.evaluate(() => {
            const menu = document.querySelector('.bottom-menu');
            if (menu) menu.style.display = 'none';
        });

        await page.getByRole('button', { name: /Создать заказ/i }).click();
    });
});
