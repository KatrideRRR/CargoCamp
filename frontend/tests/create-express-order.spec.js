import { test, expect } from "@playwright/test";

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

    await page.goto(EXPRESS_CREATE_URL);

    await page.waitForLoadState("domcontentloaded");

    await expect(page.locator(".exo-page")).toBeVisible({
        timeout: 15000,
    });

    await expect(page.locator(".exo-title")).toHaveText("Экспресс-заказ", {
        timeout: 15000,
    });
}

async function clickBySelector(page, selector, errorMessage) {
    await page.evaluate(
        ({ selector, errorMessage }) => {
            const el = document.querySelector(selector);

            if (!el) {
                throw new Error(errorMessage || `Элемент не найден: ${selector}`);
            }

            el.click();
        },
        {
            selector,
            errorMessage,
        }
    );
}

async function clickCreateExpressOrder(page) {
    await clickBySelector(
        page,
        ".exo-btnPrimary",
        "Кнопка создания экспресс-заказа не найдена"
    );
}

async function clickTaxiType(page) {
    await page.locator(".exo-typeBtn").filter({ hasText: "Такси" }).click();
}

async function clickCourierType(page) {
    await page.locator(".exo-typeBtn").filter({ hasText: "Курьер" }).click();
}

async function fillRouteBySuggestions(page) {
    const fromInput = page.getByPlaceholder("Адрес точки A");
    const toInput = page.getByPlaceholder("Адрес точки B");

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

    await page.getByPlaceholder("Например 500").fill("700");
}

test.describe("CreateExpressOrder", () => {
    test.beforeEach(async ({ page }) => {
        await openExpressPage(page);
    });

    test("отображает страницу экспресс-заказа", async ({ page }) => {
        await expect(page.locator(".exo-page")).toBeVisible();

        await expect(page.locator(".exo-title")).toHaveText("Экспресс-заказ");
        await expect(page.getByText("Две точки + цена — и готово")).toBeVisible();

        await expect(page.locator(".exo-typeBtn").filter({ hasText: "Такси" })).toBeVisible();
        await expect(page.locator(".exo-typeBtn").filter({ hasText: "Курьер" })).toBeVisible();

        await expect(page.getByPlaceholder("Адрес точки A")).toBeVisible();
        await expect(page.getByPlaceholder("Адрес точки B")).toBeVisible();

        await expect(page.locator(".exo-cardTitle")).toHaveText("Маршрут");
        await expect(page.locator(".exo-label").filter({ hasText: "Цена" })).toBeVisible();

        await expect(page.getByPlaceholder("Например 500")).toBeVisible();

        await expect(page.locator(".exo-btnPrimary")).toHaveText("Создать заказ");
    });

    test("по умолчанию выбран тип Такси", async ({ page }) => {
        await expect(page.locator(".exo-typeBtn.isActive")).toContainText("Такси");
        await expect(page.locator(".exo-pill").filter({ hasText: "🚕 Такси" })).toBeVisible();
    });

    test("переключает тип на Курьер и обратно", async ({ page }) => {
        await clickCourierType(page);

        await expect(page.locator(".exo-typeBtn.isActive")).toContainText("Курьер");
        await expect(page.locator(".exo-pill").filter({ hasText: "📦 Курьер" })).toBeVisible();

        await clickTaxiType(page);

        await expect(page.locator(".exo-typeBtn.isActive")).toContainText("Такси");
    });

    test("показывает адресные подсказки для точки A и выбирает адрес", async ({ page }) => {
        const fromInput = page.getByPlaceholder("Адрес точки A");

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
        const toInput = page.getByPlaceholder("Адрес точки B");

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
        const priceInput = page.getByPlaceholder("Например 500");

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
        await expect(page.locator(".exo-note")).toBeVisible();
        await expect(page.getByRole("button", { name: /Показать маршрут/i })).toBeVisible();
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

        await expect(page.locator(".exo-alertText")).toHaveText("Укажите цену");
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

        expect(createRequestBody.basePrice).toBe(0);
        expect(createRequestBody.pricePerKm).toBe(0);

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

        await page.getByRole("button", { name: /Дополнительно/i }).click();
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