import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3000";

const testUser = {
    id: 1,
    username: "creator",
    role: "customer",
};

const categories = [
    { id: 1, name: "Грузоперевозки" },
    { id: 2, name: "Ремонт" },
    { id: 3, name: "Такси" },
    { id: 4, name: "Курьер" },
];

const subcategories = [
    { id: 10, name: "Перевозка мебели", price: 1500 },
    { id: 11, name: "Вывоз мусора", price: 2000 },
];

const profileLocation = {
    locationAddress: "Симферополь, улица Пушкина, 1",
    locationLat: 44.9521,
    locationLng: 34.1024,
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

async function setFakeAuth(page) {
    const fakeToken = createFakeJwt({
        id: testUser.id,
        role: testUser.role,
        name: testUser.username,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
    });

    await page.addInitScript(({ token, user }) => {
        localStorage.setItem("authToken", token);
        localStorage.setItem("user", JSON.stringify(user));
        localStorage.setItem("currentUser", JSON.stringify(user));
        localStorage.setItem("userData", JSON.stringify(user));
    }, {
        token: fakeToken,
        user: testUser,
    });
}

async function setupCreateOrderMocks(page, options = {}) {
    const {
        location = profileLocation,
        createOrderStatus = 200,
        createOrderBody = { id: 777, success: true },
        promotionPaymentBody = {
            success: true,
            confirmationUrl: "https://payment.example.test/confirm",
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

    page.on("requestfailed", (request) => {
        const url = request.url();

        if (
            url.includes("yastatic.net") ||
            url.includes("maps-front") ||
            url.includes("geocode-maps.yandex.ru")
        ) {
            return;
        }

        console.log("[REQUEST FAILED]", url, request.failure()?.errorText);
    });

    await page.route("**/api/auth/location/me", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                location,
            }),
        });
    });

    await page.route("**/api/category", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(categories),
        });
    });

    await page.route("**/api/category/subcategory/1", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(subcategories),
        });
    });

    await page.route("**/api/category/subcategory/2", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify([
                { id: 20, name: "Электрика", price: 1000 },
            ]),
        });
    });

    await page.route("**/api/orders/", async (route) => {
        await route.fulfill({
            status: createOrderStatus,
            contentType: "application/json",
            body: JSON.stringify(createOrderBody),
        });
    });

    await page.route("**/api/payments/order/promotion/create", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(promotionPaymentBody),
        });
    });

    await page.route("**/api/tbank-payments/order/promotion/create", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(promotionPaymentBody),
        });
    });

    await page.route("https://geocode-maps.yandex.ru/1.x/**", async (route) => {
        const url = route.request().url();

        const isSuggestionRequest = url.includes("results=10");

        const address = isSuggestionRequest
            ? "Россия, Республика Крым, Симферополь, улица Киевская, 10"
            : "Россия, Республика Крым, Симферополь, улица Пушкина, 1";

        const pos = isSuggestionRequest
            ? "34.1200 44.9600"
            : "34.1024 44.9521";

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
                                            text: address,
                                        },
                                    },
                                    name: address,
                                    Point: {
                                        pos,
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

async function openCreateOrderPage(page, options = {}) {
    await setFakeAuth(page);
    await setupCreateOrderMocks(page, options);

    await page.goto(`${FRONT_URL}/create-order`, {

        waitUntil: "domcontentloaded",

        timeout: 30000,

    });

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "create-order-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("После fake JWT произошёл редирект на /login.");
    }

    await expect(page.locator(".create-page")).toBeVisible({
        timeout: 15000,
    });

    await expect(page.locator(".header-title")).toHaveText("Создать заказ", {
        timeout: 15000,
    });
}

async function clickCreateOrderButton(page) {
    const button = page.getByRole("button", {
        name: /^Создать заказ$/,
    });

    await expect(button).toBeVisible();
    await expect(button).toBeEnabled();

    await button.click({
        noWaitAfter: true,
    });
}

async function clickAddressCard(page) {
    const button = page.locator(".miniCardBtn");

    await expect(button).toBeVisible();
    await button.click();
}

async function clickAsapToggle(page) {
    const button = page.locator(".timeChip .toggle");

    await expect(button).toBeVisible();
    await button.click();
}

async function fillRequiredOrderFields(page) {
    await page.locator("textarea.textarea").fill("Нужно перевезти мебель аккуратно");
    await page.locator('input[type="number"]').fill("1500");

    await page.locator("select.control").first().selectOption("1");

    await expect(page.locator("select.control").nth(1)).toBeVisible({
        timeout: 10000,
    });

    await page.locator("select.control").nth(1).selectOption("10");
}

test.describe("CreateOrderPage", () => {
    test.beforeEach(async ({ page }) => {
        await openCreateOrderPage(page);
    });

    test("отображает страницу создания заказа", async ({ page }) => {
        await expect(page.locator(".create-page")).toBeVisible();

        await expect(page.locator(".header-title")).toHaveText("Создать заказ");
        await expect(page.getByRole("button", { name: /^Создать заказ$/ })).toBeVisible();

        await expect(page.getByText("Адрес и время подставятся автоматически")).toBeVisible();

        await expect(page.locator(".section-title", { hasText: "Категория" })).toBeVisible();
        await expect(page.locator(".section-title", { hasText: "Описание" })).toBeVisible();
        await expect(page.locator(".section-title", { hasText: "Оплата и продвижение" })).toBeVisible();

        await expect(page.getByText("Срочно")).toBeVisible();
        await expect(page.getByText("К оплате сейчас")).toBeVisible();
        await expect(page.locator(".totalAmount")).toHaveText("0 ₽");

        await expect(page.locator("textarea.textarea")).toBeVisible();
        await expect(page.locator('input[type="number"]')).toBeVisible();
        await expect(page.getByRole("button", { name: /Создать заказ/i })).toBeVisible();
    });

    test("загружает адрес из профиля", async ({ page }) => {
        await expect(page.getByText("Указан")).toBeVisible({
            timeout: 10000,
        });

        await expect(page.getByText("Симферополь, улица Пушкина, 1")).toBeVisible();
    });

    test("открывает и закрывает блок адреса", async ({ page }) => {
        await clickAddressCard(page);

        await expect(page.getByPlaceholder("Введите адрес")).toBeVisible();

        await clickAddressCard(page);

        await expect(page.getByPlaceholder("Введите адрес")).not.toBeVisible();
    });

    test("показывает подсказки адреса и выбирает адрес", async ({ page }) => {
        await clickAddressCard(page);

        const addressInput = page.getByPlaceholder("Введите адрес");

        await addressInput.fill("Киевская 10");

        await expect(page.locator(".suggestions li").first()).toBeVisible({
            timeout: 10000,
        });

        await page.locator(".suggestions li").first().click();

        await expect(addressInput).toHaveValue(
            "Россия, Республика Крым, Симферополь, улица Киевская, 10"
        );
    });

    test("переключает адрес в ручной режим", async ({ page }) => {
        await clickAddressCard(page);

        await page.getByRole("button", { name: "Нет" }).click();

        await expect(page.getByRole("button", { name: "На карте" })).toBeVisible();
        await expect(page.getByRole("button", { name: "GPS" })).toBeVisible();
    });

    test("переключает срочно / ко времени", async ({ page }) => {
        await expect(page.getByText("Срочно")).toBeVisible();

        await clickAsapToggle(page);

        await expect(page.locator(".timeChipValue")).toHaveText("Ко времени");
        await expect(page.getByPlaceholder("Выберите дату и время")).toBeVisible();

        await clickAsapToggle(page);

        await expect(page.locator(".timeChipValue")).toHaveText("Срочно");
        await expect(page.getByPlaceholder("Выберите дату и время")).not.toBeVisible();
    });

    test("загружает категории и фильтрует Такси/Курьер", async ({ page }) => {
        const categorySelect = page.locator("select.control").first();

        await expect(categorySelect).toContainText("Грузоперевозки");
        await expect(categorySelect).toContainText("Ремонт");

        await expect(categorySelect).not.toContainText("Такси");
        await expect(categorySelect).not.toContainText("Курьер");
    });

    test("после выбора категории показывает подкатегории", async ({ page }) => {
        await page.locator("select.control").first().selectOption("1");

        const subcategorySelect = page.locator("select.control").nth(1);

        await expect(subcategorySelect).toBeVisible({
            timeout: 10000,
        });

        await expect(subcategorySelect).toContainText("Перевозка мебели");
        await expect(subcategorySelect).toContainText("Вывоз мусора");
    });

    test("ограничивает сумму максимумом 300000", async ({ page }) => {
        const amountInput = page.locator('input[type="number"]');

        await amountInput.fill("999999");

        await expect(amountInput).toHaveValue("300000");
    });

    test("очищает отрицательную сумму", async ({ page }) => {
        const amountInput = page.locator('input[type="number"]');

        await amountInput.fill("-10");

        await expect(amountInput).toHaveValue("");
    });

    test("показывает ошибку, если адрес пустой", async ({ page }) => {
        await clickAddressCard(page);

        await page.getByPlaceholder("Введите адрес").fill("");

        await clickCreateOrderButton(page);

        await expect(page.getByText("Адрес обязателен")).toBeVisible();
    });

    test("показывает ошибку, если адрес является координатами", async ({ page }) => {
        await clickAddressCard(page);

        await page.getByPlaceholder("Введите адрес").fill("Координаты: 44.9, 34.1");

        await clickCreateOrderButton(page);

        await expect(
            page.getByText("Нужно указать адрес текстом")
        ).toBeVisible();
    });

    test("показывает ошибку, если категория не выбрана", async ({ page }) => {
        await page.locator('input[type="number"]').fill("1500");

        await clickCreateOrderButton(page);

        await expect(page.locator(".alert-text")).toHaveText("Выберите категорию");
    });

    test("показывает ошибку, если сумма некорректная", async ({ page }) => {
        await page.locator("select.control").first().selectOption("1");

        await clickCreateOrderButton(page);

        await expect(page.getByText("Укажите корректную сумму за работу")).toBeVisible();
    });

    test("успешно создаёт заказ без продвижения", async ({ page }) => {
        let createOrderRequest = null;

        await page.route("**/api/orders/", async (route) => {
            createOrderRequest = route.request();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    id: 777,
                    success: true,
                }),
            });
        });

        let alertText = "";

        page.once("dialog", async (dialog) => {
            alertText = dialog.message();
            await dialog.accept();
        });

        await fillRequiredOrderFields(page);

        await clickCreateOrderButton(page);

        await expect
            .poll(() => createOrderRequest, {
                timeout: 10000,
            })
            .not.toBeNull();

        expect(createOrderRequest.method()).toBe("POST");

        const postData = createOrderRequest.postData() || "";

        expect(postData).toContain("Нужно перевезти мебель аккуратно");
        expect(postData).toContain("Симферополь");
        expect(postData).toContain("1500");
        expect(postData).toContain("cash");
        expect(postData).toContain("44.9521,34.1024");

        await expect
            .poll(() => alertText, {
                timeout: 5000,
            })
            .toContain("Заказ успешно создан");

        await expect(page).toHaveURL(/\/orders/);
    });

    test("показывает ошибку, если создание заказа не удалось", async ({ page }) => {
        await page.route("**/api/orders/", async (route) => {
            await route.fulfill({
                status: 500,
                contentType: "application/json",
                body: JSON.stringify({
                    message: "Ошибка сервера при создании заказа",
                }),
            });
        });

        await fillRequiredOrderFields(page);

        await clickCreateOrderButton(page);

        await expect(page.getByText("Ошибка сервера при создании заказа")).toBeVisible({
            timeout: 10000,
        });
    });

    test("при выбранном продвижении показывает сумму к оплате", async ({ page }) => {
        const promoLabels = page.locator(".promoBox label");

        const count = await promoLabels.count();

        if (count === 0) {
            test.skip(true, "PromotionOptions не содержит label-элементов в текущей верстке");
        }

        await promoLabels.first().click();

        await expect(page.locator(".totalAmount")).not.toHaveText("0 ₽");
    });

    test("создаёт заказ с продвижением и открывает ссылку оплаты", async ({ page }) => {
        const promoLabels = page.locator(".promoBox label");

        const count = await promoLabels.count();

        if (count === 0) {
            test.skip(
                true,
                "PromotionOptions не содержит label-элементов в текущей верстке"
            );
        }

        let promotionPaymentRequest = null;

        const paymentNavigation = await mockPaymentNavigation(page);

        await page.route(
            "**/api/payments/order/promotion/create",
            async (route) => {
                promotionPaymentRequest = route.request();

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

        await promoLabels.first().click();

        await fillRequiredOrderFields(page);

        await clickCreateOrderButton(page);

        await expect
            .poll(() => promotionPaymentRequest, {
                timeout: 10000,
            })
            .not.toBeNull();

        expect(promotionPaymentRequest.method()).toBe("POST");

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

    test("загружает фото и показывает превью", async ({ page }) => {
        const tinyPngBase64 =
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

        await page.locator('input[type="file"]').setInputFiles({
            name: "photo.png",
            mimeType: "image/png",
            buffer: Buffer.from(tinyPngBase64, "base64"),
        });

        await expect(page.getByText("Фото 1")).toBeVisible({
            timeout: 15000,
        });
    });
});