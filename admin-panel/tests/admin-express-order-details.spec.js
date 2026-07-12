import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3001";

// Если route в App.js другой — поменяй только это:
const DETAILS_PATH = "/express-orders/201";

const expressOrder = {
    id: 201,
    type: "taxi",
    status: "accepted",
    createdAt: "2026-07-01T10:00:00.000Z",

    creatorId: 10,
    executorId: 20,

    subcategory: "Перевозка пассажиров",
    totalPrice: 700,
    paymentType: "cash",
    dealStatus: "active",

    basePrice: 150,
    pricePerKm: 20,
    distanceKm: 5.4,
    estimatedTimeMin: 15,

    fromAddress: "Симферополь, улица Пушкина, 1",
    fromLat: 44.9521,
    fromLng: 34.1024,

    toAddress: "Симферополь, проспект Кирова, 10",
    toLat: 44.9489,
    toLng: 34.0987,

    description: "Тестовая поездка",

    arrivedAt: "2026-07-01T10:10:00.000Z",
    startedAt: "2026-07-01T10:15:00.000Z",
    completedAt: null,
};

const logsRows = [
    {
        id: 1,
        ts: "2026-07-01T10:00:00.000Z",
        actionType: "created",
        actorRole: "admin",
        actorUserId: 1,
        success: true,
        severity: "info",
        reason: "",
        meta: {
            source: "admin-panel",
        },
    },
    {
        id: 2,
        ts: "2026-07-01T10:05:00.000Z",
        actionType: "accepted",
        actorRole: "executor",
        actorUserId: 20,
        success: false,
        severity: "warning",
        reason: "Тестовая ошибка",
        meta: {
            status: "accepted",
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

        // ВАЖНО: именно это проверяет PrivateRoute в admin-panel
        localStorage.setItem("userRole", "admin");

        localStorage.setItem("user", JSON.stringify(adminUser));
        localStorage.setItem("adminUser", JSON.stringify(adminUser));
        localStorage.setItem("currentUser", JSON.stringify(adminUser));
    });
}

async function setupMocks(page, options = {}) {
    const {
        orderStatus = 200,
        orderBody = expressOrder,
        logsStatus = 200,
        logsBody = {
            rows: logsRows,
        },
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

    await page.route("**/api/admin/express-orders/201", async (route) => {
        await route.fulfill({
            status: orderStatus,
            contentType: "application/json",
            body: JSON.stringify(orderBody),
        });
    });

    await page.route("**/api/admin/express-orders/201/logs", async (route) => {
        await route.fulfill({
            status: logsStatus,
            contentType: "application/json",
            body: JSON.stringify(logsBody),
        });
    });
}

async function openDetailsPage(page, options = {}) {
    await setAdminAuth(page);
    await setupMocks(page, options);

    await page.goto(`${FRONT_URL}${DETAILS_PATH}`);
    await page.waitForLoadState("domcontentloaded");

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "admin-express-details-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("AdminExpressOrderDetailsPage редиректит на /login. Проверь PrivateRoute.");
    }

    if (!(await page.locator(".express-details-container").count())) {
        await page.screenshot({
            path: "admin-express-details-wrong-route.png",
            fullPage: true,
        });

        throw new Error(
            `AdminExpressOrderDetailsPage не найдена. Текущий URL: ${page.url()}. Проверь DETAILS_PATH в тесте.`
        );
    }

    await expect(page.locator(".express-details-container")).toBeVisible({
        timeout: 15000,
    });
}

test.describe("AdminExpressOrderDetailsPage", () => {
    test("отображает детали express-заказа", async ({ page }) => {
        await openDetailsPage(page);

        await expect(page.getByRole("heading", {
            name: "Детали экспресс-заказа #201",
        })).toBeVisible();

        await expect(page.getByRole("heading", {
            name: "Основная информация",
        })).toBeVisible();

        await expect(page.locator(".express-card").first()).toContainText("Тип");
        await expect(page.locator(".express-card").first()).toContainText("Такси");

        await expect(page.locator(".express-card").first()).toContainText("Статус");
        await expect(page.locator(".status-badge")).toHaveText("accepted");
        await expect(page.locator(".status-badge")).toHaveClass(/active/);

        await expect(page.locator(".express-card").first()).toContainText("Заказчик ID");
        await expect(page.locator(".express-card").first()).toContainText("10");

        await expect(page.locator(".express-card").first()).toContainText("Исполнитель ID");
        await expect(page.locator(".express-card").first()).toContainText("20");

        await expect(page.locator(".express-card").first()).toContainText("Перевозка пассажиров");
        await expect(page.locator(".express-card").first()).toContainText("700 ₽");
        await expect(page.locator(".express-card").first()).toContainText("Наличные");
        await expect(page.locator(".express-card").first()).toContainText("active");
    });

    test("отображает маршрут и координаты", async ({ page }) => {
        await openDetailsPage(page);

        await expect(page.locator(".route-box")).toBeVisible();

        await expect(page.locator(".route-box")).toContainText("A");
        await expect(page.locator(".route-box")).toContainText("Симферополь, улица Пушкина, 1");

        await expect(page.locator(".route-box")).toContainText("B");
        await expect(page.locator(".route-box")).toContainText("Симферополь, проспект Кирова, 10");

        await expect(page.locator(".express-card").first()).toContainText("Координаты точки A");
        await expect(page.locator(".express-card").first()).toContainText("44.9521, 34.1024");

        await expect(page.locator(".express-card").first()).toContainText("Координаты точки B");
        await expect(page.locator(".express-card").first()).toContainText("44.9489, 34.0987");
    });

    test("отображает цены, расстояние и время", async ({ page }) => {
        await openDetailsPage(page);

        const mainCard = page.locator(".express-card").first();

        await expect(mainCard).toContainText("Базовая цена");
        await expect(mainCard).toContainText("150 ₽");

        await expect(mainCard).toContainText("Цена за км");
        await expect(mainCard).toContainText("20 ₽");

        await expect(mainCard).toContainText("Расстояние");
        await expect(mainCard).toContainText("5.4 км");

        await expect(mainCard).toContainText("Оценка времени");
        await expect(mainCard).toContainText("15 мин");
    });

    test("отображает courier и guarantee labels", async ({ page }) => {
        await openDetailsPage(page, {
            orderBody: {
                ...expressOrder,
                type: "courier",
                paymentType: "guarantee",
                status: "completed",
            },
        });

        const mainCard = page.locator(".express-card").first();

        await expect(mainCard).toContainText("Курьер");
        await expect(mainCard).toContainText("Гарантия");

        await expect(page.locator(".status-badge")).toHaveText("completed");
        await expect(page.locator(".status-badge")).toHaveClass(/completed/);
    });

    test("для cancelled показывает cancelled class", async ({ page }) => {
        await openDetailsPage(page, {
            orderBody: {
                ...expressOrder,
                status: "cancelled",
            },
        });

        await expect(page.locator(".status-badge")).toHaveText("cancelled");
        await expect(page.locator(".status-badge")).toHaveClass(/cancelled/);
    });

    test("показывает прочерки для пустых значений", async ({ page }) => {
        await openDetailsPage(page, {
            orderBody: {
                id: 201,
                type: null,
                status: null,
                createdAt: null,
                creatorId: null,
                executorId: null,
                subcategory: null,
                totalPrice: null,
                paymentType: null,
                dealStatus: null,
                basePrice: null,
                pricePerKm: null,
                distanceKm: null,
                estimatedTimeMin: null,
                fromAddress: "",
                fromLat: null,
                fromLng: null,
                toAddress: "",
                toLat: null,
                toLng: null,
                description: "",
                arrivedAt: null,
                startedAt: null,
                completedAt: null,
            },
            logsBody: {
                rows: [],
            },
        });

        const mainCard = page.locator(".express-card").first();

        await expect(mainCard).toContainText("—");
        await expect(page.locator(".route-box")).toContainText("—");
    });

    test("отображает историю действий", async ({ page }) => {
        await openDetailsPage(page);

        await expect(page.getByRole("heading", {
            name: "История действий",
        })).toBeVisible();

        await expect(page.locator(".logs-list")).toBeVisible();
        await expect(page.locator(".log-item")).toHaveCount(2);

        const firstLog = page.locator(".log-item").first();

        await expect(firstLog).toContainText("created");
        await expect(firstLog).toContainText("admin #1");
        await expect(firstLog).toContainText("OK");
        await expect(firstLog.locator(".log-status")).toHaveClass(/ok/);

        const secondLog = page.locator(".log-item").nth(1);

        await expect(secondLog).toContainText("accepted");
        await expect(secondLog).toContainText("executor #20");
        await expect(secondLog).toContainText("FAIL");
        await expect(secondLog.locator(".log-status")).toHaveClass(/fail/);
        await expect(secondLog).toContainText("Причина: Тестовая ошибка");
    });

    test("отображает meta в details", async ({ page }) => {
        await openDetailsPage(page);

        const firstLog = page.locator(".log-item").first();

        await expect(firstLog.locator(".log-meta")).toBeVisible();
        await expect(firstLog.locator("summary")).toHaveText("meta");

        await firstLog.locator("summary").click();

        await expect(firstLog.locator("pre")).toContainText("source");
        await expect(firstLog.locator("pre")).toContainText("admin-panel");
    });

    test("если логов нет, показывает пустое состояние", async ({ page }) => {
        await openDetailsPage(page, {
            logsBody: {
                rows: [],
            },
        });

        await expect(page.locator(".logs-list")).not.toBeVisible();
        await expect(page.getByText("Логов пока нет")).toBeVisible();
    });

    test("если загрузка заказа упала, показывает ошибку", async ({ page }) => {
        await openDetailsPage(page, {
            orderStatus: 500,
            orderBody: {
                message: "Express-заказ не найден",
            },
        });

        await expect(page.getByRole("heading", {
            name: "Детали экспресс-заказа",
        })).toBeVisible();

        await expect(page.locator(".page-message.error")).toHaveText(
            "Express-заказ не найден"
        );
    });

    test("если загрузка логов упала, показывает ошибку логов", async ({ page }) => {
        await openDetailsPage(page, {
            logsStatus: 500,
            logsBody: {
                message: "Логи недоступны",
            },
        });

        await expect(page.getByRole("heading", {
            name: "Детали экспресс-заказа #201",
        })).toBeVisible();

        await expect(page.locator(".page-message.error")).toHaveText("Логи недоступны");
    });

    test("если нет токена, показывает ошибку авторизации", async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.clear();
        });

        await setupMocks(page);

        await page.goto(`${FRONT_URL}${DETAILS_PATH}`);
        await page.waitForLoadState("domcontentloaded");

        // Если route защищён PrivateRoute, он может редиректить на главную.
        // Тогда этот тест можно удалить.
        if (page.url() === `${FRONT_URL}/` || page.url().endsWith("/login")) {
            test.skip(true, "PrivateRoute не пускает без токена, внутренняя ошибка компонента недостижима");
        }

        await expect(page.locator(".page-message.error")).toHaveText(
            "Нет токена авторизации"
        );
    });

    test("кнопка Назад ведёт к /orders", async ({ page }) => {
        await openDetailsPage(page);

        await page.getByRole("button", {
            name: "Назад",
        }).click();

        await expect(page).toHaveURL(/\/orders/);
    });

    test("кнопка Удалить показывает alert", async ({ page }) => {
        await openDetailsPage(page);

        const dialogPromise = page.waitForEvent("dialog").then(async (dialog) => {
            expect(dialog.message()).toBe("Удаление express-заказа пока не подключено");
            await dialog.accept();
        });

        await page.getByRole("button", {
            name: "Удалить",
        }).click({
            noWaitAfter: true,
        });

        await dialogPromise;
    });
});