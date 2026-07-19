import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3000";

const viewer = {
    id: 2,
    username: "Артем",
    role: "executor",
    debt: 0,
    locationLat: 44.9521,
    locationLng: 34.1024,
    locationAddress: "Симферополь, улица Пушкина, 1",
    preferredCategoryIds: [1],
};

const creator = {
    id: 1,
    username: "Иван",
    rating: 4.7,
    complaintsCount: 2,
};

const categories = [
    { id: 1, name: "Грузы" },
    { id: 2, name: "Ремонт" },
    { id: 3, name: "Такси" },
    { id: 4, name: "Курьер" },
];

const subcategories = [
    { id: 10, name: "Мебель", categoryId: 1 },
    { id: 11, name: "Вывоз мусора", categoryId: 1 },
];

const regularOrders = [
    {
        id: 101,
        type: "Доставка",
        description: "Привезти груз",
        address: "Симферополь, улица Ленина, 5",
        paymentType: "cash",
        proposedSum: 500,
        creatorId: 1,
        executorId: null,
        images: ["/uploads/orders/101/photo1.jpg", "/uploads/orders/101/photo2.jpg"],
        categoryId: 1,
        subcategoryId: 10,
        category: { id: 1, name: "Грузы" },
        subcategory: { id: 10, name: "Мебель" },
        service: { name: "Перевозка" },
        coordinates: "44.9530,34.1030",
        createdAt: "2026-07-01T10:00:00.000Z",
        status: "pending",
        is_recommended: true,
        is_highlighted: true,
        taxi_courier: false,
    },
    {
        id: 102,
        type: "Ремонт",
        description: "Починить розетку",
        address: "Симферополь, Киевская 10",
        paymentType: "guarantee",
        proposedSum: 1500,
        creatorId: 1,
        executorId: null,
        images: [],
        categoryId: 2,
        subcategoryId: 20,
        category: { id: 2, name: "Ремонт" },
        subcategory: { id: 20, name: "Электрика" },
        service: null,
        coordinates: "44.9540,34.1040",
        createdAt: "2026-07-02T10:00:00.000Z",
        status: "pending",
        is_recommended: false,
        is_highlighted: false,
        taxi_courier: false,
    },
    {
        id: 103,
        type: "Далеко",
        description: "Дальний заказ не должен попадать в радиус",
        address: "Москва",
        paymentType: "cash",
        proposedSum: 9999,
        creatorId: 1,
        executorId: null,
        images: [],
        categoryId: 1,
        subcategoryId: 10,
        category: { id: 1, name: "Грузы" },
        subcategory: { id: 10, name: "Мебель" },
        service: null,
        coordinates: "55.7558,37.6176",
        createdAt: "2026-07-03T10:00:00.000Z",
        status: "pending",
        is_recommended: false,
        is_highlighted: false,
        taxi_courier: false,
    },
    {
        id: 104,
        type: "Свой заказ",
        description: "Это мой заказ",
        address: "Симферополь, рядом",
        paymentType: "cash",
        proposedSum: 1000,
        creatorId: 2,
        executorId: null,
        images: [],
        categoryId: 1,
        subcategoryId: 10,
        category: { id: 1, name: "Грузы" },
        subcategory: { id: 10, name: "Мебель" },
        service: null,
        coordinates: "44.9535,34.1035",
        createdAt: "2026-07-04T10:00:00.000Z",
        status: "pending",
        is_recommended: false,
        is_highlighted: false,
        taxi_courier: false,
    },
];

const expressOrders = [
    {
        id: 201,
        type: "taxi",
        status: "created",
        creatorId: 1,
        executorId: null,
        createdAt: "2026-07-05T10:00:00.000Z",
        totalPrice: 700,
        paymentType: "cash",
        fromAddress: "Симферополь, улица Пушкина, 1",
        toAddress: "Симферополь, проспект Кирова, 10",
        fromLat: 44.9525,
        fromLng: 34.1028,
        toLat: 44.9489,
        toLng: 34.0987,
        description: "Нужно такси",
        subcategory: null,
    },
    {
        id: 202,
        type: "courier",
        status: "created",
        creatorId: 1,
        executorId: null,
        createdAt: "2026-07-06T10:00:00.000Z",
        totalPrice: 500,
        paymentType: "cash",
        fromAddress: "Симферополь, центр",
        toAddress: "Симферополь, вокзал",
        fromLat: 44.9526,
        fromLng: 34.1029,
        toLat: 44.9500,
        toLng: 34.1000,
        description: "Доставить документы",
        subcategory: "Документы",
    },
];

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

async function setFakeAuth(page, user = viewer) {
    const fakeToken = createFakeJwt({
        id: user.id,
        role: user.role || "executor",
        name: user.username,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
    });

    await page.addInitScript(({ token, user }) => {
        localStorage.setItem("authToken", token);
        localStorage.setItem("user", JSON.stringify(user));
        localStorage.setItem("currentUser", JSON.stringify(user));
        localStorage.setItem("userData", JSON.stringify(user));
    }, {
        token: fakeToken,
        user,
    });
}

async function setupOrdersMocks(page, options = {}) {
    const {
        profileBody = viewer,
        profileStatus = 200,
        orders = regularOrders,
        express = expressOrders,
        categoriesBody = categories,
        subcategoriesBody = subcategories,
        activeRegular = [],
        activeExpress = [],
        statusDebt = 0,
        requestPostStatus = 200,
        requestPostBody = { success: true },
        acceptStatus = 200,
        acceptBody = { success: true },
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

    await page.route("**/api/auth/profile", async (route) => {
        await route.fulfill({
            status: profileStatus,
            contentType: "application/json",
            body: JSON.stringify(profileBody),
        });
    });

    await page.route("**/api/orders/all", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(orders),
        });
    });

    await page.route("**/api/express/express-orders/available", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                success: true,
                orders: express,
            }),
        });
    });

    await page.route("**/api/category", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(categoriesBody),
        });
    });

    await page.route("**/api/category/subcategory/*", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(subcategoriesBody),
        });
    });

    await page.route("**/api/auth/1", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(creator),
        });
    });

    await page.route("**/api/auth/2", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                ...viewer,
                username: "Артем",
            }),
        });
    });

    await page.route("**/api/orders/active-orders", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                orders: activeRegular,
            }),
        });
    });

    await page.route("**/api/express/express-orders/me?mode=active", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                orders: activeExpress,
            }),
        });
    });

    await page.route("**/api/orders/me/status", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                debt: statusDebt,
            }),
        });
    });

    await page.route("**/api/orders/101/request", async (route) => {
        await route.fulfill({
            status: requestPostStatus,
            contentType: "application/json",
            body: JSON.stringify(requestPostBody),
        });
    });

    await page.route("**/api/express/express-orders/201/accept", async (route) => {
        await route.fulfill({
            status: acceptStatus,
            contentType: "application/json",
            body: JSON.stringify(acceptBody),
        });
    });

    await page.route("**/api/payments/status**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                status: "succeeded",
            }),
        });
    });

    await page.route("https://geocode-maps.yandex.ru/1.x/**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                response: {
                    GeoObjectCollection: {
                        featureMember: [
                            {
                                GeoObject: {
                                    metaDataProperty: {
                                        GeocoderMetaData: {
                                            text: "Россия, Республика Крым, Симферополь, улица Пушкина, 1",
                                        },
                                    },
                                    name: "Симферополь, улица Пушкина, 1",
                                    Point: {
                                        pos: "34.1024 44.9521",
                                    },
                                },
                            },
                        ],
                    },
                },
            }),
        });
    });
}

async function openOrdersPage(page, options = {}) {
    await setFakeAuth(page, options.profileBody || viewer);
    await setupOrdersMocks(page, options);

    const query = options.query || "platform=web";

    await page.goto(`${FRONT_URL}/orders?${query}`, {

        waitUntil: "domcontentloaded",

        timeout: 30000,

    });

    if (options.waitForPage === false) return;

    await expect(page.locator(".orders-title")).toHaveText("Все заказы", {
        timeout: 15000,
    });
}

function orderCard(page, text) {
    return page.locator(".order-card").filter({
        hasText: text,
    });
}

async function openFilters(page) {
    await page.getByRole("button", { name: /Фильтры/i }).click();

    await expect(page.locator(".drawer")).toBeVisible({
        timeout: 10000,
    });
}

async function openRequestModal(page, cardText = "Заказ №101") {
    const card = orderCard(page, cardText);

    await card.getByRole("button", { name: "Запросить выполнение" }).click();

    await expect(page.locator(".request-order-content")).toBeVisible({
        timeout: 10000,
    });
}

async function clickByDom(page, selector, textIncludes) {
    await page.evaluate(({ selector, textIncludes }) => {
        const items = Array.from(document.querySelectorAll(selector));
        const element = textIncludes
            ? items.find((item) => item.textContent?.includes(textIncludes))
            : items[0];

        if (!element) {
            throw new Error(`Элемент не найден: ${selector} ${textIncludes || ""}`);
        }

        element.click();
    }, {
        selector,
        textIncludes,
    });
}

test.describe("OrdersPage", () => {
    test.beforeEach(async ({ page }) => {
        await openOrdersPage(page);
    });

    test("отображает страницу всех заказов", async ({ page }) => {
        await expect(page.locator(".orders-page")).toBeVisible();
        await expect(page.locator(".orders-title")).toHaveText("Все заказы");

        await expect(page.locator(".orders-subtitle")).toContainText("Радиус:");
        await expect(page.locator(".orders-subtitle")).toContainText("50 км");
        await expect(page.locator(".orders-subtitle")).toContainText("Найдено:");

        await expect(page.getByRole("button", { name: /Карта/i })).toBeVisible();
        await expect(page.getByRole("button", { name: /Фильтры/i })).toBeVisible();
    });

    test("ставит web-класс при platform=web", async ({ page }) => {
        await openOrdersPage(page, {
            query: "platform=web",
        });

        await expect(page.locator(".orders-page")).toHaveClass(/orders-page--web/);
    });

    test("ставит ios-класс при platform=ios", async ({ page }) => {
        await openOrdersPage(page, {
            query: "platform=ios",
        });

        await expect(page.locator(".orders-page")).toHaveClass(/orders-page--ios/);
    });

    test("ставит android-класс при platform=android", async ({ page }) => {
        await openOrdersPage(page, {
            query: "platform=android",
        });

        await expect(page.locator(".orders-page")).toHaveClass(/orders-page--android/);
    });

    test("показывает обычные заказы в радиусе", async ({ page }) => {
        const card = orderCard(page, "Заказ №101");

        await expect(card).toBeVisible();
        await expect(card).toContainText("Привезти груз");
        await expect(card).toContainText("Симферополь, улица Ленина, 5");
        await expect(card).toContainText("Грузы • Мебель • Перевозка");
        await expect(card.locator(".pay-price")).toHaveText("500 ₽");

        await expect(page.getByText("Заказ №103")).not.toBeVisible();
        await expect(page.getByText("Дальний заказ не должен попадать в радиус")).not.toBeVisible();
    });

    test("показывает express-заказы как обычные карточки", async ({ page }) => {
        const taxiCard = orderCard(page, "Экспресс №201");
        const courierCard = orderCard(page, "Экспресс №202");

        await expect(taxiCard).toBeVisible();
        await expect(taxiCard).toContainText("Нужно такси");
        await expect(taxiCard).toContainText("Такси");
        await expect(taxiCard.locator(".pay-price")).toHaveText("700 ₽");

        await expect(courierCard).toBeVisible();
        await expect(courierCard).toContainText("Доставить документы");
        await expect(courierCard).toContainText("Курьер");
    });

    test("показывает расстояние до заказов", async ({ page }) => {
        const card = orderCard(page, "Заказ №101");

        await expect(card.locator(".badge-distance")).toContainText("км");
    });

    test("подсвечивает рекомендованный и выделенный заказ", async ({ page }) => {
        const card = orderCard(page, "Заказ №101");

        await expect(card).toHaveClass(/recommended/);
        await expect(card).toHaveClass(/highlighted/);
        await expect(card).toContainText("В приоритете");
    });

    test("свой заказ показывает с бейджем Мой заказ и без кнопки запроса", async ({ page }) => {
        const card = orderCard(page, "Заказ №104");

        await expect(card).toContainText("Мой заказ");
        await expect(card.getByRole("button", { name: "Запросить выполнение" })).not.toBeVisible();
    });

    test("чужой обычный pending заказ можно запросить", async ({ page }) => {
        const card = orderCard(page, "Заказ №101");

        await expect(card).toHaveClass(/can-take/);
        await expect(card).toContainText("Можно взять");
        await expect(card.getByRole("button", { name: "Запросить выполнение" })).toBeVisible();
    });

    test("переходит в детальную страницу обычного заказа", async ({ page }) => {
        const card = orderCard(page, "Заказ №101");

        await card.getByRole("button", { name: "Открыть" }).click();

        await expect(page).toHaveURL(/\/order\/101/);
    });

    test("переходит в детальную страницу express-заказа", async ({ page }) => {
        const card = orderCard(page, "Экспресс №201");

        await card.getByRole("button", { name: "Открыть" }).click();

        await expect(page).toHaveURL(/\/express-order\/201/);
    });

    test("переходит на страницу жалоб", async ({ page }) => {
        const card = orderCard(page, "Заказ №101");

        const link = card.getByRole("link", {
            name: /Жалобы/i,
        });

        await expect(link).toHaveAttribute("href", "/complaints/1");

        await link.click();

        await expect(page).toHaveURL(/\/complaints\/1/);
    });

    test("переключает вкладку В приоритете", async ({ page }) => {
        await page.getByRole("button", { name: "В приоритете" }).click();

        await expect(page.getByRole("button", { name: "В приоритете" })).toHaveClass(/active/);

        await expect(page.getByText("Заказ №101")).toBeVisible();
        await expect(page.getByText("Заказ №102")).not.toBeVisible();
        await expect(page.getByText("Экспресс №201")).not.toBeVisible();
    });

    test("переключает вкладку Курьер / Такси", async ({ page }) => {
        await page.getByRole("button", { name: "Курьер / Такси" }).click();

        await expect(page.getByRole("button", { name: "Курьер / Такси" })).toHaveClass(/active/);

        await expect(page.getByText("Экспресс №201")).toBeVisible();
        await expect(page.getByText("Экспресс №202")).toBeVisible();
        await expect(page.getByText("Заказ №101")).not.toBeVisible();
    });

    test("открывает и закрывает drawer фильтров", async ({ page }) => {
        await openFilters(page);

        await expect(page.locator(".drawer-title")).toHaveText("Фильтры");
        await expect(page.locator(".drawer-sub")).toContainText("Профессии");

        await page.getByRole("button", { name: "Закрыть" }).click();

        await expect(page.locator(".drawer")).not.toBeVisible();
    });

    test("показывает профессии из профиля в фильтрах", async ({ page }) => {
        await openFilters(page);

        await expect(page.locator(".drawer-section-professions")).toContainText("Профессии из профиля");
        await expect(page.locator(".drawer-section-professions")).toContainText("Грузы");
        await expect(page.locator(".drawer-status-pill")).toContainText("Включено");
    });

    test("скрывает Такси и Курьер из select категорий", async ({ page }) => {
        await openFilters(page);

        const categorySelect = page.locator(".drawer select").first();

        await expect(categorySelect).toContainText("Грузы");
        await expect(categorySelect).toContainText("Ремонт");
        await expect(categorySelect).not.toContainText("Такси");
        await expect(categorySelect).not.toContainText("Курьер");
    });

    test("фильтрует по категории и подкатегории", async ({ page }) => {
        await openFilters(page);

        const selects = page.locator(".drawer select");

        await selects.first().selectOption("1");

        await expect(selects.nth(1)).toBeEnabled({
            timeout: 10000,
        });

        await selects.nth(1).selectOption("10");

        await page.locator(".drawer-foot").getByRole("button", { name: /Показать/i }).click();

        await expect(page.getByText("Заказ №101")).toBeVisible();
        await expect(page.getByText("Заказ №102")).not.toBeVisible();
    });

    test("кнопка Сбросить очищает фильтры", async ({ page }) => {
        await openFilters(page);

        const selects = page.locator(".drawer select");

        await selects.first().selectOption("1");
        await expect(selects.nth(1)).toBeEnabled();

        await page.evaluate(() => {
            const buttons = Array.from(
                document.querySelectorAll(".drawer-foot button")
            );

            const resetButton = buttons.find(
                (button) => button.textContent?.trim() === "Сбросить"
            );

            if (!resetButton) {
                throw new Error("Кнопка Сбросить в drawer-foot не найдена");
            }

            resetButton.click();
        });

        await expect(selects.first()).toHaveValue("");
        await expect(selects.nth(1)).toHaveValue("");
    });

    test("сброс профессий временно отключает фильтр по профессиям", async ({ page }) => {
        await openFilters(page);

        await page.getByRole("button", { name: "Сбросить профессии" }).click();

        await expect(page.locator(".drawer-status-pill")).toContainText("Отключено");
        await expect(page.locator(".orders-subtitle")).toContainText("все категории");
    });

    test("Показать всё сбрасывает вкладку и фильтры", async ({ page }) => {
        await page.getByRole("button", { name: "В приоритете" }).click();

        await openFilters(page);

        await page.getByRole("button", { name: "Показать всё" }).click();

        await expect(page.getByRole("button", { name: "Все" })).toHaveClass(/active/);
        await expect(page.locator(".orders-subtitle")).toContainText("все категории");
    });

    test("открывает модалку запроса выполнения", async ({ page }) => {
        await openRequestModal(page);

        await expect(page.locator(".request-order-title")).toHaveText("Запросить выполнение");
        await expect(page.getByPlaceholder("Например: 2500")).toBeVisible();
        await expect(page.getByPlaceholder("Например: могу приехать сегодня после 18:00")).toBeVisible();

        await page.getByRole("button", { name: "Отмена" }).click();

        await expect(page.locator(".request-order-content")).not.toBeVisible();
    });

    test("в поле суммы заявки пропускает только цифры", async ({ page }) => {
        await openRequestModal(page);

        const input = page.getByPlaceholder("Например: 2500");

        await input.fill("25abc00");

        await expect(input).toHaveValue("2500");
    });

    test("кнопка отправки заявки отключена без суммы", async ({ page }) => {
        await openRequestModal(page);

        await expect(page.getByRole("button", { name: "Отправить запрос" })).toBeDisabled();
    });

    test("успешно отправляет заявку на обычный заказ", async ({ page }) => {
        let statusCalled = false;
        let requestBody = null;

        await page.route("**/api/orders/me/status", async (route) => {
            statusCalled = true;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    debt: 0,
                }),
            });
        });

        await page.route("**/api/orders/101/request", async (route) => {
            requestBody = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                }),
            });
        });

        await openRequestModal(page);

        await page.getByPlaceholder("Например: 2500").fill("2500");
        await page
            .getByPlaceholder("Например: могу приехать сегодня после 18:00")
            .fill("Могу приехать сегодня");

        await page.getByRole("button", { name: "Отправить запрос" }).click();

        await expect
            .poll(() => statusCalled, {
                timeout: 10000,
            })
            .toBe(true);

        await expect
            .poll(() => requestBody, {
                timeout: 10000,
            })
            .toEqual({
                proposedSum: 2500,
                comment: "Могу приехать сегодня",
            });

        await expect(page.locator(".request-order-content")).not.toBeVisible();
    });

    test("при ошибке отправки заявки модалка остаётся открытой", async ({ page }) => {
        await page.route("**/api/orders/101/request", async (route) => {
            await route.fulfill({
                status: 400,
                contentType: "application/json",
                body: JSON.stringify({
                    message: "Нельзя отправить запрос",
                }),
            });
        });

        await openRequestModal(page);

        await page.getByPlaceholder("Например: 2500").fill("2500");

        await page.getByRole("button", { name: "Отправить запрос" }).click();

        await expect(page.locator(".request-order-content")).toBeVisible({
            timeout: 10000,
        });
    });

    test("если нет токена, при заявке уводит на login", async ({ page }) => {
        await page.evaluate(() => {
            localStorage.removeItem("authToken");
        });

        const card = orderCard(page, "Заказ №101");

        await card.getByRole("button", { name: "Запросить выполнение" }).click();

        await expect(page).toHaveURL(/\/login/);
    });

    test("блокирует заявки, если есть активный обычный заказ", async ({ page }) => {
        await openOrdersPage(page, {
            activeRegular: [
                {
                    id: 777,
                    executorId: 2,
                    status: "active",
                },
            ],
        });

        const card = orderCard(page, "Заказ №101");

        await expect(card.getByRole("button", { name: "Запросить выполнение" })).toBeDisabled();
        await expect(card.locator(".blocked-order-hint")).toContainText(
            "У вас уже есть активный обычный заказ"
        );
    });

    test("принимает express-заказ после confirm", async ({ page }) => {
        let acceptCalled = false;

        await page.route("**/api/express/express-orders/201/accept", async (route) => {
            acceptCalled = true;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                }),
            });
        });

        const card = orderCard(page, "Экспресс №201");

        page.once("dialog", async (dialog) => {
            expect(dialog.message()).toContain("экспресс-заказ №201");
            await dialog.accept();
        });

        await card.getByRole("button", { name: "Принять" }).click();

        await expect
            .poll(() => acceptCalled, {
                timeout: 10000,
            })
            .toBe(true);

        await expect(page).toHaveURL(/\/active-orders/);
    });

    test("не принимает express-заказ при отмене confirm", async ({ page }) => {
        let acceptCalled = false;

        await page.route("**/api/express/express-orders/201/accept", async (route) => {
            acceptCalled = true;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                }),
            });
        });

        const card = orderCard(page, "Экспресс №201");

        page.once("dialog", async (dialog) => {
            await dialog.dismiss();
        });

        await card.getByRole("button", { name: "Принять" }).click();

        expect(acceptCalled).toBe(false);
        await expect(page).not.toHaveURL(/\/active-orders/);
    });

    test("открывает модалку изображения и переключает фото", async ({ page }) => {
        const card = orderCard(page, "Заказ №101");

        await card.locator(".thumb").first().click();

        const modalImage = page.locator(".img-full");

        await expect(modalImage).toBeVisible();
        await expect(modalImage).toHaveAttribute("src", /photo1\.jpg/);

        await clickByDom(page, ".img-nav.right");

        await expect(modalImage).toHaveAttribute("src", /photo2\.jpg/);

        await clickByDom(page, ".img-nav.left");

        await expect(modalImage).toHaveAttribute("src", /photo1\.jpg/);

        await clickByDom(page, ".img-close");

        await expect(modalImage).not.toBeVisible();
    });

    test("если нет координат пользователя, показывает пустое состояние местоположения", async ({ page }) => {
        await openOrdersPage(page, {
            profileBody: {
                ...viewer,
                locationLat: null,
                locationLng: null,
                locationAddress: "",
            },
        });

        await expect(page.locator(".empty-title")).toHaveText("Нужно местоположение");
        await expect(page.getByPlaceholder("Введите адрес")).toBeVisible();
    });

    test("ручной адрес геокодится и сохраняется в профиль", async ({ page }) => {
        let saveLocationBody = null;

        await openOrdersPage(page, {
            profileBody: {
                ...viewer,
                locationLat: null,
                locationLng: null,
                locationAddress: "",
            },
        });

        await page.route("**/api/auth/location/me", async (route) => {
            saveLocationBody = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    location: {
                        locationAddress: saveLocationBody.address,
                        locationLat: saveLocationBody.lat,
                        locationLng: saveLocationBody.lng,
                    },
                }),
            });
        });

        await page.getByPlaceholder("Введите адрес").fill("Симферополь Пушкина 1");

        await page.getByRole("button", { name: "Применить" }).click();

        await expect
            .poll(() => saveLocationBody, {
                timeout: 10000,
            })
            .toEqual({
                address: "Симферополь Пушкина 1",
                lat: 44.9521,
                lng: 34.1024,
                source: "manual",
            });
    });

    test("открывает меню местоположения и подтягивает адрес из профиля", async ({ page }) => {
        await page.getByLabel("Местоположение").click();

        await expect(page.locator(".loc-menu-panel")).toBeVisible();

        await page.getByRole("button", { name: "Из профиля" }).click();

        await expect(page.locator(".orders-location-text")).toContainText(
            "Симферополь, улица Пушкина, 1"
        );
    });

    test("открывает карту заказов", async ({ page }) => {
        await page.getByRole("button", { name: /Карта/i }).click();

        await expect(page.locator("body")).toContainText(/Карта|Выбрать|Закрыть|Местоположение/i, {
            timeout: 10000,
        });

        await expect(page.locator(".orders-title")).toHaveText("Все заказы");
    });

    test("показывает пустое состояние, если доступных заказов нет", async ({ page }) => {
        await openOrdersPage(page, {
            orders: [],
            express: [],
        });

        await expect(page.locator(".empty-title")).toHaveText("Нет доступных заказов");
        await expect(page.locator(".empty-sub")).toContainText("В радиусе 50 км");
    });

    test("promoReturn чистит URL после проверки платежа", async ({ page }) => {
        await openOrdersPage(page, {
            query: "platform=web&promoReturn=1&paymentId=pay_123",
        });

        await expect
            .poll(() => page.url(), {
                timeout: 10000,
            })
            .not.toContain("promoReturn=1");

        expect(page.url()).not.toContain("paymentId=pay_123");
    });

    test("pull-to-refresh повторно загружает данные и вызывает done", async ({ page }) => {
        let ordersCalls = 0;
        let expressCalls = 0;

        await setFakeAuth(page);
        await setupOrdersMocks(page);

        await page.route("**/api/orders/all", async (route) => {
            ordersCalls += 1;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(regularOrders),
            });
        });

        await page.route("**/api/express/express-orders/available", async (route) => {
            expressCalls += 1;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                    orders: expressOrders,
                }),
            });
        });

        await page.goto(`${FRONT_URL}/orders?platform=web`, {

            waitUntil: "domcontentloaded",

            timeout: 30000,

        });

        await expect(page.locator(".orders-title")).toHaveText("Все заказы", {
            timeout: 15000,
        });

        await expect
            .poll(() => ordersCalls, {
                timeout: 10000,
            })
            .toBeGreaterThanOrEqual(1);

        await expect
            .poll(() => expressCalls, {
                timeout: 10000,
            })
            .toBeGreaterThanOrEqual(1);

        await page.waitForTimeout(300);

        await page.evaluate(() => {
            window.__pullDone = false;

            window.dispatchEvent(
                new CustomEvent("appPullToRefresh", {
                    detail: {
                        done: () => {
                            window.__pullDone = true;
                        },
                    },
                })
            );
        });

        await expect
            .poll(() => ordersCalls, {
                timeout: 10000,
            })
            .toBeGreaterThanOrEqual(2);

        await expect
            .poll(() => expressCalls, {
                timeout: 10000,
            })
            .toBeGreaterThanOrEqual(2);

        await expect
            .poll(async () => {
                return await page.evaluate(() => window.__pullDone === true);
            }, {
                timeout: 10000,
            })
            .toBe(true);
    });
});