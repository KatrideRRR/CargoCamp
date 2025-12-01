import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
    await page.route('**/auth/profile', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                id: 1,
                username: 'testuser',
            }),
        });
    });

    await page.addInitScript(() => {
        localStorage.setItem('authToken', 'fake-token');
    });
});

test('1. отображение страницы и переход по кнопке "разместить заказ"', async ({ page }) => {
    await page.route('**/orders/creator/1', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([]), // Нет заказов
        });
    });

    await page.goto('/my-orders/1');

    const createButton = page.getByRole('button', { name: 'Разместить заказ' });
    await expect(createButton).toBeVisible();

    await createButton.click();
});

test('2. отображение заказа, переход по кнопкам "жалобы", "одобрить" и открытие модалки', async ({ page }) => {
    // Мокаем заказ
    await page.route('**/orders/creator/1', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
                {
                    id: 101,
                    createdAt: new Date().toISOString(),
                    type: 'Починить крышу',
                    category: { name: 'Строительство' },
                    subcategory: { name: 'Кровельные работы' },
                    proposedSum: 10000,
                    description: 'Починить крышу в сарае',
                    paymentType: 'cash',
                    images: ['/uploads/order101_img1.jpg'],
                },
            ]),
        });
    });

    // Мокаем список исполнителей
    await page.route('**/orders/101/requested-executors', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([
                {
                    id: 2,
                    username: 'executor1',
                    rating: 4.8,
                    ratingCount: 12,
                    proposedSum: 9500,
                    comment: 'Сделаю быстро и качественно',
                    isVerified: true,
                },
            ]),
        });
    });

    // Мокаем запрос на одобрение исполнителя
    let approveCalled = false;
    await page.route('**/orders/101/approve', async (route) => {

        approveCalled = true;
        const body = await route.request().postDataJSON();
        expect(body.executorId).toBe(2);
        await route.fulfill({ status: 200 });
    });

    await page.goto('/my-orders/1');

    // Проверка отображения заказа
    await expect(page.getByText('Заказ №101')).toBeVisible();
    await expect(page.getByText('Название заказа: Починить крышу')).toBeVisible();
    await expect(page.getByText('executor1')).toBeVisible();

    // Клик по кнопке "Жалобы"
    const complaintButton = page.getByRole('button', { name: 'Жалобы' });
    await complaintButton.click();
    await expect(page).toHaveURL('/complaints/2');

    // Назад к заказам
    await page.goBack();

    page.once('dialog', async (dialog) => {
        expect(dialog.message()).toBe('Исполнитель одобрен!');
        await dialog.dismiss();
    });

    // Клик по кнопке "Одобрить"
    const approveButton = page.getByRole('button', { name: 'Одобрить' });
    await approveButton.click();

    // Клик по изображению для открытия модалки
    const image = page.locator('img.order-image');
    await image.click();

    // Проверка открытия модального окна
    const modal = page.locator('.custom-modal-content');
    await expect(modal).toBeVisible();

    // Проверка наличия кнопки закрытия
    await expect(modal.getByRole('button', { name: '✖' })).toBeVisible();
});
