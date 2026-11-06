import {
    test,
    expect,
} from "./fixtures/safeTest";

import {
    setAdminAuth,
    ADMIN_TEST_TOKEN,
} from "./utils/adminTestAuth";

const USER = {
    id: 61,
    username: "Тестовый пользователь ПЭП",
    phone: "+79990000061",
    createdAt: "2026-10-01T10:00:00.000Z",
    rating: 5,
    userStatus: "unverified",
    role: "user",
    subscription_type: "standard",
    subscription_expires_at: null,
};

function activePep() {
    return {
        userId: 61,
        policyVersion: "1.1",
        activatedAt: "2026-11-01T10:00:00.000Z",
        expiresAt: new Date(
            Date.now() + 45 * 86400000
        ).toISOString(),
        revokedAt: null,
        revokeReason: null,
    };
}

async function setupMocks(page, options = {}) {
    const {
        enrollments = [],
        revokeStatus = 200,
        revokeMessage = "",
    } = options;

    const state = {
        enrollmentsRequests: [],
        revocations: [],
    };

    // Искусственный пользователь.
    await page.route(
        "**/api/admin/users",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: [USER],
            });
        }
    );

    // Список активаций ПЭП.
    await page.route(
        "**/api/admin/pep/enrollments",
        async (route) => {
            state.enrollmentsRequests.push({
                method: route.request().method(),
                authorization:
                route.request().headers().authorization,
            });

            await route.fulfill({
                status: 200,
                json: {
                    success: true,
                    enrollments,
                },
            });
        }
    );

    // Дополнительные счётчики UsersPage.
    const extraRoutes = {
        "/api/admin/user-documents/61": {
            documents: [],
        },
        "/api/admin/users/61/complaints": {
            complaints: [],
        },
        "/api/admin/users/61/orders": {
            orders: [],
        },
    };

    for (const [path, body] of Object.entries(
        extraRoutes
    )) {
        await page.route(
            `**${path}`,
            async (route) => {
                await route.fulfill({
                    status: 200,
                    json: body,
                });
            }
        );
    }

    // Отзыв ПЭП. Запрос никуда не отправляется.
    await page.route(
        "**/api/admin/pep/61/revoke",
        async (route) => {
            state.revocations.push({
                method: route.request().method(),
                body: route.request().postDataJSON(),
                authorization:
                route.request().headers().authorization,
            });

            await route.fulfill({
                status: revokeStatus,
                json:
                    revokeStatus === 200
                        ? {
                            success: true,
                            message:
                                "ПЭП отозвана. Для повторной активации потребуется SMS.",
                        }
                        : {
                            success: false,
                            message:
                                revokeMessage ||
                                "Не удалось отозвать ПЭП",
                        },
            });
        }
    );

    return state;
}

async function openUsers(page, options = {}) {
    await setAdminAuth(page);

    const state = await setupMocks(page, options);

    await page.goto("/users");

    await expect(
        page.locator(".users-table tbody tr")
    ).toHaveCount(1);

    return state;
}

// Колонка ПЭП — шестая колонка таблицы.
function pepCell(page) {
    return page
        .locator(".users-table tbody tr")
        .first()
        .locator("td")
        .nth(5);
}

function revokeButton(page) {
    return pepCell(page).getByRole("button", {
        name: "Назначить повторную проверку",
    });
}

function handleDialogs(page, promptValue, messages) {
    page.on("dialog", async (dialog) => {
        messages.push({
            type: dialog.type(),
            message: dialog.message(),
        });

        if (dialog.type() === "prompt") {
            if (promptValue === null) {
                await dialog.dismiss();
            } else {
                await dialog.accept(promptValue);
            }
            return;
        }

        await dialog.accept();
    });
}

test.describe("UsersPage — ПЭП", () => {

    test("отображает отсутствие ПЭП", async ({ page }) => {
        const state = await openUsers(page);

        await expect(
            pepCell(page)
        ).toContainText("Не подключена");

        await expect(
            revokeButton(page)
        ).toHaveCount(0);

        await expect.poll(
            () => state.enrollmentsRequests.length
        ).toBeGreaterThanOrEqual(1);

        for (const request of state.enrollmentsRequests) {
            expect(request).toEqual({
                method: "GET",
                authorization: `Bearer ${ADMIN_TEST_TOKEN}`,
            });
        }
    });

    test("показывает активированную через SMS ПЭП", async ({ page }) => {
        const pep = activePep();

        await openUsers(page, {
            enrollments: [pep],
        });

        await expect(
            pepCell(page)
        ).toContainText("SMS подтверждена");

        await expect(
            pepCell(page)
        ).toContainText(
            new Date(pep.expiresAt)
                .toLocaleDateString("ru-RU")
        );

        await expect(
            revokeButton(page)
        ).toBeVisible();
    });

    test("показывает истёкшую ПЭП", async ({ page }) => {
        await openUsers(page, {
            enrollments: [
                {
                    ...activePep(),
                    expiresAt:
                        "2020-01-01T00:00:00.000Z",
                },
            ],
        });

        await expect(
            pepCell(page)
        ).toContainText("Требует SMS");

        await expect(
            revokeButton(page)
        ).toHaveCount(0);
    });

    test("показывает отозванную ПЭП", async ({ page }) => {
        await openUsers(page, {
            enrollments: [
                {
                    ...activePep(),
                    revokedAt:
                        "2026-11-02T10:00:00.000Z",
                    revokeReason:
                        "Повторная проверка документов",
                },
            ],
        });

        await expect(
            pepCell(page)
        ).toContainText("Отозвана");

        await expect(
            revokeButton(page)
        ).toHaveCount(0);
    });

    test("не путает ПЭП разных пользователей", async ({ page }) => {
        await openUsers(page, {
            enrollments: [
                {
                    ...activePep(),
                    userId: 999,
                },
            ],
        });

        await expect(
            pepCell(page)
        ).toContainText("Не подключена");

        await expect(
            revokeButton(page)
        ).toHaveCount(0);
    });

    test("отмена окна причины не отзывает ПЭП", async ({ page }) => {
        const state = await openUsers(page, {
            enrollments: [activePep()],
        });

        await expect(
            revokeButton(page)
        ).toBeVisible();

        const dialogs = [];

        handleDialogs(page, null, dialogs);

        await revokeButton(page).click();

        expect(state.revocations).toHaveLength(0);

        expect(dialogs[0]).toEqual({
            type: "prompt",
            message:
                "Причина повторной проверки ПЭП:",
        });

        await expect(
            pepCell(page)
        ).toContainText("SMS подтверждена");
    });

    test("не позволяет указать пустую причину", async ({ page }) => {
        const state = await openUsers(page, {
            enrollments: [activePep()],
        });

        await expect(
            revokeButton(page)
        ).toBeVisible();

        const dialogs = [];

        handleDialogs(page, "   ", dialogs);

        await revokeButton(page).click();

        await expect.poll(
            () => dialogs.filter(
                (dialog) => dialog.type === "alert"
            ).length
        ).toBe(1);

        expect(
            dialogs.find(
                (dialog) => dialog.type === "alert"
            )?.message
        ).toBe(
            "Причина отзыва ПЭП должна содержать от 10 до 255 символов"
        );

        expect(state.revocations).toHaveLength(0);

        await expect(
            pepCell(page)
        ).toContainText("SMS подтверждена");
    });

    test("не принимает причину короче 10 символов", async ({ page }) => {
        const state = await openUsers(page, {
            enrollments: [activePep()],
        });

        await expect(
            revokeButton(page)
        ).toBeVisible();

        const dialogs = [];

        handleDialogs(page, "123456789", dialogs);

        await revokeButton(page).click();

        await expect.poll(
            () => dialogs.some(
                (dialog) =>
                    dialog.type === "alert" &&
                    dialog.message.includes(
                        "от 10 до 255 символов"
                    )
            )
        ).toBe(true);

        expect(state.revocations).toHaveLength(0);
    });

    test("не принимает причину длиннее 255 символов", async ({ page }) => {
        const state = await openUsers(page, {
            enrollments: [activePep()],
        });

        await expect(
            revokeButton(page)
        ).toBeVisible();

        const dialogs = [];

        handleDialogs(
            page,
            "А".repeat(256),
            dialogs
        );

        await revokeButton(page).click();

        await expect.poll(
            () => dialogs.some(
                (dialog) =>
                    dialog.type === "alert" &&
                    dialog.message.includes(
                        "от 10 до 255 символов"
                    )
            )
        ).toBe(true);

        expect(state.revocations).toHaveLength(0);
    });

    test("успешно отзывает ПЭП с правильной причиной", async ({ page }) => {
        const state = await openUsers(page, {
            enrollments: [activePep()],
        });

        await expect(
            revokeButton(page)
        ).toBeVisible();

        const dialogs = [];

        handleDialogs(
            page,
            "  Повторная проверка документов  ",
            dialogs
        );

        await revokeButton(page).click();

        await expect.poll(
            () => state.revocations.length
        ).toBe(1);

        expect(state.revocations[0]).toEqual({
            method: "POST",
            body: {
                reason:
                    "Повторная проверка документов",
            },
            authorization:
                `Bearer ${ADMIN_TEST_TOKEN}`,
        });

        await expect(
            pepCell(page)
        ).toContainText("Отозвана");

        await expect(
            revokeButton(page)
        ).toHaveCount(0);
    });

    test("при конфликте 409 сохраняет активную ПЭП в интерфейсе", async ({ page }) => {
        const state = await openUsers(page, {
            enrollments: [activePep()],
            revokeStatus: 409,
            revokeMessage:
                "Активное подтверждение ПЭП не найдено",
        });

        await expect(
            revokeButton(page)
        ).toBeVisible();

        const dialogs = [];

        handleDialogs(
            page,
            "Необходимо повторно проверить документы",
            dialogs
        );

        await revokeButton(page).click();

        await expect.poll(
            () => dialogs.some(
                (dialog) =>
                    dialog.type === "alert" &&
                    dialog.message ===
                    "Активное подтверждение ПЭП не найдено"
            )
        ).toBe(true);

        expect(state.revocations).toHaveLength(1);

        await expect(
            pepCell(page)
        ).toContainText("SMS подтверждена");
    });

    test("обрабатывает ошибку сервера при отзыве ПЭП", async ({ page }) => {
        const state = await openUsers(page, {
            enrollments: [activePep()],
            revokeStatus: 500,
            revokeMessage:
                "Не удалось отозвать ПЭП",
        });

        await expect(
            revokeButton(page)
        ).toBeVisible();

        const dialogs = [];

        handleDialogs(
            page,
            "Повторная проверка документов пользователя",
            dialogs
        );

        await revokeButton(page).click();

        await expect.poll(
            () => dialogs.some(
                (dialog) =>
                    dialog.type === "alert" &&
                    dialog.message ===
                    "Не удалось отозвать ПЭП"
            )
        ).toBe(true);

        expect(state.revocations).toHaveLength(1);

        await expect(
            pepCell(page)
        ).toContainText("SMS подтверждена");
    });

});