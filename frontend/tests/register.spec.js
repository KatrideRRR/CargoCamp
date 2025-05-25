import { test, expect } from '@playwright/test';

test.describe('RegisterPage — регистрация с моками', () => {
    test.beforeEach(async ({ page }) => {
        // Мокаем /send-sms
        await page.route('**/api/auth/send-sms', async route => {
            route.fulfill({ status: 200, body: JSON.stringify({ success: true }) });
        });

        // Мокаем /register
        await page.route('**/api/auth/register', async route => {
            const data = await route.request().postDataJSON();
            expect(data).toMatchObject({
                username: 'TestUser',
                phone: '89991234567',
                password: 'Password123',
                smsCode: '123456',
                captchaToken: 'mock-captcha-token',
            });
            route.fulfill({ status: 200, body: JSON.stringify({ token: 'mock-token' }) });
        });

        // Подменяем работу капчи
        await page.addInitScript(() => {
            window.grecaptcha = {
                render: (container, opts) => {
                    setTimeout(() => {
                        opts.callback('mock-captcha-token');
                    }, 50); // эмулируем задержку
                    return 'mock-render-id';
                },
                getResponse: () => 'mock-captcha-token',
            };
        });

        await page.goto('http://localhost:3001/register');
    });

    test('пользователь проходит регистрацию полностью', async ({ page }) => {
        await expect(page.getByText('Регистрация')).toBeVisible();

        await page.getByLabel('Имя пользователя:').fill('TestUser');
        await page.getByLabel('Телефон:').fill('89991234567');
        await page.getByLabel('Пароль:').fill('Password123');
        await page.locator('input[type="checkbox"]').check();

        // ⏳ Дождаться, пока кнопка станет доступной (после mock капчи)
        const getCodeButton = page.getByRole('button', { name: 'Получить код' });
        await expect(getCodeButton).toBeEnabled();

        // 📩 Получить код и принять alert
        const [dialog] = await Promise.all([
            page.waitForEvent('dialog'),
            getCodeButton.click(),
        ]);
        await dialog.accept();

        await page.getByPlaceholder('Код из SMS').fill('123456');

        // 🚀 Регистрация
        await Promise.all([
            page.waitForNavigation(),
            page.getByRole('button', { name: 'Зарегистрироваться' }).click(),
        ]);

        await expect(page).toHaveURL(/\/profile/);
    });

    test('кнопка "Получить код" отключена без прохождения капчи', async ({ page }) => {
        // 👉 Полностью убираем render/response вызовы
        await page.addInitScript(() => {
            window.grecaptcha = {
                render: () => 'mock-id',
                getResponse: () => '', // имитируем "нет ответа"
            };
        });

        await page.goto('http://localhost:3001/register');

        await page.getByLabel('Имя пользователя:').fill('TestUser');
        await page.getByLabel('Телефон:').fill('89991234567');
        await page.getByLabel('Пароль:').fill('Password123');

        const getCodeButton = page.getByRole('button', { name: 'Получить код' });

        // 🔍 Проверяем через DOM, потому что toBeDisabled() ненадёжен с React
        const isDisabled = await getCodeButton.getAttribute('disabled');
        expect(isDisabled).not.toBeNull(); // Кнопка должна быть отключена
    });

    test('нельзя завершить регистрацию без принятия пользовательского соглашения', async ({ page }) => {
        // Мокаем капчу
        await page.addInitScript(() => {
            window.grecaptcha = {
                render: (container, opts) => {
                    setTimeout(() => opts.callback('mock-captcha-token'), 50);
                    return 'mock-id';
                },
                getResponse: () => 'mock-captcha-token',
            };
        });

        // Мокаем отправку SMS
        await page.route('**/api/auth/send-sms', route =>
            route.fulfill({ status: 200, body: JSON.stringify({ success: true }) })
        );

        // Мокаем /register — на всякий случай (он НЕ должен вызываться!)
        let registerCalled = false;
        await page.route('**/api/auth/register', route => {
            registerCalled = true;
            route.fulfill({ status: 200, body: JSON.stringify({ token: 'should-not-be-set' }) });
        });

        await page.goto('http://localhost:3001/register');

        await page.getByLabel('Имя пользователя:').fill('TestUser');
        await page.getByLabel('Телефон:').fill('89991234567');
        await page.getByLabel('Пароль:').fill('Password123');

        const getCodeButton = page.getByRole('button', { name: 'Получить код' });
        await expect(getCodeButton).toBeEnabled();

        const [smsAlert] = await Promise.all([
            page.waitForEvent('dialog'),
            getCodeButton.click(),
        ]);
        await smsAlert.accept();

        await page.getByPlaceholder('Код из SMS').fill('123456');

        // Клик по "Зарегистрироваться" — без чекбокса
        await page.getByRole('button', { name: 'Зарегистрироваться' }).click();

        // 🔍 Проверка: остались на странице регистрации
        await expect(page).toHaveURL(/\/register/);

        // 🔍 Проверка: токен НЕ установлен
        const token = await page.evaluate(() => localStorage.getItem('authToken'));
        expect(token).toBeNull();

        // 🔍 Проверка: запрос к /register не ушёл
        expect(registerCalled).toBeFalsy();
    });

});
