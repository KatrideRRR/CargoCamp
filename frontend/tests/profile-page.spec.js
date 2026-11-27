import { test, expect } from "./fixtures/safeTest";

import {
    createMockJwt,
    mockAnonymousRefresh,
} from "./utils/mockAuthSession";

import { mockOrderAssets } from "./utils/mockOrderAssets";

const FRONT_URL = "http://localhost:3000";

const profile = {
    id: 123,
    username: "testuser",
    rating: 4.2,
    role: "customer",
    userStatus: "verified",
    subscriptionType: "basic",
    subscriptionExpiresAt: null,
    yookassaPaymentMethodId: "pm_123",
    cardType: "VISA",
    cardLastFour: "1234",
    avatar: "/uploads/avatars/avatar_123.jpg",
    documentPhotos: [
        "/uploads/documents/passport_1.jpg",
        "/uploads/documents/passport_2.pdf",
    ],
    preferredCategoryIds: [1, 12],
    locationLat: 44.9521,
    locationLng: 34.1024,
    locationAddress: "Симферополь, улица Пушкина, 1",
    locationSource: "manual",
};

const profileWithoutCard = {
    ...profile,
    yookassaPaymentMethodId: null,
    cardType: null,
    cardLastFour: null,
};

const profileWithoutDocs = {
    ...profile,
    documentPhotos: [],
};

const categories = [
    { id: 1, name: "Грузы" },
    { id: 2, name: "Ремонт" },
    { id: 12, name: "Такси" },
    { id: 13, name: "Курьер" },
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

async function setFakeAuth(page, user = profile) {
    const fakeToken = createMockJwt(user);

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

async function setupProfileMocks(page, options = {}) {
    const {
        profileBody = profile,
        profileStatus = 200,
        debt = 0,
        categoriesBody = categories,
        saveCategoriesBody = { preferredCategoryIds: [1, 2] },
        uploadAvatarBody = { avatar: "/uploads/avatars/new_avatar.jpg" },
        uploadDocumentsBody = { success: true },
        saveLocationBody = null,
        bindCardBody = {
            success: true,
            confirmationUrl: "https://payment.example.test/bind-card",
        },
        unbindCardBody = {
            success: true,
        },
        premiumBody = {
            success: true,
            confirmationUrl: "https://payment.example.test/premium",
        },
        debtBody = {
            success: true,
            confirmationUrl: "https://payment.example.test/debt",
        },
        identityBody = {
            success: true,
            verification: null,
        },
        benefitsBody = {
            success: true,
            benefits: [],
        },
    } = options;

    await mockOrderAssets(page);
    await mockAnonymousRefresh(page);

// Аватары подменяем настоящим локальным PNG.
// Реальный сервер изображений не вызывается.
    const mockAvatar = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
        "base64"
    );

    for (const filename of [
        "avatar_123.jpg",
        "new_avatar.jpg",
    ]) {
        await page.route(
            `**/uploads/avatars/${filename}`,
            async (route) => {
                if (route.request().method() !== "GET") {
                    await route.fallback();
                    return;
                }

                await route.fulfill({
                    status: 200,
                    contentType: "image/png",
                    body: mockAvatar,
                });
            }
        );
    }

// Актуальная верификация личности.
    await page.route("**/api/identity/me", async (route) => {
        if (route.request().method() !== "GET") {
            await route.fallback();
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(identityBody),
        });
    });

    await page.route(
        "**/api/account-deletion/status",
        async (route) => {
            await route.fulfill({
                status: 200,

                json: {
                    success: true,
                    request: null,
                },
            });
        }
    );

    await page.route(
        "**/api/account-deletion/request",
        async (route) => {
            await route.fulfill({
                status: 201,

                json: {
                    success: true,
                    requested: true,
                    alreadyRequested: false,
                },
            });
        }
    );

    await page.route(
        "**/api/legal/consents/*",
        async (route) => {
            const url = new URL(
                route.request().url()
            );

            const code =
                url.pathname.split("/").pop();

            await route.fulfill({
                status: 200,

                json: {
                    success: true,

                    document: {
                        code,

                        version: "2026-11-25",

                        sha256: "a".repeat(64),

                        text:
                            "Тестовое согласие на обработку персональных данных.",
                    },
                },
            });
        }
    );

// Актуальные социальные льготы.
    await page.route("**/api/benefits/me", async (route) => {
        if (route.request().method() !== "GET") {
            await route.fallback();
            return;
        }

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(benefitsBody),
        });
    });

// Загрузка данных на страницах, куда ведут кнопки профиля.
    const linkedPageResponses = [
        ["**/api/support/messages", []],
        ["**/api/auth/user/123", profile],
        ["**/api/auth/reviews/user/123", { reviews: [] }],
        ["**/api/auth/reviews/my", { reviews: [] }],
        ["**/api/orders/completed/123", []],
        ["**/api/express/express-orders/me*", { orders: [] }],
    ];

    for (const [pattern, body] of linkedPageResponses) {
        await page.route(pattern, async (route) => {
            if (route.request().method() !== "GET") {
                await route.fallback();
                return;
            }

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(body),
            });
        });
    }

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

    await page.route("**/api/orders/me/status", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                debt,
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

    await page.route("**/api/auth/categories/me", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(saveCategoriesBody),
        });
    });

    await page.route("**/api/auth/upload-avatar", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(uploadAvatarBody),
        });
    });

    await page.route("**/api/auth/upload-documents", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(uploadDocumentsBody),
        });
    });

    await page.route("**/api/auth/location/me", async (route) => {
        const body = route.request().postDataJSON();

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(
                saveLocationBody || {
                    location: {
                        locationAddress: body.address,
                        locationLat: body.lat,
                        locationLng: body.lng,
                        locationSource: body.source,
                    },
                }
            ),
        });
    });

    await page.route("**/api/payments/card/bind/create", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(bindCardBody),
        });
    });

    await page.route("**/api/payments/card/unbind", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(unbindCardBody),
        });
    });

    await page.route("**/api/payments/premium/create", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(premiumBody),
        });
    });

    await page.route("**/api/tbank-payments/premium/create", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(premiumBody),
        });
    });

    await page.route("**/api/payments/debt/create", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(debtBody),
        });
    });

    await page.route("**/api/tbank-payments/debt/create", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(debtBody),
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

async function openProfilePage(page, options = {}) {
    await setFakeAuth(page, options.profileBody || profile);
    await setupProfileMocks(page, options);

    const query = options.query || "platform=web";

    await page.goto(`${FRONT_URL}/profile?${query}`, {

        waitUntil: "domcontentloaded",

        timeout: 30000,

    });

    if (options.waitForPage === false) return;

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "profile-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("ProfilePage редиректит на /login. Fake JWT не применился.");
    }

    await expectProfileLoaded(page);
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

async function openProfileSheet(
    page,
    rowName,
    dialogName
) {
    await page.getByRole("button", {
        name: rowName,
    }).click();

    const dialog = page.getByRole("dialog", {
        name: dialogName,
        exact: true,
    });

    await expect(dialog).toBeVisible();

    return dialog;
}

async function expectProfileLoaded(page) {
    await expect(
        page.getByRole("heading", {
            name: "Профиль",
            exact: true,
        })
    ).toBeVisible();
}

test.describe("ProfilePage", () => {
    test.beforeEach(async ({ page }) => {
        await openProfilePage(page);
    });

    test(
        "отображает страницу профиля",
        async ({ page }) => {
            await expectProfileLoaded(page);

            await expect(
                page.locator(".profile-page")
            ).toBeVisible();

            const account = page.locator(
                ".cc-profile-account"
            );

            await expect(
                account.getByRole("heading", {
                    name: "testuser",
                    exact: true,
                })
            ).toBeVisible();

            await expect(account)
                .toContainText("ID: 123");

            await expect(account)
                .toContainText("Рейтинг: 4.2");
        }
    );

    test(
        "пользователь может зарегистрировать запрос удаления аккаунта",
        async ({ page }) => {
            await openProfilePage(page);

            await page.getByRole(
                "button",
                {
                    name: "Удалить аккаунт",
                    exact: true,
                }
            ).click();

            await page.getByLabel(
                "Пароль аккаунта",
                {
                    exact: true,
                }
            ).fill("test-password");

            await page.getByLabel(
                "Я подтверждаю запрос на удаление аккаунта."
            ).check();

            const requestPromise =
                page.waitForRequest(
                    (request) =>
                        request.url().includes(
                            "/api/account-deletion/request"
                        ) &&
                        request.method() === "POST"
                );

            await page.getByRole(
                "button",
                {
                    name: "Подтвердить удаление",
                    exact: true,
                }
            ).click();

            const request =
                await requestPromise;

            expect(
                request.postDataJSON()
            ).toEqual({
                password: "test-password",
                confirmed: true,
            });

            await expect(
                page.getByText(
                    "Запрос на удаление зарегистрирован",
                    {
                        exact: true,
                    }
                )
            ).toBeVisible();
        }
    );

    test("ставит web-класс при platform=web", async ({ page }) => {
        await openProfilePage(page, {
            query: "platform=web",
        });

        await expect(page.locator(".profile-page")).toHaveClass(/profile-page--web/);
    });

    test("ставит ios-класс и safe-area классы при platform=ios", async ({ page }) => {
        await openProfilePage(page, {
            query: "platform=ios",
        });

        await expect(page.locator(".profile-page")).toHaveClass(/profile-page--ios/);
        await expect(page.locator(".profile-page")).toHaveClass(/ios-safe-top/);
        await expect(page.locator(".profile-page")).toHaveClass(/ios-safe-bottom/);
    });

    test("ставит android-класс при platform=android", async ({ page }) => {
        await openProfilePage(page, {
            query: "platform=android",
        });

        await expect(page.locator(".profile-page")).toHaveClass(/profile-page--android/);
    });

    test(
        "показывает данные пользователя и аватар",
        async ({ page }) => {
            const account = page.locator(
                ".cc-profile-account"
            );

            await expect(account).toBeVisible();

            await expect(
                account.getByRole("heading", {
                    name: "testuser",
                    exact: true,
                })
            ).toBeVisible();

            await expect(account)
                .toContainText("ID: 123");

            await expect(account)
                .toContainText("Рейтинг: 4.2");

            const avatar = account.getByRole("img", {
                name: "Аватар",
                exact: true,
            });

            await expect(avatar).toBeVisible();

            await expect(avatar).toHaveAttribute(
                "src",
                /avatar_123\.jpg$/
            );
        }
    );

    test("если аватара нет, показывает placeholder с первой буквой", async ({ page }) => {
        await openProfilePage(page, {
            profileBody: {
                ...profile,
                avatar: null,
            },
        });

        await expect(page.locator(
            ".cc-profile-account__avatar > span"
        )).toHaveText("T");
    });

    test("кнопка Поддержка ведёт на /support", async ({ page }) => {
        await page.getByRole("button", { name: /Поддержка/i }).click();

        await expect(page).toHaveURL(/\/support/);
    });

    test(
        "показывает привязанную карту",
        async ({ page }) => {
            const dialog = await openProfileSheet(
                page,
                /^Банковские карты/,
                "Банковские карты"
            );

            await expect(dialog)
                .toContainText("VISA");

            await expect(dialog)
                .toContainText("•••• 1234");

            await expect(
                dialog.getByRole("button", {
                    name: "Отвязать",
                    exact: true,
                })
            ).toBeVisible();
        }
    );

    test(
        "показывает отсутствие сохранённых карт",
        async ({ page }) => {
            await openProfilePage(page, {
                profileBody: profileWithoutCard,
            });

            const dialog = await openProfileSheet(
                page,
                /^Банковские карты/,
                "Банковские карты"
            );

            await expect(dialog)
                .toContainText(
                    "У вас пока нет сохранённых карт"
                );

            await expect(
                dialog.getByRole("button", {
                    name: /Привязать карту/,
                })
            ).toBeVisible();
        }
    );

    test(
        "отменяет отвязку без запроса к серверу",
        async ({ page }) => {
            let unbindCalls = 0;

            await page.route(
                "**/api/payments/card/unbind",
                async (route) => {
                    unbindCalls += 1;

                    await route.fulfill({
                        json: { success: true },
                    });
                }
            );

            const dialog = await openProfileSheet(
                page,
                /^Банковские карты/,
                "Банковские карты"
            );

            await dialog.getByRole("button", {
                name: "Отвязать",
                exact: true,
            }).click();

            const confirmation = page.getByRole(
                "dialog",
                {
                    name: "Отвязать карту",
                    exact: true,
                }
            );

            await expect(confirmation)
                .toContainText("•••• 1234");

            await confirmation.getByRole("button", {
                name: "Отмена",
                exact: true,
            }).click();

            await expect(
                page.getByRole("dialog", {
                    name: "Банковские карты",
                    exact: true,
                })
            ).toBeVisible();

            expect(unbindCalls).toBe(0);
        }
    );

    test(
        "отвязывает карту и обновляет профиль",
        async ({ page }) => {
            let unbindCalls = 0;

            await page.route(
                "**/api/auth/profile",
                async (route) => {
                    await route.fulfill({
                        json:
                            unbindCalls > 0
                                ? profileWithoutCard
                                : profile,
                    });
                }
            );

            await page.route(
                "**/api/payments/card/unbind",
                async (route) => {
                    unbindCalls += 1;

                    await route.fulfill({
                        json: { success: true },
                    });
                }
            );

            const dialog = await openProfileSheet(
                page,
                /^Банковские карты/,
                "Банковские карты"
            );

            await dialog.getByRole("button", {
                name: "Отвязать",
                exact: true,
            }).click();

            await page.getByRole("dialog", {
                name: "Отвязать карту",
                exact: true,
            }).getByRole("button", {
                name: "Отвязать карту",
                exact: true,
            }).click();

            await expect.poll(
                () => unbindCalls
            ).toBe(1);

            const updatedDialog = page.getByRole(
                "dialog",
                {
                    name: "Банковские карты",
                    exact: true,
                }
            );

            await expect(updatedDialog)
                .toContainText(
                    "У вас пока нет сохранённых карт"
                );
        }
    );

    test(
        "показывает задолженность и кнопку оплаты",
        async ({ page }) => {
            await openProfilePage(page, {
                debt: 25000,
            });

            const dialog = await openProfileSheet(
                page,
                /^Задолженность/,
                "Задолженность"
            );

            await expect(dialog)
                .toContainText("250.00 ₽");

            await expect(
                dialog.getByRole("button", {
                    name: "Оплатить задолженность",
                    exact: true,
                })
            ).toBeVisible();
        }
    );

    test(
        "открывает шторку при нулевой задолженности",
        async ({ page }) => {
            const dialog = await openProfileSheet(
                page,
                /^Задолженность/,
                "Задолженность"
            );

            await expect(dialog)
                .toContainText("Задолженности нет");

            await expect(
                dialog.getByRole("button", {
                    name: "Оплатить задолженность",
                })
            ).toHaveCount(0);

            await dialog.getByRole("button", {
                name: "Понятно",
            }).click();

            await expect(dialog)
                .not.toBeVisible();
        }
    );

    test("создаёт оплату задолженности и переходит на оплату", async ({ page }) => {
        await openProfilePage(page, {
            debt: 25000,
        });

        const paymentNavigation = await mockPaymentNavigation(page);

        const paymentsCard = await openProfileSheet(
            page,
            /^Задолженность/,
            "Задолженность"
        );

        await paymentsCard
            .getByRole("button", { name: "Оплатить задолженность" })
            .click();

        await expect
            .poll(() => paymentNavigation.getOpenedUrl(), {
                timeout: 10000,
            })
            .toBe("https://payment.example.test/debt");

        await expect(page).toHaveURL(
            "https://payment.example.test/debt",
            {
                timeout: 10000,
            }
        );
    });

    test(
        "показывает тарифы Premium",
        async ({ page }) => {
            const dialog = await openProfileSheet(
                page,
                /^CargoCamp Premium/,
                "CargoCamp Premium"
            );

            await expect(dialog)
                .toContainText("Обычный аккаунт");

            await expect(
                dialog.getByRole("button", {
                    name: /На 7 дней/,
                })
            ).toContainText("2 500 ₽");

            await expect(
                dialog.getByRole("button", {
                    name: /На 30 дней/,
                })
            ).toContainText("9 000 ₽");
        }
    );

    test(
        "показывает активный Premium",
        async ({ page }) => {
            await openProfilePage(page, {
                profileBody: {
                    ...profile,

                    subscriptionType: "premium",

                    subscriptionExpiresAt:
                        new Date(
                            Date.now() +
                            7 * 86400000
                        ).toISOString(),
                },
            });

            const dialog = await openProfileSheet(
                page,
                /^CargoCamp Premium/,
                "CargoCamp Premium"
            );

            await expect(dialog)
                .toContainText("Премиум активен");
        }
    );

    test(
        "выбор тарифа не инициирует списание",
        async ({ page }) => {
            let paymentCalls = 0;

            for (const endpoint of [
                "**/api/payments/premium/create",
                "**/api/tbank-payments/premium/create",
            ]) {
                await page.route(
                    endpoint,
                    async (route) => {
                        paymentCalls += 1;

                        await route.fulfill({
                            json: { success: false },
                        });
                    }
                );
            }

            const dialog = await openProfileSheet(
                page,
                /^CargoCamp Premium/,
                "CargoCamp Premium"
            );

            await dialog.getByRole("button", {
                name: /На 7 дней/,
            }).click();

            const paymentDialog = page.getByRole(
                "dialog",
                {
                    name: "Оплата Premium",
                    exact: true,
                }
            );

            await expect(paymentDialog)
                .toContainText("2 500 ₽");

            await expect(paymentDialog)
                .toContainText("•••• 1234");

            expect(paymentCalls).toBe(0);
        }
    );

    for (const provider of [
        {
            name: "ЮKassa",
            endpoint: "**/api/payments/premium/create",
        },
        {
            name: "Т-Банк",
            endpoint: "**/api/tbank-payments/premium/create",
        },
    ]) {
        test(
            `оплачивает Premium без привязки через ${provider.name}`,
            async ({ page }) => {
                await openProfilePage(page, {
                    profileBody: profileWithoutCard,
                });

                const navigation =
                    await mockPaymentNavigation(page);

                let submittedBody = null;

                await page.route(
                    provider.endpoint,
                    async (route) => {
                        submittedBody =
                            route.request()
                                .postDataJSON();

                        await route.fulfill({
                            json: {
                                success: true,

                                confirmationUrl:
                                    "https://payment.example.test/premium",
                            },
                        });
                    }
                );

                const dialog =
                    await openProfileSheet(
                        page,
                        /^CargoCamp Premium/,
                        "CargoCamp Premium"
                    );

                await dialog.getByRole("button", {
                    name: /На 7 дней/,
                }).click();

                await page.getByRole("dialog", {
                    name: "Оплата Premium",
                    exact: true,
                }).getByRole("button", {
                    name: "Оплатить без привязки",
                    exact: true,
                }).click();

                const providerDialog =
                    page.getByRole("dialog", {
                        name: "Способ оплаты",
                        exact: true,
                    });

                await providerDialog
                    .getByRole("button", {
                        name: new RegExp(
                            provider.name
                        ),
                    }).click();

                await providerDialog
                    .getByRole("button", {
                        name: "Оплатить 2 500 ₽",
                        exact: true,
                    }).click();

                await expect.poll(
                    () => submittedBody
                ).toEqual({
                    duration: "7d",
                    paymentMode: "redirect",
                });

                await expect.poll(
                    () => navigation.getOpenedUrl()
                ).toBe(
                    "https://payment.example.test/premium"
                );
            }
        );
    }

    test(
        "показывает актуальные секции подтверждений",
        async ({ page }) => {
            const verificationCard = page.locator(
                ".profile-verification-card"
            );

            await expect(
                verificationCard
            ).toBeVisible();

            await expect(
                verificationCard
            ).toContainText(
                "Подтверждения и льготы"
            );

            await expect(
                verificationCard.locator(
                    ".cc-identity .verification-panel-title"
                )
            ).toBeVisible();

            await expect(
                verificationCard.locator(
                    ".cc-benefits .verification-panel-title"
                )
            ).toBeVisible();

            await expect(
                page.getByRole("button", {
                    name: /^Автомобиль/,
                })
            ).toBeVisible();

            await expect(
                verificationCard.locator(
                    ".verification-panel-vehicle"
                )
            ).toHaveCount(0);
        }
    );

    test("открывает информацию о подтверждениях", async ({ page }) => {
        const card = page.locator(".profile-verification-card");

        await card.getByRole("button", { name: "Подробнее" }).click();

        const modal = page.locator(".modal-window");

        await expect(modal).toBeVisible();
        await expect(modal).toContainText("О верификации пользователя");

        await modal.getByRole("button", { name: "Закрыть" }).click();

        await expect(modal).not.toBeVisible();
    });

    test("отображает неподтверждённую личность", async ({ page }) => {
        const identity = page.locator(".cc-identity");

        await expect(
            identity.locator(".verification-summary-status")
        ).toHaveText("Не подтверждена");

        await identity.locator(".verification-panel-head").click();

        await expect(
            identity.locator("select")
        ).toHaveValue("passport_rf");

        await expect(
            identity.locator(".cc-identity-submit")
        ).toBeDisabled();
    });

    test("для подтверждённой личности скрывает повторную подачу", async ({ page }) => {
        await openProfilePage(page, {
            identityBody: {
                success: true,
                verification: {
                    status: "verified",
                    verifiedAt: "2026-11-01T12:00:00Z",
                },
            },
        });

        const identity = page.locator(".cc-identity");

        await expect(
            identity.locator(".verification-summary-status")
        ).toHaveText("Подтверждена");

        await identity.locator(".verification-panel-head").click();

        await expect(
            identity.locator(".cc-identity-form")
        ).toHaveCount(0);
    });

    test("при проверке личности блокирует повторную заявку", async ({ page }) => {
        await openProfilePage(page, {
            identityBody: {
                success: true,
                verification: {
                    status: "pending",
                },
            },
        });

        const identity = page.locator(".cc-identity");

        await identity.locator(".verification-panel-head").click();

        await expect(identity).toContainText("На проверке");

        await expect(
            identity.locator(".cc-identity-form")
        ).toHaveCount(0);

        await expect(
            identity.locator(".cc-identity-note")
        ).toContainText("после рассмотрения заявки");
    });

    test("отклоняет недопустимый файл для проверки личности", async ({ page }) => {
        const identity = page.locator(".cc-identity");

        await identity.locator(".verification-panel-head").click();

        await identity.locator('input[type="file"]').setInputFiles({
            name: "document.exe",
            mimeType: "application/octet-stream",
            buffer: Buffer.from("invalid-file"),
        });

        await expect(
            identity.locator(".cc-identity-error")
        ).toContainText("Поддерживаются только PDF, JPG и PNG");

        await expect(
            identity.locator(".cc-identity-submit")
        ).toBeDisabled();
    });

    test("отправляет документы личности через multipart API", async ({ page }) => {
        let submittedBody = null;

        await page.route("**/api/identity/me/apply", async (route) => {
            submittedBody = route.request().postData();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ success: true }),
            });
        });

        const identity = page.locator(".cc-identity");

        await identity.locator(".verification-panel-head").click();

        await identity.locator('input[type="file"]').setInputFiles({
            name: "passport.jpg",
            mimeType: "image/jpeg",
            buffer: Buffer.from("mock-passport"),
        });

        const submitButton = identity.locator(
            ".cc-identity-submit"
        );

        await expect(submitButton).toBeDisabled();

        await identity.getByRole("checkbox", {
            name: /Подтверждаю, что отправляю свои документы/,
        }).check();

        await expect(submitButton).toBeDisabled();

        await identity.getByRole("checkbox", {
            name: /Я ознакомился с отдельным согласием/,
        }).check();

        await expect(submitButton).toBeEnabled();

        page.once("dialog", (dialog) => dialog.accept());

        await identity.locator(".cc-identity-submit").click();

        await expect
            .poll(() => submittedBody)
            .toContain('name="documentType"');

        expect(submittedBody).toContain("passport_rf");

        expect(submittedBody).toContain(
            'name="consentVersion"'
        );

        expect(submittedBody).toContain(
            'name="consentSha256"'
        );

        expect(submittedBody).toContain(
            'name="consentConfirmed"'
        );

        expect(submittedBody).toContain(
            "2026-11-25"
        );

        expect(submittedBody).toContain(
            "a".repeat(64)
        );

        expect(submittedBody).toMatch(
            /name="consentConfirmed"\r?\n\r?\ntrue/
        );

        await expect(
            identity.locator(".cc-identity-success")
        ).toContainText("Документы отправлены на проверку");
    });

    test("отображает статусы подтверждённых и ожидающих льгот", async ({ page }) => {
        await openProfilePage(page, {
            benefitsBody: {
                success: true,
                benefits: [
                    {
                        code: "pension_recipient",
                        status: "verified",
                    },
                    {
                        code: "disability_status",
                        status: "pending",
                    },
                ],
            },
        });

        const section = page.locator(".cc-benefits");

        await expect(
            section.locator(".cc-benefits-header-status")
        ).toHaveText("Подтверждено: 1");

        await section.locator(".cc-benefits-heading").click();

        const pension = section.locator(".cc-benefit-item").filter({
            hasText: "Пенсионер",
        });

        const disability = section.locator(".cc-benefit-item").filter({
            hasText: "Льгота по инвалидности",
        });

        await expect(
            pension.locator(".cc-benefit-status")
        ).toContainText("Подтверждена");

        await expect(
            disability.locator(".cc-benefit-status")
        ).toContainText("На проверке");

        await expect(
            pension.locator('input[type="file"]')
        ).toHaveCount(0);

        await expect(
            disability.locator('input[type="file"]')
        ).toHaveCount(0);
    });

    test(
        "не позволяет загружать документы для временно недоступных льгот",
        async ({ page }) => {
            const section =
                page.locator(".cc-benefits");

            await section
                .locator(".cc-benefits-heading")
                .click();

            const disabledPrograms =
                section.locator(".cc-benefit-item")
                    .filter({
                        hasText: /Приём новых заявок временно недоступен/,
                    });

            await expect(
                disabledPrograms
            ).toHaveCount(2);

            await expect(
                disabledPrograms.locator(
                    'input[type="file"]'
                )
            ).toHaveCount(0);

            await expect(
                disabledPrograms.locator(
                    ".cc-benefit-submit"
                )
            ).toHaveCount(0);

            const pension =
                section.locator(".cc-benefit-item")
                    .filter({
                        hasText: "Пенсионер",
                    });

            await expect(
                pension.locator(
                    'input[type="file"]'
                )
            ).toHaveCount(1);
        }
    );

    test("отправляет документ на социальную льготу", async ({ page }) => {
        let submittedBody = null;

        await page.route(
            "**/api/benefits/me/pension_recipient/apply",
            async (route) => {
                submittedBody = route.request().postData();

                await route.fulfill({
                    status: 200,
                    contentType: "application/json",
                    body: JSON.stringify({ success: true }),
                });
            }
        );

        const section = page.locator(".cc-benefits");

        await section.locator(".cc-benefits-heading").click();

        const pension = section.locator(".cc-benefit-item").filter({
            hasText: "Пенсионер",
        });

        await pension.locator('input[type="file"]').setInputFiles({
            name: "pension.pdf",
            mimeType: "application/pdf",
            buffer: Buffer.from("mock-pdf"),
        });

        await expect(
            pension.locator(".cc-benefit-submit")
        ).toBeDisabled();

        await pension.getByRole("checkbox", {
            name: /Я ознакомился с отдельным согласием/,
        }).check();

        await expect(
            pension.locator(".cc-benefit-submit")
        ).toBeEnabled();

        page.once("dialog", (dialog) => dialog.accept());

        await pension.locator(".cc-benefit-submit").click();

        await expect
            .poll(() => submittedBody)
            .toContain('name="document"');

        expect(submittedBody).toContain(
            'name="consentVersion"'
        );

        expect(submittedBody).toContain(
            'name="consentSha256"'
        );

        expect(submittedBody).toContain(
            'name="consentConfirmed"'
        );

        expect(submittedBody).toContain(
            "2026-11-25"
        );

        expect(submittedBody).toContain(
            "a".repeat(64)
        );

        expect(submittedBody).toMatch(
            /name="consentConfirmed"\r?\n\r?\ntrue/
        );

        await expect(
            section.locator(".cc-benefits-success")
        ).toContainText("Документ успешно отправлен");
    });

    test(
        "загружает аватар",
        async ({ page }) => {
            let uploadCalls = 0;
            let submittedBody = null;

            await page.route(
                "**/api/auth/upload-avatar",
                async (route) => {
                    if (
                        route.request().method() !== "POST"
                    ) {
                        await route.fallback();
                        return;
                    }

                    uploadCalls += 1;

                    submittedBody =
                        route.request().postData();

                    await route.fulfill({
                        status: 200,

                        json: {
                            avatar:
                                "/uploads/avatars/new_avatar.jpg",
                        },
                    });
                }
            );

            const avatarInput = page.getByLabel(
                "Изменить фото профиля",
                {
                    exact: true,
                }
            );

            await avatarInput.setInputFiles({
                name: "avatar.png",

                mimeType: "image/png",

                buffer: Buffer.from(
                    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
                    "base64"
                ),
            });

            await expect.poll(
                () => uploadCalls
            ).toBe(1);

            expect(submittedBody).toContain(
                'name="avatar"'
            );

            expect(submittedBody).toContain(
                'filename="avatar.png"'
            );

            await expect(
                page.getByRole("img", {
                    name: "Аватар",
                    exact: true,
                })
            ).toHaveAttribute(
                "src",
                /new_avatar\.jpg$/
            );
        }
    );

    test("показывает профессии и активные категории", async ({ page }) => {
        const professionsCard =
            await openProfileSheet(
                page,
                /^Профессии/,
                "Мои профессии"
            );

        await expect(professionsCard).toContainText("Грузы");
        await expect(professionsCard).toContainText("Такси");
        await expect(professionsCard).toContainText("Курьер");

        await expect(professionsCard.getByRole("button", { name: "Грузы" })).toHaveClass(/active/);
        await expect(professionsCard.getByRole("button", { name: "Такси" })).toHaveClass(/active/);
    });

    test("выбирает профессию и сохраняет", async ({ page }) => {
        let saveBody = null;

        await page.route("**/api/auth/categories/me", async (route) => {
            saveBody = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    preferredCategoryIds: saveBody.categoryIds,
                }),
            });
        });

        const professionsCard =
            await openProfileSheet(
                page,
                /^Профессии/,
                "Мои профессии"
            );

        await professionsCard.getByRole("button", { name: "Ремонт" }).click();
        await professionsCard.getByRole("button", { name: "Сохранить" }).click();

        await expect
            .poll(() => saveBody, {
                timeout: 10000,
            })
            .toEqual({
                categoryIds: [1, 12, 2],
            });
    });

    test("сбрасывает выбранные профессии", async ({ page }) => {
        const professionsCard =
            await openProfileSheet(
                page,
                /^Профессии/,
                "Мои профессии"
            );

        await professionsCard.getByRole("button", { name: "Сбросить" }).click();

        await expect(professionsCard.getByRole("button", { name: "Грузы" })).not.toHaveClass(/active/);
        await expect(professionsCard.getByRole("button", { name: "Такси" })).not.toHaveClass(/active/);
    });

    test(
        "показывает местоположение из профиля",
        async ({ page }) => {
            const dialog = await openProfileSheet(
                page,
                /^Местоположение/,
                "Местоположение"
            );

            await expect(
                dialog.getByRole("textbox", {
                    name: "Адрес",
                    exact: true,
                })
            ).toHaveValue(
                "Симферополь, улица Пушкина, 1"
            );
        }
    );

    test(
        "показывает подсказки адреса и выбирает подсказку",
        async ({ page }) => {
            const dialog = await openProfileSheet(
                page,
                /^Местоположение/,
                "Местоположение"
            );

            const input = dialog.getByRole(
                "textbox",
                {
                    name: "Адрес",
                    exact: true,
                }
            );

            await input.fill(
                "Симферополь Пушкина"
            );

            const suggestion = dialog.locator(
                ".cc-profile-address-suggestions button"
            ).first();

            await expect(suggestion).toBeVisible({
                timeout: 10000,
            });

            await suggestion.click();

            await expect(input).toHaveValue(
                "Россия, Республика Крым, Симферополь, улица Пушкина, 1"
            );

            await expect(
                dialog.locator(
                    ".cc-profile-address-suggestions"
                )
            ).toHaveCount(0);
        }
    );

    test(
        "сохраняет местоположение вручную и закрывает шторку",
        async ({ page }) => {
            let locationBody = null;
            let saveCalls = 0;

            await page.route(
                "**/api/auth/location/me",
                async (route) => {
                    saveCalls += 1;

                    locationBody =
                        route.request()
                            .postDataJSON();

                    await route.fulfill({
                        status: 200,

                        json: {
                            location: {
                                locationAddress:
                                locationBody.address,

                                locationLat:
                                locationBody.lat,

                                locationLng:
                                locationBody.lng,

                                locationSource:
                                locationBody.source,
                            },
                        },
                    });
                }
            );

            const dialog = await openProfileSheet(
                page,
                /^Местоположение/,
                "Местоположение"
            );

            await dialog.getByRole("textbox", {
                name: "Адрес",
                exact: true,
            }).fill(
                "Симферополь Пушкина 1"
            );

            await dialog.getByRole("button", {
                name: "Сохранить",
                exact: true,
            }).click();

            await expect.poll(
                () => locationBody
            ).toEqual({
                address:
                    "Россия, Республика Крым, Симферополь, улица Пушкина, 1",

                lat: 44.9521,

                lng: 34.1024,

                source: "manual",
            });

            expect(saveCalls).toBe(1);

            await expect(dialog)
                .not.toBeVisible();

            await expect(
                page.getByRole("button", {
                    name: /^Местоположение/,
                })
            ).toContainText(
                "Симферополь, улица Пушкина, 1"
            );
        }
    );

    test(
        "не сохраняет пустой адрес",
        async ({ page }) => {
            let saveCalls = 0;

            await page.route(
                "**/api/auth/location/me",
                async (route) => {
                    saveCalls += 1;

                    await route.fulfill({
                        json: {},
                    });
                }
            );

            const dialog = await openProfileSheet(
                page,
                /^Местоположение/,
                "Местоположение"
            );

            await dialog.getByRole("textbox", {
                name: "Адрес",
                exact: true,
            }).fill("");

            await expect(
                dialog.getByRole("button", {
                    name: "Сохранить",
                    exact: true,
                })
            ).toBeDisabled();

            await expect(dialog)
                .toBeVisible();

            expect(saveCalls).toBe(0);
        }
    );

    test(
        "при ошибке сохранения оставляет шторку открытой",
        async ({ page }) => {
            await page.route(
                "**/api/auth/location/me",
                async (route) => {
                    await route.fulfill({
                        status: 503,

                        json: {
                            message:
                                "Сервис временно недоступен",
                        },
                    });
                }
            );

            const dialog = await openProfileSheet(
                page,
                /^Местоположение/,
                "Местоположение"
            );

            const input = dialog.getByRole(
                "textbox",
                {
                    name: "Адрес",
                    exact: true,
                }
            );

            await dialog.getByRole("button", {
                name: "Сохранить",
                exact: true,
            }).click();

            await expect(
                dialog.getByRole("alert")
            ).toContainText(
                "Сервис временно недоступен"
            );

            await expect(dialog)
                .toBeVisible();

            await expect(input).toHaveValue(
                "Симферополь, улица Пушкина, 1"
            );

            await expect(
                dialog.getByRole("button", {
                    name: "Сохранить",
                    exact: true,
                })
            ).toBeEnabled();
        }
    );

    test(
        "открывает встроенную карту и возвращается к адресу",
        async ({ page }) => {
            const dialog = await openProfileSheet(
                page,
                /^Местоположение/,
                "Местоположение"
            );

            await dialog.getByRole("button", {
                name: /^Выбрать на карте/,
            }).click();

            const mapDialog = page.getByRole(
                "dialog",
                {
                    name: "Выбрать на карте",
                    exact: true,
                }
            );

            await expect(mapDialog)
                .toBeVisible();

            await expect(
                mapDialog.locator(
                    ".cc-embedded-map__canvas"
                )
            ).toBeVisible();

            await expect(
                page.locator(
                    ".yandex-map-modal-overlay"
                )
            ).toHaveCount(0);

            await expect(
                mapDialog.getByRole("button", {
                    name:
                        "Подтвердить местоположение",
                    exact: true,
                })
            ).toBeDisabled();

            await mapDialog.getByRole("button", {
                name: "Назад",
                exact: true,
            }).click();

            const locationDialog = page.getByRole(
                "dialog",
                {
                    name: "Местоположение",
                    exact: true,
                }
            );

            await expect(
                locationDialog.getByRole("textbox", {
                    name: "Адрес",
                    exact: true,
                })
            ).toHaveValue(
                "Симферополь, улица Пушкина, 1"
            );

            await expect(
                page.locator(".cc-embedded-map")
            ).toHaveCount(0);
        }
    );

    test(
        "для неподтверждённого автомобиля показывает форму",
        async ({ page }) => {
            const dialog = await openProfileSheet(
                page,
                /^Автомобиль/,
                "Автомобиль"
            );

            await expect(
                dialog.getByRole("textbox", {
                    name: "Марка автомобиля",
                    exact: true,
                })
            ).toBeVisible();

            await expect(
                dialog.getByRole("textbox", {
                    name: "Госномер автомобиля",
                    exact: true,
                })
            ).toBeVisible();

            await expect(
                dialog.getByRole("button", {
                    name: "Отправить на проверку",
                    exact: true,
                })
            ).toBeVisible();
        }
    );

    test(
        "для подтверждённого автомобиля показывает карточку без формы",
        async ({ page }) => {
            await openProfilePage(page, {
                profileBody: {
                    ...profile,

                    vehicleBrand: "Toyota",

                    vehicleModel: "Camry",

                    vehicleColor: "Белый",

                    vehiclePlate: "А123ВС82",

                    vehicleYear: 2020,

                    vehicleVerificationStatus:
                        "verified",
                },
            });

            const dialog = await openProfileSheet(
                page,
                /^Автомобиль/,
                "Автомобиль"
            );

            await expect(dialog)
                .toContainText("Toyota Camry");

            await expect(dialog)
                .toContainText("А123ВС82");

            await expect(dialog)
                .toContainText("Автомобиль подтверждён");

            await expect(
                dialog.getByRole("textbox", {
                    name: "Марка автомобиля",
                    exact: true,
                })
            ).toHaveCount(0);

            await expect(
                dialog.getByRole("button", {
                    name: "Сменить автомобиль",
                    exact: true,
                })
            ).toBeVisible();
        }
    );

    test(
        "открывает редактирование автомобиля и отменяет изменения",
        async ({ page }) => {
            await openProfilePage(page, {
                profileBody: {
                    ...profile,

                    vehicleBrand: "Toyota",

                    vehicleModel: "Camry",

                    vehicleColor: "Белый",

                    vehiclePlate: "А123ВС82",

                    vehicleYear: 2020,

                    vehicleVerificationStatus:
                        "verified",
                },
            });

            let saveCalls = 0;

            await page.route(
                "**/api/auth/vehicle/me",
                async (route) => {
                    saveCalls += 1;

                    await route.fulfill({
                        json: {
                            success: true,
                        },
                    });
                }
            );

            const dialog = await openProfileSheet(
                page,
                /^Автомобиль/,
                "Автомобиль"
            );

            await dialog.getByRole("button", {
                name: "Сменить автомобиль",
                exact: true,
            }).click();

            const editor = page.getByRole(
                "dialog",
                {
                    name: "Сменить автомобиль",
                    exact: true,
                }
            );

            const brandInput = editor.getByRole(
                "textbox",
                {
                    name: "Марка автомобиля",
                    exact: true,
                }
            );

            await expect(brandInput)
                .toHaveValue("Toyota");

            await brandInput.fill("BMW");

            await editor.getByRole("button", {
                name: "Назад",
                exact: true,
            }).click();

            await expect(
                page.getByRole("dialog", {
                    name: "Автомобиль",
                    exact: true,
                })
            ).toContainText(
                "Toyota Camry"
            );

            expect(saveCalls).toBe(0);

            await page.getByRole("dialog", {
                name: "Автомобиль",
                exact: true,
            }).getByRole("button", {
                name: "Сменить автомобиль",
                exact: true,
            }).click();

            await expect(
                page.getByRole("textbox", {
                    name: "Марка автомобиля",
                    exact: true,
                })
            ).toHaveValue("Toyota");
        }
    );

    test(
        "не отправляет пустую форму автомобиля",
        async ({ page }) => {
            let saveCalls = 0;

            await page.route(
                "**/api/auth/vehicle/me",
                async (route) => {
                    saveCalls += 1;

                    await route.fulfill({
                        json: {
                            success: true,
                        },
                    });
                }
            );

            const dialog = await openProfileSheet(
                page,
                /^Автомобиль/,
                "Автомобиль"
            );

            await dialog.getByRole("textbox", {
                name: "Марка автомобиля",
                exact: true,
            }).fill("");

            await dialog.getByRole("button", {
                name: "Отправить на проверку",
                exact: true,
            }).click();

            await expect(
                page.getByText(
                    "Укажите марку автомобиля",
                    {
                        exact: true,
                    }
                )
            ).toBeVisible();

            await expect(dialog)
                .toBeVisible();

            expect(saveCalls).toBe(0);
        }
    );

    test("переходит на отзывы пользователя", async ({ page }) => {
        await page.getByRole("button", { name: "Отзывы" }).click();

        await expect(page).toHaveURL(/\/complaints\/123/);
    });

    test("переходит на историю заказов", async ({ page }) => {
        await page.getByRole("button", { name: "История заказов" }).click();

        await expect(page).toHaveURL(/\/orders-history\/123/);
    });

    test("переходит на информацию и контакты", async ({ page }) => {
        await page.getByRole("button", { name: "Информация и контакты" }).click();

        await expect(page).toHaveURL(/\/info/);
    });

    test("выходит из аккаунта", async ({ page }) => {
        let logoutBody = null;

        await page.route("**/api/auth/session/logout", async (route) => {
            logoutBody = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({ success: true }),
            });
        });

        await page.getByRole("button", { name: "Выйти" }).click();

        await expect(page).toHaveURL(/\/login/);

        await expect
            .poll(() => logoutBody)
            .toEqual({
                sessionClient: "web",
            });

        const storedToken = await page.evaluate(() =>
            localStorage.getItem("authToken")
        );

        expect(storedToken).toBeNull();
    });

    test("редиректит на login, если нет токена", async ({ page }) => {
        await page.addInitScript(() => {
            localStorage.removeItem("authToken");
        });

        await setupProfileMocks(page);

        await page.goto(`${FRONT_URL}/profile?platform=web`, {

            waitUntil: "domcontentloaded",

            timeout: 30000,

        });

        await expect(page).toHaveURL(/\/login/);
    });

    test("редиректит на login при ошибке загрузки профиля", async ({ page }) => {
        await openProfilePage(page, {
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

    test("pull-to-refresh повторно загружает профиль, долг и категории", async ({ page }) => {
        let profileCalls = 0;
        let debtCalls = 0;
        let categoryCalls = 0;

        await setFakeAuth(page);

        await setupProfileMocks(page);

        await page.route("**/api/auth/profile", async (route) => {
            profileCalls += 1;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(profile),
            });
        });

        await page.route("**/api/orders/me/status", async (route) => {
            debtCalls += 1;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    debt: 0,
                }),
            });
        });

        await page.route("**/api/category", async (route) => {
            categoryCalls += 1;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(categories),
            });
        });

        await page.goto(`${FRONT_URL}/profile?platform=web`, {

            waitUntil: "domcontentloaded",

            timeout: 30000,

        });

        await expectProfileLoaded(page);

        await expect
            .poll(() => profileCalls, {
                timeout: 10000,
            })
            .toBeGreaterThanOrEqual(1);

        await page.waitForTimeout(500);

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
            .poll(() => profileCalls, {
                timeout: 10000,
            })
            .toBeGreaterThanOrEqual(2);

        await expect
            .poll(() => debtCalls, {
                timeout: 10000,
            })
            .toBeGreaterThanOrEqual(2);

        await expect
            .poll(() => categoryCalls, {
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