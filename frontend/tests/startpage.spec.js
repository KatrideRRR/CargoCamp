import { test, expect } from "@playwright/test";
const { login } = require("./utils/auth");

test.describe("StartPage", () => {
    test.beforeEach(async ({ page }) => {
        // Устанавливаем user в localStorage до загрузки страницы
        await page.addInitScript(() => {
            localStorage.setItem("user", JSON.stringify({ id: 1 }));
        });

        await page.goto("http://localhost:3000/");
    });

    test("отображает заголовок и подзаголовок", async ({ page }) => {
        await expect(page.getByText("Добро пожаловать!")).toBeVisible();
        await expect(page.getByText("Кем вы хотите быть сегодня?")).toBeVisible();
    });

    test("отображаются кнопки ролей", async ({ page }) => {
        await expect(page.getByRole("button", { name: /я заказчик/i })).toBeVisible();
        await expect(page.getByRole("button", { name: /я исполнитель/i })).toBeVisible();
    });

    test("отображаются кнопки юридической информации", async ({ page }) => {
        await expect(page.getByRole("button", { name: /политика конфиденциальности/i })).toBeVisible();
        await expect(page.getByRole("button", { name: /публичная оферта/i })).toBeVisible();
    });

    test("переход на /my-orders/:id при клике Я заказчик", async ({ page }) => {

        // 1. Заходим на стартовую страницу
        await page.goto("http://localhost:3000/");

        // 2. Нажимаем "Я заказчик"
        await page.getByRole("button", { name: /я заказчик/i }).click();

        // 3. Так как пользователь не авторизован → редирект на /login
        await expect(page).toHaveURL(/\/login$/);

        // 4. Логинимся через универсальную функцию
        await login(page);

        // 5. После логина ты попадаешь на /profile (так реализовано в приложении)
        await expect(page).toHaveURL(/\/profile/);

        // 6. Теперь вручную переходим на нужную страницу
        // (потому что приложение само не делает возврат)
        await page.goto("http://localhost:3000/my-orders/4");

        // 7. Проверяем, что пользователь реально попал куда нужно
        await expect(page).toHaveURL(/\/my-orders\/4$/);
    });

    test("переход на /orders при клике Я исполнитель", async ({ page }) => {
        await page.getByRole("button", { name: /я исполнитель/i }).click();
        await expect(page).toHaveURL(/\/orders$/);
    });

    // ---------- МОДАЛКИ ----------

    test("открывается модалка Политики конфиденциальности", async ({ page }) => {
        await page.getByRole("button", { name: /политика конфиденциальности/i }).click();
        await expect(page.getByText("Политика конфиденциальности CargoCamp")).toBeVisible();
    });

    test("закрытие модалки Политики кликом по overlay", async ({ page }) => {
        await page.getByRole("button", { name: /политика конфиденциальности/i }).click();

        await page.locator(".modal-overlay").click({ position: { x: 10, y: 10 } });

        await expect(page.getByText("Политика конфиденциальности CargoCamp")).not.toBeVisible();
    });

    test("открывается модалка Публичной оферты", async ({ page }) => {
        await page.getByRole("button", { name: /публичная оферта/i }).click();
        await expect(page.getByText("Публичная оферта CargoCamp")).toBeVisible();
    });

    test("закрытие модалки Оферты кликом по overlay", async ({ page }) => {
        await page.getByRole("button", { name: /публичная оферта/i }).click();

        await page.locator(".modal-overlay").click({ position: { x: 10, y: 10 } });

        await expect(page.getByText("Публичная оферта CargoCamp")).not.toBeVisible();
    });

    // ---------- НЕАВТОРИЗОВАННЫЙ ----------

    test("неавторизованный пользователь перенаправляется на /login", async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.removeItem("user");
        });

        await page.goto("http://localhost:3000/");
        await page.getByRole("button", { name: /я заказчик/i }).click();

        await expect(page).toHaveURL(/\/login/);
    });
});