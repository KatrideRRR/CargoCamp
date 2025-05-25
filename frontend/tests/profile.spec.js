import { test, expect } from "@playwright/test";

test.describe("Страница профиля", () => {
    test.beforeEach(async ({ page }) => {
        // Мокаем localStorage с токеном
        await page.addInitScript(() => {
            localStorage.setItem("authToken", "mock-token");
        });

        // Мокаем API /api/auth/profile
        await page.route("**/api/auth/profile", async (route) => {
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    id: 123,
                    username: "testuser",
                    rating: 4,
                    userStatus: "verified",
                    rebillId: "rebill_123",
                    cardType: "VISA",
                    cardLastFour: "1234"
                }),
            });
        });

        // Мокаем /unbind-card
        await page.route("**/api/payment/unbind-card", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ success: true }),
            })
        );
        // Мокаем API для загрузки документов
        await page.route("**/api/auth/upload-documents", (route) =>
            route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ message: "Документы успешно загружены" }),
            })
        );
    });

    test("отображает информацию профиля", async ({ page }) => {
        await page.goto("http://localhost:3001/profile");

        await expect(page.getByText("Имя пользователя:")).toBeVisible();
        await expect(page.getByText("testuser")).toBeVisible();
        await expect(page.getByText("ID пользователя:")).toBeVisible();
        await expect(page.locator('.section').nth(1).getByText("123")).toBeVisible();
        await expect(page.getByText("★★★★☆")).toBeVisible();
        await expect(page.getByText(/Карта привязана/)).toContainText("VISA •••• 1234");

        await expect(page.getByRole("button", { name: "Удалить карту" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Мои жалобы" })).toBeVisible();
        await expect(page.getByRole("button", { name: "История заказов" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Выйти" })).toBeVisible();
    });

    test("редирект на /login если токен отсутствует", async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.removeItem("authToken");
        });

        await page.goto("http://localhost:3001/profile");

        await expect(page).toHaveURL(/\/login/);
    });

    test("загрузка документов", async ({ page }) => {
        await page.goto("http://localhost:3001/profile");

        const inputFile = page.locator('input[type="file"]');
        const uploadButton = page.locator('.upload-button-style');

        // Мокаем успешную загрузку документа
        await inputFile.setInputFiles('C:/Users/katriderrr/Desktop/CargoCamp/backend/uploads/upload-document/39_5.jpg');

        // Проверяем, что кнопка доступна
        await expect(uploadButton).toBeVisible();

        await uploadButton.click();

        // Ожидаем успешную загрузку (появление Toast)

        // Проверяем текст о успешной загрузке
    });


});
