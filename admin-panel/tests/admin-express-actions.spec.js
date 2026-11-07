import {
    test,
    expect,
} from "./fixtures/safeTest";

import {
    setAdminAuth,
    ADMIN_TEST_TOKEN,
} from "./utils/adminTestAuth";

const ORDER = {
    id: 201,
    type: "taxi",
    status: "created",
    creatorId: 10,
    executorId: null,
    createdAt: "2026-10-01T10:00:00.000Z",

    fromAddress: "Симферополь, Пушкина, 1",
    toAddress: "Симферополь, Кирова, 10",

    totalPrice: 700,
    paymentType: "cash",

    adminDeleted: false,
    creatorHidden: false,
};

const DISPUTE = {
    id: 501,
    orderId: 201,
    orderType: "express",
    status: "open",
    openedByRole: "creator",
    openedById: 10,
    reasonCode: "wrong_address",
    reason: "Указан неправильный адрес",
    description: "Водитель приехал в другое место",
    createdAt: "2026-10-02T10:00:00.000Z",
    evidencePhotos: [],
};

const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
);

async function setupMocks(page, options = {}) {
    const {
        order = ORDER,
        evidenceStatus = 200,
        hideStatus = 200,
        restoreStatus = 200,
        disputes = [],
        disputesStatus = 200,
        evidence = false,
    } = options;

    const state = {
        order: { ...order },
        writes: [],
        evidenceRequests: [],
    };

    await page.route(
        "**/api/admin/express-orders/201/restore",
        async (route) => {
            state.writes.push({
                method: route.request().method(),
                action: "restore",
                authorization:
                route.request().headers().authorization,
            });

            if (restoreStatus !== 200) {
                await route.fulfill({
                    status: restoreStatus,
                    json: {
                        message:
                            "Не удалось восстановить экспресс-заказ",
                    },
                });
                return;
            }

            state.order = {
                ...state.order,
                adminDeleted: false,
                creatorHidden: false,
            };

            await route.fulfill({
                status: 200,
                json: {
                    order: state.order,
                },
            });
        }
    );

    await page.route(
        "**/api/admin/express-orders/201/logs",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    rows: [],
                },
            });
        }
    );

    await page.route(
        "**/api/admin/express-orders/201",
        async (route) => {
            const method = route.request().method();

            if (method === "GET") {
                await route.fulfill({
                    status: 200,
                    json: state.order,
                });
                return;
            }

            if (method === "DELETE") {
                state.writes.push({
                    method,
                    action: "hide",
                    authorization:
                    route.request().headers().authorization,
                });

                if (hideStatus !== 200) {
                    await route.fulfill({
                        status: hideStatus,
                        json: {
                            message:
                                "Не удалось скрыть экспресс-заказ",
                        },
                    });
                    return;
                }

                state.order = {
                    ...state.order,
                    adminDeleted: true,
                };

                await route.fulfill({
                    status: 200,
                    json: {
                        order: state.order,
                    },
                });
                return;
            }

            await route.abort("blockedbyclient");

            throw new Error(
                `Неожиданный метод: ${method}`
            );
        }
    );

    await page.route(
        "**/api/admin/disputes**",
        async (route) => {
            await route.fulfill({
                status: disputesStatus,
                json:
                    disputesStatus === 200
                        ? { disputes }
                        : {
                            message:
                                "Ошибка загрузки споров",
                        },
            });
        }
    );

    if (evidence) {
        await page.route(
            "**/api/disputes/evidence/501/77",
            async (route) => {
                state.evidenceRequests.push({
                    method:
                        route.request().method(),
                    authorization:
                    route.request().headers()
                        .authorization,
                });

                await route.fulfill(
                    evidenceStatus === 200
                        ? {
                            status: 200,
                            contentType: "image/png",
                            body: PNG,
                        }
                        : {
                            status: evidenceStatus,
                            json: {
                                message: "Фотография недоступна",
                            },
                        }
                );
            }
        );
    }

    return state;
}

async function openPage(page, options = {}) {
    await setAdminAuth(page);

    const state = await setupMocks(
        page,
        options
    );

    await page.goto("/express-orders/201");

    await expect(
        page.getByRole("heading", {
            name: "Детали экспресс-заказа #201",
        })
    ).toBeVisible();

    return state;
}

function watchDialogs(page, dismissConfirm = false) {
    const dialogs = [];

    page.on("dialog", async (dialog) => {
        dialogs.push({
            type: dialog.type(),
            message: dialog.message(),
        });

        if (
            dismissConfirm &&
            dialog.type() === "confirm"
        ) {
            await dialog.dismiss();
            return;
        }

        await dialog.accept();
    });

    return dialogs;
}

test.describe("Экспресс-заказы — действия и споры", () => {

    test("новый заказ без исполнителя можно скрыть", async ({ page }) => {
        await openPage(page);

        await expect(
            page.getByRole("button", {
                name: "Скрыть заказ",
            })
        ).toBeVisible();

        await expect(
            page.getByRole("button", {
                name: "Восстановить",
            })
        ).toHaveCount(0);
    });

    test("принятый заказ нельзя скрыть через интерфейс", async ({ page }) => {
        await openPage(page, {
            order: {
                ...ORDER,
                status: "accepted",
                executorId: 20,
            },
        });

        await expect(
            page.getByRole("button", {
                name: "Скрыть заказ",
            })
        ).toHaveCount(0);
    });

    test("ошибка фотографии не оставляет бесконечную загрузку", async ({ page }) => {
        await openPage(page, {
            disputes: [
                {
                    ...DISPUTE,
                    evidencePhotos: [
                        {
                            id: 77,
                            uploadedById: 20,
                        },
                    ],
                },
            ],
            evidence: true,
            evidenceStatus: 500,
        });

        await expect(
            page.getByRole("alert", {
                name: "",
            }).filter({
                hasText: "Не удалось загрузить фотографию",
            })
        ).toBeVisible();

        await expect(
            page.getByRole("button", {
                name: "Повторить",
            })
        ).toBeVisible();
    });

    test("повторная загрузка фотографии работает после ошибки", async ({ page }) => {
        await openPage(page, {
            disputes: [
                {
                    ...DISPUTE,
                    evidencePhotos: [
                        {
                            id: 77,
                            uploadedById: 20,
                        },
                    ],
                },
            ],
            evidence: true,
            evidenceStatus: 500,
        });

        await expect(
            page.getByText(
                "Не удалось загрузить фотографию"
            )
        ).toBeVisible();

        // Последний зарегистрированный обработчик маршрута
        // имеет приоритет над предыдущим.
        await page.route(
            "**/api/disputes/evidence/501/77",
            async (route) => {
                await route.fulfill({
                    status: 200,
                    contentType: "image/png",
                    body: PNG,
                });
            }
        );

        await page.getByRole("button", {
            name: "Повторить",
        }).click();

        await expect(
            page.getByRole("img", {
                name: "Доказательство 1",
            })
        ).toHaveAttribute("src", /^blob:/);

        await expect(
            page.getByText(
                "Не удалось загрузить фотографию"
            )
        ).toHaveCount(0);
    });

    test("заказ с исполнителем нельзя скрыть", async ({ page }) => {
        await openPage(page, {
            order: {
                ...ORDER,
                executorId: 20,
            },
        });

        await expect(
            page.getByRole("button", {
                name: "Скрыть заказ",
            })
        ).toHaveCount(0);
    });

    test("отмена скрытия не отправляет DELETE", async ({ page }) => {
        const state = await openPage(page);

        watchDialogs(page, true);

        await page.getByRole("button", {
            name: "Скрыть заказ",
        }).click();

        expect(state.writes).toHaveLength(0);

        await expect(
            page.getByRole("button", {
                name: "Скрыть заказ",
            })
        ).toBeVisible();
    });

    test("скрытие отправляет DELETE с авторизацией", async ({ page }) => {
        const state = await openPage(page);

        watchDialogs(page);

        await page.getByRole("button", {
            name: "Скрыть заказ",
        }).click();

        await expect.poll(
            () => state.writes.length
        ).toBe(1);

        expect(state.writes[0]).toEqual({
            method: "DELETE",
            action: "hide",
            authorization:
                `Bearer ${ADMIN_TEST_TOKEN}`,
        });

        await expect(
            page.getByRole("button", {
                name: "Восстановить",
            })
        ).toBeVisible();
    });

    test("ошибка скрытия сохраняет исходное состояние", async ({ page }) => {
        const state = await openPage(page, {
            hideStatus: 500,
        });

        const dialogs = watchDialogs(page);

        await page.getByRole("button", {
            name: "Скрыть заказ",
        }).click();

        await expect.poll(
            () => dialogs.some(
                (dialog) =>
                    dialog.type === "alert" &&
                    dialog.message ===
                    "Не удалось скрыть экспресс-заказ"
            )
        ).toBe(true);

        expect(state.writes).toHaveLength(1);

        await expect(
            page.getByRole("button", {
                name: "Скрыть заказ",
            })
        ).toBeVisible();
    });

    test("отмена восстановления не отправляет PATCH", async ({ page }) => {
        const state = await openPage(page, {
            order: {
                ...ORDER,
                adminDeleted: true,
            },
        });

        watchDialogs(page, true);

        await page.getByRole("button", {
            name: "Восстановить",
        }).click();

        expect(state.writes).toHaveLength(0);

        await expect(
            page.getByRole("button", {
                name: "Восстановить",
            })
        ).toBeVisible();
    });

    test("восстановление отправляет PATCH и обновляет интерфейс", async ({ page }) => {
        const state = await openPage(page, {
            order: {
                ...ORDER,
                adminDeleted: true,
            },
        });

        watchDialogs(page);

        await page.getByRole("button", {
            name: "Восстановить",
        }).click();

        await expect.poll(
            () => state.writes.length
        ).toBe(1);

        expect(state.writes[0]).toEqual({
            method: "PATCH",
            action: "restore",
            authorization:
                `Bearer ${ADMIN_TEST_TOKEN}`,
        });

        await expect(
            page.getByRole("button", {
                name: "Скрыть заказ",
            })
        ).toBeVisible();
    });

    test("ошибка восстановления не меняет состояние заказа", async ({ page }) => {
        const state = await openPage(page, {
            order: {
                ...ORDER,
                adminDeleted: true,
            },
            restoreStatus: 500,
        });

        const dialogs = watchDialogs(page);

        await page.getByRole("button", {
            name: "Восстановить",
        }).click();

        await expect.poll(
            () => dialogs.some(
                (dialog) =>
                    dialog.type === "alert" &&
                    dialog.message ===
                    "Не удалось восстановить экспресс-заказ"
            )
        ).toBe(true);

        expect(state.writes).toHaveLength(1);

        await expect(
            page.getByRole("button", {
                name: "Восстановить",
            })
        ).toBeVisible();
    });

    test("без споров показывает пустой список", async ({ page }) => {
        await openPage(page);

        await expect(
            page.getByText(
                "По этому экспресс-заказу споров нет"
            )
        ).toBeVisible();
    });

    test("показывает подробности спора", async ({ page }) => {
        await openPage(page, {
            disputes: [DISPUTE],
        });

        const dispute = page.locator(
            ".admin-dispute-box"
        );

        await expect(dispute).toHaveCount(1);

        await expect(dispute).toContainText(
            "Открыт"
        );

        await expect(dispute).toContainText(
            "Заказчик #10"
        );

        await expect(dispute).toContainText(
            "Неверный адрес или маршрут"
        );

        await expect(dispute).toContainText(
            "Указан неправильный адрес"
        );
    });

    test("показывает ошибку загрузки споров", async ({ page }) => {
        await openPage(page, {
            disputesStatus: 500,
        });

        await expect(
            page.locator(".page-message.error")
        ).toContainText(
            "Ошибка загрузки споров"
        );

        await expect(
            page.locator(".admin-dispute-box")
        ).toHaveCount(0);
    });

    test("загружает фотографию спора через защищённый API", async ({ page }) => {
        const state = await openPage(page, {
            disputes: [
                {
                    ...DISPUTE,
                    evidencePhotos: [
                        {
                            id: 77,
                            uploadedById: 20,
                        },
                    ],
                },
            ],
            evidence: true,
        });

        await expect.poll(
            () => state.evidenceRequests.length
        ).toBeGreaterThanOrEqual(1);

        for (const request of state.evidenceRequests) {
            expect(request).toEqual({
                method: "GET",
                authorization:
                    `Bearer ${ADMIN_TEST_TOKEN}`,
            });
        }

        await expect(
            page.getByRole("img", {
                name: "Доказательство 1",
            })
        ).toHaveAttribute(
            "src",
            /^blob:/
        );

        await expect(
            page.locator(".admin-dispute-box")
        ).toContainText(
            "Пользователь #20"
        );
    });

});