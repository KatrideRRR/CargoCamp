import {
    test,
    expect,
} from "./fixtures/safeTest";

import {
    mockAppShell,
} from "./utils/mockAppShell";

import {
    createMockJwt,
} from "./utils/mockAuthSession";

const FRONT_URL =
    "http://localhost:3000";

const profile = {
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

    tbankCardBound: false,
    autoCommissionProvider: "none",

    avatar: null,
    documentPhotos: [],
    preferredCategoryIds: [],

    locationLat: 44.9521,
    locationLng: 34.1024,

    locationAddress:
        "Симферополь, улица Пушкина, 1",

    locationSource: "manual",
};

async function setupProfile(page) {
    const state = {
        bindCalls: 0,
        paymentUrl: null,
        bindStatus: 200,
    };

    await mockAppShell(page, {
        identity: true,
        benefits: true,
    });

    const token = createMockJwt(profile);

    await page.addInitScript(
        ({ token, profile }) => {
            localStorage.setItem(
                "authToken",
                token
            );

            localStorage.setItem(
                "user",
                JSON.stringify(profile)
            );

            localStorage.setItem(
                "currentUser",
                JSON.stringify(profile)
            );

            localStorage.setItem(
                "userData",
                JSON.stringify(profile)
            );
        },
        {
            token,
            profile,
        }
    );

    await page.route(
        "**/api/auth/profile",
        async (route) => {
            await route.fulfill({
                json: profile,
            });
        }
    );

    await page.route(
        "**/api/orders/me/status",
        async (route) => {
            await route.fulfill({
                json: {
                    debt: 0,
                },
            });
        }
    );

    await page.route(
        "**/api/category",
        async (route) => {
            await route.fulfill({
                json: [],
            });
        }
    );

    await page.route(
        "**/api/account-deletion/status",
        async (route) => {
            await route.fulfill({
                json: {
                    request: null,
                },
            });
        }
    );

    await page.route(
        "**/api/payments/card/bind/create",
        async (route) => {
            state.bindCalls += 1;

            if (state.bindStatus !== 200) {
                await route.fulfill({
                    status: state.bindStatus,

                    json: {
                        message:
                            "Привязка временно недоступна",
                    },
                });

                return;
            }

            await route.fulfill({
                json: {
                    success: true,

                    confirmationUrl:
                        "https://payment.example.test/bind-card",
                },
            });
        }
    );

    await page.route(
        "https://payment.example.test/**",
        async (route) => {
            state.paymentUrl =
                route.request().url();

            await route.fulfill({
                status: 200,
                contentType: "text/html",
                body: "<html><body>Payment mock</body></html>",
            });
        }
    );

    await page.goto(
        `${FRONT_URL}/profile?platform=web`,
        {
            waitUntil: "domcontentloaded",
        }
    );

    await expect(
        page.getByRole("heading", {
            name: "Профиль",
            exact: true,
        })
    ).toBeVisible();

    return state;
}

async function openAgreement(page) {
    await page.getByRole("button", {
        name: /^Банковские карты/,
    }).click();

    const cards = page.getByRole(
        "dialog",
        {
            name: "Банковские карты",
            exact: true,
        }
    );

    await cards.getByRole("button", {
        name: /Привязать карту/,
    }).click();

    const providers = page.getByRole(
        "dialog",
        {
            name: "Привязать карту",
            exact: true,
        }
    );

    await providers.getByRole("button", {
        name: /^ЮKassa/,
    }).click();

    const agreement = page.getByRole(
        "dialog",
        {
            name: "Соглашение",
            exact: true,
        }
    );

    await expect(agreement)
        .toBeVisible();

    return agreement;
}

function getAgreementCheckbox(dialog) {
    return dialog.getByRole(
        "checkbox",
        {
            name:
                /Я согласен с условиями списания средств/,
        }
    );
}

function getSubmitButton(dialog) {
    return dialog.getByRole(
        "button",
        {
            name:
                "Подтвердить и привязать карту",
            exact: true,
        }
    );
}

test.describe(
    "Соглашение о привязке карты",
    () => {
        let state;

        test.beforeEach(async ({ page }) => {
            state = await setupProfile(page);
        });

        test(
            "соглашение не открывается автоматически",
            async ({ page }) => {
                await expect(
                    page.getByRole("dialog", {
                        name: "Соглашение",
                        exact: true,
                    })
                ).toHaveCount(0);

                expect(state.bindCalls)
                    .toBe(0);
            }
        );

        test(
            "открывает соглашение внутри шторки банковских карт",
            async ({ page }) => {
                const dialog =
                    await openAgreement(page);

                await expect(dialog)
                    .toBeVisible();

                await expect(
                    page.getByRole("dialog")
                ).toHaveCount(1);

                await expect(
                    page.locator(
                        ".agreement-overlay"
                    )
                ).toHaveCount(0);
            }
        );

        test(
            "показывает условия списания средств",
            async ({ page }) => {
                const dialog =
                    await openAgreement(page);

                for (const text of [
                    "Назначение платежа",

                    "Оплата работ исполнителей онлайн не принимается",

                    "200 ₽",

                    "50 ₽ / 100 ₽ / 150 ₽",

                    "2500 ₽",

                    "9000 ₽",

                    "partner@cargocamp.ru",
                ]) {
                    await expect(dialog)
                        .toContainText(text);
                }
            }
        );

        test(
            "без согласия нельзя начать привязку",
            async ({ page }) => {
                const dialog =
                    await openAgreement(page);

                await expect(
                    getAgreementCheckbox(dialog)
                ).not.toBeChecked();

                await expect(
                    getSubmitButton(dialog)
                ).toBeDisabled();

                expect(state.bindCalls)
                    .toBe(0);
            }
        );

        test(
            "согласие включает кнопку подтверждения",
            async ({ page }) => {
                const dialog =
                    await openAgreement(page);

                await getAgreementCheckbox(
                    dialog
                ).check();

                await expect(
                    getSubmitButton(dialog)
                ).toBeEnabled();

                await getAgreementCheckbox(
                    dialog
                ).uncheck();

                await expect(
                    getSubmitButton(dialog)
                ).toBeDisabled();
            }
        );

        test(
            "возврат назад не инициирует привязку",
            async ({ page }) => {
                const dialog =
                    await openAgreement(page);

                await getAgreementCheckbox(
                    dialog
                ).check();

                await dialog.getByRole(
                    "button",
                    {
                        name: "Назад",
                        exact: true,
                    }
                ).click();

                const providers =
                    page.getByRole("dialog", {
                        name: "Привязать карту",
                        exact: true,
                    });

                await expect(providers)
                    .toBeVisible();

                expect(state.bindCalls)
                    .toBe(0);

                await providers.getByRole(
                    "button",
                    {
                        name: /^ЮKassa/,
                    }
                ).click();

                const reopened =
                    page.getByRole("dialog", {
                        name: "Соглашение",
                        exact: true,
                    });

                await expect(
                    getAgreementCheckbox(
                        reopened
                    )
                ).not.toBeChecked();

                await expect(
                    getSubmitButton(reopened)
                ).toBeDisabled();
            }
        );

        test(
            "закрытие шторки сбрасывает согласие",
            async ({ page }) => {
                let dialog =
                    await openAgreement(page);

                await getAgreementCheckbox(
                    dialog
                ).check();

                await dialog.getByRole(
                    "button",
                    {
                        name: "Закрыть",
                        exact: true,
                    }
                ).click();

                await expect(dialog)
                    .not.toBeVisible();

                dialog =
                    await openAgreement(page);

                await expect(
                    getAgreementCheckbox(dialog)
                ).not.toBeChecked();

                expect(state.bindCalls)
                    .toBe(0);
            }
        );

        test(
            "клик внутри соглашения не закрывает шторку",
            async ({ page }) => {
                const dialog =
                    await openAgreement(page);

                await dialog.getByText(
                    /Назначение платежа/
                ).first().click();

                await expect(dialog)
                    .toBeVisible();

                expect(state.bindCalls)
                    .toBe(0);
            }
        );

        test(
            "закрывается по нажатию на затемнение",
            async ({ page }) => {
                const dialog =
                    await openAgreement(page);

                await page.locator(
                    ".cc-sheet-overlay"
                ).click({
                    position: {
                        x: 5,
                        y: 5,
                    },
                });

                await expect(dialog)
                    .not.toBeVisible();

                expect(state.bindCalls)
                    .toBe(0);
            }
        );

        test(
            "после подтверждения создаёт привязку и открывает платёжную страницу",
            async ({ page }) => {
                const dialog =
                    await openAgreement(page);

                await getAgreementCheckbox(
                    dialog
                ).check();

                await getSubmitButton(
                    dialog
                ).click();

                await expect.poll(
                    () => state.bindCalls
                ).toBe(1);

                await expect.poll(
                    () => state.paymentUrl
                ).toBe(
                    "https://payment.example.test/bind-card"
                );
            }
        );

        test(
            "при ошибке привязки оставляет возможность повторить",
            async ({ page }) => {
                state.bindStatus = 503;

                const dialog =
                    await openAgreement(page);

                await getAgreementCheckbox(
                    dialog
                ).check();

                await getSubmitButton(
                    dialog
                ).click();

                await expect.poll(
                    () => state.bindCalls
                ).toBe(1);

                await expect(dialog)
                    .toBeVisible();

                await expect(
                    getSubmitButton(dialog)
                ).toBeEnabled();

                expect(state.paymentUrl)
                    .toBeNull();
            }
        );
    }
);