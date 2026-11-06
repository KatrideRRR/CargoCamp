import {
    test,
    expect,
} from "./fixtures/safeTest";

import {
    setAdminAuth,
} from "./utils/adminTestAuth";

test.describe("AdminUserDocumentsPage", () => {
    test("старый просмотр документов отключён", async ({ page }) => {
        await setAdminAuth(page);

        await page.goto("/user-documents/123");

        await expect(
            page.getByRole("heading", {
                name: "Документы пользователя #123",
            })
        ).toBeVisible();

        await expect(
            page.locator(".documents-message")
        ).toContainText(
            "Старый просмотр документов отключён"
        );
    });

    test("показывает переход в защищённый раздел проверки личности", async ({ page }) => {
        await setAdminAuth(page);

        await page.goto("/user-documents/123");

        const link = page.getByRole("link", {
            name: "Перейти к проверке личности",
        });

        await expect(link).toBeVisible();

        await expect(link).toHaveAttribute(
            "href",
            "/identity"
        );
    });
});