import {
    test,
    expect,
} from "./fixtures/safeTest";

import {
    setAdminAuth,
} from "./utils/adminTestAuth";

const APPLICATION = {
    id: 81,
    userId: 1201,
    status: "pending",
    countryCode: "RU",
    verificationMethod: "document",
    assuranceLevel: "basic",
    createdAt: "2026-11-01T10:00:00.000Z",

    user: {
        id: 1201,
        username: "Тестовый пользователь",
        phone: "+79990000000",
    },

    documents: [
        {
            id: 11,
            documentType: "passport_page",
            mimeType: "image/png",
            fileSize: 2048,
            createdAt: "2026-11-01T10:00:00.000Z",
        },
    ],
};

const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
);

function futureDate(days = 60) {
    const date = new Date();

    date.setDate(date.getDate() + days);

    return date.toISOString().slice(0, 10);
}

async function setupMocks(page, options = {}) {
    const {
        applications = [APPLICATION],
        listStatus = 200,
        decisionStatus = 200,
        documentStatus = 200,
    } = options;

    const state = {
        applications: structuredClone(applications),
        listRequests: 0,
        decisions: [],
        documentRequests: 0,
    };

    // Страница дополнительно загружает список
    // уже верифицированных пользователей.
    await page.route(
        "**/api/admin/identity/verified**",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    success: true,
                    users: [],
                    total: 0,
                },
            });
        }
    );

    // Очередь заявок.
    await page.route(
        "**/api/admin/identity/pending",
        async (route) => {
            state.listRequests++;

            await route.fulfill({
                status: listStatus,
                json:
                    listStatus === 200
                        ? {
                            success: true,
                            applications:
                            state.applications,
                        }
                        : {
                            success: false,
                            message:
                                "Не удалось получить заявки",
                        },
            });
        }
    );

    // Подтверждение или отклонение личности.
    await page.route(
        "**/api/admin/identity/81/decision",
        async (route) => {
            const body =
                route.request().postDataJSON();

            state.decisions.push({
                method: route.request().method(),
                body,
            });

            if (decisionStatus === 200) {
                state.applications =
                    state.applications.filter(
                        (item) => item.id !== 81
                    );
            }

            await route.fulfill({
                status: decisionStatus,
                json:
                    decisionStatus === 200
                        ? {
                            success: true,
                            message:
                                body.action === "approve"
                                    ? "Личность пользователя подтверждена"
                                    : "Заявка отклонена",
                            verification: {
                                id: 81,
                                userId: 1201,
                                status:
                                    body.action === "approve"
                                        ? "verified"
                                        : "rejected",
                            },
                        }
                        : {
                            success: false,
                            message:
                                "Не удалось сохранить решение",
                        },
            });
        }
    );

    // Искусственный документ.
    await page.route(
        "**/api/admin/identity/81/document/11",
        async (route) => {
            state.documentRequests++;

            if (documentStatus !== 200) {
                await route.fulfill({
                    status: documentStatus,
                    json: {
                        message: "Документ недоступен",
                    },
                });

                return;
            }

            await route.fulfill({
                status: 200,
                contentType: "image/png",
                headers: {
                    "Cache-Control": "no-store",
                },
                body: PNG,
            });
        }
    );

    return state;
}

async function openIdentity(page, options = {}) {
    await setAdminAuth(page);

    const state = await setupMocks(page, options);

    await page.goto("/identity");

    await expect(
        page.locator(".admin-identity-page")
    ).toBeVisible();

    return state;
}

async function openApplication(page) {
    await page.getByRole("button", {
        name: "Рассмотреть",
    }).first().click();

    await expect(
        page.locator(".admin-identity-details")
    ).toBeVisible();
}

function acceptDialogs(page) {
    page.on("dialog", async (dialog) => {
        await dialog.accept();
    });
}

test.describe("AdminIdentityPage", () => {

    test("отображает пустую очередь заявок", async ({ page }) => {
        await openIdentity(page, {
            applications: [],
        });

        await expect(
            page.getByRole("heading", {
                name: "Проверка личности",
            })
        ).toBeVisible();

        await expect(
            page.locator(".admin-identity-counter")
        ).toHaveText("0");

        await expect(
            page.getByRole("heading", {
                name: "Все заявки рассмотрены",
            })
        ).toBeVisible();
    });

    test("отображает заявку и сведения о пользователе", async ({ page }) => {
        await openIdentity(page);

        const card = page.locator(
            ".admin-identity-card"
        );

        await expect(card).toHaveCount(1);

        await expect(card).toContainText(
            "Тестовый пользователь"
        );

        await expect(card).toContainText(
            "1201"
        );

        await expect(card).toContainText(
            "Заявка № 81"
        );

        await expect(card).toContainText(
            "Документов: 1"
        );
    });

    test("открывает и сворачивает заявку", async ({ page }) => {
        await openIdentity(page);

        await openApplication(page);

        await expect(
            page.locator(".admin-identity-details")
        ).toContainText(
            "Документы пользователя"
        );

        await expect(
            page.locator(".admin-identity-document")
        ).toContainText(
            "Документ, удостоверяющий личность"
        );

        await page.getByRole("button", {
            name: "Свернуть",
        }).click();

        await expect(
            page.locator(".admin-identity-details")
        ).toHaveCount(0);
    });

    test("запрещает подтверждение без документов", async ({ page }) => {
        const state = await openIdentity(page, {
            applications: [
                {
                    ...APPLICATION,
                    documents: [],
                },
            ],
        });

        await openApplication(page);

        await expect(
            page.locator(".admin-identity-warning")
        ).toContainText(
            "К заявке не приложены документы"
        );

        await expect(
            page.getByRole("button", {
                name: "Подтвердить личность",
            })
        ).toBeDisabled();

        expect(state.decisions).toHaveLength(0);
    });

    test("требует отметку о проверке документов", async ({ page }) => {
        const state = await openIdentity(page);

        await openApplication(page);

        const checkbox = page.getByRole("checkbox");

        await expect(checkbox).not.toBeChecked();

        await expect(
            page.getByRole("button", {
                name: "Подтвердить личность",
            })
        ).toBeDisabled();

        await checkbox.check();

        await expect(
            page.getByRole("button", {
                name: "Подтвердить личность",
            })
        ).toBeEnabled();

        expect(state.decisions).toHaveLength(0);
    });

    test("не подтверждает личность без даты", async ({ page }) => {
        const state = await openIdentity(page);

        await openApplication(page);

        await page.getByRole("checkbox").check();

        await page.locator(
            ".admin-identity-form input[type='date']"
        ).fill("");

        await page.getByRole("button", {
            name: "Подтвердить личность",
        }).click();

        await expect(
            page.locator(".admin-identity-error")
        ).toHaveText(
            "Укажите дату следующей проверки"
        );

        expect(state.decisions).toHaveLength(0);
    });

    test("не отклоняет заявку без причины", async ({ page }) => {
        const state = await openIdentity(page);

        await openApplication(page);

        await page.getByRole("button", {
            name: "Отклонить заявку",
        }).click();

        await expect(
            page.locator(".admin-identity-error")
        ).toHaveText(
            "Укажите причину отказа — минимум 5 символов"
        );

        expect(state.decisions).toHaveLength(0);
    });

    test("подтверждает личность после проверки документов", async ({ page }) => {
        const state = await openIdentity(page);

        await openApplication(page);

        const validUntil = futureDate();

        await page.getByRole("checkbox").check();

        await page.locator(
            ".admin-identity-form input[type='date']"
        ).fill(validUntil);

        acceptDialogs(page);

        await page.getByRole("button", {
            name: "Подтвердить личность",
        }).click();

        await expect.poll(
            () => state.decisions.length
        ).toBe(1);

        expect(state.decisions[0]).toEqual({
            method: "POST",
            body: {
                action: "approve",
                reason: "",
                validUntil,
            },
        });

        await expect(
            page.locator(".admin-identity-success")
        ).toHaveText(
            "Личность пользователя подтверждена"
        );

        await expect(
            page.getByRole("heading", {
                name: "Все заявки рассмотрены",
            })
        ).toBeVisible();
    });

    test("отклоняет заявку с указанием причины", async ({ page }) => {
        const state = await openIdentity(page);

        await openApplication(page);

        const reason =
            "Документы не позволяют подтвердить личность";

        await page.getByPlaceholder(
            "Причина обязательна при отклонении заявки"
        ).fill(reason);

        acceptDialogs(page);

        await page.getByRole("button", {
            name: "Отклонить заявку",
        }).click();

        await expect.poll(
            () => state.decisions.length
        ).toBe(1);

        expect(state.decisions[0]).toEqual({
            method: "POST",
            body: {
                action: "reject",
                reason,
            },
        });

        await expect(
            page.locator(".admin-identity-success")
        ).toHaveText("Заявка отклонена");
    });

    test("отмена подтверждения не отправляет решение", async ({ page }) => {
        const state = await openIdentity(page);

        await openApplication(page);

        await page.getByRole("checkbox").check();

        page.on("dialog", async (dialog) => {
            await dialog.dismiss();
        });

        await page.getByRole("button", {
            name: "Подтвердить личность",
        }).click();

        expect(state.decisions).toHaveLength(0);

        await expect(
            page.locator(".admin-identity-card")
        ).toHaveCount(1);
    });

    test("скачивает документ через защищённый маршрут", async ({ page }) => {
        const state = await openIdentity(page);

        await openApplication(page);

        const downloadPromise =
            page.waitForEvent("download");

        await page.locator(
            ".admin-identity-document"
        ).getByRole("button", {
            name: "Скачать",
            exact: true,
        }).click();

        const download = await downloadPromise;

        expect(
            download.suggestedFilename()
        ).toBe(
            "identity-81-document-11.png"
        );

        expect(state.documentRequests).toBe(1);
    });

    test("показывает ошибку скачивания документа", async ({ page }) => {
        const state = await openIdentity(page, {
            documentStatus: 409,
        });

        await openApplication(page);

        await page.locator(
            ".admin-identity-document"
        ).getByRole("button", {
            name: "Скачать",
            exact: true,
        }).click();

        await expect(
            page.locator(".admin-identity-error")
        ).toContainText(
            "Не удалось получить документ"
        );

        expect(state.documentRequests).toBe(1);
    });

    test("показывает ошибку загрузки заявок", async ({ page }) => {
        await openIdentity(page, {
            listStatus: 500,
        });

        await expect(
            page.locator(".admin-identity-error")
        ).toHaveText(
            "Не удалось получить заявки"
        );
    });

    test("сохраняет заявку при ошибке решения", async ({ page }) => {
        const state = await openIdentity(page, {
            decisionStatus: 500,
        });

        await openApplication(page);

        await page.getByRole("checkbox").check();

        acceptDialogs(page);

        await page.getByRole("button", {
            name: "Подтвердить личность",
        }).click();

        await expect(
            page.locator(".admin-identity-error")
        ).toHaveText(
            "Не удалось сохранить решение"
        );

        expect(state.decisions).toHaveLength(1);

        await expect(
            page.locator(".admin-identity-card")
        ).toHaveCount(1);
    });

    test("повторно загружает заявки по кнопке Обновить", async ({ page }) => {
        const state = await openIdentity(page);

        await expect.poll(
            () => state.listRequests
        ).toBeGreaterThanOrEqual(1);

        await page.locator(
            ".admin-identity-refresh"
        ).click();

        await expect.poll(
            () => state.listRequests
        ).toBeGreaterThanOrEqual(2);
    });

});