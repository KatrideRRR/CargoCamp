const { test, expect } = require('@playwright/test');

test('Успешный логин', async ({ page }) => {
    // Зайти на страницу логина
    await page.goto('http://localhost:3000/login');

    // Ввести телефон
    await page.getByLabel('Телефон:').fill('89786864117'); // Заменить на валидный тестовый номер

    // Ввести пароль
    await page.getByLabel('Пароль:').fill('11jan1999'); // Заменить на валидный пароль

    // Нажать на "Войти"
    await page.getByRole('button', { name: 'Войти' }).click();

    // Проверка: редирект на /profile
    await expect(page).toHaveURL(/\/profile/);
});

test('Попытка входа заблокированного пользователя', async ({ page }) => {
    await page.goto('http://localhost:3000/login');

    // Ввести номер и пароль пользователя с ролью "banned"
    await page.getByLabel('Телефон:').fill('89780434395'); // замените на тестовый номер заблокированного пользователя
    await page.getByLabel('Пароль:').fill('11jan1999'); // соответствующий пароль

    await page.getByRole('button', { name: 'Войти' }).click();

    // Ожидаем появление сообщения о блокировке
    await expect(page.locator('.error')).toHaveText(/Ваш аккаунт заблокирован/i);

    // Убедимся, что не произошло редиректа
    await expect(page).not.toHaveURL(/\/profile/);
});

test('Переход на страницу регистрации', async ({ page }) => {
    await page.goto('http://localhost:3000/login');

    // Клик по ссылке "Зарегистрироваться"
    await page.getByText('Зарегистрироваться').click();

    // Проверка: редирект на /register
    await expect(page).toHaveURL(/\/register/);
});

test('Переход по кнопке "Забыли пароль?"', async ({ page }) => {
    await page.goto('http://localhost:3000/login');

    // Ввести телефон (если требуется)
    await page.getByLabel('Телефон:').fill('89786864118');

    // Клик по кнопке "Забыли пароль?"
    await page.getByRole('button', { name: 'Забыли пароль?' }).click();

    // Проверка: отображается сообщение об отправке СМС
    await expect(page.locator('.error')).toHaveText(/Новый пароль отправлен на ваш номер/i);
});

test('Неверный логин или пароль', async ({ page }) => {
    await page.goto('http://localhost:3000/login');

    await page.getByLabel('Телефон:').fill('89999999999'); // несуществующий номер
    await page.getByLabel('Пароль:').fill('wrongpassword');

    await page.getByRole('button', { name: 'Войти' }).click();

    await expect(page.locator('.error')).toHaveText(/Ошибка авторизации|Неверный|User not found/i);
});


