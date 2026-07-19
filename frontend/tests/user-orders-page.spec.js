import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3000";

const viewer = {
    id: 2,
    username: "Executor",
    role: "executor",
};

const creator = {
    id: 1,
    username: "Иван",
    rating: 4.5,
    complaintsCount: 2,
};

const orders = [
    {
        id: 1,
        creatorId: 1,
        createdAt: "2026-07-01T10:00:00.000Z",
        type: "Покраска забора",
        description: "Нужно покрасить забор в зелёный цвет",
        address: "ул. Примерная, д. 1",
        proposedSum: 5000,
        paymentType: "cash",
        images: ["/uploads/orders/1/photo1.jpg", "/uploads/orders/1/photo2.jpg"],
        executorId: null,
        status: "pending",
        category: { name: "Ремонт" },
        subcategory: { name: "Покраска" },
        service: { name: "Забор" },
        is_highlighted: true,
    },
    {
        id: 2,
        creatorId: 1,
        createdAt: "2026-07-02T10:00:00.000Z",
        type: "Перевозка",
        description: "Перевезти коробки",
        address: "ул. Вторая, д. 2",
        proposedSum: 2500,
        paymentType: "guarantee",
        images: [],
        executorId: 5,
        status: "active",
        category: { name: "Грузы" },
        subcategory: null,
        service: null,
        is_highlighted: false,
    },
    {
        id: 3,
        creatorId: 1,
        createdAt: "2026-07-03T10:00:00.000Z",
        type: "Карта",
        description: "Оплата картой",
        address: "ул. Третья, д. 3",
        proposedSum: 1000,
        paymentType: "installments",
        images: [],
        executorId: null,
        status: "pending",
        category: null,
        subcategory: null,
        service: null,
        is_highlighted: false,
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

async function setupUserOrdersMocks(page, options = {}) {
    const {
        profileBody = viewer,
        ordersBody = orders,
        ordersStatus = 200,
        creatorBody = creator,
        creatorStatus = 200,
        requestStatus = 200,
        requestBody = { success: true },
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
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(profileBody),
        });
    });

    await page.route("**/api/orders/creator/*", async (route) => {
        await route.fulfill({
            status: ordersStatus,
            contentType: "application/json",
            body: JSON.stringify(ordersBody),
        });
    });

    await page.route("**/api/auth/1", async (route) => {
        await route.fulfill({
            status: creatorStatus,
            contentType: "application/json",
            body: JSON.stringify(creatorBody),
        });
    });

    await page.route("**/api/orders/*/request", async (route) => {
        await route.fulfill({
            status: requestStatus,
            contentType: "application/json",
            body: JSON.stringify(requestBody),
        });
    });
}

async function openUserOrdersPage(page, options = {}) {
    await setFakeAuth(page, options.profileBody || viewer);
    await setupUserOrdersMocks(page, options);

    const userId = options.userId || 1;

    await page.goto(`${FRONT_URL}/user-orders/${userId}?platform=web`, {

        waitUntil: "domcontentloaded",

        timeout: 30000,

    });

    if (options.waitForPage === false) return;

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "user-orders-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("UserOrdersPage редиректит на /login. Fake JWT не применился или роут другой.");
    }

    await expect(page.locator(".all-orders")).toBeVisible({
        timeout: 15000,
    });

    await expect(page.getByText("Заказ №1")).toBeVisible({
        timeout: 15000,
    });
}

function orderCard(page, text) {
    return page.locator(".floatingCard").filter({
        hasText: text,
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

test.describe("UserOrdersPage", () => {
    test.beforeEach(async ({ page }) => {
        await openUserOrdersPage(page);
    });

    test("отображает страницу заказов пользователя", async ({ page }) => {
        await expect(page.locator(".all-orders")).toBeVisible();
        await expect(page.locator(".pageContainer")).toBeVisible();
        await expect(page.locator(".all-orders-page")).toBeVisible();

        await expect(page.getByText("Заказы, размещенные пользователем Executor (ID: 2)")).toBeVisible();
    });

    test("загружает и отображает список заказов", async ({ page }) => {
        await expect(page.locator(".orders-list")).toBeVisible();
        await expect(page.locator(".floatingCard")).toHaveCount(3);

        await expect(page.getByText("Заказ №1")).toBeVisible();
        await expect(page.getByText("Заказ №2")).toBeVisible();
        await expect(page.getByText("Заказ №3")).toBeVisible();
    });

    test("показывает данные первого заказа", async ({ page }) => {
        const card = orderCard(page, "Заказ №1");

        await expect(card).toBeVisible();
        await expect(card).toContainText("Нужно покрасить забор в зелёный цвет");
        await expect(card).toContainText("ул. Примерная, д. 1");
        await expect(card).toContainText("5000 ₽");
        await expect(card).toContainText("Ремонт");
        await expect(card).toContainText("Покраска");
        await expect(card).toContainText("Забор");
    });

    test("показывает данные заказчика", async ({ page }) => {
        const card = orderCard(page, "Заказ №1");

        await expect(card).toContainText("ID заказчика: 1");
        await expect(card).toContainText("Имя заказчика: Иван");
        await expect(card).toContainText("Рейтинг заказчика: 4.5");
    });

    test("показывает ссылку на жалобы заказчика", async ({ page }) => {
        const card = orderCard(page, "Заказ №1");

        const link = card.getByRole("link", {
            name: /Жалобы/i,
        });

        await expect(link).toHaveAttribute("href", "/complaints/1");
        await expect(link).toContainText("2");
    });

    test("переходит на страницу жалоб", async ({ page }) => {
        const card = orderCard(page, "Заказ №1");

        await card.getByRole("link", { name: /Жалобы/i }).click();

        await expect(page).toHaveURL(/\/complaints\/1/);
    });

    test("подсвечивает highlighted заказ", async ({ page }) => {
        const card = orderCard(page, "Заказ №1");

        await expect(card).toHaveClass(/highlighted-order/);
    });

    test("показывает fallback для отсутствующих категории, подкатегории и услуги", async ({ page }) => {
        const card = orderCard(page, "Заказ №3");

        await expect(card).toContainText("Категория: Не указано");
        await expect(card).toContainText("Подкатегория: Не указано");
        await expect(card).toContainText("Услуга: Не указано");
    });

    test("показывает иконки типов оплаты", async ({ page }) => {
        const cashCard = orderCard(page, "Заказ №1");
        const guaranteeCard = orderCard(page, "Заказ №2");
        const installmentsCard = orderCard(page, "Заказ №3");

        await expect(cashCard.locator(".payment-icon svg title")).toHaveText("Наличные");
        await expect(guaranteeCard.locator(".payment-icon svg title")).toHaveText("Tinkoff");
        await expect(installmentsCard.locator(".payment-icon svg title")).toHaveText("Карта");
    });

    test("показывает кнопку запроса только для чужого pending заказа без исполнителя", async ({ page }) => {
        const pendingCard = orderCard(page, "Заказ №1");
        const activeCard = orderCard(page, "Заказ №2");

        await expect(pendingCard.getByRole("button", { name: /Запросить выполнение/i })).toBeVisible();
        await expect(activeCard.getByRole("button", { name: /Запросить выполнение/i })).not.toBeVisible();
    });

    test("не показывает кнопку запроса для своего заказа", async ({ page }) => {
        await openUserOrdersPage(page, {
            ordersBody: [
                {
                    ...orders[0],
                    creatorId: 2,
                },
            ],
            creatorBody: {
                id: 2,
                username: "Executor",
                rating: 5,
                complaintsCount: 0,
            },
        });

        const card = orderCard(page, "Заказ №1");

        await expect(card.getByRole("button", { name: /Запросить выполнение/i })).not.toBeVisible();
    });

    test("отправляет запрос на выполнение заказа", async ({ page }) => {
        let requestCalled = false;

        await page.route("**/api/orders/1/request", async (route) => {
            requestCalled = true;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                }),
            });
        });

        const card = orderCard(page, "Заказ №1");

        const dialogPromise = page.waitForEvent("dialog");

        await card.getByRole("button", { name: /Запросить выполнение/i }).click();

        const dialog = await dialogPromise;

        expect(dialog.message()).toBe("Запрос отправлен заказчику!");

        await dialog.accept();

        await expect
            .poll(() => requestCalled, {
                timeout: 10000,
            })
            .toBe(true);
    });

    test("если нет токена, при запросе редиректит на login", async ({ page }) => {
        await page.evaluate(() => {
            localStorage.removeItem("authToken");
        });

        page.once("dialog", async (dialog) => {
            expect(dialog.message()).toBe("Вы не авторизованы! Пожалуйста, войдите в систему.");
            await dialog.accept();
        });

        const card = orderCard(page, "Заказ №1");

        await card.getByRole("button", { name: /Запросить выполнение/i }).click();

        await expect(page).toHaveURL(/\/login/);
    });

    test("открывает модалку изображения", async ({ page }) => {
        const card = orderCard(page, "Заказ №1");

        await card.locator(".order-image").first().click();

        await expect(page.locator(".custom-modal-content")).toBeVisible();
        await expect(page.locator(".custom-modal-image")).toHaveAttribute("src", /photo1\.jpg/);
    });

    test("переключает изображения в модалке", async ({ page }) => {
        const card = orderCard(page, "Заказ №1");

        await card.locator(".order-image").first().click();

        const modalImage = page.locator(".custom-modal-image");

        await expect(modalImage).toHaveAttribute("src", /photo1\.jpg/);

        await clickByDom(page, ".custom-nav-button", "▶");

        await expect(modalImage).toHaveAttribute("src", /photo2\.jpg/);

        await clickByDom(page, ".custom-nav-button", "◀");

        await expect(modalImage).toHaveAttribute("src", /photo1\.jpg/);
    });

    test("закрывает модалку изображения", async ({ page }) => {
        const card = orderCard(page, "Заказ №1");

        await card.locator(".order-image").first().click();

        await expect(page.locator(".custom-modal-content")).toBeVisible();

        await clickByDom(page, ".custom-close-button");

        await expect(page.locator(".custom-modal-content")).not.toBeVisible();
    });

    test("показывает ошибку при сбое загрузки заказов", async ({ page }) => {
        await openUserOrdersPage(page, {
            ordersStatus: 500,
            ordersBody: {
                message: "Нет доступа к заказам",
            },
            waitForPage: false,
        });

        await expect(page.locator(".error-message")).toHaveText(
            "Ошибка: Нет доступа к заказам"
        );
    });

    test("если создатель не загрузился, показывает Неизвестно", async ({ page }) => {
        await openUserOrdersPage(page, {
            creatorStatus: 500,
            creatorBody: {
                message: "Creator error",
            },
        });

        const card = orderCard(page, "Заказ №1");

        await expect(card).toContainText("от Неизвестно");
        await expect(card).toContainText("Имя заказчика: Неизвестно");
        await expect(card).toContainText("Рейтинг заказчика: Нет данных");
    });

    test("при пустом списке сейчас показывает Загрузка", async ({ page }) => {
        await openUserOrdersPage(page, {
            ordersBody: [],
            waitForPage: false,
        });

        await expect(page.locator(".loading-message")).toHaveText("Загрузка...");
    });
});