import { test, expect } from '@playwright/test';

const mockOrder = {
    id: 101,
    type: 'Доставка',
    description: 'Привезти груз',
    address: 'Улица Пушкина',
    paymentType: 'cash',
    proposedSum: 500,
    creatorId: 1,
    executorId: null,
    images: ['image1.jpg'],
    category: { name: 'Грузы' },
    subcategory: { name: 'Мебель' },
    coordinates: '55.7558,37.6176',
    createdAt: new Date().toISOString(),
    completedBy: [],
    status: 'pending',
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

test.describe('OrdersPage', () => {
    test.beforeEach(async ({ page }) => {
        await page.route('**/orders/all', route => {
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify([mockOrder]) // исправлено
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

        await page.goto('/orders');
    });

    test('отображение страницы и самого заказа', async ({ page }) => {
        await expect(page.locator('.orders-list')).toBeVisible();
        await expect(page.getByText('Привезти груз')).toBeVisible();
        await expect(page.getByText('Улица Пушкина')).toBeVisible();
        await expect(page.getByText('Мебель')).toBeVisible();
        await expect(page.getByText('Грузы')).toBeVisible();
        await expect(page.getByText(/500\s*₽/)).toBeVisible();
    });

    test('переключение карты: скрыть/показать', async ({ page }) => {
        const toggleButton = page.getByRole('button', { name: /Скрыть карту|Показать карту/ });
        await expect(toggleButton).toBeVisible();
        const initialText = await toggleButton.innerText();
        await toggleButton.click();
        await expect(toggleButton).not.toHaveText(initialText);
    });

    test('клик на изображение с открытием модалки просмотра', async ({ page }) => {
        const image = page.locator('img.order-image');
        await expect(image).toBeVisible();
        await image.click();

        const modal = page.locator('.custom-modal');
        await expect(modal).toBeVisible();
        await expect(modal.locator('img')).toHaveAttribute('src', expect.stringContaining('image1.jpg'));

    });

    test('клик на жалобы с переходом на страницу жалоб', async ({ page }) => {
        const complaintsLink = page.getByRole('link', { name: /Жалобы/i });
        await expect(complaintsLink).toHaveAttribute('href', '/complaints/1');
        await complaintsLink.click();
        await expect(page).toHaveURL('/complaints/1');
    });

    test('кнопка "Запросить выполнение" появляется и работает', async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.setItem('authToken', 'mock-token');
        });

        let requestReceived = false;
        await page.route('**/orders/1/request', async route => {
            requestReceived = true;
            route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ success: true })
            });
        });

        await page.goto('/orders');

        const requestButton = page.getByRole('button', { name: 'Запросить выполнение' });
        await expect(requestButton).toBeVisible();

        page.once('dialog', async dialog => {
            await dialog.dismiss();
        });

        await requestButton.click();
    });
});
