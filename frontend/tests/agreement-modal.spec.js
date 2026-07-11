import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3000";

const testUser = {
    id: 123,
    username: "testuser",
    role: "customer",
    rating: 4.2,
    userStatus: "verified",
    subscriptionType: "basic",
    subscriptionExpiresAt: null,
    yookassaPaymentMethodId: null,
    cardType: null,
    cardLastFour: null,
    avatar: null,
    documentPhotos: [],
    preferredCategoryIds: [],
    locationLat: 44.9521,
    locationLng: 34.1024,
    locationAddress: "Симферополь, улица Пушкина, 1",
    locationSource: "manual",
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

async function setupProfileMocks(page, options = {}) {
    const {
        profileBody = testUser,
        debt = 0,
        bindCardBody = {
            success: true,
            confirmationUrl: "https://payment.example.test/bind-card",
        },
        onBindCard,
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
            body: JSON.stringify([]),
        });
    });

    await page.route("**/api/payments/card/bind/create", async (route) => {
        onBindCard?.();

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(bindCardBody),
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

async function openProfileWithAgreement(page, options = {}) {
    await setFakeAuth(page);
    await setupProfileMocks(page, options);

    await page.goto(`${FRONT_URL}/profile?platform=web`);
    await page.waitForLoadState("domcontentloaded");

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "agreement-modal-profile-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("ProfilePage редиректит на /login. Fake JWT не применился.");
    }

    await expect(page.locator(".profile-title")).toHaveText("Профиль", {
        timeout: 15000,
    });

    const paymentsCard = page.locator(".profile-card").filter({
        hasText: "Платежи",
    });

    await expect(paymentsCard.getByRole("button", {
        name: "Привязать карту",
    })).toBeVisible();

    return paymentsCard;
}

async function openAgreementModal(page) {
    const paymentsCard = page.locator(".profile-card").filter({
        hasText: "Платежи",
    });

    await paymentsCard.getByRole("button", {
        name: "Привязать карту",
    }).click();

    await expect(page.locator(".agreement-modal")).toBeVisible({
        timeout: 10000,
    });
}

test.describe("AgreementModal", () => {
    test.beforeEach(async ({ page }) => {
        await openProfileWithAgreement(page);
    });

    test("по умолчанию модалка не отображается", async ({ page }) => {
        await expect(page.locator(".agreement-modal")).not.toBeVisible();
        await expect(page.locator(".agreement-overlay")).not.toBeVisible();
    });

    test("открывается по кнопке Привязать карту", async ({ page }) => {
        await openAgreementModal(page);

        await expect(page.locator(".agreement-overlay")).toBeVisible();
        await expect(page.locator(".agreement-modal")).toBeVisible();

        await expect(page.locator(".agreement-title")).toHaveText(
            "Соглашение о списании средств"
        );
    });

    test("показывает ключевые условия соглашения", async ({ page }) => {
        await openAgreementModal(page);

        const modal = page.locator(".agreement-modal");

        await expect(modal).toContainText("Назначение платежа");
        await expect(modal).toContainText("Оплата работ исполнителей онлайн не принимается");
        await expect(modal).toContainText("200 ₽");
        await expect(modal).toContainText("50 ₽ / 100 ₽ / 150 ₽");
        await expect(modal).toContainText("2500 ₽");
        await expect(modal).toContainText("9000 ₽");
        await expect(modal).toContainText("partner@cargocamp.ru");
    });

    test("кнопка Подтвердить отключена без чекбокса", async ({ page }) => {
        await openAgreementModal(page);

        await expect(page.locator(".agreement-button")).toBeDisabled();

        await expect(page.locator(".agreement-check")).toContainText(
            "Я согласен с условиями списания средств"
        );
    });

    test("чекбокс включает кнопку Подтвердить", async ({ page }) => {
        await openAgreementModal(page);

        await page.locator(".agreement-check input[type='checkbox']").check();

        await expect(page.locator(".agreement-button")).toBeEnabled();
    });

    test("повторное открытие сбрасывает чекбокс", async ({ page }) => {
        await openAgreementModal(page);

        const checkbox = page.locator(".agreement-check input[type='checkbox']");

        await checkbox.check();

        await expect(page.locator(".agreement-button")).toBeEnabled();

        await page.getByLabel("Закрыть").click();

        await expect(page.locator(".agreement-modal")).not.toBeVisible();

        await openAgreementModal(page);

        await expect(page.locator(".agreement-check input[type='checkbox']")).not.toBeChecked();
        await expect(page.locator(".agreement-button")).toBeDisabled();
    });

    test("закрывается по кнопке крестика", async ({ page }) => {
        await openAgreementModal(page);

        await page.getByLabel("Закрыть").click();

        await expect(page.locator(".agreement-modal")).not.toBeVisible();
        await expect(page.locator(".agreement-overlay")).not.toBeVisible();
    });

    test("закрывается по клику на overlay", async ({ page }) => {
        await openAgreementModal(page);

        await page.locator(".agreement-overlay").click({
            position: {
                x: 10,
                y: 10,
            },
        });

        await expect(page.locator(".agreement-modal")).not.toBeVisible();
    });

    test("клик внутри модалки не закрывает её", async ({ page }) => {
        await openAgreementModal(page);

        await page.locator(".agreement-modal").click({
            position: {
                x: 20,
                y: 20,
            },
        });

        await expect(page.locator(".agreement-modal")).toBeVisible();
    });

    test("без чекбокса не вызывает привязку карты", async ({ page }) => {
        let bindCalled = false;

        await page.route("**/api/payments/card/bind/create", async (route) => {
            bindCalled = true;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                    confirmationUrl: "https://payment.example.test/bind-card",
                }),
            });
        });

        await openAgreementModal(page);

        await expect(page.locator(".agreement-button")).toBeDisabled();

        expect(bindCalled).toBe(false);
    });

    test("после подтверждения вызывает привязку карты", async ({ page }) => {
        let bindCalled = false;

        await openProfileWithAgreement(page, {
            onBindCard: () => {
                bindCalled = true;
            },
        });

        await openAgreementModal(page);

        await page.locator(".agreement-check input[type='checkbox']").check();

        await page.locator(".agreement-button").click();

        await expect
            .poll(() => bindCalled, {
                timeout: 10000,
            })
            .toBe(true);
    });
});