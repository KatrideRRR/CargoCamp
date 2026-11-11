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
        ["**/api/express-orders/me*", { orders: [] }],
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

    await expect(page.locator(".profile-title")).toHaveText("Профиль", {
        timeout: 15000,
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

test.describe("ProfilePage", () => {
    test.beforeEach(async ({ page }) => {
        await openProfilePage(page);
    });

    test("отображает страницу профиля", async ({ page }) => {
        await expect(page.locator(".profile-page")).toBeVisible();

        await expect(page.locator(".profile-title")).toHaveText("Профиль");
        await expect(page.locator(".profile-subtitle")).toHaveText(
            "Управление аккаунтом и оплатой"
        );

        await expect(page.locator(".header-mini-name")).toHaveText("testuser");
        await expect(page.locator(".header-mini-pill")).toContainText("4.2");
    });

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

    test("показывает identity-блок пользователя", async ({ page }) => {
        await expect(page.locator(".identity-name")).toHaveText("testuser");
        await expect(page.locator(".identity-main")).toContainText("ID: 123");
        await expect(page.locator(".identity-main")).toContainText("Рейтинг: 4.2");

        await expect(page.locator(".profile-avatar")).toBeVisible();
        await expect(page.locator(".profile-avatar")).toHaveAttribute("src", /avatar_123\.jpg/);
    });

    test("если аватара нет, показывает placeholder с первой буквой", async ({ page }) => {
        await openProfilePage(page, {
            profileBody: {
                ...profile,
                avatar: null,
            },
        });

        await expect(page.locator(".profile-avatar-placeholder")).toHaveText("T");
    });

    test("кнопка Поддержка ведёт на /support", async ({ page }) => {
        await page.getByRole("button", { name: /Поддержка/i }).click();

        await expect(page).toHaveURL(/\/support/);
    });

    test("показывает привязанную карту", async ({ page }) => {
        const paymentsCard = page.locator(".profile-finance-card")

        await expect(paymentsCard).toContainText("Привязана");
        await expect(paymentsCard).toContainText("VISA");
        await expect(paymentsCard).toContainText("•••• 1234");

        await expect(
            paymentsCard.getByRole("button", { name: "Отвязать" })
        ).toBeVisible();
    });

    test("если карта не привязана, показывает кнопку Привязать карту", async ({ page }) => {
        await openProfilePage(page, {
            profileBody: profileWithoutCard,
        });

        const paymentsCard =page.locator(".profile-finance-card")

        await expect(paymentsCard.getByRole("button", { name: /Привязать карту/ })).toBeVisible();
    });

    test("открывает подтверждение удаления карты и отменяет", async ({ page }) => {
        const paymentsCard = page.locator(".profile-finance-card")

        await paymentsCard.getByRole("button", { name: "Отвязать" }).click();

        await expect(page.locator(".modal-window-compact")).toBeVisible();
        await expect(page.locator(".modal-window-compact")).toContainText("Удалить карту?");
        await expect(page.locator(".modal-window-compact")).toContainText("VISA •••• 1234");

        await page.locator(".modal-window-compact").getByRole("button", { name: "Отмена" }).click();

        await expect(page.locator(".modal-window-compact")).not.toBeVisible();
    });

    test("удаляет привязанную карту", async ({ page }) => {
        let unbindCalled = false;

        await page.route("**/api/payments/card/unbind", async (route) => {
            unbindCalled = true;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                }),
            });
        });

        const paymentsCard = page.locator(".profile-finance-card")

        await paymentsCard.getByRole("button", { name: "Отвязать" }).click();
        await page.locator(".modal-window-compact").getByRole("button", { name: "Удалить карту" }).click();

        await expect
            .poll(() => unbindCalled, {
                timeout: 10000,
            })
            .toBe(true);

        await expect(page.locator(".modal-window-compact")).not.toBeVisible();
        await expect(paymentsCard.getByRole("button", { name: /Привязать карту/ })).toBeVisible();
    });

    test("показывает задолженность и кнопку оплаты", async ({ page }) => {
        await openProfilePage(page, {
            debt: 25000,
        });

        const paymentsCard = page.locator(".profile-finance-card")

        await expect(paymentsCard.locator(".alert-danger")).toBeVisible();
        await expect(paymentsCard.locator(".alert-title")).toHaveText("Задолженность по комиссии");
        await expect(paymentsCard.locator(".alert-text")).toHaveText("250.00 ₽");
        await expect(paymentsCard.getByRole("button", { name: "Оплатить задолженность" })).toBeVisible();
    });

    test("создаёт оплату задолженности и переходит на оплату", async ({ page }) => {
        await openProfilePage(page, {
            debt: 25000,
        });

        const paymentNavigation = await mockPaymentNavigation(page);

        const paymentsCard = page.locator(".profile-finance-card")

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

    test("показывает Premium блок", async ({ page }) => {
        const premiumCard = page.locator(".profile-card").filter({
            hasText: "Premium",
        });

        await expect(premiumCard).toContainText("Обычный аккаунт");
        await expect(premiumCard.getByRole("button", { name: "Купить на 7 дней" })).toBeVisible();
        await expect(premiumCard.getByRole("button", { name: "Купить на 30 дней" })).toBeVisible();
    });

    test("показывает активный Premium", async ({ page }) => {
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

        await openProfilePage(page, {
            profileBody: {
                ...profile,
                subscriptionType: "premium",
                subscriptionExpiresAt: expiresAt,
            },
        });

        const premiumCard = page.locator(".profile-card").filter({
            hasText: "Premium",
        });

        await expect(premiumCard).toContainText("Премиум активен");
    });

    test("создаёт оплату Premium на 7 дней и переходит на оплату", async ({ page }) => {
        const paymentNavigation = await mockPaymentNavigation(page);

        await page
            .getByRole("button", { name: "Купить на 7 дней" })
            .click();

        await expect
            .poll(() => paymentNavigation.getOpenedUrl(), {
                timeout: 10000,
            })
            .toBe("https://payment.example.test/premium");

        await expect(page).toHaveURL(
            "https://payment.example.test/premium",
            {
                timeout: 10000,
            }
        );
    });

    test("показывает актуальные секции подтверждений", async ({ page }) => {
        const card = page.locator(".profile-verification-card");

        await expect(card).toContainText("Подтверждения и льготы");

        await expect(
            card.locator(".cc-identity .verification-panel-title")
        ).toHaveText("Подтверждение личности");

        await expect(
            card.locator(".cc-benefits .verification-panel-title")
        ).toHaveText("Социальные льготы");

        await expect(
            card.locator(".verification-panel-vehicle")
        ).toBeVisible();
    });

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

        await identity.locator('input[type="checkbox"]').check();

        page.once("dialog", (dialog) => dialog.accept());

        await identity.locator(".cc-identity-submit").click();

        await expect
            .poll(() => submittedBody)
            .toContain('name="documentType"');

        expect(submittedBody).toContain("passport_rf");

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
        ).toBeEnabled();

        page.once("dialog", (dialog) => dialog.accept());

        await pension.locator(".cc-benefit-submit").click();

        await expect
            .poll(() => submittedBody)
            .toContain('name="document"');

        await expect(
            section.locator(".cc-benefits-success")
        ).toContainText("Документ успешно отправлен");
    });

    test("загружает аватар", async ({ page }) => {
        let avatarCalled = false;

        await page.route("**/api/auth/upload-avatar", async (route) => {
            avatarCalled = true;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    avatar: "/uploads/avatars/new_avatar.jpg",
                }),
            });
        });

        const avatarInput = page.locator(".avatar-block input[type='file']");

        await avatarInput.setInputFiles({
            name: "avatar.jpg",
            mimeType: "image/jpeg",
            buffer: Buffer.from("fake-avatar"),
        });

        await expect
            .poll(() => avatarCalled, {
                timeout: 10000,
            })
            .toBe(true);

        await expect(page.locator(".profile-avatar")).toHaveAttribute("src", /new_avatar\.jpg/);
    });

    test("показывает профессии и активные категории", async ({ page }) => {
        const professionsCard = page.locator(".profile-card").filter({
            hasText: "Профессии",
        });

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

        const professionsCard = page.locator(".profile-card").filter({
            hasText: "Профессии",
        });

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
        const professionsCard = page.locator(".profile-card").filter({
            hasText: "Профессии",
        });

        await professionsCard.getByRole("button", { name: "Сбросить" }).click();

        await expect(professionsCard.getByRole("button", { name: "Грузы" })).not.toHaveClass(/active/);
        await expect(professionsCard.getByRole("button", { name: "Такси" })).not.toHaveClass(/active/);
    });

    test("показывает местоположение из профиля", async ({ page }) => {
        const locationCard = page.locator(".profile-card").filter({
            hasText: "Местоположение",
        });

        await expect(locationCard.getByPlaceholder("Введите район / улицу / адрес")).toHaveValue(
            "Симферополь, улица Пушкина, 1"
        );

        await expect(locationCard).toContainText("Источник: manual");
    });

    test("показывает подсказки адреса и выбирает подсказку", async ({ page }) => {
        const locationCard = page.locator(".profile-card").filter({
            hasText: "Местоположение",
        });

        const input = locationCard.getByPlaceholder("Введите район / улицу / адрес");

        await input.fill("Симферополь Пушкина");

        await expect(page.locator(".loc-suggestions li").first()).toBeVisible({
            timeout: 10000,
        });

        await page.evaluate(() => {
            const suggestion = document.querySelector(".loc-suggestions li");

            if (!suggestion) {
                throw new Error("Подсказка адреса не найдена");
            }

            suggestion.click();
        });

        await expect(input).toHaveValue(
            "Россия, Республика Крым, Симферополь, улица Пушкина, 1"
        );
    });

    test("сохраняет местоположение вручную", async ({ page }) => {
        let locationBody = null;

        await page.route("**/api/auth/location/me", async (route) => {
            locationBody = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    location: {
                        locationAddress: locationBody.address,
                        locationLat: locationBody.lat,
                        locationLng: locationBody.lng,
                        locationSource: locationBody.source,
                    },
                }),
            });
        });

        const locationCard = page.locator(".profile-card").filter({
            hasText: "Местоположение",
        });

        const input = locationCard.getByPlaceholder("Введите район / улицу / адрес");

        await input.fill("Симферополь Пушкина 1");

        await locationCard.getByRole("button", { name: "Сохранить" }).click();

        await expect
            .poll(() => locationBody, {
                timeout: 10000,
            })
            .toEqual({
                address: "Россия, Республика Крым, Симферополь, улица Пушкина, 1",
                lat: 44.9521,
                lng: 34.1024,
                source: "manual",
            });
    });

    test("не сохраняет пустой адрес", async ({ page }) => {
        const locationCard = page.locator(".profile-card").filter({
            hasText: "Местоположение",
        });

        const input = locationCard.getByPlaceholder("Введите район / улицу / адрес");

        await input.fill("");

        await locationCard.getByRole("button", { name: "Сохранить" }).click();

        await expect(locationCard.locator(".loc-error")).toHaveText("Введите адрес");
    });

    test("открывает карту выбора местоположения", async ({ page }) => {
        const locationCard = page.locator(".profile-card").filter({
            hasText: "Местоположение",
        });

        await locationCard.getByRole("button", { name: "Выбрать на карте" }).click();

        await expect(page.locator("body")).toContainText(/Карта|Выбрать|Закрыть|Местоположение/i, {
            timeout: 10000,
        });

        await expect(page.locator(".profile-title")).toHaveText("Профиль");
    });

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

        await expect(page.locator(".profile-title")).toHaveText("Профиль", {
            timeout: 15000,
        });

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