import {
    test,
    expect,
} from "./fixtures/safeTest";

const FRONT_URL = "http://localhost:3001";

function makeToken({
                       role = "admin",
                       remainingSeconds = 3600,
                   } = {}) {
    const encode = (value) =>
        Buffer.from(
            JSON.stringify(value)
        ).toString("base64url");

    const header = {
        alg: "none",
        typ: "JWT",
    };

    const payload = {
        id: 1,
        role,
        exp:
            Math.floor(Date.now() / 1000) +
            remainingSeconds,
    };

    return [
        encode(header),
        encode(payload),
        "",
    ].join(".");
}

const ACTIVE_TOKEN = makeToken();
const REFRESHED_TOKEN = makeToken({
    remainingSeconds: 7200,
});

async function seedSession(page, token) {
    /*
     * Инициализируем тестовую сессию один раз.
     *
     * После перенаправления на /login
     * токен не должен восстанавливаться
     * тестовым скриптом повторно.
     */
    await page.addInitScript((initialToken) => {
        const key =
            "__cc_admin_session_test_initialized__";

        if (sessionStorage.getItem(key)) {
            return;
        }

        sessionStorage.setItem(key, "1");

        if (initialToken) {
            localStorage.setItem(
                "authToken",
                initialToken
            );
        } else {
            localStorage.removeItem("authToken");
        }

        localStorage.setItem(
            "userRole",
            "admin"
        );
    }, token);
}

async function getStoredToken(page) {
    return page.evaluate(() =>
        localStorage.getItem("authToken")
    );
}

async function mockRefresh(page, responder) {
    const requests = [];

    await page.route(
        "**/api/admin/session/refresh",
        async (route) => {
            requests.push({
                method:
                    route.request().method(),
                url:
                    route.request().url(),
            });

            const result =
                await responder(requests.length);

            await route.fulfill({
                status: result.status,
                json: result.body,
            });
        }
    );

    return requests;
}

async function mockOrders(
    page,
    regularStatus = 200,
    message = "Не удалось получить заказы"
) {
    const requests = [];

    await page.route(
        "**/api/admin/orders",
        async (route) => {
            requests.push(
                route.request().method()
            );

            await route.fulfill({
                status: regularStatus,
                json:
                    regularStatus === 200
                        ? []
                        : {
                            message,
                        },
            });
        }
    );

    await page.route(
        "**/api/admin/express-orders",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: [],
            });
        }
    );

    return requests;
}

async function mockBenefits(
    page,
    status,
    message
) {
    const requests = [];

    await page.route(
        "**/api/admin/benefits/pending",
        async (route) => {
            requests.push(
                route.request().method()
            );

            await route.fulfill({
                status,
                json:
                    status === 200
                        ? {
                            success: true,
                            applications: [],
                        }
                        : {
                            success: false,
                            message,
                        },
            });
        }
    );

    return requests;
}

test.describe(
    "Административная сессия",
    () => {

        test(
            "действующий токен открывает Dashboard без обновления",
            async ({ page }) => {
                await seedSession(
                    page,
                    ACTIVE_TOKEN
                );

                const requests =
                    await mockRefresh(
                        page,
                        async () => ({
                            status: 200,
                            body: {
                                token:
                                REFRESHED_TOKEN,
                            },
                        })
                    );

                await page.goto("/dashboard");

                await expect(
                    page.getByRole("heading", {
                        name:
                            "Панель администратора",
                    })
                ).toBeVisible();

                expect(
                    requests
                ).toHaveLength(0);

                expect(
                    await getStoredToken(page)
                ).toBe(ACTIVE_TOKEN);
            }
        );

        test(
            "без токена и при отказе обновления перенаправляет на вход",
            async ({ page }) => {
                await seedSession(page, null);

                const requests =
                    await mockRefresh(
                        page,
                        async () => ({
                            status: 401,
                            body: {
                                message:
                                    "Сессия отсутствует",
                            },
                        })
                    );

                await page.goto("/dashboard");

                await expect(page).toHaveURL(
                    /\/login\?reason=expired$/
                );

                await expect(
                    page.getByText(
                        "Срок действия сессии истёк.",
                        { exact: false }
                    )
                ).toBeVisible();

                expect(
                    requests.length
                ).toBeGreaterThanOrEqual(1);

                for (const request of requests) {
                    expect(
                        request.method
                    ).toBe("POST");
                }

                expect(
                    await getStoredToken(page)
                ).toBeNull();
            }
        );

        test(
            "истёкший токен успешно обновляется",
            async ({ page }) => {
                await seedSession(
                    page,
                    makeToken({
                        remainingSeconds: -60,
                    })
                );

                const requests =
                    await mockRefresh(
                        page,
                        async () => ({
                            status: 200,
                            body: {
                                token:
                                REFRESHED_TOKEN,
                            },
                        })
                    );

                await page.goto("/dashboard");

                await expect(
                    page.getByRole("heading", {
                        name:
                            "Панель администратора",
                    })
                ).toBeVisible();

                await expect.poll(
                    () => requests.length
                ).toBeGreaterThanOrEqual(1);

                await expect.poll(
                    () => getStoredToken(page)
                ).toBe(REFRESHED_TOKEN);

                await expect.poll(
                    () => page.evaluate(
                        () =>
                            localStorage.getItem(
                                "userRole"
                            )
                    )
                ).toBe("admin");
            }
        );

        test(
            "токен с остатком менее двух минут обновляется",
            async ({ page }) => {
                await seedSession(
                    page,
                    makeToken({
                        remainingSeconds: 80,
                    })
                );

                const requests =
                    await mockRefresh(
                        page,
                        async () => ({
                            status: 200,
                            body: {
                                token:
                                REFRESHED_TOKEN,
                            },
                        })
                    );

                await page.goto("/dashboard");

                await expect(
                    page.getByRole("heading", {
                        name:
                            "Панель администратора",
                    })
                ).toBeVisible();

                await expect.poll(
                    () => requests.length
                ).toBeGreaterThanOrEqual(1);

                expect(
                    await getStoredToken(page)
                ).toBe(REFRESHED_TOKEN);
            }
        );

        test(
            "токен обычного пользователя не даёт доступ без обновления",
            async ({ page }) => {
                await seedSession(
                    page,
                    makeToken({
                        role: "user",
                    })
                );

                const requests =
                    await mockRefresh(
                        page,
                        async () => ({
                            status: 200,
                            body: {
                                token:
                                REFRESHED_TOKEN,
                            },
                        })
                    );

                await page.goto("/dashboard");

                await expect.poll(
                    () => requests.length
                ).toBeGreaterThanOrEqual(1);

                await expect(
                    page.getByRole("heading", {
                        name:
                            "Панель администратора",
                    })
                ).toBeVisible();

                expect(
                    await getStoredToken(page)
                ).toBe(REFRESHED_TOKEN);
            }
        );

        test(
            "ошибка обновления показывает offline и позволяет повторить",
            async ({ page }) => {
                const expiredToken = makeToken({
                    remainingSeconds: -60,
                });

                await seedSession(
                    page,
                    expiredToken
                );

                let serverAvailable = false;

                const requests =
                    await mockRefresh(
                        page,
                        async () => {
                            if (!serverAvailable) {
                                return {
                                    status: 503,
                                    body: {
                                        message:
                                            "Сервер временно недоступен",
                                    },
                                };
                            }

                            return {
                                status: 200,
                                body: {
                                    token:
                                    REFRESHED_TOKEN,
                                },
                            };
                        }
                    );

                await page.goto("/dashboard");

                await expect(
                    page.getByRole("heading", {
                        name:
                            "Не удалось связаться с сервером",
                    })
                ).toBeVisible();

                expect(
                    await getStoredToken(page)
                ).toBe(expiredToken);

                serverAvailable = true;

                await page.getByRole(
                    "button",
                    {
                        name: "Повторить",
                    }
                ).click();

                await expect(
                    page.getByRole("heading", {
                        name:
                            "Панель администратора",
                    })
                ).toBeVisible();

                expect(
                    await getStoredToken(page)
                ).toBe(REFRESHED_TOKEN);

                expect(
                    requests.length
                ).toBeGreaterThanOrEqual(2);
            }
        );

        test(
            "ответ обновления без токена не открывает админку",
            async ({ page }) => {
                await seedSession(
                    page,
                    makeToken({
                        remainingSeconds: -60,
                    })
                );

                await mockRefresh(
                    page,
                    async () => ({
                        status: 200,
                        body: {
                            success: true,
                        },
                    })
                );

                await page.goto("/dashboard");

                await expect(
                    page.getByRole("heading", {
                        name:
                            "Не удалось связаться с сервером",
                    })
                ).toBeVisible();

                await expect(
                    page.getByRole("heading", {
                        name:
                            "Панель администратора",
                    })
                ).toHaveCount(0);
            }
        );

        test(
            "401 обычного axios завершает административную сессию",
            async ({ page }) => {
                await seedSession(
                    page,
                    ACTIVE_TOKEN
                );

                const requests =
                    await mockOrders(
                        page,
                        401,
                        "Сессия завершена"
                    );

                await page.goto("/orders");

                await expect(page).toHaveURL(
                    /\/login\?reason=expired$/
                );

                expect(
                    requests.length
                ).toBeGreaterThanOrEqual(1);

                expect(
                    await getStoredToken(page)
                ).toBeNull();
            }
        );

        test(
            "403 с отзывом прав открывает правильное предупреждение",
            async ({ page }) => {
                await seedSession(
                    page,
                    ACTIVE_TOKEN
                );

                const requests =
                    await mockOrders(
                        page,
                        403,
                        "Доступ запрещен"
                    );

                await page.goto("/orders");

                await expect(page).toHaveURL(
                    /\/login\?reason=access_revoked$/
                );

                await expect(
                    page.getByText(
                        "Доступ администратора был отозван.",
                        { exact: false }
                    )
                ).toBeVisible();

                expect(
                    requests.length
                ).toBeGreaterThanOrEqual(1);

                expect(
                    await getStoredToken(page)
                ).toBeNull();
            }
        );

        test(
            "другая ошибка 403 не должна автоматически завершать сессию",
            async ({ page }) => {
                await seedSession(
                    page,
                    ACTIVE_TOKEN
                );

                await mockOrders(
                    page,
                    403,
                    "Недостаточно прав для операции"
                );

                await page.goto("/orders");

                await expect(
                    page.locator(
                        ".orders-message.error"
                    )
                ).toContainText(
                    "Не удалось загрузить заказы"
                );

                await expect(page).toHaveURL(
                    `${FRONT_URL}/orders`
                );

                expect(
                    await getStoredToken(page)
                ).toBe(ACTIVE_TOKEN);
            }
        );

        test(
            "401 отдельного axiosInstance завершает сессию",
            async ({ page }) => {
                await seedSession(
                    page,
                    ACTIVE_TOKEN
                );

                const requests =
                    await mockBenefits(
                        page,
                        401,
                        "Сессия завершена"
                    );

                await page.goto("/benefits");

                await expect(page).toHaveURL(
                    /\/login\?reason=expired$/
                );

                expect(
                    requests.length
                ).toBeGreaterThanOrEqual(1);

                expect(
                    await getStoredToken(page)
                ).toBeNull();
            }
        );

        test(
            "403 отдельного axiosInstance сообщает об отзыве прав",
            async ({ page }) => {
                await seedSession(
                    page,
                    ACTIVE_TOKEN
                );

                const requests =
                    await mockBenefits(
                        page,
                        403,
                        "Доступ запрещен"
                    );

                await page.goto("/benefits");

                await expect(page).toHaveURL(
                    /\/login\?reason=access_revoked$/
                );

                await expect(
                    page.getByText(
                        "Доступ администратора был отозван.",
                        { exact: false }
                    )
                ).toBeVisible();

                expect(
                    requests.length
                ).toBeGreaterThanOrEqual(1);

                expect(
                    await getStoredToken(page)
                ).toBeNull();
            }
        );

    }
);