import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3000";

const testUser = {
    id: 1,
    username: "creator",
    role: "customer",
    name: "Creator User",
};

const regularOrders = [
    {
        id: 101,
        createdAt: "2026-07-01T10:00:00.000Z",
        type: "Грузоперевозка",
        status: "pending",
        category: { name: "Грузоперевозки" },
        subcategory: { name: "Перевозка мебели" },
        proposedSum: 1500,
        description:
            "Нужно аккуратно перевезти мебель из квартиры в дом. Есть шкаф, стол, несколько коробок и бытовая техника.",
        paymentType: "cash",
        address: "Симферополь, улица Пушкина, 1",
        images: ["/uploads/orders/101/photo1.jpg", "/uploads/orders/101/photo2.jpg"],
    },
    {
        id: 102,
        createdAt: "2026-07-02T10:00:00.000Z",
        type: "Ремонт",
        status: "pending_payment",
        category: { name: "Ремонт" },
        subcategory: { name: "Электрика" },
        proposedSum: 3000,
        description: "Починить розетку и заменить автомат.",
        paymentType: "guarantee",
        address: "Симферополь, Киевская 10",
        images: [],
    },
    {
        id: 103,
        createdAt: "2026-07-03T10:00:00.000Z",
        type: "Старый заказ",
        status: "active",
        category: { name: "Не должен отображаться" },
        subcategory: { name: "Не должен отображаться" },
        proposedSum: 9999,
        description: "Этот заказ не должен быть на странице.",
        paymentType: "cash",
        address: "Скрытый адрес",
        images: [],
    },
];

const requestedExecutors = {
    101: [
        {
            id: 2,
            username: "executor1",
            rating: 4.8,
            ratingCount: 12,
            proposedSum: 1400,
            comment: "Сделаю быстро и аккуратно",
            isVerified: true,
        },
        {
            id: 3,
            username: "executor2",
            rating: 4.2,
            ratingCount: 3,
            proposedSum: 1600,
            comment: "",
            isVerified: false,
        },
    ],
    102: [],
};

const expressOrders = [
    {
        id: 201,
        kind: "express",
        type: "taxi",
        status: "created",
        creatorId: 1,
        executorId: null,
        createdAt: "2026-07-04T10:00:00.000Z",
        totalPrice: 700,
        paymentType: "cash",
        fromAddress: "Симферополь, улица Пушкина, 1",
        toAddress: "Симферополь, проспект Кирова, 10",
        description: "Экспресс такси",
    },
    {
        id: 202,
        kind: "express",
        type: "courier",
        status: "accepted",
        creatorId: 1,
        executorId: 5,
        createdAt: "2026-07-05T10:00:00.000Z",
        totalPrice: 500,
        paymentType: "cash",
        fromAddress: "Не должен отображаться",
        toAddress: "Не должен отображаться",
        description: "Уже принят",
    },
    {
        id: 203,
        kind: "express",
        type: "taxi",
        status: "created",
        creatorId: 99,
        executorId: null,
        createdAt: "2026-07-06T10:00:00.000Z",
        totalPrice: 900,
        paymentType: "cash",
        fromAddress: "Чужой заказ",
        toAddress: "Чужой заказ",
        description: "Чужой заказ",
    },
];

async function mockPaymentNavigation(page) {
    let openedPaymentUrl = null;

    await page.route("https://payment.example.test/**", async (route) => {
        openedPaymentUrl = route.request().url();

        await route.fulfill({
            status: 200,
            contentType: "text/html",
            body: "<html><body>Payment mock</body></html>",
        });
    });

    return {
        getOpenedUrl: () => openedPaymentUrl,
    };
}

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

async function setFakeAuth(page, user = testUser) {
    const fakeToken = createFakeJwt({
        id: user.id,
        role: user.role,
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

async function setupMyOrdersMocks(page, options = {}) {
    const {
        user = testUser,
        regular = regularOrders,
        express = expressOrders,
        executors = requestedExecutors,
        profileStatus = 200,
        profileBody = user,
        regularStatus = 200,
        expressStatus = 200,
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

    await page.route("**/api/orders/creator/1", async (route) => {
        await route.fulfill({
            status: regularStatus,
            contentType: "application/json",
            body: JSON.stringify(regular),
        });
    });

    await page.route("**/api/express/express-orders/me?mode=created", async (route) => {
        await route.fulfill({
            status: expressStatus,
            contentType: "application/json",
            body: JSON.stringify({
                success: true,
                orders: express,
            }),
        });
    });

    await page.route("**/api/orders/*/requested-executors", async (route) => {
        const match = route.request().url().match(/\/orders\/(\d+)\/requested-executors/);
        const orderId = match?.[1];

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(executors[orderId] || []),
        });
    });

    await page.route("**/api/orders/*/approve", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                success: true,
            }),
        });
    });

    await page.route("**/api/orders/*/hide-by-creator", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                success: true,
            }),
        });
    });

    await page.route("**/api/express/express-orders/*/hide-by-creator", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                success: true,
            }),
        });
    });

    await page.route("**/api/payments/order/promotion/create", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                success: true,
                confirmationUrl: "https://payment.example.test/confirm",
            }),
        });
    });
}

async function openMyOrdersPage(page, options = {}) {
    await setFakeAuth(page, options.user || testUser);
    await setupMyOrdersMocks(page, options);

    const userId = options.userId || 1;
    const query = options.query || "platform=web";

    await page.goto(`${FRONT_URL}/my-orders/${userId}?${query}`, {

        waitUntil: "domcontentloaded",

        timeout: 30000,

    });

    if (options.waitForPage === false) {
        return;
    }

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "my-orders-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("MyOrdersPage редиректит на /login. Fake JWT не применился.");
    }

    await expect(page.getByText("Мои заказы")).toBeVisible({
        timeout: 15000,
    });

    await expect(page.getByText("Загрузка…")).not.toBeVisible({
        timeout: 15000,
    });
}

function orderCard(page, text) {
    return page.locator("li").filter({
        hasText: text,
    });
}

async function clickDeleteInCard(page, cardText) {
    const card = orderCard(page, cardText);

    await card.getByRole("button", { name: /Удалить заказ/i }).click();
}

test.describe("MyOrdersPage", () => {
    test.beforeEach(async ({ page }) => {
        await openMyOrdersPage(page);
    });

    test("отображает страницу моих заказов", async ({ page }) => {
        await expect(page.getByText("Мои заказы")).toBeVisible();

        await expect(page.getByText("Всего:")).toBeVisible();
        await expect(page.getByText("Разместить")).toBeVisible();
        await expect(page.getByText("Вызвать такси / курьера")).toBeVisible();
    });

    test("показывает только pending и pending_payment обычные заказы", async ({ page }) => {
        await expect(page.getByText("Заказ №101")).toBeVisible();
        await expect(page.getByText("Заказ №102")).toBeVisible();

        await expect(page.getByText("Заказ №103")).not.toBeVisible();
        await expect(page.getByText("Не должен отображаться")).not.toBeVisible();
    });

    test("показывает только созданные экспресс-заказы без исполнителя", async ({ page }) => {
        await expect(page.getByText("Экспресс №201")).toBeVisible();
        await expect(page.getByText("Экспресс • Такси")).toBeVisible();

        await expect(page.getByText("Экспресс №202")).not.toBeVisible();
        await expect(page.getByText("Экспресс №203")).not.toBeVisible();
        await expect(page.getByText("Чужой заказ")).not.toBeVisible();
    });

    test("показывает количество заказов", async ({ page }) => {
        await expect(page.getByText("Всего:")).toBeVisible();
        await expect(page.locator("b").filter({ hasText: "3" })).toBeVisible();
    });

    test("переходит на создание обычного заказа", async ({ page }) => {
        await page.getByRole("button", { name: "Разместить" }).click();

        await expect(page).toHaveURL(/\/create-order/);
    });

    test("переходит на создание экспресс-заказа", async ({ page }) => {
        await page.getByRole("button", { name: "Вызвать такси \/ курьера" }).click();

        await expect(page).toHaveURL(/\/express/);
    });

    test("показывает данные обычного заказа", async ({ page }) => {
        const card = orderCard(page, "Заказ №101");

        await expect(card).toContainText("Грузоперевозка");
        await expect(card).toContainText("Опубликован");
        await expect(card).toContainText("1500 ₽");
        await expect(card).toContainText("Наличные");
        await expect(card).toContainText("Грузоперевозки");
        await expect(card).toContainText("Перевозка мебели");
        await expect(card).toContainText("Симферополь, улица Пушкина, 1");
        await expect(card).toContainText("Нужно аккуратно перевезти мебель");
    });

    test("показывает pending_payment заказ и кнопку оплаты", async ({ page }) => {
        const card = orderCard(page, "Заказ №102");

        await expect(card).toContainText("Ожидает оплаты");
        await expect(card).toContainText("Продвижение не оплачено");
        await expect(card.getByRole("button", { name: "Оплатить" })).toBeVisible();
    });

    test("создаёт оплату продвижения и переходит по ссылке", async ({ page }) => {
        let paymentRequestBody = null;

        const paymentNavigation = await mockPaymentNavigation(page);

        await page.route(
            "**/api/payments/order/promotion/create",
            async (route) => {
                paymentRequestBody = route.request().postDataJSON();

                await route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({
                        success: true,
                        confirmationUrl:
                            "https://payment.example.test/confirm",
                    }),
                });
            }
        );

        const card = orderCard(page, "Заказ №102");

        await card
            .getByRole("button", { name: "Оплатить" })
            .click();

        await expect
            .poll(() => paymentRequestBody, {
                timeout: 10000,
            })
            .toEqual({
                orderId: 102,
            });

        await expect
            .poll(() => paymentNavigation.getOpenedUrl(), {
                timeout: 10000,
            })
            .toBe("https://payment.example.test/confirm");

        await expect(page).toHaveURL(
            "https://payment.example.test/confirm",
            {
                timeout: 10000,
            }
        );
    });

    test("показывает данные экспресс-заказа", async ({ page }) => {
        const card = orderCard(page, "Экспресс №201");

        await expect(card).toContainText("Экспресс • Такси");
        await expect(card).toContainText("Ожидает исполнителя");
        await expect(card).toContainText("700 ₽");
        await expect(card).toContainText("Наличные");
        await expect(card).toContainText("Откуда");
        await expect(card).toContainText("Симферополь, улица Пушкина, 1");
        await expect(card).toContainText("Куда");
        await expect(card).toContainText("Симферополь, проспект Кирова, 10");
        await expect(card).toContainText("Ожидаем, пока заказ примет исполнитель.");
    });

    test("разворачивает и скрывает список исполнителей", async ({ page }) => {
        const card = orderCard(page, "Заказ №101");

        await expect(card).toContainText("Запросы исполнителей");
        await expect(card).toContainText("Список скрыт");

        await card.getByRole("button", { name: "Показать" }).click();

        await expect(card).toContainText("executor1");
        await expect(card).toContainText("executor2");
        await expect(card).toContainText("4.8");
        await expect(card).toContainText("Сделаю быстро и аккуратно");
        await expect(card).toContainText("✔ Верифицирован");

        await card.getByRole("button", { name: "Скрыть" }).click();

        await expect(card).toContainText("Список скрыт");
    });

    test("переходит на жалобы исполнителя", async ({ page }) => {
        const card = orderCard(page, "Заказ №101");

        await card.getByRole("button", { name: "Показать" }).click();

        await card.getByRole("button", { name: "Жалобы" }).first().click();

        await expect(page).toHaveURL(/\/complaints\/2/);
    });

    test("одобряет исполнителя и переходит в активные заказы", async ({ page }) => {
        let approveRequestBody = null;

        await page.route("**/api/orders/101/approve", async (route) => {
            approveRequestBody = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                }),
            });
        });

        const card = orderCard(page, "Заказ №101");

        await card.getByRole("button", { name: "Показать" }).click();

        await card.getByRole("button", { name: "Одобрить" }).first().click();

        await expect
            .poll(() => approveRequestBody, {
                timeout: 10000,
            })
            .toEqual({
                executorId: 2,
            });

        await expect(page).toHaveURL(
            /\/active-orders\?view=created&orderId=101&orderType=regular&reason=approved/
        );
    });

    test("если одобрение вернуло confirmationUrl, переходит на оплату", async ({ page }) => {
        let approveRequestBody = null;

        const paymentNavigation = await mockPaymentNavigation(page);

        await page.route(
            "**/api/orders/101/approve",
            async (route) => {
                approveRequestBody = route.request().postDataJSON();

                await route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({
                        success: true,
                        confirmationUrl:
                            "https://payment.example.test/guarantee",
                    }),
                });
            }
        );

        const card = orderCard(page, "Заказ №101");

        await card
            .getByRole("button", { name: "Показать" })
            .click();

        await card
            .getByRole("button", { name: "Одобрить" })
            .first()
            .click();

        await expect
            .poll(() => approveRequestBody, {
                timeout: 10000,
            })
            .toEqual({
                executorId: 2,
            });

        await expect
            .poll(() => paymentNavigation.getOpenedUrl(), {
                timeout: 10000,
            })
            .toBe("https://payment.example.test/guarantee");

        await expect(page).toHaveURL(
            "https://payment.example.test/guarantee",
            {
                timeout: 10000,
            }
        );
    });

    test("удаляет обычный заказ после подтверждения", async ({ page }) => {
        let hideCalled = false;

        await page.route("**/api/orders/101/hide-by-creator", async (route) => {
            hideCalled = true;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                }),
            });
        });

        page.once("dialog", async (dialog) => {
            expect(dialog.message()).toContain("Удалить заказ из списка");
            await dialog.accept();
        });

        await clickDeleteInCard(page, "Заказ №101");

        await expect
            .poll(() => hideCalled, {
                timeout: 10000,
            })
            .toBe(true);

        await expect(page.getByText("Заказ №101")).not.toBeVisible();
    });

    test("не удаляет обычный заказ при отмене confirm", async ({ page }) => {
        let hideCalled = false;

        await page.route("**/api/orders/101/hide-by-creator", async (route) => {
            hideCalled = true;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                }),
            });
        });

        page.once("dialog", async (dialog) => {
            await dialog.dismiss();
        });

        await clickDeleteInCard(page, "Заказ №101");

        expect(hideCalled).toBe(false);

        await expect(page.getByText("Заказ №101")).toBeVisible();
    });

    test("удаляет экспресс-заказ после подтверждения", async ({ page }) => {
        let hideCalled = false;

        await page.route("**/api/express/express-orders/201/hide-by-creator", async (route) => {
            hideCalled = true;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                }),
            });
        });

        page.once("dialog", async (dialog) => {
            expect(dialog.message()).toContain("Удалить экспресс-заказ");
            await dialog.accept();
        });

        await clickDeleteInCard(page, "Экспресс №201");

        await expect
            .poll(() => hideCalled, {
                timeout: 10000,
            })
            .toBe(true);

        await expect(page.getByText("Экспресс №201")).not.toBeVisible();
    });

    test("открывает модалку изображения и переключает фото", async ({ page }) => {
        const card = orderCard(page, "Заказ №101");

        await card.locator("img").first().click();

        const modal = page.locator(".custom-modal-content").nth(0);
        const modalImage = page.locator(".custom-modal-image").nth(0);

        await expect(modal).toBeVisible();
        await expect(modalImage).toBeVisible();

        await expect(modalImage).toHaveAttribute("src", /photo1\.jpg/);

        await page.evaluate(() => {
            const button = Array.from(document.querySelectorAll(".custom-nav-button"))
                .find((item) => item.textContent?.includes("▶"));

            if (!button) {
                throw new Error("Кнопка следующего изображения не найдена");
            }

            button.click();
        });

        await expect(modalImage).toHaveAttribute("src", /photo2\.jpg/);

        await page.evaluate(() => {
            const button = Array.from(document.querySelectorAll(".custom-nav-button"))
                .find((item) => item.textContent?.includes("◀"));

            if (!button) {
                throw new Error("Кнопка предыдущего изображения не найдена");
            }

            button.click();
        });

        await expect(modalImage).toHaveAttribute("src", /photo1\.jpg/);

        await page.evaluate(() => {
            const button = document.querySelector(".custom-close-button");

            if (!button) {
                throw new Error("Кнопка закрытия модалки не найдена");
            }

            button.click();
        });

        await expect(modal).not.toBeVisible();
    });

    test("показывает пустое состояние, если заказов нет", async ({ page }) => {
        await openMyOrdersPage(page, {
            regular: [],
            express: [],
        });

        await expect(page.getByText("Пока нет заказов.")).toBeVisible();
    });

    test("редиректит на главную, если профиль другого пользователя", async ({ page }) => {
        await openMyOrdersPage(page, {
            profileBody: {
                id: 99,
                username: "other",
                role: "customer",
            },
            waitForPage: false,
        });

        await expect(page).toHaveURL(`${FRONT_URL}/`, {
            timeout: 10000,
        });
    });

    test("редиректит на login, если профиль не загрузился", async ({ page }) => {
        await openMyOrdersPage(page, {
            profileStatus: 401,
            profileBody: {
                message: "Unauthorized",
            },
            waitForPage: false,
        });

        await expect(page).toHaveURL(/\/login/, {
            timeout: 10000,
        });
    });

    test("поднимает целевой заказ наверх и раскрывает его", async ({ page }) => {
        await openMyOrdersPage(page, {
            query: "platform=web&orderId=101&expand=1",
        });

        const cards = page.locator("li");

        await expect(cards.first()).toContainText("Заказ №101");

        const firstCard = cards.first();

        await expect(firstCard).toContainText("executor1");
        await expect(firstCard).toContainText("Нужно аккуратно перевезти мебель");
    });
});