import {
    test,
    expect,
} from "./fixtures/safeTest";

import {
    setAdminAuth,
    ADMIN_TEST_TOKEN,
} from "./utils/adminTestAuth";

const USER = {
    id: 71,
    username: "Тестовый водитель",
    phone: "+79990000071",
    createdAt: "2026-10-01T10:00:00.000Z",
    rating: 4.9,
    userStatus: "verified",
    role: "user",

    subscription_type: "standard",
    subscription_expires_at: null,

    vehicleBrand: "Toyota",
    vehicleModel: "Camry",
    vehicleColor: "Чёрный",
    vehiclePlate: "А123АА82",
    vehicleYear: 2020,
    vehiclePhoto: "/uploads/test-vehicle.jpg",

    vehicleVerificationStatus: "pending",
    vehicleVerificationNote: null,
};

function makeUser(changes = {}) {
    return {
        ...USER,
        ...changes,
    };
}


function getVehicleReviewSnapshot(user) {
    return {
        vehicleBrand: user.vehicleBrand ?? null,
        vehicleModel: user.vehicleModel ?? null,
        vehicleColor: user.vehicleColor ?? null,
        vehiclePlate: user.vehiclePlate ?? null,
        vehicleYear: user.vehicleYear ?? null,
        vehiclePhoto: user.vehiclePhoto ?? null,
        vehicleVerificationStatus:
            user.vehicleVerificationStatus ?? null,
    };
}

async function setupMocks(page, options = {}) {
    const {
        user = makeUser(),
        approveStatus = 200,
        rejectStatus = 200,
        removeStatus = 200,
    } = options;

    const state = {
        verifications: [],
        removals: [],
    };

    // Полностью искусственный пользователь.
    await page.route(
        "**/api/admin/users",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: [user],
            });
        }
    );

    // ПЭП.
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

    // Счётчики страницы пользователей.
    const extraRoutes = {
        "/api/admin/user-documents/71": {
            documents: [],
        },
        "/api/admin/users/71/complaints": {
            complaints: [],
        },
        "/api/admin/users/71/orders": {
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

    // Одобрение и отклонение автомобиля.
    await page.route(
        "**/api/admin/users/71/vehicle-verification",
        async (route) => {
            const method = route.request().method();
            const body = route.request().postDataJSON();

            state.verifications.push({
                method,
                body,
                authorization:
                route.request().headers().authorization,
            });

            const status =
                body.status === "verified"
                    ? approveStatus
                    : rejectStatus;

            if (status !== 200) {
                await route.fulfill({
                    status,
                    json: {
                        success: false,
                        message:
                            body.status === "verified"
                                ? "Нельзя подтвердить автомобиль: не заполнены обязательные данные"
                                : "Не удалось изменить статус проверки автомобиля",
                    },
                });

                return;
            }

            await route.fulfill({
                status: 200,
                json: {
                    success: true,
                    user: {
                        id: 71,
                        vehicleVerificationStatus:
                        body.status,
                        vehicleVerificationNote:
                            body.status === "rejected"
                                ? body.note
                                : null,
                    },
                },
            });
        }
    );

    // Удаление автомобиля.
    await page.route(
        "**/api/admin/users/71/vehicle",
        async (route) => {
            state.removals.push({
                method: route.request().method(),
                authorization:
                route.request().headers().authorization,
            });

            await route.fulfill({
                status: removeStatus,
                json:
                    removeStatus === 200
                        ? {
                            success: true,
                            message: "Автомобиль удалён",
                        }
                        : {
                            success: false,
                            message:
                                "Не удалось удалить автомобиль",
                        },
            });
        }
    );

    return state;
}

async function openUsers(page, options = {}) {
    await setAdminAuth(page);

    const state = await setupMocks(
        page,
        options
    );

    await page.goto("/users");

    await expect(
        page.locator(".users-table tbody tr")
    ).toHaveCount(1);

    return state;
}

function vehicleCell(page) {
    return page
        .locator(".users-table tbody tr")
        .first()
        .locator(".admin-vehicle-cell");
}

function rejectModal(page) {
    return page.locator(
        ".admin-vehicle-modal"
    );
}

async function openRejectModal(page) {
    await vehicleCell(page).getByRole(
        "button",
        {
            name: "Отклонить",
            exact: true,
        }
    ).click();

    await expect(
        rejectModal(page)
    ).toBeVisible();
}

function acceptDialogs(page) {
    const dialogs = [];

    page.on("dialog", async (dialog) => {
        dialogs.push({
            type: dialog.type(),
            message: dialog.message(),
        });

        await dialog.accept();
    });

    return dialogs;
}

test.describe("UsersPage — автомобили", () => {

    test("показывает отсутствие автомобиля", async ({ page }) => {
        await openUsers(page, {
            user: makeUser({
                vehicleBrand: null,
                vehicleModel: null,
                vehicleColor: null,
                vehiclePlate: null,
                vehicleYear: null,
                vehiclePhoto: null,
                vehicleVerificationStatus: "none",
            }),
        });

        await expect(
            vehicleCell(page)
        ).toContainText("Не указан");

        await expect(
            vehicleCell(page).getByRole("button", {
                name: "Одобрить",
            })
        ).toHaveCount(0);

        await expect(
            vehicleCell(page).getByRole("button", {
                name: "Удалить автомобиль",
            })
        ).toHaveCount(0);
    });

    test("отображает автомобиль, ожидающий проверки", async ({ page }) => {
        await openUsers(page);

        const cell = vehicleCell(page);

        await expect(cell).toContainText(
            "Toyota Camry"
        );

        await expect(cell).toContainText(
            "Чёрный"
        );

        await expect(cell).toContainText(
            "А123АА82"
        );

        await expect(cell).toContainText(
            "2020 г."
        );

        await expect(
            cell.locator(".admin-vehicle-status")
        ).toHaveText("Ожидает проверки");

        await expect(
            cell.getByRole("button", {
                name: "Одобрить",
            })
        ).toBeVisible();

        await expect(
            cell.getByRole("button", {
                name: "Отклонить",
                exact: true,
            })
        ).toBeVisible();

        await expect(
            cell.getByRole("link", {
                name: "Фото автомобиля",
            })
        ).toHaveAttribute(
            "href",
            /\/uploads\/test-vehicle\.jpg$/
        );
    });

    test("подтверждённый автомобиль не требует повторного решения", async ({ page }) => {
        await openUsers(page, {
            user: makeUser({
                vehicleVerificationStatus: "verified",
            }),
        });

        const cell = vehicleCell(page);

        await expect(
            cell.locator(".admin-vehicle-status")
        ).toHaveText("Подтверждён");

        await expect(
            cell.getByRole("button", {
                name: "Одобрить",
            })
        ).toHaveCount(0);

        await expect(
            cell.getByRole("button", {
                name: "Отклонить",
                exact: true,
            })
        ).toHaveCount(0);
    });

    test("отклонённый автомобиль показывает причину", async ({ page }) => {
        await openUsers(page, {
            user: makeUser({
                vehicleVerificationStatus: "rejected",
                vehicleVerificationNote:
                    "Не соответствует государственный номер",
            }),
        });

        const cell = vehicleCell(page);

        await expect(
            cell.locator(".admin-vehicle-status")
        ).toHaveText("Отклонён");

        await expect(
            cell.locator(".admin-vehicle-reject-note")
        ).toHaveText(
            "Не соответствует государственный номер"
        );

        await expect(
            cell.getByRole("button", {
                name: "Одобрить",
            })
        ).toBeVisible();
    });

    test("отмена подтверждения не отправляет запрос", async ({ page }) => {
        const state = await openUsers(page);

        page.once("dialog", async (dialog) => {
            await dialog.dismiss();
        });

        await vehicleCell(page).getByRole(
            "button",
            {
                name: "Одобрить",
            }
        ).click();

        expect(
            state.verifications
        ).toHaveLength(0);

        await expect(
            vehicleCell(page).locator(
                ".admin-vehicle-status"
            )
        ).toHaveText("Ожидает проверки");
    });

    test("успешно подтверждает автомобиль", async ({ page }) => {
        const state = await openUsers(page);

        const dialogs = acceptDialogs(page);

        await vehicleCell(page).getByRole(
            "button",
            {
                name: "Одобрить",
            }
        ).click();

        await expect.poll(
            () => state.verifications.length
        ).toBe(1);

        expect(
            state.verifications[0]
        ).toEqual({
            method: "PUT",
            body: {
                status: "verified",
                expectedVehicle:
                    getVehicleReviewSnapshot(USER),
            },
            authorization:
                `Bearer ${ADMIN_TEST_TOKEN}`,
        });

        expect(
            dialogs[0].message
        ).toContain(
            "Подтвердить автомобиль Toyota Camry"
        );

        await expect(
            vehicleCell(page).locator(
                ".admin-vehicle-status"
            )
        ).toHaveText("Подтверждён");
    });

    test("ошибка backend не подтверждает автомобиль", async ({ page }) => {
        const state = await openUsers(page, {
            approveStatus: 400,
        });

        const dialogs = acceptDialogs(page);

        await vehicleCell(page).getByRole(
            "button",
            {
                name: "Одобрить",
            }
        ).click();

        await expect.poll(
            () => dialogs.some(
                (dialog) =>
                    dialog.type === "alert" &&
                    dialog.message.includes(
                        "не заполнены обязательные данные"
                    )
            )
        ).toBe(true);

        expect(
            state.verifications
        ).toHaveLength(1);

        await expect(
            vehicleCell(page).locator(
                ".admin-vehicle-status"
            )
        ).toHaveText("Ожидает проверки");
    });

    test("открывает окно отклонения автомобиля", async ({ page }) => {
        await openUsers(page);

        await openRejectModal(page);

        const modal = rejectModal(page);

        await expect(
            modal.getByRole("heading", {
                name: "Отклонить автомобиль",
            })
        ).toBeVisible();

        await expect(modal).toContainText(
            "Toyota Camry"
        );

        await expect(modal).toContainText(
            "А123АА82"
        );

        await expect(
            modal.locator("textarea")
        ).toBeVisible();
    });

    test("не разрешает отклонять без причины", async ({ page }) => {
        const state = await openUsers(page);

        await openRejectModal(page);

        const modal = rejectModal(page);

        const reason = modal.locator("textarea");

        const button = modal.getByRole(
            "button",
            {
                name: "Отклонить",
                exact: true,
            }
        );

        await expect(
            button
        ).toBeDisabled();

        await reason.fill("Нет");

        await expect(
            button
        ).toBeEnabled();

        await reason.fill("  а  ");

        await expect(
            button
        ).toBeDisabled();

        expect(
            state.verifications
        ).toHaveLength(0);
    });

    test("отмена отклонения закрывает окно", async ({ page }) => {
        const state = await openUsers(page);

        await openRejectModal(page);

        await rejectModal(page)
            .locator("textarea")
            .fill(
                "Госномер не соответствует фотографии"
            );

        await rejectModal(page).getByRole(
            "button",
            {
                name: "Отмена",
            }
        ).click();

        await expect(
            rejectModal(page)
        ).toHaveCount(0);

        expect(
            state.verifications
        ).toHaveLength(0);

        await expect(
            vehicleCell(page).locator(
                ".admin-vehicle-status"
            )
        ).toHaveText("Ожидает проверки");
    });

    test("отклоняет автомобиль с указанной причиной", async ({ page }) => {
        const state = await openUsers(page);

        await openRejectModal(page);

        const reason =
            "Госномер не соответствует фотографии";

        await rejectModal(page)
            .locator("textarea")
            .fill(`  ${reason}  `);

        await rejectModal(page).getByRole(
            "button",
            {
                name: "Отклонить",
                exact: true,
            }
        ).click();

        await expect.poll(
            () => state.verifications.length
        ).toBe(1);

        expect(
            state.verifications[0]
        ).toEqual({
            method: "PUT",
            body: {
                status: "rejected",
                note: reason,
                expectedVehicle:
                    getVehicleReviewSnapshot(USER),
            },
            authorization:
                `Bearer ${ADMIN_TEST_TOKEN}`,
        });

        await expect(
            rejectModal(page)
        ).toHaveCount(0);

        await expect(
            vehicleCell(page).locator(
                ".admin-vehicle-status"
            )
        ).toHaveText("Отклонён");

        await expect(
            vehicleCell(page).locator(
                ".admin-vehicle-reject-note"
            )
        ).toHaveText(reason);
    });

    test("ошибка сервера не меняет статус при отклонении", async ({ page }) => {
        const state = await openUsers(page, {
            rejectStatus: 500,
        });

        const dialogs = acceptDialogs(page);

        await openRejectModal(page);

        await rejectModal(page)
            .locator("textarea")
            .fill(
                "Необходимо повторно проверить автомобиль"
            );

        await rejectModal(page).getByRole(
            "button",
            {
                name: "Отклонить",
                exact: true,
            }
        ).click();

        await expect.poll(
            () => dialogs.some(
                (dialog) =>
                    dialog.type === "alert" &&
                    dialog.message ===
                    "Не удалось изменить статус проверки автомобиля"
            )
        ).toBe(true);

        expect(
            state.verifications
        ).toHaveLength(1);

        await expect(
            vehicleCell(page).locator(
                ".admin-vehicle-status"
            )
        ).toHaveText("Ожидает проверки");

        await expect(
            rejectModal(page)
        ).toBeVisible();
    });

    test("повторно одобряет ранее отклонённый автомобиль", async ({ page }) => {
        const state = await openUsers(page, {
            user: makeUser({
                vehicleVerificationStatus: "rejected",
                vehicleVerificationNote:
                    "Фото было нечётким",
            }),
        });

        acceptDialogs(page);

        await vehicleCell(page).getByRole(
            "button",
            {
                name: "Одобрить",
            }
        ).click();

        await expect.poll(
            () => state.verifications.length
        ).toBe(1);


        expect(
            state.verifications[0].body
        ).toEqual({
            status: "verified",
            expectedVehicle: getVehicleReviewSnapshot({
                ...USER,
                vehicleVerificationStatus: "rejected",
            }),
        });


        await expect(
            vehicleCell(page).locator(
                ".admin-vehicle-status"
            )
        ).toHaveText("Подтверждён");

        await expect(
            vehicleCell(page).locator(
                ".admin-vehicle-reject-note"
            )
        ).toHaveCount(0);
    });

    test("отмена удаления сохраняет автомобиль", async ({ page }) => {
        const state = await openUsers(page);

        page.once("dialog", async (dialog) => {
            await dialog.dismiss();
        });

        await vehicleCell(page).getByRole(
            "button",
            {
                name: "Удалить автомобиль",
            }
        ).click();

        expect(
            state.removals
        ).toHaveLength(0);

        await expect(
            vehicleCell(page)
        ).toContainText("Toyota Camry");
    });

    test("успешно удаляет автомобиль", async ({ page }) => {
        const state = await openUsers(page);

        const dialogs = acceptDialogs(page);

        await vehicleCell(page).getByRole(
            "button",
            {
                name: "Удалить автомобиль",
            }
        ).click();

        await expect.poll(
            () => state.removals.length
        ).toBe(1);

        expect(
            state.removals[0]
        ).toEqual({
            method: "DELETE",
            authorization:
                `Bearer ${ADMIN_TEST_TOKEN}`,
        });

        expect(
            dialogs[0].message
        ).toContain("Удалить автомобиль");

        await expect(
            vehicleCell(page)
        ).toContainText("Не указан");

        await expect(
            vehicleCell(page)
        ).not.toContainText("Toyota Camry");
    });

    test("ошибка удаления сохраняет сведения об автомобиле", async ({ page }) => {
        const state = await openUsers(page, {
            removeStatus: 500,
        });

        const dialogs = acceptDialogs(page);

        await vehicleCell(page).getByRole(
            "button",
            {
                name: "Удалить автомобиль",
            }
        ).click();

        await expect.poll(
            () => dialogs.some(
                (dialog) =>
                    dialog.type === "alert" &&
                    dialog.message ===
                    "Не удалось удалить автомобиль"
            )
        ).toBe(true);

        expect(
            state.removals
        ).toHaveLength(1);

        await expect(
            vehicleCell(page)
        ).toContainText("Toyota Camry");

        await expect(
            vehicleCell(page).locator(
                ".admin-vehicle-status"
            )
        ).toHaveText("Ожидает проверки");
    });

});