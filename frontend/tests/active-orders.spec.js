import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3000";

const testUser = {
    id: 1,
    username: "executor",
    role: "executor",
    phone: "+79786864118",
};

const customerUser = {
    id: 2,
    username: "Заказчик",
    rating: 4.5,
    phone: "+79780032978",
};

const regularOrder = {
    id: 101,
    description: "Привезти груз",
    address: "Улица Пушкина",
    paymentType: "cash",
    proposedSum: 500,
    creatorId: 2,
    executorId: 1,
    images: ["/test-image.jpg", "/test-image-2.jpg"],
    category: { name: "Грузы" },
    subcategory: { name: "Мебель" },
    service: { name: "Перевозка мебели" },
    coordinates: "55.7558,37.6176",
    createdAt: new Date().toISOString(),
    completedBy: [],
    status: "active",
    workStartedAt: "2026-07-01T10:00:00.000Z",
    contractPath: "contracts/test-contract.pdf",
    executorBeforePhotos: ["/before-1.jpg"],
    executorAfterPhotos: [],
    customerBeforePhotos: [],
    customerAfterPhotos: [],
};

function createFakeJwt(payload) {
    const header = {
        alg: "none",
        typ: "JWT",
    };

    const base64url = (obj) =>
        Buffer.from(JSON.stringify(obj))
            .toString("base64")
            .replace(/=/g, "")
            .replace(/\+/g, "-")
            .replace(/\//g, "_");

    return `${base64url(header)}.${base64url(payload)}.`;
}

async function setFakeAuthToken(page) {
    const fakeToken = createFakeJwt({
        id: testUser.id,
        role: testUser.role,
        name: testUser.username,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
    });

    await page.addInitScript((token) => {
        localStorage.setItem("authToken", token);
    }, fakeToken);
}

async function setupFrontendMocks(page) {
    page.on("pageerror", (error) => {
        console.log("[PAGE ERROR]", error.message);
    });

    page.on("console", (msg) => {
        const text = msg.text();

        if (
            text.includes("Ошибка") ||
            text.includes("error") ||
            text.includes("React") ||
            text.includes("CALL")
        ) {
            console.log(`[BROWSER ${msg.type()}]`, text);
        }
    });

    page.on("requestfailed", (request) => {
        console.log("[REQUEST FAILED]", request.url(), request.failure()?.errorText);
    });

    await page.route("**/api/orders/active-orders", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                orders: [regularOrder],
                notifications: [
                    {
                        id: 1,
                        type: "new_message",
                        userId: testUser.id,
                        orderId: regularOrder.id,
                        isRead: false,
                    },
                ],
            }),
        });
    });

    await page.route("**/api/express/express-orders/me**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                success: true,
                orders: [],
            }),
        });
    });

    await page.route("**/api/auth/2", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(customerUser),
        });
    });

    await page.route("**/api/auth/user/2", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(customerUser),
        });
    });

    await page.route("**/api/auth/1", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(testUser),
        });
    });

    await page.route("**/api/auth/user/1", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(testUser),
        });
    });

    await page.route("**/api/disputes/order/**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                dispute: null,
            }),
        });
    });

    await page.route("**/test-image.jpg", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "image/jpeg",
            body: Buffer.from("fake-image-1"),
        });
    });

    await page.route("**/test-image-2.jpg", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "image/jpeg",
            body: Buffer.from("fake-image-2"),
        });
    });

    await page.route("**/before-1.jpg", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "image/jpeg",
            body: Buffer.from("fake-before-image"),
        });
    });
}

async function openActiveOrdersPage(page) {
    await setFakeAuthToken(page);
    await setupFrontendMocks(page);

    await page.goto(`${FRONT_URL}/active-orders?platform=web`);

    await page.waitForLoadState("domcontentloaded");

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "active-orders-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error(
            "После fake JWT всё равно произошёл редирект на /login. Нужно проверить роутер/PrivateRoute."
        );
    }

    await expect(page.getByText("Активные заказы")).toBeVisible({
        timeout: 15000,
    });
}

function disputeModal(page) {
    return page.locator(".dispute-modal-content");
}

async function clickDisputeSubmit(page) {
    await page.evaluate(() => {
        const button = document.querySelector(
            ".dispute-modal-content .dispute-submit-button"
        );

        if (!button) {
            throw new Error("Кнопка отправки спора не найдена");
        }

        button.click();
    });
}

test.describe("ActiveOrdersPage", () => {
    test.beforeEach(async ({ page }) => {
        await openActiveOrdersPage(page);
    });

    test("отображает активный заказ исполнителя", async ({ page }) => {
        await expect(page.getByText("Активные заказы")).toBeVisible();

        const card = page.locator(".order-card").first();

        await expect(card).toBeVisible();

        await expect(card.getByText("Заказ №101")).toBeVisible();
        await expect(card.getByText("Вы исполнитель")).toBeVisible();

        await expect(card.getByText(/ID заказчика:\s*2/)).toBeVisible();
        await expect(card.getByText(/Имя заказчика:\s*Заказчик/)).toBeVisible();
        await expect(card.getByText(/Рейтинг заказчика:\s*4\.5/)).toBeVisible();

        await expect(card.getByText(/Грузы/)).toBeVisible();
        await expect(card.getByText(/Мебель/)).toBeVisible();
        await expect(card.getByText(/Перевозка мебели/)).toBeVisible();

        await expect(card.getByText(/Улица Пушкина/)).toBeVisible();
        await expect(card.getByText(/Привезти груз/)).toBeVisible();

        await expect(card.getByText(/500/)).toBeVisible();
        await expect(card.locator(".pay-type")).toHaveText("Наличные");

        await expect(card.getByText("Фото-протокол заказа")).toBeVisible();
        await expect(card.getByText("Фото ДО начала работы")).toBeVisible();
        await expect(card.getByText("Фото ПОСЛЕ выполнения работы")).toBeVisible();
    });

    test("показывает бейдж непрочитанного сообщения", async ({ page }) => {
        await expect(page.getByRole("button", { name: /Сообщение/i })).toBeVisible();
        await expect(page.locator(".notification-badge-ios")).toHaveText("1");
    });

    test("клик по сообщению ведёт в чат обычного заказа", async ({ page }) => {
        await page.getByRole("button", { name: /Сообщение/i }).click();

        await expect(page).toHaveURL(/\/messages\/regular\/101$/);
    });

    test("открывает модальное окно с изображением заказа", async ({ page }) => {
        await page.locator(".image-stack").click();

        await expect(page.locator(".custom-modal-image")).toBeVisible();

        await expect(page.locator(".custom-modal-image")).toHaveAttribute(
            "src",
            /test-image\.jpg/
        );
    });

    test("переключает изображения в модальном окне", async ({ page }) => {
        await page.locator(".image-stack").click();

        await expect(page.locator(".custom-modal-image")).toHaveAttribute(
            "src",
            /test-image\.jpg/
        );

        await page.getByRole("button", { name: "▶" }).click();

        await expect(page.locator(".custom-modal-image")).toHaveAttribute(
            "src",
            /test-image-2\.jpg/
        );

        await page.getByRole("button", { name: "◀" }).click();

        await expect(page.locator(".custom-modal-image")).toHaveAttribute(
            "src",
            /test-image\.jpg/
        );
    });

    test("закрывает модальное окно изображения", async ({ page }) => {
        await page.locator(".image-stack").click();

        await expect(page.locator(".custom-modal-image")).toBeVisible();

        await page.locator(".custom-close-button").click();

        await expect(page.locator(".custom-modal-image")).not.toBeVisible();
    });

    test("кнопка Позвонить получает телефон и нормализует номер", async ({ page }) => {
        const consolePromise = page.waitForEvent("console", (msg) =>
            msg.text().includes("CALL NORMALIZED PHONE:")
        );

        await page.getByRole("button", { name: /Позвонить/i }).click();

        const msg = await consolePromise;

        expect(msg.text()).toContain("+79780032978");
    });

    test("кнопка Маршрут открывает Яндекс.Навигатор", async ({ page }) => {
        await page.evaluate(() => {
            window.__openedUrl = null;

            window.confirm = () => true;

            window.open = (url) => {
                window.__openedUrl = url;
            };

            navigator.geolocation.getCurrentPosition = (success) => {
                success({
                    coords: {
                        latitude: 55.75,
                        longitude: 37.61,
                    },
                });
            };
        });

        await page.getByRole("button", { name: /Маршрут/i }).click();

        await expect
            .poll(async () => page.evaluate(() => window.__openedUrl))
            .toContain("https://yandex.ru/navi/");
    });

    test("открывает модалку спора", async ({ page }) => {
        await page.getByRole("button", { name: /Открыть спор/i }).click();

        const modal = disputeModal(page);

        await expect(modal.getByRole("heading", { name: "Открыть спор" })).toBeVisible();
        await expect(modal.getByText("Заказ №101")).toBeVisible();

        await expect(
            modal.getByPlaceholder("Например: работа выполнена не полностью")
        ).toBeVisible();

        await expect(
            modal.getByPlaceholder("Опишите подробно, в чём проблема, что произошло, что именно не устраивает")
        ).toBeVisible();
    });

    test("закрывает модалку спора", async ({ page }) => {
        await page.getByRole("button", { name: /Открыть спор/i }).click();

        const modal = disputeModal(page);

        await expect(modal.getByRole("heading", { name: "Открыть спор" })).toBeVisible();

        await modal.getByRole("button", { name: /Отмена/i }).click({ force: true });

        await expect(modal.getByRole("heading", { name: "Открыть спор" })).not.toBeVisible();
    });

    test("не отправляет спор без краткой причины", async ({ page }) => {
        let disputeOpenCalled = false;

        await page.route("**/api/disputes/open", async (route) => {
            disputeOpenCalled = true;

            await route.fulfill({
                status: 400,
                contentType: "application/json",
                body: JSON.stringify({
                    message: "Не должно было отправиться",
                }),
            });
        });

        await page.getByRole("button", { name: /Открыть спор/i }).click();

        const modal = disputeModal(page);

        await expect(modal.getByRole("heading", { name: "Открыть спор" })).toBeVisible();

        page.once("dialog", async (dialog) => {
            await dialog.accept();
        });

        await clickDisputeSubmit(page);

        await page.waitForTimeout(500);

        expect(disputeOpenCalled).toBe(false);

        await expect(modal.getByRole("heading", { name: "Открыть спор" })).toBeVisible();
    });

    test("отправляет спор", async ({ page }) => {
        let disputeRequestBody = null;

        await page.route("**/api/disputes/open", async (route) => {
            disputeRequestBody = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    dispute: {
                        id: 555,
                        orderId: 101,
                        status: "open",
                        reason: "Работа выполнена плохо",
                        description: "Исполнитель повредил груз",
                    },
                }),
            });
        });

        await page.getByRole("button", { name: /Открыть спор/i }).click();

        const modal = disputeModal(page);

        await modal
            .getByPlaceholder("Например: работа выполнена не полностью")
            .fill("Работа выполнена плохо");

        await modal
            .getByPlaceholder("Опишите подробно, в чём проблема, что произошло, что именно не устраивает")
            .fill("Исполнитель повредил груз");

        const dialogPromise = page.waitForEvent("dialog");

        await clickDisputeSubmit(page);

        const dialog = await dialogPromise;

        expect(dialog.message()).toContain("Спор успешно открыт");

        await dialog.accept();

        expect(disputeRequestBody).toEqual({
            orderId: 101,
            reasonCode: "poor_quality",
            reason: "Работа выполнена плохо",
            description: "Исполнитель повредил груз",
        });

        await expect(page.getByText(/Спор:\s*open/)).toBeVisible({
            timeout: 10000,
        });
    });

    test("завершает заказ после подтверждения", async ({ page }) => {
        let completionConfirmed = false;
        let completeRequestCalled = false;
        let confirmWasShown = false;
        let successAlertWasShown = false;

        /*
         * После подтверждения завершения следующий GET должен вернуть
         * уже обновлённый заказ с completedBy: [1].
         */
        await page.route("**/api/orders/active-orders", async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    orders: [
                        {
                            ...regularOrder,
                            completedBy: completionConfirmed ? [1] : [],
                            status: "active",
                        },
                    ],
                    notifications: [],
                }),
            });
        });

        await page.route("**/api/orders/complete/101", async (route) => {
            expect(route.request().method()).toBe("POST");

            completeRequestCalled = true;
            completionConfirmed = true;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    ...regularOrder,
                    completedBy: [1],
                    status: "active",
                }),
            });
        });

        page.on("dialog", async (dialog) => {
            if (dialog.type() === "confirm") {
                confirmWasShown = true;

                expect(dialog.message()).toContain(
                    "Подтвердить завершение заказа?"
                );
            }

            if (
                dialog.type() === "alert" &&
                dialog.message().includes("Вы подтвердили завершение")
            ) {
                successAlertWasShown = true;
            }

            await dialog.accept();
        });

        await page.getByRole("button", {
            name: /^Завершить$/,
        }).click();

        await expect.poll(() => confirmWasShown).toBe(true);
        await expect.poll(() => completeRequestCalled).toBe(true);
        await expect.poll(() => successAlertWasShown).toBe(true);

        await expect(
            page.getByText("Вы подтвердили завершение.", {
                exact: true,
            })
        ).toBeVisible({
            timeout: 10000,
        });

        await expect(
            page.getByRole("button", {
                name: /Ждём подтверждения/i,
            })
        ).toBeDisabled();

        await expect(
            page.getByRole("button", {
                name: /Напомнить/i,
            })
        ).toBeVisible();
    });

    test("отправляет напоминание, если пользователь уже подтвердил завершение", async ({ page }) => {
        await page.route("**/api/orders/active-orders", async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    orders: [
                        {
                            ...regularOrder,
                            completedBy: [1],
                            status: "active",
                        },
                    ],
                    notifications: [],
                }),
            });
        });

        await page.route("**/api/orders/101/remind-complete", async (route) => {
            expect(route.request().method()).toBe("POST");

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                }),
            });
        });

        await page.reload();

        await expect(page.getByText("Вы подтвердили завершение.")).toBeVisible();

        const dialogPromise = page.waitForEvent("dialog");

        await page.getByRole("button", { name: /Напомнить/i }).click();

        const dialog = await dialogPromise;

        expect(dialog.message()).toContain("Напоминание отправлено");

        await dialog.accept();
    });

    test("загружает фото ДО от исполнителя", async ({ page }) => {
        await page.route("**/api/orders/101/executor-before-photos", async (route) => {
            expect(route.request().method()).toBe("POST");

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                }),
            });
        });

        page.on("dialog", async (dialog) => {
            await dialog.accept();
        });

        const fileInput = page.locator('input[type="file"]').first();

        await fileInput.setInputFiles({
            name: "photo.jpg",
            mimeType: "image/jpeg",
            buffer: Buffer.from("fake-image"),
        });

        await expect(page.getByText("Заказ №101")).toBeVisible();
    });

    test("переключает вкладку на созданные заказы", async ({ page }) => {
        await page.getByRole("button", { name: /Мои заказы выполняют/i }).click();

        await expect(page.getByText("Ваши заказы, которые сейчас выполняются")).toBeVisible();

        await expect(page.getByText("Нет активных заказов.")).toBeVisible();
    });

    test("если backend вернул ошибку, показывает сообщение об ошибке", async ({ page }) => {
        await page.route("**/api/orders/active-orders", async (route) => {
            await route.fulfill({
                status: 500,
                contentType: "application/json",
                body: JSON.stringify({
                    message: "Server error",
                }),
            });
        });

        await page.reload();

        await expect(page.getByText("Не удалось загрузить заказы.")).toBeVisible();
    });
});