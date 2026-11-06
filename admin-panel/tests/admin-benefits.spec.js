import {
    test,
    expect,
} from "./fixtures/safeTest";

import {
    setAdminAuth,
} from "./utils/adminTestAuth";

const BASE_APPLICATION = {
    id: 71,
    userId: 101,
    benefitCode: "pension_recipient",
    submittedAt: "2026-11-01T10:00:00.000Z",

    user: {
        id: 101,
        username: "Тестовый пользователь",
        phone: "+79990000000",
    },

    documents: [
        {
            id: 9,
            documentType: "pension_document",
            mimeType: "image/png",
            fileSize: 1024,
        },
    ],
};

const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
);

function futureDate(days = 40) {
    const date = new Date();

    date.setDate(date.getDate() + days);

    return date.toISOString().slice(0, 10);
}

async function setupMocks(page, options = {}) {
    const {
        applications = [BASE_APPLICATION],
        listStatus = 200,
        decisionStatus = 200,
        documentStatus = 200,
    } = options;

    const state = {
        applications: JSON.parse(
            JSON.stringify(applications)
        ),

        listRequests: 0,
        decisions: [],
        documentRequests: 0,
    };

    // Очередь заявок на льготы.
    await page.route(
        "**/api/admin/benefits/pending",
        async (route) => {
            state.listRequests++;

            await route.fulfill({
                status: listStatus,
                contentType: "application/json",
                body: JSON.stringify(
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
                        }
                ),
            });
        }
    );

    // Решение администратора.
    await page.route(
        "**/api/admin/benefits/71/decision",
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
                        (application) =>
                            application.id !== 71
                    );
            }

            await route.fulfill({
                status: decisionStatus,
                contentType: "application/json",
                body: JSON.stringify(
                    decisionStatus === 200
                        ? {
                            success: true,
                            verification: {
                                id: 71,
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
                        }
                ),
            });
        }
    );

    // Защищённый документ.
    // Никаких настоящих фотографий или паспортов.
    await page.route(
        "**/api/admin/benefits/71/document/9",
        async (route) => {
            state.documentRequests++;

            if (documentStatus !== 200) {
                await route.fulfill({
                    status: documentStatus,
                    json: {
                        message:
                            "Документ недоступен",
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

async function openBenefits(page, options = {}) {
    await setAdminAuth(page);

    const state = await setupMocks(page, options);

    await page.goto("/benefits");

    await expect(
        page.locator(".admin-benefits-page")
    ).toBeVisible();

    return state;
}

async function openApplication(page) {
    await page.getByRole("button", {
        name: "Рассмотреть",
    }).first().click();

    await expect(
        page.locator(".admin-benefits-details")
    ).toBeVisible();
}

function acceptDialogs(page) {
    page.on("dialog", async (dialog) => {
        await dialog.accept();
    });
}

test.describe("AdminBenefitsPage", () => {

    test("отображает страницу и пустую очередь", async ({ page }) => {
        await openBenefits(page, {
            applications: [],
        });

        await expect(
            page.getByRole("heading", {
                name: "Проверка льгот",
            })
        ).toBeVisible();

        await expect(
            page.locator(
                ".admin-benefits-summary-value"
            )
        ).toHaveText("0");

        await expect(
            page.locator(".admin-benefits-empty")
        ).toHaveText("Новых заявок пока нет");
    });

    test("показывает разные категории льгот", async ({ page }) => {
        const applications = [
            BASE_APPLICATION,

            {
                ...BASE_APPLICATION,
                id: 72,
                userId: 102,
                benefitCode: "disability_status",
                user: {
                    username: "Пользователь 2",
                },
            },

            {
                ...BASE_APPLICATION,
                id: 73,
                userId: 103,
                benefitCode: "large_family_parent",
                user: {
                    username: "Пользователь 3",
                },
            },
        ];

        await openBenefits(page, {
            applications,
        });

        await expect(
            page.locator(".admin-benefits-card")
        ).toHaveCount(3);

        await expect(
            page.locator(".admin-benefits-list")
        ).toContainText("Пенсионер");

        await expect(
            page.locator(".admin-benefits-list")
        ).toContainText("Инвалидность");

        await expect(
            page.locator(".admin-benefits-list")
        ).toContainText("Многодетная семья");
    });

    test("открывает и сворачивает заявку", async ({ page }) => {
        await openBenefits(page);

        await openApplication(page);

        await expect(
            page.locator(".admin-benefits-details")
        ).toContainText("Документы");

        await expect(
            page.getByRole("button", {
                name: "Получить документ №9",
            })
        ).toBeVisible();

        await page.getByRole("button", {
            name: "Свернуть",
        }).click();

        await expect(
            page.locator(".admin-benefits-details")
        ).toHaveCount(0);
    });

    test("не подтверждает льготу без даты", async ({ page }) => {
        const state = await openBenefits(page);

        await openApplication(page);

        await page.getByRole("button", {
            name: "Подтвердить",
            exact: true,
        }).click();

        await expect(
            page.getByRole("alert")
        ).toHaveText(
            "Укажите дату следующей проверки льготы"
        );

        expect(state.decisions).toHaveLength(0);
    });

    test("не отклоняет заявку без причины", async ({ page }) => {
        const state = await openBenefits(page);

        await openApplication(page);

        await page.getByRole("button", {
            name: "Отклонить",
        }).click();

        await expect(
            page.getByRole("alert")
        ).toHaveText(
            "Укажите причину отклонения — минимум 5 символов"
        );

        expect(state.decisions).toHaveLength(0);
    });

    test("не позволяет подтвердить заявку без документов", async ({ page }) => {
        await openBenefits(page, {
            applications: [
                {
                    ...BASE_APPLICATION,
                    documents: [],
                },
            ],
        });

        await openApplication(page);

        await expect(
            page.getByText("Документы отсутствуют")
        ).toBeVisible();

        await expect(
            page.getByRole("button", {
                name: "Подтвердить",
                exact: true,
            })
        ).toBeDisabled();
    });

    test("подтверждает льготу с датой проверки", async ({ page }) => {
        const state = await openBenefits(page);

        await openApplication(page);

        const validUntil = futureDate();

        await page.getByLabel(
            "Дата следующей проверки"
        ).fill(validUntil);

        acceptDialogs(page);

        await page.getByRole("button", {
            name: "Подтвердить",
            exact: true,
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
            page.locator(".admin-benefits-empty")
        ).toBeVisible();
    });

    test("отклоняет заявку с указанной причиной", async ({ page }) => {
        const state = await openBenefits(page);

        await openApplication(page);

        await page.getByLabel(
            "Комментарий к решению"
        ).fill(
            "Представленные документы не подтверждают льготу"
        );

        acceptDialogs(page);

        await page.getByRole("button", {
            name: "Отклонить",
        }).click();

        await expect.poll(
            () => state.decisions.length
        ).toBe(1);

        expect(state.decisions[0]).toEqual({
            method: "POST",
            body: {
                action: "reject",
                reason:
                    "Представленные документы не подтверждают льготу",
            },
        });

        await expect(
            page.locator(".admin-benefits-empty")
        ).toBeVisible();
    });

    test("отмена подтверждения не отправляет решение", async ({ page }) => {
        const state = await openBenefits(page);

        await openApplication(page);

        await page.getByLabel(
            "Дата следующей проверки"
        ).fill(futureDate());

        page.on("dialog", async (dialog) => {
            await dialog.dismiss();
        });

        await page.getByRole("button", {
            name: "Подтвердить",
            exact: true,
        }).click();

        expect(state.decisions).toHaveLength(0);

        await expect(
            page.locator(".admin-benefits-card")
        ).toHaveCount(1);
    });

    test("скачивает документ через тестовый API", async ({ page }) => {
        const state = await openBenefits(page);

        await openApplication(page);

        const downloadPromise =
            page.waitForEvent("download");

        await page.getByRole("button", {
            name: "Получить документ №9",
        }).click();

        const download = await downloadPromise;

        expect(
            download.suggestedFilename()
        ).toBe(
            "benefit-71-document-9.png"
        );

        expect(state.documentRequests).toBe(1);
    });

    test("показывает ошибку загрузки заявок", async ({ page }) => {
        await openBenefits(page, {
            listStatus: 500,
        });

        await expect(
            page.getByRole("alert")
        ).toHaveText(
            "Не удалось получить заявки"
        );
    });

    test("показывает ошибку сохранения решения", async ({ page }) => {
        const state = await openBenefits(page, {
            decisionStatus: 500,
        });

        await openApplication(page);

        await page.getByLabel(
            "Дата следующей проверки"
        ).fill(futureDate());

        acceptDialogs(page);

        await page.getByRole("button", {
            name: "Подтвердить",
            exact: true,
        }).click();

        await expect(
            page.getByRole("alert")
        ).toHaveText(
            "Не удалось сохранить решение"
        );

        expect(state.decisions).toHaveLength(1);

        await expect(
            page.locator(".admin-benefits-card")
        ).toHaveCount(1);
    });

    test("кнопка обновления повторно загружает очередь", async ({ page }) => {
        const state = await openBenefits(page);

        await expect.poll(
            () => state.listRequests
        ).toBeGreaterThanOrEqual(1);

        await page.getByRole("button", {
            name: "Обновить",
        }).click();

        await expect.poll(
            () => state.listRequests
        ).toBeGreaterThanOrEqual(2);
    });

});