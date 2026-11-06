import { test, expect } from "./fixtures/safeTest";

import {
    setAdminAuth,
    ADMIN_TEST_TOKEN,
} from "./utils/adminTestAuth";

const SERVICE = {
    type: "subcategory",
    categoryId: 5,
    categoryName: "Клининг",
    subcategoryId: 51,
    subcategoryName: "Уборка квартиры",
    label: "Уборка квартиры",

    formConfig: {
        fields: [
            {
                key: "cleaningType",
                type: "select",
                label: "Тип уборки",
                required: true,
                options: [
                    {
                        value: "regular",
                        label: "Обычная",
                    },
                    {
                        value: "deep",
                        label: "Генеральная",
                    },
                ],
            },
            {
                key: "areaSqm",
                type: "number",
                label: "Площадь",
                required: true,
                min: 10,
                max: 300,
            },
            {
                key: "windowsCleaning",
                type: "boolean",
                label: "Мытьё окон",
            },
            {
                key: "comment",
                type: "textarea",
                label: "Пожелания",
                placeholder: "Дополнительные пожелания",
            },
            {
                key: "contact",
                type: "text",
                label: "Контакт",
                placeholder: "Контакт на объекте",
            },
        ],
    },

    pricingConfig: {
        enabled: true,
        calculator: "cleaning",
        pricePerSqm: {
            regular: 100,
            deep: 150,
        },
        windowsCleaningPrice: 500,
        rangePercent: 10,
        minimumPrice: 1000,
        maximumPrice: 300000,
        version: 1,
    },
};

const ADDRESS_SERVICE = {
    ...SERVICE,
    formConfig: {
        fields: [
            {
                key: "destination",
                type: "address",
                label: "Адрес назначения",
                placeholder: "Укажите второй адрес",
                required: true,
            },
        ],
    },
    pricingConfig: null,
};

const PUSHKINA =
    "Россия, Республика Крым, Симферополь, улица Пушкина, 1";

const KIROVA =
    "Россия, Республика Крым, Симферополь, проспект Кирова, 10";

function geocodeResponse(address, longitude, latitude) {
    return {
        response: {
            GeoObjectCollection: {
                featureMember: [
                    {
                        GeoObject: {
                            name: address,
                            metaDataProperty: {
                                GeocoderMetaData: {
                                    text: address,
                                },
                            },
                            Point: {
                                pos: `${longitude} ${latitude}`,
                            },
                        },
                    },
                ],
            },
        },
    };
}

async function setupMocks(page, service = SERVICE) {
    const state = {
        created: [],
        searches: [],
    };

    await page.route(
        "**/api/category/search**",
        async (route) => {
            const query = new URL(
                route.request().url()
            ).searchParams.get("q");

            state.searches.push(query);

            await route.fulfill({
                status: 200,
                json: {
                    query,
                    results: [service],
                },
            });
        }
    );

    await page.route(
        "**/api/category",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: [],
            });
        }
    );

    await page.route(
        "**/api/category/subcategory/5",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: [],
            });
        }
    );

    await page.route(
        "**/api/auth/profile",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    id: 1,
                    role: "admin",
                },
            });
        }
    );

    await page.route(
        "**/api/auth/me",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    id: 1,
                    role: "admin",
                },
            });
        }
    );

    await page.route(
        "https://geocode-maps.yandex.ru/1.x/**",
        async (route) => {
            const query = decodeURIComponent(
                route.request().url()
            );

            const isKirova = query.includes("Кирова");

            await route.fulfill({
                status: 200,
                json: isKirova
                    ? geocodeResponse(
                        KIROVA,
                        34.0987,
                        44.9489
                    )
                    : geocodeResponse(
                        PUSHKINA,
                        34.1024,
                        44.9521
                    ),
            });
        }
    );

    await page.route(
        "https://api-maps.yandex.ru/2.1/**",
        async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/javascript",
                body: `
                    window.ymaps = {
                        ready: () => Promise.resolve(),
                        route: () => Promise.resolve({
                            getLength: () => 5400,
                            getTime: () => 900
                        })
                    };
                `,
            });
        }
    );

    await page.route(
        "**/api/admin/create-order",
        async (route) => {
            state.created.push({
                method: route.request().method(),
                headers: route.request().headers(),
                body: route.request().postDataJSON(),
            });

            await route.fulfill({
                status: 200,
                json: {
                    success: true,
                    orderId: 777,
                },
            });
        }
    );

    await page.route(
        "**/api/admin/orders",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: [],
            });
        }
    );

    await page.route(
        "**/api/admin/express-orders",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: [],
            });
        }
    );

    return state;
}

async function openPage(page, service = SERVICE) {
    await setAdminAuth(page);

    const state = await setupMocks(page, service);

    await page.goto("/create-order/123");

    await expect(
        page.locator(".admin-create-page")
    ).toBeVisible();

    return state;
}

async function selectService(page) {
    await page.getByPlaceholder(
        "Например: перевезти диван, починить кран"
    ).fill("уборка");

    const option = page
        .locator(".admin-service-result")
        .filter({
            hasText: "Уборка квартиры",
        });

    await expect(option).toBeVisible();

    await option.click();

    await expect(
        page.locator(".admin-selected-service-name")
    ).toHaveText("Уборка квартиры");
}

async function selectMainAddress(page) {
    await page.getByPlaceholder(
        "Введите адрес"
    ).fill("Пушкина 1");

    const suggestion = page.locator(
        ".admin-suggestions li"
    ).first();

    await expect(suggestion).toBeVisible();

    await suggestion.click();

    await expect(
        page.getByPlaceholder("Введите адрес")
    ).toHaveValue(PUSHKINA);
}

function details(page) {
    return page.locator(".dynamicServiceFields");
}

async function fillCleaningDetails(page, area = 30) {
    await details(page)
        .locator("select")
        .selectOption("regular");

    await details(page)
        .locator('input[type="number"]')
        .fill(String(area));
}

async function fillReadyOrder(page) {
    await selectMainAddress(page);
    await selectService(page);
    await fillCleaningDetails(page);

    await page.getByPlaceholder(
        "Например 1500"
    ).fill("3500");
}

async function submitOrder(page) {
    page.on("dialog", async (dialog) => {
        await dialog.accept();
    });

    await page.getByRole("button", {
        name: "Создать заказ",
    }).click();
}

test.describe("Создание заказа — динамические поля", () => {

    test("отображает все типы полей услуги", async ({ page }) => {
        await openPage(page);
        await selectService(page);

        const form = details(page);

        await expect(form).toBeVisible();

        await expect(
            form.locator("select")
        ).toHaveCount(1);

        await expect(
            form.locator('input[type="number"]')
        ).toHaveCount(1);

        await expect(
            form.locator('input[type="checkbox"]')
        ).toHaveCount(1);

        await expect(
            form.locator("textarea")
        ).toHaveCount(1);

        await expect(
            form.getByPlaceholder("Контакт на объекте")
        ).toBeVisible();
    });

    test("обязательный список нельзя оставить пустым", async ({ page }) => {
        const state = await openPage(page);

        await selectMainAddress(page);
        await selectService(page);

        const select = details(page).locator("select");

        await expect(select).toHaveAttribute(
            "required",
            ""
        );

        expect(
            await select.evaluate(
                (element) => element.validity.valueMissing
            )
        ).toBe(true);

        await page.getByRole("button", {
            name: "Создать заказ",
        }).click();

        expect(state.created).toHaveLength(0);
    });

    test("числовое поле соблюдает минимальное и максимальное значения", async ({ page }) => {
        await openPage(page);
        await selectService(page);

        const input = details(page).locator(
            'input[type="number"]'
        );

        await input.fill("9");

        expect(
            await input.evaluate(
                (element) => element.validity.rangeUnderflow
            )
        ).toBe(true);

        await input.fill("301");

        expect(
            await input.evaluate(
                (element) => element.validity.rangeOverflow
            )
        ).toBe(true);

        await input.fill("30");

        expect(
            await input.evaluate(
                (element) => element.checkValidity()
            )
        ).toBe(true);
    });

    test("рекомендуемая цена не появляется без обязательных параметров", async ({ page }) => {
        await openPage(page);
        await selectService(page);

        await expect(
            page.locator(".admin-recommended-price")
        ).toHaveCount(0);

        await details(page)
            .locator("select")
            .selectOption("regular");

        await expect(
            page.locator(".admin-recommended-price")
        ).toHaveCount(0);

        await details(page)
            .locator('input[type="number"]')
            .fill("30");

        await expect(
            page.locator(".admin-recommended-price")
        ).toBeVisible();
    });

    test("рассчитывает рекомендуемую цену и подставляет сумму", async ({ page }) => {
        await openPage(page);
        await selectService(page);
        await fillCleaningDetails(page);

        const recommended = page.locator(
            ".admin-recommended-price"
        );

        // 30 м² × 100 ₽ = 3000 ₽.
        await expect(recommended).toContainText(
            /2\s*700/
        );

        await expect(recommended).toContainText(
            /3\s*300/
        );

        await recommended.getByRole("button", {
            name: "Указать сумму",
        }).click();

        await expect(
            page.getByPlaceholder("Например 1500")
        ).toHaveValue("3000");
    });

    test("переключатель Мытьё окон пересчитывает цену", async ({ page }) => {
        await openPage(page);
        await selectService(page);
        await fillCleaningDetails(page);

        const checkbox = details(page).locator(
            'input[type="checkbox"]'
        );

        await checkbox.check();

        // 3000 ₽ за уборку + 500 ₽ за окна.
        await page.getByRole("button", {
            name: "Указать сумму",
        }).click();

        await expect(
            page.getByPlaceholder("Например 1500")
        ).toHaveValue("3500");

        await checkbox.uncheck();

        await page.getByRole("button", {
            name: "Указать сумму",
        }).click();

        await expect(
            page.getByPlaceholder("Например 1500")
        ).toHaveValue("3000");
    });

    test("отправляет заполненные динамические поля в backend payload", async ({ page }) => {
        const state = await openPage(page);

        await fillReadyOrder(page);

        await details(page)
            .locator('input[type="checkbox"]')
            .check();

        await details(page)
            .getByPlaceholder("Дополнительные пожелания")
            .fill("Убрать кухню особенно тщательно");

        await details(page)
            .getByPlaceholder("Контакт на объекте")
            .fill("Тестовый контакт");

        await submitOrder(page);

        await expect.poll(
            () => state.created.length
        ).toBe(1);

        const request = state.created[0];

        expect(request.method).toBe("POST");

        expect(
            request.headers.authorization
        ).toBe(`Bearer ${ADMIN_TEST_TOKEN}`);

        expect(request.body).toEqual(
            expect.objectContaining({
                userId: 123,
                categoryId: 5,
                subcategoryId: 51,
                paymentType: "cash",
                coordinates: "44.9521,34.1024",
            })
        );

        expect(request.body.serviceDetails).toEqual(
            expect.objectContaining({
                cleaningType: "regular",
                areaSqm: 30,
                windowsCleaning: true,
                comment:
                    "Убрать кухню особенно тщательно",
                contact: "Тестовый контакт",
                recommendedPrice: 3500,
                pricingCalculator: "cleaning",
            })
        );
    });

    test("кнопка Изменить очищает параметры прежней услуги", async ({ page }) => {
        await openPage(page);
        await selectService(page);
        await fillCleaningDetails(page);

        await expect(
            page.locator(".admin-recommended-price")
        ).toBeVisible();

        await page.getByRole("button", {
            name: "Изменить",
        }).click();

        await expect(
            details(page)
        ).toHaveCount(0);

        await expect(
            page.locator(".admin-recommended-price")
        ).toHaveCount(0);

        await expect(
            page.locator(".admin-selected-service")
        ).toHaveCount(0);
    });

    test("редактирование поиска сбрасывает выбранную услугу", async ({ page }) => {
        await openPage(page);
        await selectService(page);
        await fillCleaningDetails(page);

        await page.getByPlaceholder(
            "Например: перевезти диван, починить кран"
        ).fill("другая услуга");

        await expect(
            details(page)
        ).toHaveCount(0);

        await expect(
            page.locator(".admin-recommended-price")
        ).toHaveCount(0);

        await expect(
            page.locator(".admin-selected-service")
        ).toHaveCount(0);
    });

    test("изменение основного адреса сбрасывает координаты", async ({ page }) => {
        const state = await openPage(page);

        await fillReadyOrder(page);

        await page.getByPlaceholder(
            "Введите адрес"
        ).fill("Новый адрес, дом 2");

        await page.getByRole("button", {
            name: "Создать заказ",
        }).click();

        await expect(
            page.locator(".admin-alert-text")
        ).toHaveText(
            "Выберите точный адрес из подсказки"
        );

        expect(state.created).toHaveLength(0);
    });

    test("сумма обычного заказа ограничивается 300000 рублей", async ({ page }) => {
        await openPage(page);

        const input = page.getByPlaceholder(
            "Например 1500"
        );

        await input.fill("999999");

        await expect(input).toHaveValue(
            "300000"
        );
    });

    test("обязательный динамический адрес нужно выбирать из подсказки", async ({ page }) => {
        const state = await openPage(
            page,
            ADDRESS_SERVICE
        );

        await selectMainAddress(page);
        await selectService(page);

        await details(page)
            .getByPlaceholder("Укажите второй адрес")
            .fill("Кирова 10");

        await page.getByPlaceholder(
            "Например 1500"
        ).fill("2500");

        await page.getByRole("button", {
            name: "Создать заказ",
        }).click();

        await expect(
            page.locator(".admin-alert-text")
        ).toHaveText(
            "Выберите точный адрес в поле «Адрес назначения» из подсказки"
        );

        expect(state.created).toHaveLength(0);
    });

    test("сохраняет координаты выбранного динамического адреса", async ({ page }) => {
        const state = await openPage(
            page,
            ADDRESS_SERVICE
        );

        await selectMainAddress(page);
        await selectService(page);

        await details(page)
            .getByPlaceholder("Укажите второй адрес")
            .fill("Кирова 10");

        const suggestion = page.locator(
            ".dynamicAddressSuggestions button"
        ).first();

        await expect(suggestion).toBeVisible();

        await suggestion.click();

        await expect(
            page.locator(".dynamicAddressConfirmed")
        ).toContainText("Адрес выбран");

        await page.getByPlaceholder(
            "Например 1500"
        ).fill("2500");

        await submitOrder(page);

        await expect.poll(
            () => state.created.length
        ).toBe(1);

        expect(
            state.created[0].body.serviceDetails
        ).toEqual(
            expect.objectContaining({
                destination: KIROVA,
                destinationCoordinates: {
                    lat: 44.9489,
                    lng: 34.0987,
                },
            })
        );
    });

    test("редактирование динамического адреса делает прежние координаты недействительными", async ({ page }) => {
        const state = await openPage(
            page,
            ADDRESS_SERVICE
        );

        await selectMainAddress(page);
        await selectService(page);

        const addressInput = details(page)
            .getByPlaceholder("Укажите второй адрес");

        await addressInput.fill("Кирова 10");

        await expect(
            page.locator(
                ".dynamicAddressSuggestions button"
            ).first()
        ).toBeVisible();

        await page.locator(
            ".dynamicAddressSuggestions button"
        ).first().click();

        await expect(
            page.locator(".dynamicAddressConfirmed")
        ).toBeVisible();

        await addressInput.fill(
            "Другой адрес, дом 5"
        );

        await expect(
            page.locator(".dynamicAddressConfirmed")
        ).toHaveCount(0);

        await page.getByPlaceholder(
            "Например 1500"
        ).fill("2500");

        await page.getByRole("button", {
            name: "Создать заказ",
        }).click();

        await expect(
            page.locator(".admin-alert-text")
        ).toHaveText(
            "Выберите точный адрес в поле «Адрес назначения» из подсказки"
        );

        expect(state.created).toHaveLength(0);
    });

});