import { test, expect } from "./fixtures/safeTest";
import { mockAppShell } from "./utils/mockAppShell";
import { createMockJwt } from "./utils/mockAuthSession";
const FRONT_URL = "http://localhost:3000";

// Если у тебя маршрут называется иначе — поменяй только эту строку.
const EXPRESS_CREATE_URL = `${FRONT_URL}/express?platform=web`;

const testUser = {
    id: 1,
    username: "creator",
    role: "customer",
};

const savedAddresses = [
    {
        id: 1,
        label: "home",
        title: "Дом",
        address: "Симферополь, улица Пушкина, 1",
        lat: 44.9521,
        lng: 34.1024,
    },
    {
        id: 2,
        label: "work",
        title: "Работа",
        address: "Симферополь, проспект Кирова, 10",
        lat: 44.9489,
        lng: 34.0987,
    },
];

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

async function setupExpressMocks(page, options = {}) {
    const {
        savedItems = savedAddresses,
        createOrderBody = {
            success: true,
            order: {
                id: 900,
            },
        },
        createOrderStatus = 200,
    } = options;

    await mockAppShell(page);

    await page.route("**/api/orders/creator/1", async (route) => {
        await route.fulfill({
            status: 200,
            json: [],
        });
    });

    await page.route("**/api/express/express-orders/me?mode=created", async (route) => {
        await route.fulfill({
            status: 200,
            json: {
                success: true,
                orders: [],
            },
        });
    });

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
            url.includes("geocode-maps.yandex.ru") ||
            url.includes("api-maps.yandex.ru")
        ) {
            return;
        }

        console.log("[REQUEST FAILED]", url, request.failure()?.errorText);
    });

    await page.addInitScript(() => {
        window.ymaps = {
            ready: async () => {},
            route: async () => ({
                getLength: () => 7800,
                getTime: () => 1260,
            }),
        };
    });

    await page.route("**/api/express/express-addresses/me", async (route) => {
        if (route.request().method() === "POST") {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                }),
            });
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                success: true,
                items: savedItems,
            }),
        });
    });

    await page.route("**/api/express/express-orders", async (route) => {
        await route.fulfill({
            status: createOrderStatus,
            contentType: "application/json",
            body: JSON.stringify(createOrderBody),
        });
    });

    await page.route("**/api/auth/profile", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(testUser),
        });
    });

    await page.route("https://geocode-maps.yandex.ru/1.x/**", async (route) => {
        const url = route.request().url();
        const decodedUrl = decodeURIComponent(url);

        const isFrom = decodedUrl.includes("Пушкина") || decodedUrl.includes("Адрес A");
        const isTo = decodedUrl.includes("Кирова") || decodedUrl.includes("Адрес B");

        const address = isTo
            ? "Россия, Республика Крым, Симферополь, проспект Кирова, 10"
            : "Россия, Республика Крым, Симферополь, улица Пушкина, 1";

        const pos = isTo
            ? "34.0987 44.9489"
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

async function openExpressPage(page, options = {}) {
    await setFakeAuth(page);
    await setupExpressMocks(page, options);

    await page.goto(EXPRESS_CREATE_URL, {

        waitUntil: "domcontentloaded",

        timeout: 30000,

    });

    await expect(page.locator(".exo-page")).toBeVisible({
        timeout: 15000,
    });

    await expect(
        page.getByRole("dialog", {
            name: "Экспресс-заказ",
            exact: true,
        })
    ).toBeVisible({
        timeout: 15000,
    });
}

async function goToExpressStep(page, step) {
    const dialog = page.getByRole(
        "dialog",
        {
            name: "Экспресс-заказ",
            exact: true,
        }
    );

    await dialog.getByRole("button", {
        name: new RegExp(
            `^Шаг ${step}:`
        ),
    }).click();

    await expect(
        dialog.locator(
            `[data-order-step="${step}"]`
        )
    ).toBeVisible();

    return dialog;
}

async function clickCreateExpressOrder(page) {
    const dialog =
        await goToExpressStep(page, 4);

    await dialog.getByRole("button", {
        name: "Создать заказ",
        exact: true,
    }).click();
}

async function clickTaxiType(page) {
    await goToExpressStep(page, 1);

    await page
        .locator(".exo-typeBtn")
        .filter({ hasText: "Такси" })
        .click();
}

async function clickCourierType(page) {
    await goToExpressStep(page, 1);

    await page
        .locator(".exo-typeBtn")
        .filter({ hasText: "Курьер" })
        .click();
}

async function fillRouteBySuggestions(page) {
    await goToExpressStep(page, 2);
    const fromInput = page.getByPlaceholder("Откуда — адрес точки A");
    const toInput = page.getByPlaceholder("Куда — адрес точки B");

    await fromInput.fill("Пушкина 1");

    await expect(page.locator(".suggestions li").first()).toBeVisible({
        timeout: 10000,
    });

    await page.locator(".suggestions li").first().click();

    await expect(fromInput).toHaveValue(
        "Россия, Республика Крым, Симферополь, улица Пушкина, 1"
    );

    await toInput.fill("Кирова 10");

    await expect(page.locator(".suggestions li").first()).toBeVisible({
        timeout: 10000,
    });

    await page.locator(".suggestions li").first().click();

    await expect(toInput).toHaveValue(
        "Россия, Республика Крым, Симферополь, проспект Кирова, 10"
    );
}

async function fillValidExpressOrder(page) {
    await fillRouteBySuggestions(page);

    await expect(page.getByRole("button", { name: /Показать маршрут/i })).toBeEnabled({
        timeout: 10000,
    });
    await goToExpressStep(page, 3);
    await page.locator("#express-price").fill("700");
}

test.describe("CreateExpressOrder", () => {
    test.beforeEach(async ({ page }) => {
        await openExpressPage(page);
    });

    test(
        "проходит четыре шага экспресс-заказа без преждевременной публикации",
        async ({ page }) => {
            let createCalls = 0;

            await page.route(
                "**/api/express/express-orders",
                async (route) => {
                    createCalls += 1;

                    await route.fulfill({
                        status: 200,
                        json: {
                            success: true,
                            order: {
                                id: 900,
                            },
                        },
                    });
                }
            );

            const dialog = page.getByRole(
                "dialog",
                {
                    name: "Экспресс-заказ",
                    exact: true,
                }
            );

            await clickCourierType(page);

            const next = dialog.getByRole(
                "button",
                {
                    name: "Далее",
                    exact: true,
                }
            );

            await next.click();

            await expect(dialog)
                .toContainText("Шаг 2 из 4");

            await next.click();

            await expect(
                dialog.getByRole("alert")
            ).toContainText(
                "Заполните Откуда и Куда"
            );

            expect(createCalls).toBe(0);

            await fillRouteBySuggestions(page);

            await expect(
                page.locator(".exo-note")
            ).toContainText(
                /7\.8 км|7,8 км/
            );

            await next.click();

            await expect(dialog)
                .toContainText("Шаг 3 из 4");

            await page.locator(
                "#express-price"
            ).fill("700");

            await next.click();

            await expect(dialog)
                .toContainText("Шаг 4 из 4");

            await expect(dialog)
                .toContainText("Курьер");

            await expect(dialog)
                .toContainText("700 ₽");

            expect(createCalls).toBe(0);

            page.once(
                "dialog",
                nativeDialog =>
                    nativeDialog.accept()
            );

            await dialog.getByRole("button", {
                name: "Создать заказ",
                exact: true,
            }).click();

            await expect.poll(
                () => createCalls
            ).toBe(1);

            await expect(page)
                .toHaveURL(/\/my-orders\/1/);
        }
    );

    test(
        "@release-smoke экспресс: такси и курьер доступны на мобильном экране",
        async ({ page }) => {
            await clickCourierType(page);

            await expect(
                page.locator(
                    ".exo-typeBtn.isActive"
                )
            ).toContainText("Курьер");

            await goToExpressStep(page, 2);

            await expect(
                page.getByPlaceholder(
                    "Откуда — адрес точки A"
                )
            ).toBeVisible();

            await expect(
                page.getByPlaceholder(
                    "Куда — адрес точки B"
                )
            ).toBeVisible();

            await goToExpressStep(page, 3);

            await page.locator(
                "#express-price"
            ).fill("700");

            await expect(
                page.locator(
                    "#express-price"
                )
            ).toHaveValue("700");

            for (const step of [1, 2, 3, 4]) {
                const dialog =
                    await goToExpressStep(
                        page,
                        step
                    );

                const overflow =
                    await dialog.evaluate(
                        (element) =>
                            element.scrollWidth -
                            element.clientWidth
                    );

                expect(overflow)
                    .toBeLessThanOrEqual(2);
            }
        }
    );

    test(
        "отображает страницу экспресс-заказа",
        async ({ page }) => {
            const dialog = page.getByRole(
                "dialog",
                {
                    name: "Экспресс-заказ",
                    exact: true,
                }
            );

            await expect(dialog)
                .toContainText("Шаг 1 из 4");

            await expect(
                dialog.locator(".exo-typeBtn")
                    .filter({
                        hasText: "Такси",
                    })
            ).toBeVisible();

            await expect(
                dialog.locator(".exo-typeBtn")
                    .filter({
                        hasText: "Курьер",
                    })
            ).toBeVisible();

            await goToExpressStep(page, 2);

            await expect(
                page.getByPlaceholder(
                    "Откуда — адрес точки A"
                )
            ).toBeVisible();

            await expect(
                page.getByPlaceholder(
                    "Куда — адрес точки B"
                )
            ).toBeVisible();

            await goToExpressStep(page, 3);

            await expect(
                page.locator("#express-price")
            ).toBeVisible();

            await expect(dialog)
                .toContainText(
                    "Оплата исполнителю наличными"
                );

            await goToExpressStep(page, 4);

            await expect(
                dialog.getByRole("button", {
                    name: "Создать заказ",
                    exact: true,
                })
            ).toBeVisible();
        }
    );

    test("по умолчанию выбран тип Такси", async ({ page }) => {
        await expect(page.locator(".exo-typeBtn.isActive")).toContainText("Такси");
        await expect(page.locator(".exo-pill--type")).toContainText("Такси");
        await expect(page.locator(".exo-pill--type svg")).toHaveCount(1);
    });

    test("переключает тип на Курьер и обратно", async ({ page }) => {
        await clickCourierType(page);

        await expect(page.locator(".exo-typeBtn.isActive")).toContainText("Курьер");
        await expect(page.locator(".exo-pill--type")).toContainText("Курьер");
        await expect(page.locator(".exo-pill--type svg")).toHaveCount(1);

        await clickTaxiType(page);

        await expect(page.locator(".exo-typeBtn.isActive")).toContainText("Такси");
    });

    test("показывает адресные подсказки для точки A и выбирает адрес", async ({ page }) => {
        await goToExpressStep(page, 2);

        const fromInput = page.getByPlaceholder("Откуда — адрес точки A");

        await fromInput.fill("Пушкина 1");

        await expect(page.locator(".suggestions li").first()).toBeVisible({
            timeout: 10000,
        });

        await page.locator(".suggestions li").first().click();

        await expect(fromInput).toHaveValue(
            "Россия, Республика Крым, Симферополь, улица Пушкина, 1"
        );
    });

    test("показывает адресные подсказки для точки B и выбирает адрес", async ({ page }) => {
        await goToExpressStep(page, 2);

        const toInput = page.getByPlaceholder("Куда — адрес точки B");

        await toInput.fill("Кирова 10");

        await expect(page.locator(".suggestions li").first()).toBeVisible({
            timeout: 10000,
        });

        await page.locator(".suggestions li").first().click();

        await expect(toInput).toHaveValue(
            "Россия, Республика Крым, Симферополь, проспект Кирова, 10"
        );
    });

    test("после выбора двух точек активирует маршрут", async ({ page }) => {
        await fillRouteBySuggestions(page);

        await expect(page.getByRole("button", { name: /Показать маршрут/i })).toBeEnabled({
            timeout: 10000,
        });

        await expect(page.locator(".exo-note")).not.toContainText(
            "Укажи точки A и B"
        );
    });

    test("позволяет вручную указать цену", async ({ page }) => {
        await goToExpressStep(page, 3);

        const priceInput = page.locator("#express-price");

        await expect(priceInput).toBeVisible();

        await priceInput.fill("650");

        await expect(priceInput).toHaveValue("650");
    });

    test("открывает и показывает дополнительные опции такси", async ({ page }) => {
        await page.getByRole("button", { name: /Дополнительно/i }).click();

        await expect(page.getByText("Опции:")).toBeVisible();
        await expect(page.getByText("Перевозка пассажиров")).toBeVisible();
        await expect(page.getByText("Перевозка детей")).toBeVisible();
        await expect(page.getByText("Перевозка животных")).toBeVisible();
        await expect(page.getByText("Между городами")).toBeVisible();

        await page.getByRole("button", { name: /Перевозка животных/i }).click();

        await expect(page.locator(".exo-chip.selected")).toContainText("Перевозка животных");
    });

    test("для курьера показывает курьерские дополнительные опции", async ({ page }) => {
        await clickCourierType(page);

        await page.getByRole("button", { name: /Дополнительно/i }).click();

        await expect(page.getByText("Цветы")).toBeVisible();
        await expect(page.getByText("Еда/продукты")).toBeVisible();
        await expect(page.getByText("Документы")).toBeVisible();
    });

    test("позволяет заполнить комментарий", async ({ page }) => {
        await page.getByRole("button", { name: /Дополнительно/i }).click();

        const comment = page.getByPlaceholder("Комментарий (домофон, подъезд, позвонить заранее)…");

        await comment.fill("Подъезд 2, позвонить за 5 минут");

        await expect(comment).toHaveValue("Подъезд 2, позвонить за 5 минут");
    });

    test("показывает блок статуса маршрута", async ({ page }) => {
        await goToExpressStep(page, 2);

        await expect(
            page.locator(".exo-note")
        ).toBeVisible();

        await expect(
            page.getByRole("button", {
                name: /Показать маршрут/i,
            })
        ).toBeVisible();
    });

    test("кнопка Показать маршрут становится активной после выбора двух точек", async ({ page }) => {
        await fillRouteBySuggestions(page);

        await expect(page.getByRole("button", { name: /Показать маршрут/i })).toBeEnabled({
            timeout: 10000,
        });
    });

    test("показывает ошибку, если адреса не заполнены", async ({ page }) => {
        await clickCreateExpressOrder(page);

        await expect(page.locator(".exo-alertText")).toHaveText("Заполните Откуда и Куда");
    });

    test("показывает ошибку, если цена не указана", async ({ page }) => {
        await fillRouteBySuggestions(page);

        await clickCreateExpressOrder(page);

        await expect(page.locator(".exo-alertText")).toHaveText("Укажите корректную цену");
    });

    test("успешно создаёт такси-заказ", async ({ page }) => {
        let createRequestBody = null;

        await page.route("**/api/express/express-orders", async (route) => {
            createRequestBody = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                    order: {
                        id: 900,
                    },
                }),
            });
        });

        let alertText = "";

        page.once("dialog", async (dialog) => {
            alertText = dialog.message();
            await dialog.accept();
        });

        await fillValidExpressOrder(page);

        await clickCreateExpressOrder(page);

        await expect
            .poll(() => createRequestBody, {
                timeout: 10000,
            })
            .not.toBeNull();

        expect(createRequestBody.type).toBe("taxi");
        expect(createRequestBody.subcategory).toBeNull();
        expect(createRequestBody.paymentType).toBe("cash");
        expect(createRequestBody.totalPrice).toBe(700);
        expect(createRequestBody.description).toBeNull();

        expect(createRequestBody.fromAddress).toContain("Пушкина");
        expect(createRequestBody.toAddress).toContain("Кирова");

        expect(createRequestBody.fromLat).toBeCloseTo(44.9521, 3);
        expect(createRequestBody.fromLng).toBeCloseTo(34.1024, 3);
        expect(createRequestBody.toLat).toBeCloseTo(44.9489, 3);
        expect(createRequestBody.toLng).toBeCloseTo(34.0987, 3);

        expect(createRequestBody.clientPricingVersion).toBe(1);
        expect(createRequestBody.distanceKm).toBeGreaterThan(0);

        await expect
            .poll(() => alertText, {
                timeout: 5000,
            })
            .toContain("Заказ успешно создан");

        await expect(page).toHaveURL(/\/my-orders\/1/);
    });

    test("успешно создаёт курьерский заказ с опцией и комментарием", async ({ page }) => {
        let createRequestBody = null;

        await page.route("**/api/express/express-orders", async (route) => {
            createRequestBody = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                    order: {
                        id: 901,
                    },
                }),
            });
        });

        page.once("dialog", async (dialog) => {
            await dialog.accept();
        });

        await clickCourierType(page);

        await fillValidExpressOrder(page);

// Маршрут и цена уже заполнены.
// Возвращаемся к дополнительным параметрам заказа.
        await goToExpressStep(page, 1);

        await page.getByRole("button", {
            name: /Дополнительно/i,
        }).click();
        await page.getByRole("button", { name: /Документы/i }).click();
        await page
            .getByPlaceholder("Комментарий (домофон, подъезд, позвонить заранее)…")
            .fill("Передать документы лично в руки");

        await clickCreateExpressOrder(page);

        await expect
            .poll(() => createRequestBody, {
                timeout: 10000,
            })
            .not.toBeNull();

        expect(createRequestBody.type).toBe("courier");
        expect(createRequestBody.subcategory).toBe("Документы");
        expect(createRequestBody.description).toBe("Передать документы лично в руки");
        expect(createRequestBody.totalPrice).toBe(700);
    });

    test("показывает ошибку backend при создании заказа", async ({ page }) => {
        await page.route("**/api/express/express-orders", async (route) => {
            await route.fulfill({
                status: 500,
                contentType: "application/json",
                body: JSON.stringify({
                    message: "Сервер не создал экспресс-заказ",
                }),
            });
        });

        await fillValidExpressOrder(page);

        await clickCreateExpressOrder(page);

        await expect(page.locator(".exo-alertText")).toHaveText(
            "Сервер не создал экспресс-заказ",
            {
                timeout: 10000,
            }
        );
    });

    test("если backend вернул success false, показывает сообщение ошибки", async ({ page }) => {
        await page.route("**/api/express/express-orders", async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: false,
                    message: "Не удалось найти исполнителей",
                }),
            });
        });

        await fillValidExpressOrder(page);

        await clickCreateExpressOrder(page);

        await expect(page.locator(".exo-alertText")).toHaveText(
            "Не удалось найти исполнителей",
            {
                timeout: 10000,
            }
        );
    });
});