import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3001";

// Если route в App.js другой — поменяй только это:
const ORDER_DETAILS_PATH = "/orders/777";

const baseOrder = {
    id: 777,
    address: "Симферополь, улица Пушкина, 1",
    status: "active",
    adminDeleted: false,
    creatorHidden: false,
    createdAt: "2026-07-01T10:00:00.000Z",
    creatorId: 10,
    executorId: 20,
    category: { id: 1, name: "Грузоперевозки" },
    subcategory: { id: 2, name: "Перевозка мебели" },
    proposedSum: 2500,
    paymentType: "cash",
    dealStatus: "performing",
    description: "Перевезти диван",
    images: ["/uploads/orders/777/create-1.jpg"],
    customerBeforePhotos: ["/uploads/orders/777/customer-before-1.jpg"],
    customerAfterPhotos: [],
    executorBeforePhotos: ["/uploads/orders/777/executor-before-1.jpg"],
    executorAfterPhotos: ["/uploads/orders/777/executor-after-1.jpg"],
    disputes: [
        {
            id: 501,
            status: "open",
            openedByRole: "creator",
            openedById: 10,
            createdAt: "2026-07-01T11:00:00.000Z",
            takenByAdminId: null,
            takenAt: null,
            reasonCode: "poor_quality",
            reason: "Плохое качество",
            description: "Исполнитель повредил вещь",
            resolution: "",
            resolvedById: null,
            resolvedAt: null,
        },
        {
            id: 502,
            status: "in_review",
            openedByRole: "executor",
            openedById: 20,
            createdAt: "2026-07-01T12:00:00.000Z",
            takenByAdminId: 1,
            takenAt: "2026-07-01T12:10:00.000Z",
            reasonCode: "wrong_price",
            reason: "Спор по цене",
            description: "Цена изменилась",
            resolution: "",
            resolvedById: null,
            resolvedAt: null,
        },
        {
            id: 503,
            status: "resolved",
            openedByRole: "creator",
            openedById: 10,
            createdAt: "2026-07-01T13:00:00.000Z",
            takenByAdminId: 1,
            takenAt: "2026-07-01T13:10:00.000Z",
            reasonCode: "other",
            reason: "Другое",
            description: "Уже решено",
            resolution: "Возврат части суммы",
            resolvedById: 1,
            resolvedAt: "2026-07-01T14:00:00.000Z",
        },
    ],
};

const logsRows = [
    {
        id: 1,
        ts: "2026-07-01T10:00:00.000Z",
        actionType: "created",
        actorRole: "creator",
        actorUserId: 10,
        success: true,
        severity: "info",
        reason: "",
        meta: {
            source: "test",
        },
    },
    {
        id: 2,
        ts: "2026-07-01T10:20:00.000Z",
        actionType: "delete_failed",
        actorRole: "admin",
        actorUserId: 1,
        success: false,
        severity: "warning",
        reason: "Тестовая причина",
        meta: {
            status: "failed",
        },
    },
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
        localStorage.setItem("userRole", "admin");

        localStorage.setItem("user", JSON.stringify(adminUser));
        localStorage.setItem("adminUser", JSON.stringify(adminUser));
        localStorage.setItem("currentUser", JSON.stringify(adminUser));
    });
}

async function setupMocks(page, options = {}) {
    const {
        orderStatus = 200,
        orderBody = baseOrder,
        logsStatus = 200,
        logsBody = { rows: logsRows },
        deleteStatus = 200,
        deleteBody = {
            order: {
                ...baseOrder,
                adminDeleted: true,
                adminDeletedAt: "2026-07-01T15:00:00.000Z",
                adminDeletedById: 1,
            },
        },
        restoreStatus = 200,
        restoreBody = {
            order: {
                ...baseOrder,
                adminDeleted: false,
                creatorHidden: false,
            },
        },
        disputeStatusBody = {
            dispute: {
                ...baseOrder.disputes[0],
                status: "in_review",
                takenByAdminId: 1,
                takenAt: "2026-07-01T15:30:00.000Z",
            },
        },
        disputeResolveBody = {
            dispute: {
                ...baseOrder.disputes[1],
                status: "resolved",
                resolution: "Вернуть заказчику часть суммы",
                resolvedById: 1,
                resolvedAt: "2026-07-01T16:00:00.000Z",
            },
        },
        onOrderFetch,
        onLogsFetch,
        onDelete,
        onRestore,
        onDisputeStatus,
        onDisputeResolve,
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

    await page.route("**/api/admin/orders/777/logs", async (route) => {
        onLogsFetch?.({
            url: route.request().url(),
            headers: route.request().headers(),
        });

        await route.fulfill({
            status: logsStatus,
            contentType: "application/json",
            body: JSON.stringify(logsBody),
        });
    });

    await page.route("**/api/admin/orders/777/restore", async (route) => {
        onRestore?.({
            body: route.request().postDataJSON?.(),
            headers: route.request().headers(),
        });

        await route.fulfill({
            status: restoreStatus,
            contentType: "application/json",
            body: JSON.stringify(restoreBody),
        });
    });

    await page.route("**/api/admin/orders/777", async (route) => {
        const method = route.request().method();

        if (method === "GET") {
            onOrderFetch?.({
                url: route.request().url(),
                headers: route.request().headers(),
            });

            await route.fulfill({
                status: orderStatus,
                contentType: "application/json",
                body: JSON.stringify(orderBody),
            });

            return;
        }

        if (method === "DELETE") {
            onDelete?.({
                headers: route.request().headers(),
            });

            await route.fulfill({
                status: deleteStatus,
                contentType: "application/json",
                body: JSON.stringify(deleteBody),
            });

            return;
        }

        await route.fallback();
    });

    await page.route("**/api/admin/disputes/501/status", async (route) => {
        onDisputeStatus?.({
            body: route.request().postDataJSON(),
            headers: route.request().headers(),
        });

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(disputeStatusBody),
        });
    });

    await page.route("**/api/admin/disputes/502/resolve", async (route) => {
        onDisputeResolve?.({
            body: route.request().postDataJSON(),
            headers: route.request().headers(),
        });

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(disputeResolveBody),
        });
    });

    await page.route("**/uploads/orders/**", async (route) => {
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

async function openOrderDetailsPage(page, options = {}) {
    await setAdminAuth(page);
    await setupMocks(page, options);

    await page.goto(`${FRONT_URL}${ORDER_DETAILS_PATH}`);
    await page.waitForLoadState("domcontentloaded");

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "order-details-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("OrderDetailsPage редиректит на /login. Проверь PrivateRoute.");
    }

    if (!(await page.locator(".order-details-container").count())) {
        await page.screenshot({
            path: "order-details-wrong-route.png",
            fullPage: true,
        });

        throw new Error(
            `OrderDetailsPage не найдена. Текущий URL: ${page.url()}. Проверь ORDER_DETAILS_PATH в тесте.`
        );
    }

    await expect(page.locator(".order-details-container")).toBeVisible({
        timeout: 15000,
    });
}

async function acceptDialogAndClick(page, locator, expectedMessage) {
    const dialogPromise = page.waitForEvent("dialog").then(async (dialog) => {
        if (expectedMessage) {
            expect(dialog.message()).toBe(expectedMessage);
        }

        await dialog.accept();
    });

    await locator.click({ noWaitAfter: true });

    await dialogPromise;
}

test.describe("OrderDetailsPage", () => {
    test("отображает детали заказа", async ({ page }) => {
        await openOrderDetailsPage(page);

        await expect(page.getByRole("heading", {
            name: "Детали заказа #777",
        })).toBeVisible();

        const mainCard = page.locator(".order-card").first();

        await expect(mainCard).toContainText("Основная информация");
        await expect(mainCard).toContainText("Симферополь, улица Пушкина, 1");
        await expect(mainCard).toContainText("active");
        await expect(mainCard).toContainText("Видимый");
        await expect(mainCard).toContainText("10");
        await expect(mainCard).toContainText("20");
        await expect(mainCard).toContainText("Грузоперевозки");
        await expect(mainCard).toContainText("Перевозка мебели");
        await expect(mainCard).toContainText("2500");
        await expect(mainCard).toContainText("cash");
        await expect(mainCard).toContainText("performing");
        await expect(mainCard).toContainText("Перевезти диван");
    });

    test("запрашивает заказ и логи с authToken", async ({ page }) => {
        let orderRequest = null;
        let logsRequest = null;

        await openOrderDetailsPage(page, {
            onOrderFetch: (data) => {
                orderRequest = data;
            },
            onLogsFetch: (data) => {
                logsRequest = data;
            },
        });

        await expect
            .poll(() => orderRequest, { timeout: 10000 })
            .toEqual(
                expect.objectContaining({
                    url: expect.stringContaining("/api/admin/orders/777"),
                    headers: expect.objectContaining({
                        authorization: "Bearer admin-test-token",
                    }),
                })
            );

        await expect
            .poll(() => logsRequest, { timeout: 10000 })
            .toEqual(
                expect.objectContaining({
                    url: expect.stringContaining("/api/admin/orders/777/logs"),
                    headers: expect.objectContaining({
                        authorization: "Bearer admin-test-token",
                    }),
                })
            );
    });

    test("кнопка Открыть чат ведёт в сообщения заказа", async ({ page }) => {
        await openOrderDetailsPage(page);

        await page.getByRole("button", {
            name: "Открыть чат",
        }).click();

        await expect(page).toHaveURL(/\/777\/messages/);
    });

    test("показывает статус adminDeleted и кнопку восстановления", async ({ page }) => {
        await openOrderDetailsPage(page, {
            orderBody: {
                ...baseOrder,
                adminDeleted: true,
                adminDeletedAt: "2026-07-01T15:00:00.000Z",
                adminDeletedById: 1,
            },
        });

        const mainCard = page.locator(".order-card").first();

        await expect(mainCard).toContainText("Удалён админом");
        await expect(mainCard).toContainText("ID админа");
        await expect(page.getByRole("button", { name: "Восстановить" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Удалить" })).not.toBeVisible();
    });

    test("показывает статус creatorHidden и кнопку восстановления", async ({ page }) => {
        await openOrderDetailsPage(page, {
            orderBody: {
                ...baseOrder,
                creatorHidden: true,
                creatorHiddenAt: "2026-07-01T15:00:00.000Z",
            },
        });

        const mainCard = page.locator(".order-card").first();

        await expect(mainCard).toContainText("Скрыт пользователем");
        await expect(mainCard).toContainText("Скрыт пользователем");
        await expect(page.getByRole("button", { name: "Восстановить" })).toBeVisible();
    });

    test("удаляет заказ после confirm", async ({ page }) => {
        let deleteCalled = false;
        const dialogMessages = [];

        await openOrderDetailsPage(page, {
            onDelete: () => {
                deleteCalled = true;
            },
        });

        page.on("dialog", async (dialog) => {
            dialogMessages.push(dialog.message());
            await dialog.accept();
        });

        await page.getByRole("button", { name: "Удалить" }).click({
            noWaitAfter: true,
        });

        await expect
            .poll(() => dialogMessages, { timeout: 10000 })
            .toContain(
                "Пометить заказ как удалённый админом? Он останется в базе и логах, но будет отмечен как удалённый."
            );

        await expect
            .poll(() => dialogMessages, { timeout: 10000 })
            .toContain("Заказ помечен как удалённый админом");

        await expect.poll(() => deleteCalled).toBe(true);
        await expect(page.locator(".visibility-badge")).toHaveText("Удалён админом");
    });

    test("не удаляет заказ, если confirm отменён", async ({ page }) => {
        let deleteCalled = false;

        await openOrderDetailsPage(page, {
            onDelete: () => {
                deleteCalled = true;
            },
        });

        const dialogPromise = page.waitForEvent("dialog").then(async (dialog) => {
            expect(dialog.message()).toContain("Пометить заказ");
            await dialog.dismiss();
        });

        await page.getByRole("button", { name: "Удалить" }).click({ noWaitAfter: true });

        await dialogPromise;

        await expect.poll(() => deleteCalled, { timeout: 1000 }).toBe(false);
        await expect(page.locator(".visibility-badge")).toHaveText("Видимый");
    });

    test("восстанавливает заказ после confirm", async ({ page }) => {
        let restoreCalled = false;
        const dialogMessages = [];

        await openOrderDetailsPage(page, {
            orderBody: {
                ...baseOrder,
                adminDeleted: true,
                adminDeletedAt: "2026-07-01T15:00:00.000Z",
                adminDeletedById: 1,
            },
            onRestore: () => {
                restoreCalled = true;
            },
        });

        page.on("dialog", async (dialog) => {
            dialogMessages.push(dialog.message());
            await dialog.accept();
        });

        await page.getByRole("button", { name: "Восстановить" }).click({
            noWaitAfter: true,
        });

        await expect
            .poll(() => dialogMessages, { timeout: 10000 })
            .toContain("Восстановить заказ и вернуть его в видимость?");

        await expect
            .poll(() => dialogMessages, { timeout: 10000 })
            .toContain("Заказ восстановлен");

        await expect.poll(() => restoreCalled).toBe(true);
        await expect(page.locator(".visibility-badge")).toHaveText("Видимый");
    });

    test("отображает споры по заказу", async ({ page }) => {
        await openOrderDetailsPage(page);

        await expect(page.getByRole("heading", {
            name: "Споры по заказу",
        })).toBeVisible();

        await expect(page.locator(".dispute-card")).toHaveCount(3);

        await expect(page.locator(".dispute-card").nth(0)).toContainText("ID спора: 501");
        await expect(page.locator(".dispute-card").nth(0)).toContainText("Открыт");
        await expect(page.locator(".dispute-card").nth(0)).toContainText("Заказчик #10");
        await expect(page.locator(".dispute-card").nth(0)).toContainText("Низкое качество работы");

        await expect(page.locator(".dispute-card").nth(1)).toContainText("На рассмотрении");
        await expect(page.locator(".dispute-card").nth(1)).toContainText("Исполнитель #20");
        await expect(page.locator(".dispute-card").nth(1)).toContainText("Спор по стоимости");

        await expect(page.locator(".dispute-card").nth(2)).toContainText("Решён");
        await expect(page.locator(".dispute-card").nth(2)).toContainText("Этот спор уже завершён.");
    });

    test("если споров нет, показывает пустое состояние", async ({ page }) => {
        await openOrderDetailsPage(page, {
            orderBody: {
                ...baseOrder,
                disputes: [],
            },
        });

        await expect(page.getByText("По этому заказу споров нет")).toBeVisible();
    });

    test("берёт спор в работу", async ({ page }) => {
        let statusRequest = null;

        await openOrderDetailsPage(page, {
            onDisputeStatus: (data) => {
                statusRequest = data;
            },
        });

        const dialogPromise = page.waitForEvent("dialog").then(async (dialog) => {
            expect(dialog.message()).toBe("Статус спора обновлён");
            await dialog.accept();
        });

        await page.locator(".dispute-card").nth(0).getByRole("button", {
            name: "Взять в работу",
        }).click({ noWaitAfter: true });

        await dialogPromise;

        await expect
            .poll(() => statusRequest, { timeout: 10000 })
            .toEqual(
                expect.objectContaining({
                    body: { status: "in_review" },
                    headers: expect.objectContaining({
                        authorization: "Bearer admin-test-token",
                    }),
                })
            );

        await expect(page.locator(".dispute-card").nth(0)).toContainText("На рассмотрении");
    });

    test("не решает спор без текста решения", async ({ page }) => {
        await openOrderDetailsPage(page);

        const dialogPromise = page.waitForEvent("dialog").then(async (dialog) => {
            expect(dialog.message()).toBe("Введите решение по спору");
            await dialog.accept();
        });

        await page.locator(".dispute-card").nth(1).getByRole("button", {
            name: "Решить спор",
        }).click({ noWaitAfter: true });

        await dialogPromise;
    });

    test("решает спор с текстом решения", async ({ page }) => {
        let resolveRequest = null;

        await openOrderDetailsPage(page, {
            onDisputeResolve: (data) => {
                resolveRequest = data;
            },
        });

        const disputeCard = page.locator(".dispute-card").nth(1);

        await disputeCard.locator(".dispute-resolution-textarea").fill(
            "Вернуть заказчику часть суммы"
        );

        const dialogPromise = page.waitForEvent("dialog").then(async (dialog) => {
            expect(dialog.message()).toBe("Спор решён");
            await dialog.accept();
        });

        await disputeCard.getByRole("button", {
            name: "Решить спор",
        }).click({ noWaitAfter: true });

        await dialogPromise;

        await expect
            .poll(() => resolveRequest, { timeout: 10000 })
            .toEqual(
                expect.objectContaining({
                    body: {
                        resolution: "Вернуть заказчику часть суммы",
                    },
                    headers: expect.objectContaining({
                        authorization: "Bearer admin-test-token",
                    }),
                })
            );

        await expect(disputeCard).toContainText("Решён");
        await expect(disputeCard).toContainText("Вернуть заказчику часть суммы");
    });

    test("отображает фото и доказательства", async ({ page }) => {
        await openOrderDetailsPage(page);

        await expect(page.getByRole("heading", {
            name: "Фото и доказательства",
        })).toBeVisible();

        await expect(page.locator(".photo-block")).toHaveCount(5);
        await expect(page.locator(".photo-link")).toHaveCount(4);

        await expect(page.locator(".order-photo").nth(0)).toHaveAttribute(
            "alt",
            "Фото заказчика при создании 1"
        );

        await expect(page.locator(".photo-block").nth(2)).toContainText("Фото нет");
    });

    test("формирует правильные href для фото", async ({ page }) => {
        await openOrderDetailsPage(page);

        await expect(page.locator(".photo-link").first()).toHaveAttribute(
            "href",
            /\/uploads\/orders\/777\/create-1\.jpg$/
        );

        await expect(page.locator(".order-photo").first()).toHaveAttribute(
            "src",
            /\/uploads\/orders\/777\/create-1\.jpg$/
        );
    });

    test("отображает историю действий", async ({ page }) => {
        await openOrderDetailsPage(page);

        await expect(page.getByRole("heading", {
            name: "История действий",
        })).toBeVisible();

        await expect(page.locator(".logs-list")).toBeVisible();
        await expect(page.locator(".log-item")).toHaveCount(2);

        await expect(page.locator(".log-item").nth(0)).toContainText("created");
        await expect(page.locator(".log-item").nth(0)).toContainText("creator #10");
        await expect(page.locator(".log-item").nth(0)).toContainText("OK");

        await expect(page.locator(".log-item").nth(1)).toContainText("delete_failed");
        await expect(page.locator(".log-item").nth(1)).toContainText("admin #1");
        await expect(page.locator(".log-item").nth(1)).toContainText("FAIL");
        await expect(page.locator(".log-item").nth(1)).toContainText("Причина: Тестовая причина");
    });

    test("отображает meta в логах", async ({ page }) => {
        await openOrderDetailsPage(page);

        const firstLog = page.locator(".log-item").first();

        await expect(firstLog.locator(".log-meta")).toBeVisible();
        await firstLog.locator("summary").click();

        await expect(firstLog.locator("pre")).toContainText("source");
        await expect(firstLog.locator("pre")).toContainText("test");
    });

    test("если логов нет, показывает пустое состояние", async ({ page }) => {
        await openOrderDetailsPage(page, {
            logsBody: {
                rows: [],
            },
        });

        await expect(page.getByText("Логов пока нет")).toBeVisible();
    });

    test("если загрузка логов упала, показывает ошибку логов", async ({ page }) => {
        await openOrderDetailsPage(page, {
            logsStatus: 500,
            logsBody: {
                message: "Логи недоступны",
            },
        });

        await expect(page.locator(".page-message.error")).toHaveText("Логи недоступны");
    });

    test("если загрузка заказа упала, показывает ошибку", async ({ page }) => {
        await openOrderDetailsPage(page, {
            orderStatus: 500,
            orderBody: {
                message: "Заказ не найден",
            },
        });

        await expect(page.getByRole("heading", {
            name: "Детали заказа",
        })).toBeVisible();

        await expect(page.locator(".page-message.error")).toHaveText("Заказ не найден");
    });

    test("показывает прочерки для пустых полей", async ({ page }) => {
        await openOrderDetailsPage(page, {
            orderBody: {
                id: 777,
                address: "",
                status: null,
                adminDeleted: false,
                creatorHidden: false,
                createdAt: null,
                creatorId: null,
                executorId: null,
                category: null,
                subcategory: null,
                proposedSum: null,
                paymentType: null,
                dealStatus: null,
                description: "",
                images: [],
                customerBeforePhotos: [],
                customerAfterPhotos: [],
                executorBeforePhotos: [],
                executorAfterPhotos: [],
                disputes: [],
            },
            logsBody: {
                rows: [],
            },
        });

        const mainCard = page.locator(".order-card").first();

        await expect(mainCard).toContainText("—");
        await expect(mainCard).toContainText("Не указано");
        await expect(page.getByText("Фото нет").first()).toBeVisible();
        await expect(page.getByText("По этому заказу споров нет")).toBeVisible();
    });
});