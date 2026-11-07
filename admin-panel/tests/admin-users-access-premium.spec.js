import {
    test,
    expect,
} from "./fixtures/safeTest";

import {
    setAdminAuth,
    ADMIN_TEST_TOKEN,
} from "./utils/adminTestAuth";

const EXPIRES_AT = new Date(
    Date.now() + 45 * 24 * 60 * 60 * 1000
).toISOString();

const USER = {
    id: 51,
    username: "Тестовый пользователь",
    phone: "+79990000051",
    createdAt: "2026-10-01T10:00:00.000Z",
    rating: 4.8,
    userStatus: "unverified",
    role: "user",
    subscription_type: "standard",
    subscription_expires_at: null,
};

function premiumUser() {
    return {
        ...USER,
        subscription_type: "premium",
        subscription_expires_at: EXPIRES_AT,
    };
}

async function setupMocks(page, options = {}) {
    const {
        user = USER,
        roleStatus = 200,
        premiumStatus = 200,
        removePremiumStatus = 200,
    } = options;

    const state = {
        roles: [],
        premiums: [],
        removals: [],
    };

    // Пользователь полностью вымышленный.
    await page.route(
        "**/api/admin/users",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: [user],
            });
        }
    );

    // ПЭП в этих тестах не активирована.
    await page.route(
        "**/api/admin/pep/enrollments",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    success: true,
                    enrollments: [],
                },
            });
        }
    );

    // Счётчики документов, жалоб и заказов.
    await page.route(
        "**/api/admin/user-documents/51",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    documents: [],
                },
            });
        }
    );

    await page.route(
        "**/api/admin/users/51/complaints",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    complaints: [],
                },
            });
        }
    );

    await page.route(
        "**/api/admin/users/51/orders",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    orders: [],
                },
            });
        }
    );

    // Изменение административной роли.
    await page.route(
        "**/api/admin/users/51/role",
        async (route) => {
            const body = route.request().postDataJSON();

            state.roles.push({
                method: route.request().method(),
                body,
                authorization:
                route.request().headers().authorization,
            });

            await route.fulfill({
                status: roleStatus,
                json:
                    roleStatus === 200
                        ? {
                            success: true,
                            user: {
                                id: 51,
                                role: body.role,
                            },
                        }
                        : {
                            success: false,
                            message:
                                "Не удалось изменить роль",
                        },
            });
        }
    );

    // Выдача или продление Premium.
    await page.route(
        "**/api/admin/users/51/premium",
        async (route) => {
            const method = route.request().method();

            if (method === "PUT") {
                const body =
                    route.request().postDataJSON();

                state.premiums.push({
                    method,
                    body,
                    authorization:
                    route.request().headers().authorization,
                });

                await route.fulfill({
                    status: premiumStatus,
                    json:
                        premiumStatus === 200
                            ? {
                                success: true,
                                user: {
                                    id: 51,
                                    subscription_type: "premium",
                                    subscription_expires_at:
                                    EXPIRES_AT,
                                },
                            }
                            : {
                                success: false,
                                message:
                                    "Не удалось выдать премиум",
                            },
                });

                return;
            }

            if (method === "DELETE") {
                state.removals.push({
                    method,
                    authorization:
                    route.request().headers().authorization,
                });

                await route.fulfill({
                    status: removePremiumStatus,
                    json:
                        removePremiumStatus === 200
                            ? {
                                success: true,
                                user: {
                                    id: 51,
                                    subscription_type: "standard",
                                    subscription_expires_at: null,
                                },
                            }
                            : {
                                success: false,
                                message:
                                    "Не удалось снять премиум",
                            },
                });

                return;
            }

            await route.abort("blockedbyclient");
            throw new Error(
                `Недопустимый метод Premium API: ${method}`
            );
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

function userRow(page) {
    return page.locator(
        ".users-table tbody tr"
    ).first();
}

function acceptDialogs(page) {
    page.on("dialog", async (dialog) => {
        await dialog.accept();
    });
}

test.describe("UsersPage — роли и Premium", () => {

    test("показывает обычную роль пользователя", async ({ page }) => {
        await openUsers(page);

        const row = userRow(page);

        await expect(
            row.locator(".role-badge")
        ).toHaveText("Пользователь");

        await expect(
            row.getByRole("button", {
                name: "Дать админку",
            })
        ).toBeVisible();
    });

    test("выдаёт права администратора", async ({ page }) => {
        const state = await openUsers(page);

        acceptDialogs(page);

        await userRow(page).getByRole("button", {
            name: "Дать админку",
        }).click();

        await expect.poll(
            () => state.roles.length
        ).toBe(1);

        expect(state.roles[0]).toEqual({
            method: "PUT",
            body: {
                role: "admin",
            },
            authorization:
                `Bearer ${ADMIN_TEST_TOKEN}`,
        });

        await expect(
            userRow(page).locator(".role-badge")
        ).toHaveText("Администратор");

        await expect(
            userRow(page).getByRole("button", {
                name: "Забрать",
            })
        ).toBeVisible();
    });

    test("снимает административные права", async ({ page }) => {
        const state = await openUsers(page, {
            user: {
                ...USER,
                role: "admin",
            },
        });

        acceptDialogs(page);

        await userRow(page).getByRole("button", {
            name: "Забрать",
        }).click();

        await expect.poll(
            () => state.roles.length
        ).toBe(1);

        expect(state.roles[0].body).toEqual({
            role: "user",
        });

        await expect(
            userRow(page).locator(".role-badge")
        ).toHaveText("Пользователь");
    });

    test("отмена подтверждения не меняет роль", async ({ page }) => {
        const state = await openUsers(page);

        page.once("dialog", async (dialog) => {
            await dialog.dismiss();
        });

        await userRow(page).getByRole("button", {
            name: "Дать админку",
        }).click();

        expect(state.roles).toHaveLength(0);

        await expect(
            userRow(page).locator(".role-badge")
        ).toHaveText("Пользователь");
    });

    test("при ошибке сервера роль не меняется", async ({ page }) => {
        const state = await openUsers(page, {
            roleStatus: 500,
        });

        const dialogs = [];

        page.on("dialog", async (dialog) => {
            dialogs.push(dialog.message());
            await dialog.accept();
        });

        await userRow(page).getByRole("button", {
            name: "Дать админку",
        }).click();

        await expect.poll(
            () => dialogs
        ).toContain("Не удалось изменить роль");

        expect(state.roles).toHaveLength(1);

        await expect(
            userRow(page).locator(".role-badge")
        ).toHaveText("Пользователь");
    });

    test("заблокированному пользователю не показываются действия с ролью", async ({ page }) => {
        await openUsers(page, {
            user: {
                ...USER,
                role: "banned",
            },
        });

        const row = userRow(page);

        await expect(
            row.locator(".role-badge")
        ).toHaveText("Заблокирован");

        await expect(
            row.getByRole("button", {
                name: "Дать админку",
            })
        ).toHaveCount(0);

        await expect(
            row.getByRole("button", {
                name: "Забрать",
            })
        ).toHaveCount(0);
    });

    test("показывает отсутствие Premium", async ({ page }) => {
        await openUsers(page);

        const premium = userRow(page).locator(
            ".premium-admin-cell"
        );

        await expect(
            premium.locator(".no-premium-badge")
        ).toHaveText("Нет");

        await expect(
            premium.getByRole("button", {
                name: "7 дней",
            })
        ).toBeVisible();

        await expect(
            premium.getByRole("button", {
                name: "30 дней",
            })
        ).toBeVisible();
    });

    test("выдаёт Premium на 7 дней", async ({ page }) => {
        const state = await openUsers(page);

        acceptDialogs(page);

        await userRow(page).getByRole("button", {
            name: "7 дней",
        }).click();

        await expect.poll(
            () => state.premiums.length
        ).toBe(1);

        expect(state.premiums[0]).toEqual({
            method: "PUT",
            body: {
                days: 7,
            },
            authorization:
                `Bearer ${ADMIN_TEST_TOKEN}`,
        });

        await expect(
            userRow(page).locator(".premium-badge")
        ).toHaveText("PREMIUM");
    });

    test("выдаёт Premium на 30 дней", async ({ page }) => {
        const state = await openUsers(page);

        acceptDialogs(page);

        await userRow(page).getByRole("button", {
            name: "30 дней",
        }).click();

        await expect.poll(
            () => state.premiums.length
        ).toBe(1);

        expect(state.premiums[0].body).toEqual({
            days: 30,
        });

        await expect(
            userRow(page).locator(".premium-badge")
        ).toBeVisible();
    });

    test("отображает активный Premium и кнопки продления", async ({ page }) => {
        await openUsers(page, {
            user: premiumUser(),
        });

        const premium = userRow(page).locator(
            ".premium-admin-cell"
        );

        await expect(
            premium.locator(".premium-badge")
        ).toHaveText("PREMIUM");

        await expect(
            premium.getByRole("button", {
                name: "+7",
            })
        ).toBeVisible();

        await expect(
            premium.getByRole("button", {
                name: "+30",
            })
        ).toBeVisible();

        await expect(
            premium.getByRole("button", {
                name: "Снять",
            })
        ).toBeVisible();
    });

    test("ошибка снятия Premium сохраняет подписку", async ({ page }) => {
        const state = await openUsers(page, {
            user: premiumUser(),
            removePremiumStatus: 500,
        });

        const alerts = [];

        page.on("dialog", async (dialog) => {
            if (dialog.type() === "alert") {
                alerts.push(dialog.message());
            }

            await dialog.accept();
        });

        await userRow(page).getByRole("button", {
            name: "Снять",
        }).click();

        await expect.poll(
            () => alerts.length
        ).toBe(1);

        expect(alerts[0]).toBe(
            "Не удалось снять премиум"
        );

        expect(state.removals).toHaveLength(1);

        await expect(
            userRow(page)
        ).toContainText("PREMIUM");

        await expect(
            userRow(page).getByRole("button", {
                name: "Снять",
            })
        ).toBeVisible();
    });

    test("отправляет запрос на продление Premium", async ({ page }) => {
        const state = await openUsers(page, {
            user: premiumUser(),
        });

        acceptDialogs(page);

        await userRow(page).getByRole("button", {
            name: "+30",
        }).click();

        await expect.poll(
            () => state.premiums.length
        ).toBe(1);

        expect(state.premiums[0].body).toEqual({
            days: 30,
        });

        await expect(
            userRow(page).locator(".premium-badge")
        ).toBeVisible();
    });

    test("снимает активный Premium", async ({ page }) => {
        const state = await openUsers(page, {
            user: premiumUser(),
        });

        acceptDialogs(page);

        await userRow(page).getByRole("button", {
            name: "Снять",
        }).click();

        await expect.poll(
            () => state.removals.length
        ).toBe(1);

        expect(state.removals[0]).toEqual({
            method: "DELETE",
            authorization:
                `Bearer ${ADMIN_TEST_TOKEN}`,
        });

        await expect(
            userRow(page).locator(".no-premium-badge")
        ).toHaveText("Нет");
    });

    test("отмена подтверждения не выдаёт Premium", async ({ page }) => {
        const state = await openUsers(page);

        page.once("dialog", async (dialog) => {
            await dialog.dismiss();
        });

        await userRow(page).getByRole("button", {
            name: "7 дней",
        }).click();

        expect(state.premiums).toHaveLength(0);

        await expect(
            userRow(page).locator(".no-premium-badge")
        ).toBeVisible();
    });

    test("отмена снятия Premium сохраняет подписку", async ({ page }) => {
        const state = await openUsers(page, {
            user: premiumUser(),
        });

        page.once("dialog", async (dialog) => {
            await dialog.dismiss();
        });

        await userRow(page).getByRole("button", {
            name: "Снять",
        }).click();

        expect(state.removals).toHaveLength(0);

        await expect(
            userRow(page).locator(".premium-badge")
        ).toBeVisible();
    });

    test("ошибка выдачи Premium не меняет подписку", async ({ page }) => {
        const state = await openUsers(page, {
            premiumStatus: 500,
        });

        const dialogs = [];

        page.on("dialog", async (dialog) => {
            dialogs.push(dialog.message());
            await dialog.accept();
        });

        await userRow(page).getByRole("button", {
            name: "7 дней",
        }).click();

        await expect.poll(
            () => dialogs
        ).toContain("Не удалось выдать премиум");

        expect(state.premiums).toHaveLength(1);

        await expect(
            userRow(page).locator(".no-premium-badge")
        ).toBeVisible();
    });

    test("истёкший Premium отображается как неактивный", async ({ page }) => {
        await openUsers(page, {
            user: {
                ...USER,
                subscription_type: "premium",
                subscription_expires_at:
                    "2020-01-01T00:00:00.000Z",
            },
        });

        const premium = userRow(page).locator(
            ".premium-admin-cell"
        );

        await expect(
            premium.locator(".no-premium-badge")
        ).toHaveText("Нет");

        await expect(
            premium.getByRole("button", {
                name: "7 дней",
            })
        ).toBeVisible();
    });

});