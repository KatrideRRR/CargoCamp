import {
    test,
    expect,
} from "./fixtures/safeTest";

import {
    setAdminAuth,
} from "./utils/adminTestAuth";

const VERIFIED_USER = {
    verificationId: 31,
    userId: 1201,
    username: "Тестовый пользователь",
    phone: "+79990001201",
    status: "verified",
    assuranceLevel: "basic",
    verificationMethod: "document",
    verifiedAt: "2026-11-01T10:00:00.000Z",
    expiresAt: "2027-11-01T10:00:00.000Z",
};

const HISTORY = {
    success: true,

    user: {
        id: 1201,
        username: "Тестовый пользователь",
    },

    current: {
        verificationId: 31,
        status: "verified",
        verified: true,
    },

    verifications: [
        {
            id: 31,
            status: "verified",
            createdAt: "2026-11-01T10:00:00.000Z",
        },
        {
            id: 30,
            status: "rejected",
            rejectionReason: "Недостаточно документов",
            createdAt: "2026-10-20T10:00:00.000Z",
        },
    ],

    actions: [
        {
            id: 91,
            actionType: "identity_application_approved",
            actorUserId: 1,
            ts: "2026-11-01T10:00:00.000Z",
            reason: "Документы проверены",
        },
    ],
};

async function setupMocks(page, options = {}) {
    const {
        users = [VERIFIED_USER],
        verifiedStatus = 200,
        historyStatus = 200,
        revokeStatus = 200,
        revokeSuccess = true,
    } = options;

    const state = {
        users: structuredClone(users),
        verifiedRequests: [],
        historyRequests: 0,
        revocations: [],
    };

    // Родительская страница дополнительно загружает
    // очередь заявок на проверку личности.
    await page.route(
        "**/api/admin/identity/pending",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    success: true,
                    applications: [],
                },
            });
        }
    );

    // Список подтверждённых пользователей.
    await page.route(
        "**/api/admin/identity/verified**",
        async (route) => {
            const url = new URL(route.request().url());

            const q = url.searchParams.get("q") || "";

            const pageNumber = Number(
                url.searchParams.get("page") || 1
            );

            state.verifiedRequests.push({
                q,
                page: pageNumber,
            });

            if (verifiedStatus !== 200) {
                await route.fulfill({
                    status: verifiedStatus,
                    json: {
                        success: false,
                        message:
                            "Не удалось загрузить подтверждённых пользователей",
                    },
                });

                return;
            }

            const digits = q.replace(/\D/g, "");

            const filtered = state.users.filter((user) => {
                if (!q) return true;

                const matchesId =
                    String(user.userId) === q;

                const matchesPhone =
                    digits.length >= 4 &&
                    String(user.phone)
                        .replace(/\D/g, "")
                        .includes(digits);

                return matchesId || matchesPhone;
            });

            const start = (pageNumber - 1) * 20;

            await route.fulfill({
                status: 200,
                json: {
                    success: true,
                    users: filtered.slice(start, start + 20),
                    total: filtered.length,
                    page: pageNumber,
                    pageSize: 20,
                },
            });
        }
    );

    // История проверки личности.
    await page.route(
        "**/api/admin/identity/users/1201/history",
        async (route) => {
            state.historyRequests++;

            await route.fulfill({
                status: historyStatus,
                json:
                    historyStatus === 200
                        ? HISTORY
                        : {
                            success: false,
                            message: "История недоступна",
                        },
            });
        }
    );

    // Отзыв верификации.
    await page.route(
        "**/api/admin/identity/31/revoke",
        async (route) => {
            const body =
                route.request().postDataJSON();

            state.revocations.push({
                method: route.request().method(),
                body,
            });

            if (revokeStatus === 200 && revokeSuccess) {
                state.users = state.users.filter(
                    (user) => user.verificationId !== 31
                );
            }

            await route.fulfill({
                status: revokeStatus,
                json:
                    revokeStatus === 200
                        ? {
                            success: revokeSuccess,
                            message: revokeSuccess
                                ? "Подтверждение личности отозвано"
                                : "Сервер не подтвердил отзыв",
                        }
                        : {
                            success: false,
                            message:
                                "Эта проверка уже не является действующей",
                        },
            });
        }
    );

    return state;
}

async function openManagement(page, options = {}) {
    await setAdminAuth(page);

    const state = await setupMocks(page, options);

    await page.goto("/identity");

    await expect(
        page.locator(".cc-verified-admin")
    ).toBeVisible();

    return state;
}

async function openHistory(page) {
    const section = page.locator(".cc-verified-admin");

    await section.getByRole("button", {
        name: "История и управление",
    }).click();

    await expect(
        section.locator(".cc-verified-admin-details")
    ).toBeVisible();

    return section;
}

function acceptDialogs(page) {
    page.on("dialog", async (dialog) => {
        await dialog.accept();
    });
}

test.describe("VerifiedIdentityManagement", () => {

    test("отображает пустой список", async ({ page }) => {
        await openManagement(page, {
            users: [],
        });

        const section = page.locator(".cc-verified-admin");

        await expect(
            section.getByRole("heading", {
                name: "Подтверждённые пользователи",
            })
        ).toBeVisible();

        await expect(
            section.locator(".cc-verified-admin-empty")
        ).toContainText(
            "Действующие подтверждения не найдены"
        );

        await expect(
            section.locator(".cc-verified-admin-header strong")
        ).toHaveText("0");
    });

    test("показывает действующую верификацию", async ({ page }) => {
        await openManagement(page);

        const section = page.locator(".cc-verified-admin");

        const card = section.locator(
            ".cc-verified-admin-card"
        );

        await expect(card).toHaveCount(1);

        await expect(card).toContainText(
            "Тестовый пользователь"
        );

        await expect(card).toContainText(
            "Проверка №31"
        );

        await expect(card).toContainText(
            "Действует"
        );

        await expect(card).toContainText(
            "+79990001201"
        );
    });

    test("ищет пользователя по ID", async ({ page }) => {
        const state = await openManagement(page);

        const section = page.locator(".cc-verified-admin");

        await section.getByRole("searchbox", {
            name: "Поиск верифицированных пользователей",
        }).fill("1201");

        await section.getByRole("button", {
            name: "Найти",
        }).click();

        await expect.poll(
            () => state.verifiedRequests.at(-1)?.q
        ).toBe("1201");

        await expect(
            section.locator(".cc-verified-admin-card")
        ).toHaveCount(1);
    });

    test("поиск без совпадений показывает пустой результат", async ({ page }) => {
        await openManagement(page);

        const section = page.locator(".cc-verified-admin");

        await section.getByRole("searchbox", {
            name: "Поиск верифицированных пользователей",
        }).fill("999999");

        await section.getByRole("button", {
            name: "Найти",
        }).click();

        await expect(
            section.locator(".cc-verified-admin-empty")
        ).toBeVisible();
    });

    test("сбрасывает поисковый фильтр", async ({ page }) => {
        const state = await openManagement(page);

        const section = page.locator(".cc-verified-admin");

        await section.getByRole("searchbox", {
            name: "Поиск верифицированных пользователей",
        }).fill("999999");

        await section.getByRole("button", {
            name: "Найти",
        }).click();

        await expect(
            section.locator(".cc-verified-admin-empty")
        ).toBeVisible();

        await section.getByRole("button", {
            name: "Сбросить",
        }).click();

        await expect.poll(
            () => state.verifiedRequests.at(-1)?.q
        ).toBe("");

        await expect(
            section.locator(".cc-verified-admin-card")
        ).toHaveCount(1);
    });

    test("переключает страницы пользователей", async ({ page }) => {
        const users = Array.from(
            { length: 25 },
            (_, index) => ({
                ...VERIFIED_USER,
                verificationId: 31 + index,
                userId: 1201 + index,
                username: `Пользователь ${index + 1}`,
                phone: `+7999000${String(index).padStart(4, "0")}`,
            })
        );

        const state = await openManagement(page, {
            users,
        });

        const section = page.locator(".cc-verified-admin");

        const pagination = section.locator(
            ".cc-verified-admin-pagination"
        );

        await expect(
            section.locator(".cc-verified-admin-card")
        ).toHaveCount(20);

        await expect(pagination).toContainText(
            "Страница 1 из 2"
        );

        await pagination.getByRole("button", {
            name: "Далее →",
        }).click();

        await expect.poll(
            () => state.verifiedRequests.at(-1)?.page
        ).toBe(2);

        await expect(
            section.locator(".cc-verified-admin-card")
        ).toHaveCount(5);

        await pagination.getByRole("button", {
            name: "← Назад",
        }).click();

        await expect(
            section.locator(".cc-verified-admin-card")
        ).toHaveCount(20);
    });

    test("показывает историю проверок и решений", async ({ page }) => {
        const state = await openManagement(page);

        const section = await openHistory(page);

        await expect(
            section.getByRole("heading", {
                name: "История проверок",
            })
        ).toBeVisible();

        await expect(
            section.locator(".cc-verified-admin-details")
        ).toContainText("Проверка №30");

        await expect(
            section.locator(".cc-verified-admin-details")
        ).toContainText("Недостаточно документов");

        await expect(
            section.locator(".cc-verified-admin-details")
        ).toContainText("Проверка подтверждена");

        await expect(
            section.locator(".cc-verified-admin-details")
        ).toContainText("Администратор №1");

        expect(state.historyRequests).toBe(1);
    });

    test("закрывает историю пользователя", async ({ page }) => {
        await openManagement(page);

        const section = await openHistory(page);

        await section.getByRole("button", {
            name: "Закрыть сведения",
        }).click();

        await expect(
            section.locator(".cc-verified-admin-details")
        ).toHaveCount(0);
    });

    test("запрещает отзыв без обоснованной причины", async ({ page }) => {
        const state = await openManagement(page);

        const section = await openHistory(page);

        const reason = section.getByPlaceholder(
            "Причина отзыва (не менее 10 символов)"
        );

        const revokeButton = section.getByRole("button", {
            name: "Отозвать верификацию",
        });

        await expect(revokeButton).toBeDisabled();

        await reason.fill("Коротко");

        await expect(revokeButton).toBeDisabled();

        await reason.fill(
            "Документы требуют повторной проверки"
        );

        await expect(revokeButton).toBeEnabled();

        expect(state.revocations).toHaveLength(0);
    });

    test("отмена подтверждения не отзывает верификацию", async ({ page }) => {
        const state = await openManagement(page);

        const section = await openHistory(page);

        await section.getByPlaceholder(
            "Причина отзыва (не менее 10 символов)"
        ).fill(
            "Необходимо повторно проверить документы"
        );

        page.on("dialog", async (dialog) => {
            await dialog.dismiss();
        });

        await section.getByRole("button", {
            name: "Отозвать верификацию",
        }).click();

        expect(state.revocations).toHaveLength(0);

        await expect(
            section.locator(".cc-verified-admin-card")
        ).toHaveCount(1);
    });

    test("успешно отзывает действующее подтверждение", async ({ page }) => {
        const state = await openManagement(page);

        const section = await openHistory(page);

        const reason =
            "Выявлены несоответствия в документах";

        await section.getByPlaceholder(
            "Причина отзыва (не менее 10 символов)"
        ).fill(reason);

        acceptDialogs(page);

        await section.getByRole("button", {
            name: "Отозвать верификацию",
        }).click();

        await expect.poll(
            () => state.revocations.length
        ).toBe(1);

        expect(state.revocations[0]).toEqual({
            method: "POST",
            body: { reason },
        });

        await expect(
            section.locator(".cc-verified-admin-success")
        ).toContainText(
            "Верификация пользователя №1201 отозвана"
        );

        await expect(
            section.locator(".cc-verified-admin-empty")
        ).toBeVisible();
    });

    test("при ошибке сервера не удаляет пользователя из списка", async ({ page }) => {
        const state = await openManagement(page, {
            revokeStatus: 409,
        });

        const section = await openHistory(page);

        await section.getByPlaceholder(
            "Причина отзыва (не менее 10 символов)"
        ).fill(
            "Повторная административная проверка"
        );

        acceptDialogs(page);

        await section.getByRole("button", {
            name: "Отозвать верификацию",
        }).click();

        await expect(
            section.locator(".cc-verified-admin-error")
        ).toHaveText(
            "Эта проверка уже не является действующей"
        );

        expect(state.revocations).toHaveLength(1);

        await expect(
            section.locator(".cc-verified-admin-card")
        ).toHaveCount(1);
    });

    test("обнаруживает отсутствие подтверждения от сервера", async ({ page }) => {
        await openManagement(page, {
            revokeSuccess: false,
        });

        const section = await openHistory(page);

        await section.getByPlaceholder(
            "Причина отзыва (не менее 10 символов)"
        ).fill(
            "Повторная проверка личности пользователя"
        );

        acceptDialogs(page);

        await section.getByRole("button", {
            name: "Отозвать верификацию",
        }).click();

        await expect(
            section.locator(".cc-verified-admin-error")
        ).toHaveText(
            "Сервер не подтвердил отзыв"
        );

        await expect(
            section.locator(".cc-verified-admin-card")
        ).toHaveCount(1);
    });

    test("показывает ошибку загрузки истории", async ({ page }) => {
        await openManagement(page, {
            historyStatus: 500,
        });

        const section = await openHistory(page);

        await expect(
            section.locator(".cc-verified-admin-error")
        ).toHaveText("История недоступна");
    });

    test("показывает ошибку загрузки подтверждённых пользователей", async ({ page }) => {
        await openManagement(page, {
            verifiedStatus: 500,
        });

        const section = page.locator(".cc-verified-admin");

        await expect(
            section.locator(".cc-verified-admin-error")
        ).toHaveText(
            "Не удалось загрузить подтверждённых пользователей"
        );
    });

});