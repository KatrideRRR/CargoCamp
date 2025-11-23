// tests/utils/auth.js

/**
 * Универсальная функция логина для всех тестов
 *
 * @param {Page} page - Playwright page
 * @param {Object} options - параметры логина
 * @param {string} options.phone - телефон пользователя
 * @param {string} options.password - пароль
 */

async function auth(page, {
    phone = "9780032978",
    password = "11jan1999",
} = {}) {

    // Переход на страницу логина
    await page.goto("http://localhost:3000/login");

    // Ввод телефона
    await page.getByLabel("Телефон:").fill(phone);

    // Ввод пароля
    await page.getByLabel("Пароль:").fill(password);

    // Нажатие кнопки "Войти"
    await page.getByRole("button", { name: "Войти" }).click();

    // Ожидаем, что логин успешный (появится /profile)
    await page.waitForURL(/\/profile/, { timeout: 5000 });
}

module.exports = { login: auth };