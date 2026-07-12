import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3001";

// Если route в App.js другой — поменяй только это:
const DOCUMENTS_PATH = "/user-documents/123";

const documents = [
    "passport-front.jpg",
    "passport-back.png",
    "driver-license.webp",
];

async function setAdminAuth(page) {
    await page.addInitScript(() => {
        const adminUser = {
            id: 1,
            username: "admin",
            name: "admin",
            role: "admin",
            isAdmin: true,
        };

        const token = "admin-test-token";

        localStorage.setItem("authToken", token);
        localStorage.setItem("adminToken", token);
        localStorage.setItem("token", token);

        // Это проверяет PrivateRoute в admin-panel
        localStorage.setItem("userRole", "admin");

        localStorage.setItem("user", JSON.stringify(adminUser));
        localStorage.setItem("adminUser", JSON.stringify(adminUser));
        localStorage.setItem("currentUser", JSON.stringify(adminUser));
    });
}

async function setupMocks(page, options = {}) {
    const {
        status = 200,
        body = {
            documents,
        },
        delayMs = 0,
        onFetch,
    } = options;

    page.on("pageerror", (error) => {
        console.log("[PAGE ERROR]", error.message);
    });

    page.on("console", (msg) => {
        const text = msg.text();

        if (
            text.includes("Ошибка") ||
            text.includes("error") ||
            text.includes("React")
        ) {
            console.log(`[BROWSER ${msg.type()}]`, text);
        }
    });

    await page.route("**/api/admin/user-documents/123", async (route) => {
        onFetch?.({
            url: route.request().url(),
            headers: route.request().headers(),
        });

        if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }

        await route.fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify(body),
        });
    });

    // Чтобы браузер не пытался реально грузить картинки документов
    await page.route("**/uploads/upload-document/**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "image/png",
            body: Buffer.from(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
                "base64"
            ),
        });
    });
}

async function openDocumentsPage(page, options = {}) {
    await setAdminAuth(page);
    await setupMocks(page, options);

    await page.goto(`${FRONT_URL}${DOCUMENTS_PATH}`);
    await page.waitForLoadState("domcontentloaded");

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "admin-user-documents-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("AdminUserDocumentsPage редиректит на /login. Проверь PrivateRoute.");
    }

    if (!(await page.locator(".admin-user-documents").count())) {
        await page.screenshot({
            path: "admin-user-documents-wrong-route.png",
            fullPage: true,
        });

        throw new Error(
            `AdminUserDocumentsPage не найдена. Текущий URL: ${page.url()}. Проверь DOCUMENTS_PATH в тесте.`
        );
    }

    await expect(page.locator(".admin-user-documents")).toBeVisible({
        timeout: 15000,
    });
}

test.describe("AdminUserDocumentsPage", () => {
    test("отображает заголовок страницы", async ({ page }) => {
        await openDocumentsPage(page);

        await expect(page.getByRole("heading", {
            name: "Документы пользователя #123",
        })).toBeVisible();
    });

    test("запрашивает документы пользователя с authToken", async ({ page }) => {
        let requestData = null;

        await openDocumentsPage(page, {
            onFetch: (data) => {
                requestData = data;
            },
        });

        await expect
            .poll(() => requestData, {
                timeout: 10000,
            })
            .toEqual(
                expect.objectContaining({
                    url: expect.stringContaining("/api/admin/user-documents/123"),
                    headers: expect.objectContaining({
                        authorization: "Bearer admin-test-token",
                    }),
                })
            );
    });

    test("показывает список документов", async ({ page }) => {
        await openDocumentsPage(page);

        await expect(page.locator(".documents-list")).toBeVisible();
        await expect(page.locator(".document-item")).toHaveCount(3);

        await expect(page.locator(".document-label").nth(0)).toHaveText("Документ 1");
        await expect(page.locator(".document-label").nth(1)).toHaveText("Документ 2");
        await expect(page.locator(".document-label").nth(2)).toHaveText("Документ 3");
    });

    test("формирует правильные href для документов", async ({ page }) => {
        await openDocumentsPage(page);

        const items = page.locator(".document-item");

        await expect(items.nth(0)).toHaveAttribute(
            "href",
            /\/uploads\/upload-document\/passport-front\.jpg$/
        );

        await expect(items.nth(1)).toHaveAttribute(
            "href",
            /\/uploads\/upload-document\/passport-back\.png$/
        );

        await expect(items.nth(2)).toHaveAttribute(
            "href",
            /\/uploads\/upload-document\/driver-license\.webp$/
        );

        await expect(items.nth(0)).toHaveAttribute("target", "_blank");
        await expect(items.nth(0)).toHaveAttribute("rel", "noopener noreferrer");
    });

    test("формирует правильные img src и alt", async ({ page }) => {
        await openDocumentsPage(page);

        const images = page.locator(".document-item img");

        await expect(images).toHaveCount(3);

        await expect(images.nth(0)).toHaveAttribute(
            "src",
            /\/uploads\/upload-document\/passport-front\.jpg$/
        );

        await expect(images.nth(0)).toHaveAttribute("alt", "Документ 1");
        await expect(images.nth(1)).toHaveAttribute("alt", "Документ 2");
        await expect(images.nth(2)).toHaveAttribute("alt", "Документ 3");
    });

    test("показывает empty state, если документов нет", async ({ page }) => {
        await openDocumentsPage(page, {
            body: {
                documents: [],
            },
        });

        await expect(page.locator(".documents-list")).not.toBeVisible();
        await expect(page.locator(".empty-state")).toBeVisible();
        await expect(page.getByText("Документы отсутствуют")).toBeVisible();
    });

    test("если documents не пришли, показывает empty state", async ({ page }) => {
        await openDocumentsPage(page, {
            body: {},
        });

        await expect(page.locator(".documents-list")).not.toBeVisible();
        await expect(page.getByText("Документы отсутствуют")).toBeVisible();
    });

    test("если загрузка документов упала, показывает ошибку", async ({ page }) => {
        await openDocumentsPage(page, {
            status: 500,
            body: {
                message: "Ошибка",
            },
        });

        await expect(page.getByRole("heading", {
            name: "Документы пользователя #123",
        })).toBeVisible();

        await expect(page.locator(".documents-message.error-text")).toHaveText(
            "Не удалось загрузить документы"
        );
    });

    test("показывает loading state", async ({ page }) => {
        await setAdminAuth(page);
        await setupMocks(page, {
            delayMs: 1000,
        });

        await page.goto(`${FRONT_URL}${DOCUMENTS_PATH}`);
        await page.waitForLoadState("domcontentloaded");

        await expect(page.locator(".admin-user-documents")).toBeVisible();

        await expect(page.locator(".documents-message")).toHaveText("Загрузка...");
    });
});