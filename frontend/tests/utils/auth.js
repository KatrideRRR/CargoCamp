// tests/utils/auth.js

/**
 * Универсальная функция логина для всех тестов
 *
 * @param {Page} page - Playwright page
 * @param {Object} options - параметры логина
 * @param {string} options.phone - телефон пользователя
 * @param {string} options.password - пароль
 */

// tests/utils/auth.js

async function login(page, {
    phone = "+7 (978) 003-29-78",
    password = "11jan1999",
} = {}) {
    await page.goto("http://localhost:3000/login?platform=web");

    await page.locator("#phone").fill(phone);

    await page.getByRole("button", { name: "Войти по паролю" }).click();

    await page.locator("#password").fill(password);

    await page.getByRole("button", { name: /^Войти$/ }).click();

    await page.waitForURL(/\/profile/, {
        timeout: 10000,
    });
}

module.exports = { login };

module.exports = { login: auth };