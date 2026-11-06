import { test, expect } from "./fixtures/safeTest";
import { setAdminAuth } from "./utils/adminTestAuth";

const FRONT_URL = "http://localhost:3001";

const categories = [
    { id: 1, name: "Грузоперевозки" },
    { id: 2, name: "Ремонт" },
    { id: 3, name: "Такси" },
    { id: 4, name: "Курьер" },
];

const subcategories = [
    { id: 10, name: "Перевозка мебели" },
    { id: 11, name: "Вывоз мусора" },
];

const yandexSuggestionPushkina = {
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
                        Point: {
                            pos: "34.1024 44.9521",
                        },
                    },
                },
            ],
        },
    },
};

const yandexSuggestionKirova = {
    response: {
        GeoObjectCollection: {
            featureMember: [
                {
                    GeoObject: {
                        metaDataProperty: {
                            GeocoderMetaData: {
                                text: "Россия, Республика Крым, Симферополь, проспект Кирова, 10",
                            },
                        },
                        Point: {
                            pos: "34.0987 44.9489",
                        },
                    },
                },
            ],
        },
    },
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


async function setupMocks(page, options = {}) {
    const {
        regularStatus = 200,
        regularBody = { success: true },
        expressStatus = 200,
        expressBody = { success: true },
        onRegularCreate,
        onExpressCreate,
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

    await page.route("**/api/category/search**", async (route) => {
        const query = new URL(
            route.request().url()
        ).searchParams.get("q") || "";

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                query,
                results: [
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
                    },
                    {
                        type: "subcategory",
                        categoryId: 2,
                        categoryName: "Ремонт",
                        subcategoryId: 20,
                        subcategoryName: "Ремонт сантехники",
                        label: "Ремонт сантехники",
                    },
                    {
                        type: "category",
                        categoryId: 3,
                        categoryName: "Такси",
                        subcategoryId: null,
                        label: "Такси",
                    },
                    {
                        type: "category",
                        categoryId: 4,
                        categoryName: "Курьер",
                        subcategoryId: null,
                        label: "Курьер",
                    },
                ],
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

    await page.route("**/api/auth/profile", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                id: 1,
                username: "admin",
                name: "admin",
                role: "admin",
                isAdmin: true,
            }),
        });
    });

    await page.route("**/api/auth/me", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                id: 1,
                username: "admin",
                name: "admin",
                role: "admin",
                isAdmin: true,
            }),
        });
    });

    await page.route("https://geocode-maps.yandex.ru/1.x/**", async (route) => {
        const url = decodeURIComponent(route.request().url());

        const body =
            url.includes("Кирова") || url.includes("проспект")
                ? yandexSuggestionKirova
                : yandexSuggestionPushkina;

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(body),
        });
    });

    await page.route("https://api-maps.yandex.ru/2.1/**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/javascript",
            body: `
                window.ymaps = {
                    ready: function() {
                        return Promise.resolve();
                    },
                    route: function() {
                        return Promise.resolve({
                            getLength: function() { return 5400; },
                            getTime: function() { return 900; }
                        });
                    }
                };
            `,
        });
    });

    await page.route("**/api/admin/create-order", async (route) => {
        onRegularCreate?.(route.request().postDataJSON());

        await route.fulfill({
            status: regularStatus,
            contentType: "application/json",
            body: JSON.stringify(regularBody),
        });
    });

    await page.route("**/api/admin/create-express-order", async (route) => {
        onExpressCreate?.(route.request().postDataJSON());

        await route.fulfill({
            status: expressStatus,
            contentType: "application/json",
            body: JSON.stringify(expressBody),
        });
    });

    // Список обычных заказов после перехода на /orders
    await page.route(
        "**/api/admin/orders",
        async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify([]),
            });
        }
    );

// Список экспресс-заказов после перехода на /orders
    await page.route(
        "**/api/admin/express-orders",
        async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify([]),
            });
        }
    );
}

async function openAdminCreateOrderPage(page, options = {}) {
    await setAdminAuth(page);
    await setupMocks(page, options);

    await page.goto(`${FRONT_URL}/create-order/123`);
    await page.waitForLoadState("domcontentloaded");

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "admin-create-order-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("AdminCreateOrderPage редиректит на /login. Проверь auth guard админки.");
    }

    if (!(await page.locator(".admin-create-page").count())) {
        await page.screenshot({
            path: "admin-create-order-wrong-route.png",
            fullPage: true,
        });

        throw new Error(
            `AdminCreateOrderPage не найдена. Текущий URL: ${page.url()}. Проверь route через: grep -R "AdminCreateOrderPage\\|create-order" -n src`
        );
    }

    await expect(page.locator(".admin-create-page")).toBeVisible({
        timeout: 15000,
    });

    await expect(page.locator(".admin-page-title")).toHaveText("Создать заказ");
}

async function waitAndPickFirstSuggestion(page) {
    await expect(page.locator(".admin-suggestions li").first()).toBeVisible({
        timeout: 10000,
    });

    await page.locator(".admin-suggestions li").first().click();
}

async function selectRegularService(page) {
    const serviceInput = page.getByPlaceholder(
        "Например: перевезти диван, починить кран"
    );

    await serviceInput.fill("перевезти диван");

    const suggestion = page
        .locator(".admin-service-result")
        .filter({
            hasText: "Перевозка мебели",
        });

    await expect(suggestion).toBeVisible();

    await suggestion.click();

    await expect(
        page.locator(".admin-selected-service-name")
    ).toHaveText("Перевозка мебели");
}

async function fillRegularOrder(page) {
    await page.getByPlaceholder("Введите адрес").fill("Пушкина 1");

    await waitAndPickFirstSuggestion(page);

    await selectRegularService(page);

    await page.getByPlaceholder("Что нужно сделать?").fill("Перевезти диван");
    await page.getByPlaceholder("Например 1500").fill("2500");
}

async function switchToExpress(page) {
    await page.getByRole("button", {
        name: "Экспресс",
    }).click();

    await expect(page.locator(".admin-mode-btn.active")).toHaveText("Экспресс");
    await expect(page.getByPlaceholder("Адрес точки A")).toBeVisible();
}

async function fillExpressOrder(page) {
    await switchToExpress(page);

    await page.getByPlaceholder("Адрес точки A").fill("Пушкина 1");

    await waitAndPickFirstSuggestion(page);

    await page.getByPlaceholder("Адрес точки B").fill("Кирова 10");

    await waitAndPickFirstSuggestion(page);

    await page.getByPlaceholder("Например 500").fill("700");
    await page.getByPlaceholder("Комментарий к экспресс-заказу").fill("Подъехать аккуратно");
}

test.describe("AdminCreateOrderPage", () => {
    test("отображает страницу создания заказа для пользователя", async ({ page }) => {
        await openAdminCreateOrderPage(page);

        await expect(page.locator(".admin-page-title")).toHaveText("Создать заказ");
        await expect(page.locator(".admin-page-subtitle")).toHaveText("Для пользователя #123");

        await expect(page.getByRole("button", { name: "Обычный" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Экспресс" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Создать заказ" })).toBeVisible();
    });

    test("по умолчанию открыт режим обычного заказа", async ({ page }) => {
        await openAdminCreateOrderPage(page);

        await expect(page.locator(".admin-mode-btn.active")).toHaveText("Обычный");

        await expect(page.locator(".admin-section-title", { hasText: "Время и адрес" })).toBeVisible();
        await expect(
            page.locator(".admin-section-title", {
                hasText: "Что нужно сделать?",
            })
        ).toBeVisible();

        await expect(
            page.getByPlaceholder(
                "Например: перевезти диван, починить кран"
            )
        ).toBeVisible();
        await expect(page.locator(".admin-section-title", { hasText: "Описание" })).toBeVisible();

        await expect(page.getByPlaceholder("Введите адрес")).toBeVisible();
        await expect(page.getByPlaceholder("Что нужно сделать?")).toBeVisible();
        await expect(page.getByPlaceholder("Например 1500")).toBeVisible();
    });

    test("переключается на экспресс-заказ", async ({ page }) => {
        await openAdminCreateOrderPage(page);

        await switchToExpress(page);

        await expect(page.getByText("Тип экспресс-заказа")).toBeVisible();
        await expect(page.getByText("Маршрут")).toBeVisible();
        await expect(page.getByText("Параметры заказа")).toBeVisible();

        await expect(page.getByPlaceholder("Адрес точки A")).toBeVisible();
        await expect(page.getByPlaceholder("Адрес точки B")).toBeVisible();
        await expect(page.getByPlaceholder("Комментарий к экспресс-заказу")).toBeVisible();
    });

    test("поиск показывает услуги и скрывает Такси/Курьер", async ({ page }) => {
        await openAdminCreateOrderPage(page);

        await page.getByPlaceholder(
            "Например: перевезти диван, починить кран"
        ).fill("перевезти диван");

        const results = page.locator(
            ".admin-service-result-list"
        );

        await expect(results).toBeVisible();

        await expect(results).toContainText(
            "Перевозка мебели"
        );

        await expect(results).toContainText(
            "Вывоз мусора"
        );

        await expect(results).not.toContainText("Такси");
        await expect(results).not.toContainText("Курьер");
    });

    test("выбор услуги сохраняет категорию и подкатегорию", async ({ page }) => {
        await openAdminCreateOrderPage(page);

        await selectRegularService(page);

        await expect(
            page.locator(".admin-selected-service-category")
        ).toContainText(
            "Категория: Грузоперевозки"
        );

        await expect(
            page.getByRole("button", {
                name: "Изменить",
            })
        ).toBeVisible();
    });

    test("показывает подсказки адреса для обычного заказа и выбирает адрес", async ({ page }) => {
        await openAdminCreateOrderPage(page);

        const addressInput = page.getByPlaceholder("Введите адрес");

        await addressInput.fill("Пушкина 1");

        await waitAndPickFirstSuggestion(page);

        await expect(addressInput).toHaveValue(
            "Россия, Республика Крым, Симферополь, улица Пушкина, 1"
        );
    });

    test("валидация обычного заказа: требует адрес", async ({ page }) => {
        await openAdminCreateOrderPage(page);

        await page.getByRole("button", {
            name: "Создать заказ",
        }).click();

        await expect(page.locator(".admin-alert-danger")).toBeVisible();
        await expect(page.locator(".admin-alert-text")).toHaveText("Укажите адрес");
    });

    test("валидация обычного заказа: требует категорию", async ({ page }) => {
        await openAdminCreateOrderPage(page);

        await page.getByPlaceholder("Введите адрес").fill("Пушкина 1");
        await waitAndPickFirstSuggestion(page);

        await page.getByRole("button", {
            name: "Создать заказ",
        }).click();

        await expect(page.locator(".admin-alert-danger")).toBeVisible();
        await expect(page.locator(".admin-alert-text"))
            .toHaveText(
                "Выберите подходящую услугу из подсказки"
            );
    });

    test("создаёт обычный заказ", async ({ page }) => {
        let createdPayload = null;

        await openAdminCreateOrderPage(page, {
            onRegularCreate: (body) => {
                createdPayload = body;
            },
        });

        await fillRegularOrder(page);

        const dialogPromise = page.waitForEvent("dialog");

        await page.getByRole("button", {
            name: "Создать заказ",
        }).click();

        const dialog = await dialogPromise;

        expect(dialog.message()).toBe("Обычный заказ успешно создан");

        await dialog.accept();

        await expect
            .poll(() => createdPayload, {
                timeout: 10000,
            })
            .toEqual(
                expect.objectContaining({
                    userId: 123,
                    description: "Перевезти диван",
                    address: "Россия, Республика Крым, Симферополь, улица Пушкина, 1",
                    proposedSum: 2500,
                    paymentType: "cash",
                    categoryId: 1,
                    subcategoryId: 10,
                    coordinates: "44.9521,34.1024",
                })
            );

        await expect(page).toHaveURL(/\/orders/);
    });

    test("если создание обычного заказа падает, показывает ошибку", async ({ page }) => {
        await openAdminCreateOrderPage(page, {
            regularStatus: 500,
            regularBody: {
                message: "Не удалось создать тестовый заказ",
            },
        });

        await fillRegularOrder(page);

        await page.getByRole("button", {
            name: "Создать заказ",
        }).click();

        await expect(page.locator(".admin-alert-danger")).toBeVisible({
            timeout: 10000,
        });

        await expect(page.locator(".admin-alert-text")).toHaveText(
            "Не удалось создать тестовый заказ"
        );
    });

    test("переключает режим времени Срочно / Ко времени", async ({ page }) => {
        await openAdminCreateOrderPage(page);

        await expect(page.getByText("Срочно")).toBeVisible();

        await page.locator(".admin-toggle").click();

        await expect(page.getByText("Ко времени")).toBeVisible();
        await expect(page.locator(".react-datepicker-wrapper input")).toBeVisible();

        await page.locator(".admin-toggle").click();

        await expect(page.getByText("Срочно")).toBeVisible();
        await expect(page.locator(".react-datepicker-wrapper input")).not.toBeVisible();
    });

    test("по умолчанию express type taxi", async ({ page }) => {
        await openAdminCreateOrderPage(page);

        await switchToExpress(page);

        await expect(page.getByRole("button", { name: /🚕 Такси/i })).toHaveClass(/active/);
        await expect(page.getByRole("button", { name: /📦 Курьер/i })).not.toHaveClass(/active/);

        await expect(page.getByRole("button", { name: /Перевозка пассажиров/i })).toBeVisible();
        await expect(page.getByRole("button", { name: /Между городами/i })).toBeVisible();
    });

    test("переключает express type на courier и показывает courier options", async ({ page }) => {
        await openAdminCreateOrderPage(page);

        await switchToExpress(page);

        await page.getByRole("button", {
            name: /📦 Курьер/i,
        }).click();

        await expect(page.getByRole("button", { name: /📦 Курьер/i })).toHaveClass(/active/);
        await expect(page.getByRole("button", { name: /🚕 Такси/i })).not.toHaveClass(/active/);

        await expect(page.getByRole("button", { name: /Цветы/i })).toBeVisible();
        await expect(page.getByRole("button", { name: /Еда\/продукты/i })).toBeVisible();
        await expect(page.getByRole("button", { name: /Документы/i })).toBeVisible();
    });

    test("выбирает и снимает express subcategory chip", async ({ page }) => {
        await openAdminCreateOrderPage(page);

        await switchToExpress(page);

        const chip = page.getByRole("button", {
            name: /Перевозка пассажиров/i,
        });

        await chip.click();

        await expect(chip).toHaveClass(/selected/);

        await chip.click();

        await expect(chip).not.toHaveClass(/selected/);
    });

    test("показывает подсказки для express адресов и выбирает точки A/B", async ({ page }) => {
        await openAdminCreateOrderPage(page);

        await switchToExpress(page);

        const fromInput = page.getByPlaceholder("Адрес точки A");
        const toInput = page.getByPlaceholder("Адрес точки B");

        await fromInput.fill("Пушкина 1");
        await waitAndPickFirstSuggestion(page);

        await expect(fromInput).toHaveValue(
            "Россия, Республика Крым, Симферополь, улица Пушкина, 1"
        );

        await toInput.fill("Кирова 10");
        await waitAndPickFirstSuggestion(page);

        await expect(toInput).toHaveValue(
            "Россия, Республика Крым, Симферополь, проспект Кирова, 10"
        );
    });

    test("валидация express: требует адреса", async ({ page }) => {
        await openAdminCreateOrderPage(page);

        await switchToExpress(page);

        await page.getByRole("button", {
            name: "Создать заказ",
        }).click();

        await expect(page.locator(".admin-alert-danger")).toBeVisible();
        await expect(page.locator(".admin-alert-text")).toHaveText("Заполните адреса Откуда и Куда");
    });

    test("валидация express: требует цену", async ({ page }) => {
        await openAdminCreateOrderPage(page);

        await switchToExpress(page);

        await page.getByPlaceholder("Адрес точки A").fill("Пушкина 1");
        await waitAndPickFirstSuggestion(page);

        await page.getByPlaceholder("Адрес точки B").fill("Кирова 10");
        await waitAndPickFirstSuggestion(page);

        await page.getByRole("button", {
            name: "Создать заказ",
        }).click();

        await expect(page.locator(".admin-alert-danger")).toBeVisible();
        await expect(page.locator(".admin-alert-text")).toHaveText("Укажите цену");
    });

    test("создаёт express taxi заказ", async ({ page }) => {
        let createdPayload = null;

        await openAdminCreateOrderPage(page, {
            onExpressCreate: (body) => {
                createdPayload = body;
            },
        });

        await fillExpressOrder(page);

        const dialogPromise = page.waitForEvent("dialog");

        await page.getByRole("button", {
            name: "Создать заказ",
        }).click();

        const dialog = await dialogPromise;

        expect(dialog.message()).toBe("Экспресс-заказ успешно создан");

        await dialog.accept();

        await expect
            .poll(() => createdPayload, {
                timeout: 10000,
            })
            .toEqual(
                expect.objectContaining({
                    userId: 123,
                    type: "taxi",
                    subcategory: null,
                    paymentType: "cash",
                    totalPrice: 700,
                    description: "Подъехать аккуратно",
                    fromAddress: "Россия, Республика Крым, Симферополь, улица Пушкина, 1",
                    fromLat: 44.9521,
                    fromLng: 34.1024,
                    toAddress: "Россия, Республика Крым, Симферополь, проспект Кирова, 10",
                    toLat: 44.9489,
                    toLng: 34.0987,
                })
            );

        await expect(page).toHaveURL(/\/orders/);
    });

    test("создаёт express courier заказ с подкатегорией", async ({ page }) => {
        let createdPayload = null;

        await openAdminCreateOrderPage(page, {
            onExpressCreate: (body) => {
                createdPayload = body;
            },
        });

        await switchToExpress(page);

        await page.getByRole("button", {
            name: /📦 Курьер/i,
        }).click();

        await page.getByRole("button", {
            name: /Документы/i,
        }).click();

        await page.getByPlaceholder("Адрес точки A").fill("Пушкина 1");
        await waitAndPickFirstSuggestion(page);

        await page.getByPlaceholder("Адрес точки B").fill("Кирова 10");
        await waitAndPickFirstSuggestion(page);

        await page.getByPlaceholder("Например 500").fill("900");

        const dialogPromise = page.waitForEvent("dialog");

        await page.getByRole("button", {
            name: "Создать заказ",
        }).click();

        const dialog = await dialogPromise;

        expect(dialog.message()).toBe("Экспресс-заказ успешно создан");

        await dialog.accept();

        await expect
            .poll(() => createdPayload, {
                timeout: 10000,
            })
            .toEqual(
                expect.objectContaining({
                    userId: 123,
                    type: "courier",
                    subcategory: "Документы",
                    paymentType: "cash",
                    totalPrice: 900,
                })
            );
    });

    test("если создание express заказа падает, показывает ошибку", async ({ page }) => {
        await openAdminCreateOrderPage(page, {
            expressStatus: 500,
            expressBody: {
                message: "Не удалось создать express",
            },
        });

        await fillExpressOrder(page);

        await page.getByRole("button", {
            name: "Создать заказ",
        }).click();

        await expect(page.locator(".admin-alert-danger")).toBeVisible({
            timeout: 10000,
        });

        await expect(page.locator(".admin-alert-text")).toHaveText(
            "Не удалось создать express"
        );
    });

    test("кнопка Назад вызывает переход назад", async ({ page }) => {
        await openAdminCreateOrderPage(page);

        await page.goto(`${FRONT_URL}/orders`);
        await page.goto(`${FRONT_URL}/create-order/123`);

        await page.getByRole("button", {
            name: "Назад",
        }).click();

        await expect(page).toHaveURL(/\/orders/);
    });
});