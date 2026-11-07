import { test, expect } from "./fixtures/safeTest";
import { setAdminAuth, ADMIN_TEST_TOKEN } from "./utils/adminTestAuth";

const FRONT_URL = "http://localhost:3001";
const USERS_PATH = "/users";

const users = [
    {
        id: 1,
        username: "Аким",
        phone: "+79781114567",
        createdAt: "2026-07-01T10:00:00.000Z",
        rating: 4.85,
        userStatus: "unverified",
        role: "user",
    },
    {
        id: 2,
        username: "Иван",
        phone: "+79990001122",
        createdAt: "2026-07-02T10:00:00.000Z",
        rating: 5,
        userStatus: "pensioner",
        role: "user",
    },
    {
        id: 3,
        username: "Бан Пользователь",
        phone: "+70000000000",
        createdAt: "2026-07-03T10:00:00.000Z",
        rating: null,
        userStatus: "verified",
        role: "banned",
    },
];

const userExtra = {
    1: {
        documents: ["passport.jpg", "license.jpg"],
        complaints: [{ id: 1 }, { id: 2 }],
        orders: [{ id: 101 }],
    },
    2: {
        documents: [],
        complaints: [],
        orders: [{ id: 201 }, { id: 202 }],
    },
    3: {
        documents: ["doc.jpg"],
        complaints: [],
        orders: [],
    },
};


async function setupMocks(page, options = {}) {
    const {
        usersStatus = 200,
        usersBody = users,
        extra = userExtra,
        blockStatus = 200,
        unblockStatus = 200,
        verifyStatus = 200,
        onUsersFetch,
        onDocsFetch,
        onComplaintsFetch,
        onOrdersFetch,
        onBlock,
        onUnblock,
        onVerify,
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

    await page.route(
        "**/api/admin/pep/enrollments",
        async (route) => {
            if (route.request().method() !== "GET") {
                await route.fallback();
                return;
            }

            await route.fulfill({
                status: 200,
                json: {
                    enrollments: [],
                },
            });
        }
    );

    await page.route("**/api/admin/users", async (route) => {
        if (route.request().method() !== "GET") {
            await route.fallback();
            return;
        }

        onUsersFetch?.({
            url: route.request().url(),
            headers: route.request().headers(),
        });

        await route.fulfill({
            status: usersStatus,
            contentType: "application/json",
            body: JSON.stringify(usersBody),
        });
    });

    await page.route("**/api/admin/user-documents/*", async (route) => {
        const url = route.request().url();
        const id = Number(url.match(/\/user-documents\/(\d+)/)?.[1]);

        onDocsFetch?.(id);

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                documents: extra[id]?.documents || [],
            }),
        });
    });

    await page.route("**/api/admin/users/*/complaints", async (route) => {
        const url = route.request().url();
        const id = Number(url.match(/\/users\/(\d+)\/complaints/)?.[1]);

        onComplaintsFetch?.(id);

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                complaints: extra[id]?.complaints || [],
            }),
        });
    });

    await page.route("**/api/admin/users/*/orders", async (route) => {
        const url = route.request().url();
        const id = Number(url.match(/\/users\/(\d+)\/orders/)?.[1]);

        onOrdersFetch?.(id);

        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                orders: extra[id]?.orders || [],
            }),
        });
    });

    await page.route("**/api/admin/users/*/block", async (route) => {
        const url = route.request().url();
        const id = Number(url.match(/\/users\/(\d+)\/block/)?.[1]);

        onBlock?.({
            id,
            headers: route.request().headers(),
        });

        await route.fulfill({
            status: blockStatus,
            contentType: "application/json",
            body: JSON.stringify({
                success: true,
            }),
        });
    });

    await page.route("**/api/admin/users/*/unblock", async (route) => {
        const url = route.request().url();
        const id = Number(url.match(/\/users\/(\d+)\/unblock/)?.[1]);

        onUnblock?.({
            id,
            headers: route.request().headers(),
        });

        await route.fulfill({
            status: unblockStatus,
            contentType: "application/json",
            body: JSON.stringify({
                success: true,
            }),
        });
    });

    await page.route("**/api/admin/users/*/verify", async (route) => {
        const url = route.request().url();
        const id = Number(url.match(/\/users\/(\d+)\/verify/)?.[1]);

        onVerify?.({
            id,
            body: route.request().postDataJSON(),
            headers: route.request().headers(),
        });

        await route.fulfill({
            status: verifyStatus,
            contentType: "application/json",
            body: JSON.stringify({
                success: true,
            }),
        });
    });
}

async function openUsersPage(page, options = {}) {
    await setAdminAuth(page);
    await setupMocks(page, options);

    await page.goto(`${FRONT_URL}${USERS_PATH}`);
    await page.waitForLoadState("domcontentloaded");

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "users-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("UsersPage редиректит на /login. Проверь PrivateRoute.");
    }

    if (!(await page.locator(".users-container").count())) {
        await page.screenshot({
            path: "users-wrong-route.png",
            fullPage: true,
        });

        throw new Error(
            `UsersPage не найдена. Текущий URL: ${page.url()}. Проверь USERS_PATH в тесте.`
        );
    }

    await expect(page.locator(".users-container")).toBeVisible({
        timeout: 15000,
    });
}

function rows(page) {
    return page.locator(".users-table tbody tr");
}

test.describe("UsersPage", () => {
    test("отображает страницу пользователей", async ({ page }) => {
        await openUsersPage(page);

        await expect(page.getByRole("heading", {
            name: "Пользователи",
        })).toBeVisible();

        await expect(page.getByPlaceholder("Поиск по ID, имени или телефону")).toBeVisible();

        await expect(page.getByRole("button", {
            name: "Создать пользователя",
        })).toBeVisible();

        await expect(page.locator(".users-table")).toBeVisible();
    });

    test("ошибка блокировки не изменяет роль пользователя", async ({ page }) => {
        await openUsersPage(page, {
            blockStatus: 500,
        });

        const alerts = [];

        page.on("dialog", async (dialog) => {
            alerts.push(dialog.message());
            await dialog.accept();
        });

        await rows(page).nth(0).getByRole("button", {
            name: "Блок",
        }).click();

        await expect.poll(
            () => alerts.length
        ).toBe(1);

        expect(alerts[0]).toBe(
            "Не удалось заблокировать пользователя"
        );

        await expect(
            rows(page).nth(0).getByRole("button", {
                name: "Блок",
            })
        ).toBeVisible();
    });

    test("ошибка разблокировки сохраняет блокировку", async ({ page }) => {
        await openUsersPage(page, {
            unblockStatus: 500,
        });

        const alerts = [];

        page.on("dialog", async (dialog) => {
            alerts.push(dialog.message());
            await dialog.accept();
        });

        await rows(page).nth(2).getByRole("button", {
            name: "Разблок.",
        }).click();

        await expect.poll(
            () => alerts.length
        ).toBe(1);

        expect(alerts[0]).toBe(
            "Не удалось разблокировать пользователя"
        );

        await expect(
            rows(page).nth(2).getByRole("button", {
                name: "Разблок.",
            })
        ).toBeVisible();
    });

    test("заголовки таблицы соответствуют данным пользователей", async ({ page }) => {
        await openUsersPage(page);

        const headers = page.locator(
            ".users-table thead th"
        );

        const firstRow = rows(page).first();

        await expect(headers).toHaveText([
            "ID",
            "Имя",
            "Телефон",
            "Дата регистрации",
            "Рейтинг",
            "ПЭП",
            "Роль",
            "Премиум",
            "Автомобиль",
            "Действия",
        ]);

        await expect(
            firstRow.locator("td")
        ).toHaveCount(10);

        // Шестая колонка — ПЭП.
        await expect(
            firstRow.locator("td").nth(5)
        ).toContainText("Не подключена");

        // Седьмая колонка — роль пользователя.
        await expect(
            firstRow.locator("td").nth(6)
        ).toContainText("Пользователь");

        // Старого управления статусами больше нет.
        await expect(
            page.locator(".verify-button")
        ).toHaveCount(0);
    });

    test("запрашивает пользователей с authToken", async ({ page }) => {
        let usersRequest = null;

        await openUsersPage(page, {
            onUsersFetch: (data) => {
                usersRequest = data;
            },
        });

        await expect
            .poll(() => usersRequest, {
                timeout: 10000,
            })
            .toEqual(
                expect.objectContaining({
                    url: expect.stringContaining("/api/admin/users"),
                    headers: expect.objectContaining({
                        authorization: `Bearer ${ADMIN_TEST_TOKEN}`,
                    }),
                })
            );
    });

    test("отображает список пользователей", async ({ page }) => {
        await openUsersPage(page);

        await expect(rows(page)).toHaveCount(3);

        await expect(rows(page).nth(0)).toContainText("1");
        await expect(rows(page).nth(0)).toContainText("Аким");
        await expect(rows(page).nth(0)).toContainText("+79781114567");
        await expect(rows(page).nth(0)).toContainText("4.8");

        await expect(rows(page).nth(1)).toContainText("2");
        await expect(rows(page).nth(1)).toContainText("Иван");
        await expect(rows(page).nth(1)).toContainText("+79990001122");
        await expect(rows(page).nth(1)).toContainText("5.0");

        await expect(rows(page).nth(2)).toContainText("3");
        await expect(rows(page).nth(2)).toContainText("Бан Пользователь");
        await expect(rows(page).nth(2)).toContainText("—");
    });

    test("загружает счётчики документов жалоб и заказов", async ({ page }) => {
        await openUsersPage(page);

        await expect(rows(page).nth(0)).toContainText("Жалобы · 2", {
            timeout: 10000,
        });
        await expect(rows(page).nth(0)).toContainText("Заказы · 1");
        await expect(rows(page).nth(0)).toContainText("Фото · 2");

        await expect(rows(page).nth(1)).toContainText("Жалобы · 0");
        await expect(rows(page).nth(1)).toContainText("Заказы · 2");
        await expect(rows(page).nth(1)).toContainText("Фото · 0");

        await expect(rows(page).nth(2)).toContainText("Жалобы · 0");
        await expect(rows(page).nth(2)).toContainText("Заказы · 0");
        await expect(rows(page).nth(2)).toContainText("Фото · 1");
    });

    test("отключает кнопки жалоб и фото, если счётчик 0", async ({ page }) => {
        await openUsersPage(page);

        const secondRow = rows(page).nth(1);

        await expect(secondRow.getByRole("button", {
            name: "Жалобы · 0",
        })).toBeDisabled();

        await expect(secondRow.getByRole("button", {
            name: "Фото · 0",
        })).toBeDisabled();

        await expect(secondRow.getByRole("button", {
            name: "Заказы · 2",
        })).toBeEnabled();
    });

    test("ищет пользователя по ID", async ({ page }) => {
        await openUsersPage(page);

        await page.getByPlaceholder("Поиск по ID, имени или телефону").fill("2");

        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page).first()).toContainText("Иван");
    });

    test("ищет пользователя по телефону", async ({ page }) => {
        await openUsersPage(page);

        await page.getByPlaceholder("Поиск по ID, имени или телефону").fill("978111");

        await expect(rows(page)).toHaveCount(1);
        await expect(rows(page).first()).toContainText("Аким");
    });

    test("сбрасывает поиск при очистке поля", async ({ page }) => {
        await openUsersPage(page);

        const search = page.getByPlaceholder("Поиск по ID, имени или телефону");

        await search.fill("2");
        await expect(rows(page)).toHaveCount(1);

        await search.fill("");
        await expect(rows(page)).toHaveCount(3);
    });

    test("кнопка Создать пользователя ведёт на create-user", async ({ page }) => {
        await openUsersPage(page);

        await page.getByRole("button", {
            name: "Создать пользователя",
        }).click();

        await expect(page).toHaveURL(/\/create-user/);
    });

    test("кнопка Жалобы ведёт на жалобы пользователя", async ({ page }) => {
        await openUsersPage(page);

        await expect(rows(page).nth(0).getByRole("button", {
            name: "Жалобы · 2",
        })).toBeEnabled({
            timeout: 10000,
        });

        await rows(page).nth(0).getByRole("button", {
            name: "Жалобы · 2",
        }).click();

        await expect(page).toHaveURL(/\/users\/1\/complaints/);
    });

    test("кнопка Заказы ведёт на заказы пользователя", async ({ page }) => {
        await openUsersPage(page);

        await rows(page).nth(1).getByRole("button", {
            name: "Заказы · 2",
        }).click();

        await expect(page).toHaveURL(/\/users\/2\/orders/);
    });

    test("кнопка Фото ведёт на документы пользователя", async ({ page }) => {
        await openUsersPage(page);

        await expect(rows(page).nth(2).getByRole("button", {
            name: "Фото · 1",
        })).toBeEnabled({
            timeout: 10000,
        });

        await rows(page).nth(2).getByRole("button", {
            name: "Фото · 1",
        }).click();

        await expect(page).toHaveURL(/\/user-documents\/3/);
    });

    test("блокирует пользователя", async ({ page }) => {
        let blockRequest = null;

        await openUsersPage(page, {
            onBlock: (data) => {
                blockRequest = data;
            },
        });

        await rows(page).nth(0).getByRole("button", {
            name: "Блок",
        }).click();

        await expect
            .poll(() => blockRequest, {
                timeout: 10000,
            })
            .toEqual(
                expect.objectContaining({
                    id: 1,
                    headers: expect.objectContaining({
                        authorization: `Bearer ${ADMIN_TEST_TOKEN}`,
                    }),
                })
            );

        await expect(rows(page).nth(0).getByRole("button", {
            name: "Разблок.",
        })).toBeVisible();
    });

    test("разблокирует пользователя", async ({ page }) => {
        let unblockRequest = null;

        await openUsersPage(page, {
            onUnblock: (data) => {
                unblockRequest = data;
            },
        });

        await rows(page).nth(2).getByRole("button", {
            name: "Разблок.",
        }).click();

        await expect
            .poll(() => unblockRequest, {
                timeout: 10000,
            })
            .toEqual(
                expect.objectContaining({
                    id: 3,
                    headers: expect.objectContaining({
                        authorization: `Bearer ${ADMIN_TEST_TOKEN}`,
                    }),
                })
            );

        await expect(rows(page).nth(2).getByRole("button", {
            name: "Блок",
        })).toBeVisible();
    });

    test("если users API вернул ошибку, таблица остаётся пустой", async ({ page }) => {
        await openUsersPage(page, {
            usersStatus: 500,
            usersBody: {
                message: "Ошибка",
            },
        });

        await expect(rows(page)).toHaveCount(0);
    });

    test("если счётчики пользователя не загрузились, показывает нули", async ({ page }) => {
        await openUsersPage(page, {
            extra: {
                1: {},
                2: {},
                3: {},
            },
        });

        await expect(rows(page).nth(0)).toContainText("Жалобы · 0", {
            timeout: 10000,
        });
        await expect(rows(page).nth(0)).toContainText("Заказы · 0");
        await expect(rows(page).nth(0)).toContainText("Фото · 0");
    });
});