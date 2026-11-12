import { test, expect } from "./fixtures/safeTest";

import { createMockJwt } from "./utils/mockAuthSession";

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
    const fakeToken = createMockJwt(testUser);

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

    // Список обычных заказов.
    await page.route(
        "**/api/orders/all",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: [],
            });
        }
    );

// Доступные экспресс-заказы.
    await page.route(
        "**/api/express/express-orders/available",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    orders: [],
                },
            });
        }
    );

// Активные обычные заказы.
    await page.route(
        "**/api/orders/active-orders",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    orders: [],
                },
            });
        }
    );

// Активные экспресс-заказы.
    await page.route(
        "**/api/express/express-orders/me?mode=active",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    orders: [],
                },
            });
        }
    );

    // Яндекс.Карты: внешний JavaScript не загружаем.
    await page.route(
        "https://api-maps.yandex.ru/2.1/**",
        async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/javascript",
                body: "",
            });
        }
    );

// Google Fonts: исключаем внешний запрос.
    await page.route(
        "https://fonts.googleapis.com/**",
        async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "text/css",
                body: "",
            });
        }
    );

// Профиль вымышленного пользователя.
    await page.route(
        "**/api/auth/profile",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    ...testUser,
                    ...profileLocation,
                    debt: 0,
                },
            });
        }
    );

// Задолженности нет.
    await page.route(
        "**/api/orders/me/status",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    debt: 0,
                },
            });
        }
    );

// Гарантийная оплата пока недоступна.
    await page.route(
        "**/api/payments/guarantee/capabilities",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    verified: true,
                    available: false,
                    operational: false,
                },
            });
        }
    );

    // Актуальный поиск услуг CargoCamp.
    await page.route(
        "**/api/category/search**",
        async (route) => {
            const results = [
                {
                    type: "subcategory",
                    categoryId: 1,
                    categoryName: "Грузоперевозки",
                    subcategoryId: 10,
                    subcategoryName: "Перевозка мебели",
                    label: "Перевозка мебели",
                    formConfig: null,
                    pricingConfig: null,
                },
                {
                    type: "subcategory",
                    categoryId: 1,
                    categoryName: "Грузоперевозки",
                    subcategoryId: 11,
                    subcategoryName: "Вывоз мусора",
                    label: "Вывоз мусора",
                    formConfig: null,
                    pricingConfig: null,
                },
                {
                    type: "subcategory",
                    categoryId: 2,
                    categoryName: "Ремонт",
                    subcategoryId: 20,
                    subcategoryName: "Электрика",
                    label: "Электрика",
                    formConfig: null,
                    pricingConfig: null,
                },

                // Намеренно возвращаем экспресс-категории.
                // Фронтенд обязан самостоятельно их скрыть.
                {
                    type: "category",
                    categoryId: 3,
                    categoryName: "Такси",
                    label: "Такси",
                },
                {
                    type: "category",
                    categoryId: 4,
                    categoryName: "Курьер",
                    label: "Курьер",
                },
            ];

            await route.fulfill({
                status: 200,
                json: {
                    success: true,
                    results,
                },
            });
        }
    );

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

async function selectTestService(
    page,
    serviceName = "Перевозка мебели"
) {
    const search = page.getByRole("textbox", {
        name: "Поиск услуги",
    });

    await search.fill("мебель");

    const suggestion = page
        .locator(".serviceSuggestionItem")
        .filter({
            hasText: serviceName,
        });

    await expect(suggestion).toBeVisible({
        timeout: 10000,
    });

    await suggestion.click();

    await expect(
        page.locator(".selectedServiceCard")
    ).toContainText(serviceName);
}

async function fillRequiredOrderFields(page) {
    await selectTestService(page);

    await page
        .locator("textarea.textarea")
        .fill("Нужно перевезти мебель аккуратно");

    await page
        .locator('input[type="number"]')
        .fill("1500");
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

        await expect(
            page.locator(".section-title", {
                hasText: "Что нужно сделать?",
            })
        ).toBeVisible();
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

    test(
        "поиск услуг скрывает Такси и Курьер",
        async ({ page }) => {
            const search = page.getByRole("textbox", {
                name: "Поиск услуги",
            });

            await search.fill("мебель");

            const suggestions = page.locator(
                ".serviceSuggestionList"
            );

            await expect(suggestions).toBeVisible();

            await expect(suggestions).toContainText(
                "Перевозка мебели"
            );

            await expect(suggestions).toContainText(
                "Вывоз мусора"
            );

            await expect(suggestions).not.toContainText(
                "Такси"
            );

            await expect(suggestions).not.toContainText(
                "Курьер"
            );
        }
    );

    test(
        "выбирает услугу и сохраняет категорию",
        async ({ page }) => {
            await selectTestService(
                page,
                "Перевозка мебели"
            );

            const selected = page.locator(
                ".selectedServiceCard"
            );

            await expect(selected).toContainText(
                "Перевозка мебели"
            );

            await expect(selected).toContainText(
                "Категория: Грузоперевозки"
            );

            await expect(
                page.locator(".serviceSuggestionPanel")
            ).not.toBeVisible();
        }
    );

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

        await expect(
            page.locator(".createOrderErrorToast__message")
        ).toContainText("Адрес обязателен");
    });

    test("показывает ошибку, если адрес является координатами", async ({ page }) => {
        await clickAddressCard(page);

        await page.getByPlaceholder("Введите адрес").fill("Координаты: 44.9, 34.1");

        await clickCreateOrderButton(page);

        await expect(
            page.locator(".createOrderErrorToast__message")
        ).toContainText("Нужно указать адрес текстом");
    });

    test(
        "не создаёт заказ без выбранной услуги",
        async ({ page }) => {
            await page
                .locator('input[type="number"]')
                .fill("1500");

            await clickCreateOrderButton(page);

            await expect(
                page.locator(".createOrderErrorToast__message")
            ).toContainText(
                "Выберите подходящую услугу из подсказки"
            );
        }
    );

    test(
        "не создаёт заказ с некорректной суммой",
        async ({ page }) => {
            await selectTestService(page);

            await clickCreateOrderButton(page);

            await expect(
                page.locator(".createOrderErrorToast__message")
            ).toContainText(
                "Укажите корректную сумму за работу"
            );
        }
    );

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

        await expect(
            page.locator(".createOrderErrorToast__message")
        ).toContainText(
            "Ошибка сервера при создании заказа"
        );
    });

    test(
        "при выбранном продвижении показывает сумму к оплате",
        async ({ page }) => {
            const highlight = page
                .locator(".promoBox .promoOption")
                .filter({
                    hasText: "Выделить цветом",
                });

            await expect(highlight).toBeVisible();

            await expect(
                page.locator(".totalAmount")
            ).toHaveText("0 ₽");

            await highlight.click();

            await expect(
                highlight.locator('input[type="checkbox"]')
            ).toBeChecked();

            await expect(
                page.locator(".totalAmount")
            ).toHaveText("50 ₽");

            // Повторное нажатие отключает продвижение.
            await highlight.click();

            await expect(
                highlight.locator('input[type="checkbox"]')
            ).not.toBeChecked();

            await expect(
                page.locator(".totalAmount")
            ).toHaveText("0 ₽");
        }
    );

    test("создаёт заказ с продвижением и открывает ссылку оплаты", async ({ page }) => {
        const highlight = page
            .locator(".promoBox .promoOption")
            .filter({
                hasText: "Выделить цветом",
            });

        await expect(highlight).toBeVisible();

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

        await highlight.click();

        await expect(
            highlight.locator('input[type="checkbox"]')
        ).toBeChecked();

        await expect(
            page.locator(".totalAmount")
        ).toHaveText("50 ₽");

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

// ============================================================
// CARGOCAMP: DYNAMIC ORDER FORM E2E
// Полностью изолированные сценарии.
// ============================================================

const DYNAMIC_TEST_SERVICE = {
    type: "subcategory",

    categoryId: 2,
    categoryName: "Ремонт",

    subcategoryId: 20,
    subcategoryName: "Ремонт сантехники",

    label: "Ремонт сантехники",

    formConfig: {
        fields: [
            {
                key: "workType",
                label: "Тип работы",
                type: "select",
                required: true,

                options: [
                    {
                        value: "faucet",
                        label: "Замена смесителя",
                    },
                    {
                        value: "pipes",
                        label: "Ремонт труб",
                    },
                ],
            },

            {
                key: "tasksCount",
                label: "Количество точек",
                type: "number",
                required: true,
                min: 1,
                max: 5,
            },

            {
                key: "needAssistant",
                label: "Нужен помощник",
                type: "boolean",
            },

            {
                key: "assistantNote",
                label: "Комментарий помощнику",
                type: "textarea",
                required: true,

                showWhen: {
                    field: "needAssistant",
                    equals: true,
                },
            },
        ],
    },

    pricingConfig: {
        enabled: true,
        calculator: "fixed_service",

        visitPrice: 500,

        workTypePrices: {
            faucet: 700,
            pipes: 1000,
        },

        quantityField: "tasksCount",
        quantityLabel: "Количество точек",
        pricePerUnit: 100,

        minimumPrice: 0,
        maximumPrice: 300000,
        rangePercent: 10,
    },
};

/**
 * Подменяет поиск услуг.
 *
 * Все результаты вымышленные.
 * Реальный API не вызывается.
 */
async function selectDynamicTestService(page) {
    await page.route(
        "**/api/category/search**",
        async (route) => {
            await route.fulfill({
                status: 200,

                json: {
                    success: true,
                    results: [
                        DYNAMIC_TEST_SERVICE,
                    ],
                },
            });
        }
    );

    const search = page.getByRole(
        "textbox",
        {
            name: "Поиск услуги",
        }
    );

    await search.fill("смеситель");

    const suggestion = page
        .locator(".serviceSuggestionItem")
        .filter({
            hasText: "Ремонт сантехники",
        });

    await expect(suggestion).toBeVisible({
        timeout: 10000,
    });

    await suggestion.click();

    await expect(
        page.locator(".selectedServiceCard")
    ).toContainText(
        "Ремонт сантехники"
    );

    await expect(
        page.locator(".dynamicServiceFields")
    ).toBeVisible();
}

/**
 * Заполняет стоимость и параметры услуги.
 */
async function fillDynamicTestFields(
    page,
    {
        count = 2,
        amount = "1500",
    } = {}
) {
    const fields = page.locator(
        ".dynamicServiceFields"
    );

    await fields
        .locator(".field")
        .filter({
            hasText: "Тип работы",
        })
        .locator("select")
        .selectOption("faucet");

    if (count !== null) {
        await fields
            .locator(".field")
            .filter({
                hasText: "Количество точек",
            })
            .locator('input[type="number"]')
            .fill(String(count));
    }

    await page
        .locator("#order-proposed-sum")
        .fill(amount);
}

/**
 * Извлекает JSON из FormData-запроса.
 *
 * Используется для проверки serviceDetails,
 * которые реально передаются фронтендом.
 */
function readMultipartJson(request, fieldName) {
    const body = request.postData() || "";

    const match = body.match(
        new RegExp(
            `name="${fieldName}"\\r?\\n\\r?\\n([^\\r\\n]+)`
        )
    );

    if (!match) {
        throw new Error(
            `Поле ${fieldName} отсутствует в FormData`
        );
    }

    return JSON.parse(match[1]);
}

test.describe(
    "CreateOrderPage — динамические поля и оплата",
    () => {
        test.beforeEach(async ({ page }) => {
            await openCreateOrderPage(page);
        });

        // ------------------------------------------------
        // 1. ОБЯЗАТЕЛЬНЫЕ ПОЛЯ
        // ------------------------------------------------

        test(
            "не создаёт заказ без обязательного динамического поля",
            async ({ page }) => {
                await selectDynamicTestService(page);

                await fillDynamicTestFields(page, {
                    count: null,
                });

                let createRequests = 0;

                await page.route(
                    "**/api/orders/",
                    async (route) => {
                        createRequests++;

                        await route.fulfill({
                            status: 200,
                            json: {
                                success: true,
                                id: 777,
                            },
                        });
                    }
                );

                await clickCreateOrderButton(page);

                await expect(
                    page.locator(".createOrderErrorToast__message")
                ).toContainText(
                    "Заполните поле «Количество точек»"
                );

                expect(createRequests).toBe(0);
            }
        );

        // ------------------------------------------------
        // 2. ОГРАНИЧЕНИЯ ЧИСЛОВОГО ПОЛЯ
        // ------------------------------------------------

        test(
            "не принимает число больше максимума",
            async ({ page }) => {
                await selectDynamicTestService(page);

                await fillDynamicTestFields(page, {
                    count: 7,
                });

                await clickCreateOrderButton(page);

                await expect(
                    page.locator(".createOrderErrorToast__message")
                ).toContainText(
                    "Максимальное значение поля «Количество точек» — 5"
                );
            }
        );

        // ------------------------------------------------
        // 3. УСЛОВНО ОБЯЗАТЕЛЬНОЕ ПОЛЕ
        // ------------------------------------------------

        test(
            "требует комментарий только при выборе помощника",
            async ({ page }) => {
                await selectDynamicTestService(page);

                await fillDynamicTestFields(page);

                const assistant = page
                    .locator(".dynamicBooleanField")
                    .filter({
                        hasText: "Нужен помощник",
                    })
                    .locator('input[type="checkbox"]');

                await expect(assistant).not.toBeChecked();

                await assistant.check();

                const note = page
                    .locator(".dynamicServiceFields .field")
                    .filter({
                        hasText: "Комментарий помощнику",
                    });

                await expect(note).toBeVisible();

                await clickCreateOrderButton(page);

                await expect(
                    page.locator(".createOrderErrorToast__message")
                ).toContainText(
                    "Заполните поле «Комментарий помощнику»"
                );
            }
        );

        // ------------------------------------------------
        // 4. ОЧИСТКА СКРЫТЫХ ПОЛЕЙ
        // ------------------------------------------------

        test(
            "удаляет скрытое поле из отправляемого заказа",
            async ({ page }) => {
                await selectDynamicTestService(page);

                await fillDynamicTestFields(page);

                const assistant = page
                    .locator(".dynamicBooleanField")
                    .filter({
                        hasText: "Нужен помощник",
                    })
                    .locator('input[type="checkbox"]');

                await assistant.check();

                const note = page
                    .locator(".dynamicServiceFields .field")
                    .filter({
                        hasText: "Комментарий помощнику",
                    })
                    .locator("textarea");

                await note.fill(
                    "Помощнику потребуется инструмент"
                );

                await assistant.uncheck();

                await expect(
                    page.locator(".dynamicServiceFields .field")
                        .filter({
                            hasText: "Комментарий помощнику",
                        })
                ).toHaveCount(0);

                let createRequest = null;

                await page.route(
                    "**/api/orders/",
                    async (route) => {
                        createRequest = route.request();

                        await route.fulfill({
                            status: 200,
                            json: {
                                success: true,
                                id: 777,
                            },
                        });
                    }
                );

                page.once(
                    "dialog",
                    async (dialog) => {
                        await dialog.accept();
                    }
                );

                await clickCreateOrderButton(page);

                await expect.poll(
                    () => createRequest
                ).not.toBeNull();

                const details = readMultipartJson(
                    createRequest,
                    "serviceDetails"
                );

                expect(details).toMatchObject({
                    workType: "faucet",
                    tasksCount: 2,
                    needAssistant: false,
                });

                expect(details).not.toHaveProperty(
                    "assistantNote"
                );
            }
        );

        // ------------------------------------------------
        // 5. РЕКОМЕНДУЕМАЯ ЦЕНА
        // ------------------------------------------------

        test(
            "рассчитывает стоимость и подставляет сумму",
            async ({ page }) => {
                await selectDynamicTestService(page);

                await fillDynamicTestFields(page);

                /*
                 * Тестовая формула:
                 *
                 * Выезд: 500 ₽
                 * Замена смесителя: 700 ₽
                 * 2 точки × 100 ₽: 200 ₽
                 *
                 * Итого: 1400 ₽
                 */
                await expect(
                    page.locator(".recommendedPriceCard")
                ).toBeVisible();

                await expect(
                    page.locator(".recommendedPriceRange")
                ).toContainText(
                    /1[\s\u00a0]?300/
                );

                await expect(
                    page.locator(".recommendedPriceRange")
                ).toContainText(
                    /1[\s\u00a0]?500/
                );

                await page.getByRole(
                    "button",
                    {
                        name: "Указать эту сумму",
                    }
                ).click();

                await expect(
                    page.locator("#order-proposed-sum")
                ).toHaveValue("1400");
            }
        );

        // ------------------------------------------------
        // 6. ВЫБОР Т-БАНКА
        // ------------------------------------------------

        test(
            "выбирает Т-Банк и создаёт платёж через его API",
            async ({ page }) => {
                const highlight = page
                    .locator(".promoBox .promoOption")
                    .filter({
                        hasText: "Выделить цветом",
                    });

                await highlight.click();

                await expect(
                    page.locator(".totalAmount")
                ).toHaveText("50 ₽");

                const tbankButton = page.getByRole(
                    "button",
                    {
                        name: /Т-Банк/,
                    }
                );

                await tbankButton.click();

                await expect(
                    tbankButton
                ).toHaveAttribute(
                    "aria-pressed",
                    "true"
                );

                const paymentNavigation =
                    await mockPaymentNavigation(page);

                let tbankRequest = null;
                let yooRequests = 0;

                await page.route(
                    "**/api/tbank-payments/order/promotion/create",
                    async (route) => {
                        tbankRequest = route.request();

                        await route.fulfill({
                            status: 200,
                            json: {
                                success: true,
                                confirmationUrl:
                                    "https://payment.example.test/confirm",
                            },
                        });
                    }
                );

                await page.route(
                    "**/api/payments/order/promotion/create",
                    async (route) => {
                        yooRequests++;

                        await route.fulfill({
                            status: 500,
                            json: {
                                success: false,
                            },
                        });
                    }
                );

                await fillRequiredOrderFields(page);

                await clickCreateOrderButton(page);

                await expect.poll(
                    () => tbankRequest
                ).not.toBeNull();

                expect(
                    tbankRequest.method()
                ).toBe("POST");

                expect(
                    tbankRequest.postDataJSON()
                ).toEqual({
                    orderId: 777,
                });

                expect(yooRequests).toBe(0);

                await expect
                    .poll(
                        () => paymentNavigation.getOpenedUrl()
                    )
                    .toBe(
                        "https://payment.example.test/confirm"
                    );

                await expect(page).toHaveURL(
                    "https://payment.example.test/confirm"
                );
            }
        );

        // ------------------------------------------------
        // 7. СОХРАНЁННАЯ КАРТА
        // ------------------------------------------------

        test(
            "после успешной оплаты сохранённой картой открывает заказы",
            async ({ page }) => {
                let paymentRequests = 0;

                await page.route(
                    "**/api/payments/order/promotion/create",
                    async (route) => {
                        paymentRequests++;

                        await route.fulfill({
                            status: 200,
                            json: {
                                success: true,
                                paidBySavedCard: true,
                                paid: true,
                            },
                        });
                    }
                );

                const messages = [];

                page.on(
                    "dialog",
                    async (dialog) => {
                        messages.push(
                            dialog.message()
                        );

                        await dialog.accept();
                    }
                );

                await page
                    .locator(".promoBox .promoOption")
                    .filter({
                        hasText: "Выделить цветом",
                    })
                    .click();

                await fillRequiredOrderFields(page);

                await clickCreateOrderButton(page);

                await expect.poll(
                    () =>
                        messages.some((message) =>
                            message.includes(
                                "продвижение оплачено"
                            )
                        )
                ).toBe(true);

                await expect(page).toHaveURL(
                    /\/orders(?:\?|$)/
                );

                expect(paymentRequests).toBe(1);
            }
        );

        // ------------------------------------------------
        // 8. ОШИБКА ПЛАТЁЖНОГО ПРОВАЙДЕРА
        // ------------------------------------------------

        test(
            "показывает ошибку банка без перехода на оплату",
            async ({ page }) => {
                await page.route(
                    "**/api/payments/order/promotion/create",
                    async (route) => {
                        await route.fulfill({
                            status: 200,
                            json: {
                                success: false,
                                error:
                                    "Тестовый платёж отклонён",
                            },
                        });
                    }
                );

                await page
                    .locator(".promoBox .promoOption")
                    .filter({
                        hasText: "Выделить цветом",
                    })
                    .click();

                await fillRequiredOrderFields(page);

                await clickCreateOrderButton(page);

                await expect(
                    page.locator(".createOrderErrorToast__message")
                ).toContainText(
                    "Тестовый платёж отклонён"
                );

                await expect(page).toHaveURL(
                    /\/create-order(?:\?|$)/
                );

                await expect(
                    page.getByRole("button", {
                        name: "Создать заказ",
                    })
                ).toBeEnabled();
            }
        );
    }
);

// ============================================================
// ДОПОЛНИТЕЛЬНЫЕ E2E-ТЕСТЫ ОБЫЧНОГО ЗАКАЗА
// Границы оплаты, координаты и данные отправки.
// ============================================================

function readMultipartText(request, fieldName) {
    const body = request.postData() || "";

    const pattern = new RegExp(
        `name="${fieldName}"\\r?\\n\\r?\\n([^\\r\\n]*)`
    );

    const match = body.match(pattern);

    if (!match) {
        throw new Error(
            `Поле "${fieldName}" отсутствует в FormData`
        );
    }

    return match[1];
}

test.describe(
    "CreateOrderPage — дополнительные проверки",
    () => {
        test.beforeEach(async ({ page }) => {
            await openCreateOrderPage(page);
        });

        test(
            "гарантийная оплата недоступна до подключения",
            async ({ page }) => {
                const cash = page.locator(
                    'input[name="paymentType"][value="cash"]'
                );

                const guarantee = page.locator(
                    'input[name="paymentType"][value="guarantee"]'
                );

                await expect(cash).toBeChecked();

                await expect(guarantee).toBeDisabled();

                await expect(
                    page.getByText(
                        "Гарантийные расчёты находятся на этапе подключения."
                    )
                ).toBeVisible();
            }
        );

        test(
            "не отправляет заказ с адресом без подтверждённых координат",
            async ({ page }) => {
                let createRequests = 0;

                await page.route(
                    "**/api/orders/",
                    async (route) => {
                        createRequests++;

                        await route.fulfill({
                            status: 200,
                            json: {
                                success: true,
                                id: 777,
                            },
                        });
                    }
                );

                await fillRequiredOrderFields(page);

                await clickAddressCard(page);

                const addressInput = page.getByPlaceholder(
                    "Введите адрес"
                );

                // Меняем адрес, но не выбираем
                // географическую подсказку.
                await addressInput.fill(
                    "Симферополь, неизвестная улица, 999"
                );

                await clickCreateOrderButton(page);

                await expect(
                    page.locator(
                        ".createOrderErrorToast__message"
                    )
                ).toContainText(
                    "Не удалось определить координаты адреса"
                );

                expect(createRequests).toBe(0);
            }
        );

        test(
            "передаёт основные поля заказа через multipart",
            async ({ page }) => {
                let createRequest = null;

                await page.route(
                    "**/api/orders/",
                    async (route) => {
                        createRequest = route.request();

                        await route.fulfill({
                            status: 200,
                            json: {
                                success: true,
                                id: 777,
                            },
                        });
                    }
                );

                page.on("dialog", (dialog) => {
                    dialog.accept();
                });

                await fillRequiredOrderFields(page);

                await clickCreateOrderButton(page);

                await expect.poll(
                    () => createRequest
                ).not.toBeNull();

                expect(createRequest.method()).toBe("POST");

                expect(
                    createRequest.headers()["content-type"]
                ).toContain("multipart/form-data");

                expect(
                    readMultipartText(createRequest, "categoryId")
                ).toBe("1");

                expect(
                    readMultipartText(createRequest, "subcategoryId")
                ).toBe("10");

                expect(
                    readMultipartText(createRequest, "proposedSum")
                ).toBe("1500");

                expect(
                    readMultipartText(createRequest, "paymentType")
                ).toBe("cash");

                expect(
                    readMultipartText(createRequest, "isAsap")
                ).toBe("true");

                expect(
                    readMultipartText(createRequest, "coordinates")
                ).toBe("44.9521,34.1024");

                expect(
                    readMultipartText(createRequest, "description")
                ).toBe(
                    "Нужно перевезти мебель аккуратно"
                );

                expect(
                    readMultipartJson(createRequest, "promotion")
                ).toEqual({
                    highlight: false,
                    recommended: false,
                    push: false,
                });
            }
        );

        test(
            "при заказе ко времени передаёт дату выполнения",
            async ({ page }) => {
                let createRequest = null;

                await page.route(
                    "**/api/orders/",
                    async (route) => {
                        createRequest = route.request();

                        await route.fulfill({
                            status: 200,
                            json: {
                                success: true,
                                id: 777,
                            },
                        });
                    }
                );

                page.on("dialog", (dialog) => {
                    dialog.accept();
                });

                await fillRequiredOrderFields(page);

                await clickAsapToggle(page);

                await expect(
                    page.locator(".timeChipValue")
                ).toHaveText("Ко времени");

                await clickCreateOrderButton(page);

                await expect.poll(
                    () => createRequest
                ).not.toBeNull();

                expect(
                    readMultipartText(createRequest, "isAsap")
                ).toBe("false");

                const workTime = readMultipartText(
                    createRequest,
                    "workTime"
                );

                expect(workTime).toMatch(
                    /^\d{4}-\d{2}-\d{2}T/
                );

                expect(
                    Number.isNaN(Date.parse(workTime))
                ).toBe(false);
            }
        );

        test(
            "суммирует три продвижения и отправляет их в платёж",
            async ({ page }) => {
                const promotionNames = [
                    "Выделить цветом",
                    "Рекомендуемый заказ",
                    "Push-уведомление исполнителям",
                ];

                for (const name of promotionNames) {
                    const option = page
                        .locator(".promoBox .promoOption")
                        .filter({ hasText: name });

                    await option.click();

                    await expect(
                        option.locator('input[type="checkbox"]')
                    ).toBeChecked();
                }

                await expect(
                    page.locator(".totalAmount")
                ).toHaveText("300 ₽");

                let createRequest = null;
                let paymentBody = null;

                await page.route(
                    "**/api/orders/",
                    async (route) => {
                        createRequest = route.request();

                        await route.fulfill({
                            status: 200,
                            json: {
                                success: true,
                                id: 777,
                            },
                        });
                    }
                );

                await page.route(
                    "**/api/payments/order/promotion/create",
                    async (route) => {
                        paymentBody = route.request().postDataJSON();

                        await route.fulfill({
                            status: 200,
                            json: {
                                success: true,
                                paidBySavedCard: true,
                                paid: true,
                            },
                        });
                    }
                );

                page.on("dialog", (dialog) => {
                    dialog.accept();
                });

                await fillRequiredOrderFields(page);

                await clickCreateOrderButton(page);

                await expect.poll(
                    () => createRequest
                ).not.toBeNull();

                expect(
                    readMultipartJson(createRequest, "promotion")
                ).toEqual({
                    highlight: true,
                    recommended: true,
                    push: true,
                });

                await expect.poll(
                    () => paymentBody
                ).toEqual({
                    orderId: 777,
                });

                await expect(page).toHaveURL(
                    /\/orders(?:\?|$)/
                );
            }
        );
    }
);