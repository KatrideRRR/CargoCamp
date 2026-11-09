import { test, expect } from "./fixtures/safeTest";

import {
    mockOrderAssets,
} from "./utils/mockOrderAssets";

const FRONT_URL = "http://localhost:3000";

const testUser = {
    id: 1,
    username: "executor",
    role: "executor",
    phone: "+79786864118",
};

const customerUser = {
    id: 2,
    username: "Заказчик",
    rating: 4.5,
    phone: "+79780032978",
};

const regularOrder = {
    id: 101,
    description: "Привезти груз",
    address: "Улица Пушкина",
    paymentType: "cash",
    proposedSum: 500,
    creatorId: 2,
    executorId: 1,
    images: ["/test-image.jpg", "/test-image-2.jpg"],
    category: { name: "Грузы" },
    subcategory: { name: "Мебель" },
    service: { name: "Перевозка мебели" },
    coordinates: "55.7558,37.6176",
    createdAt: new Date().toISOString(),
    completedBy: [],
    status: "active",
    workStartedAt: "2026-07-01T10:00:00.000Z",
    contractPath: "contracts/test-contract.pdf",
    executorBeforePhotos: ["/before-1.jpg"],
    executorAfterPhotos: [],
    customerBeforePhotos: [],
    customerAfterPhotos: [],
};

function createFakeJwt(payload) {
    const header = {
        alg: "none",
        typ: "JWT",
    };

    const base64url = (obj) =>
        Buffer.from(JSON.stringify(obj))
            .toString("base64")
            .replace(/=/g, "")
            .replace(/\+/g, "-")
            .replace(/\//g, "_");

    return `${base64url(header)}.${base64url(payload)}.`;
}

async function setFakeAuthToken(page) {
    const fakeToken = createFakeJwt({
        id: testUser.id,
        role: testUser.role,
        name: testUser.username,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
    });

    await page.addInitScript((token) => {
        localStorage.setItem("authToken", token);
    }, fakeToken);
}

async function setupFrontendMocks(page) {

    await mockOrderAssets(page);

    page.on("pageerror", (error) => {
        console.log("[PAGE ERROR]", error.message);
    });

    page.on("console", (msg) => {
        const text = msg.text();

        if (
            text.includes("Ошибка") ||
            text.includes("error") ||
            text.includes("React") ||
            text.includes("CALL")
        ) {
            console.log(`[BROWSER ${msg.type()}]`, text);
        }
    });

    page.on("requestfailed", (request) => {
        console.log("[REQUEST FAILED]", request.url(), request.failure()?.errorText);
    });

    await page.route("**/api/orders/active-orders", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                orders: [regularOrder],
                notifications: [
                    {
                        id: 1,
                        type: "new_message",
                        userId: testUser.id,
                        orderId: regularOrder.id,
                        isRead: false,
                    },
                ],
            }),
        });
    });

    await page.route("**/api/express/express-orders/me**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                success: true,
                orders: [],
            }),
        });
    });

    await page.route("**/api/auth/2", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(customerUser),
        });
    });

    await page.route("**/api/auth/user/2", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(customerUser),
        });
    });

    await page.route("**/api/auth/1", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(testUser),
        });
    });

    await page.route("**/api/auth/user/1", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(testUser),
        });
    });

    await page.route("**/api/disputes/order/**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify({
                dispute: null,
            }),
        });
    });

    await page.route("**/test-image.jpg", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "image/jpeg",
            body: Buffer.from("fake-image-1"),
        });
    });

    await page.route("**/test-image-2.jpg", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "image/jpeg",
            body: Buffer.from("fake-image-2"),
        });
    });

    await page.route("**/before-1.jpg", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "image/jpeg",
            body: Buffer.from("fake-before-image"),
        });
    });

    /*
 * Неподписанные акты.
 *
 * Для тестов бронирования очередь пустая.
 */
    await page.route(
        "**/api/orders/pending-act-signatures",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    acts: [],
                    missingOrderIds: [],
                },
            });
        }
    );

    /*
     * Договоры-задания.
     *
     * Изолируем загрузку документов,
     * но не подменяем сам React-компонент.
     */
    await page.route(
        "**/api/contracts/assignments/summary",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    success: true,
                    assignments: [],
                    acts: [],
                },
            });
        }
    );

    /*
 * =====================================================
 * CARGOCAMP — ACTIVE ORDERS E2E API MOCKS
 * =====================================================
 *
 * Все ответы искусственные.
 * Реальный backend не используется.
 */

// Профиль текущего пользователя.
    await page.route(
        "**/api/auth/profile",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    ...testUser,
                    debt: 0,
                },
            });
        }
    );

// Задолженность исполнителя.
    await page.route(
        "**/api/orders/me/status",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    debt: 0,
                },
            });
        }
    );

// Предложения по изменению условий заказа.
// Используем только номера наших тестовых заказов.
    for (const orderId of [101, 202]) {
        await page.route(
            `**/api/order-changes/order/${orderId}`,
            async (route) => {
                expect(
                    route.request().method()
                ).toBe("GET");

                await route.fulfill({
                    status: 200,
                    json: {
                        success: true,
                        changes: [],
                    },
                });
            }
        );
    }
}

async function openActiveOrdersPage(page) {
    await setFakeAuthToken(page);
    await setupFrontendMocks(page);

    await page.goto(`${FRONT_URL}/active-orders?platform=web`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
    });

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "active-orders-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error(
            "После fake JWT всё равно произошёл редирект на /login. Нужно проверить роутер/PrivateRoute."
        );
    }

    await expect(page.getByText("Активные заказы")).toBeVisible({
        timeout: 15000,
    });
}

function disputeModal(page) {
    return page.locator(".dispute-modal-content");
}

async function clickDisputeSubmit(page) {
    await page.evaluate(() => {
        const button = document.querySelector(
            ".dispute-modal-content .dispute-submit-button"
        );

        if (!button) {
            throw new Error("Кнопка отправки спора не найдена");
        }

        button.click();
    });
}

test.describe("ActiveOrdersPage", () => {
    test.beforeEach(async ({ page }) => {
        await openActiveOrdersPage(page);
    });

    test("отображает активный заказ исполнителя", async ({ page }) => {
        await expect(page.getByText("Активные заказы")).toBeVisible();

        const card = page.locator(".order-card").first();

        await expect(card).toBeVisible();

        await expect(
            card.getByText("Заказ №101", {
                exact: true,
            })
        ).toBeVisible();
        await expect(card.getByText("Вы исполнитель")).toBeVisible();

        await expect(card.getByText(/ID заказчика:\s*2/)).toBeVisible();
        await expect(card.getByText(/Имя заказчика:\s*Заказчик/)).toBeVisible();
        await expect(card.getByText(/Рейтинг заказчика:\s*4\.5/)).toBeVisible();

        await expect(card.getByText(/Грузы/)).toBeVisible();
        await expect(card.getByText(/Мебель/)).toBeVisible();
        await expect(card.getByText(/Перевозка мебели/)).toBeVisible();

        await expect(card.getByText(/Улица Пушкина/)).toBeVisible();
        await expect(card.getByText(/Привезти груз/)).toBeVisible();

        await expect(card.locator(".pay-price")).toContainText("500 ₽");
        await expect(card.locator(".pay-type")).toHaveText("Наличные");

        const photoSection = card.locator(".work-photo-section");

        await expect(photoSection).toBeVisible();

        await expect(
            photoSection.getByRole("heading", {
                name: "Мои фотографии",
            })
        ).toBeVisible();

        await expect(
            photoSection.getByRole("heading", {
                name: "До работы",
            })
        ).toBeVisible();

        await expect(
            photoSection.getByRole("heading", {
                name: "После работы",
            })
        ).toBeVisible();
    });

    test("показывает бейдж непрочитанного сообщения", async ({ page }) => {
        await expect(page.getByRole("button", { name: /Сообщение/i })).toBeVisible();
        await expect(page.locator(".notification-badge-ios")).toHaveText("1");
    });

    test("клик по сообщению ведёт в чат обычного заказа", async ({ page }) => {
        await page.getByRole("button", { name: /Сообщение/i }).click();

        await expect(page).toHaveURL(/\/messages\/regular\/101$/);
    });

    test("открывает модальное окно с изображением заказа", async ({ page }) => {
        await page.locator(".image-stack").click();

        await expect(page.locator(".custom-modal-image")).toBeVisible();

        await expect(page.locator(".custom-modal-image")).toHaveAttribute(
            "src",
            /test-image\.jpg/
        );
    });

    test("переключает изображения в модальном окне", async ({ page }) => {
        await page.locator(".image-stack").click();

        await expect(page.locator(".custom-modal-image")).toHaveAttribute(
            "src",
            /test-image\.jpg/
        );

        await page.getByRole("button", { name: "▶" }).click();

        await expect(page.locator(".custom-modal-image")).toHaveAttribute(
            "src",
            /test-image-2\.jpg/
        );

        await page.getByRole("button", { name: "◀" }).click();

        await expect(page.locator(".custom-modal-image")).toHaveAttribute(
            "src",
            /test-image\.jpg/
        );
    });

    test("закрывает модальное окно изображения", async ({ page }) => {
        await page.locator(".image-stack").click();

        await expect(page.locator(".custom-modal-image")).toBeVisible();

        await page.locator(".custom-close-button").click();

        await expect(page.locator(".custom-modal-image")).not.toBeVisible();
    });

    test(
        "кнопка Позвонить получает телефон и нормализует номер",
        async ({ page }) => {
            /*
             * Приложение открывает системную
             * ссылку tel:, а не пишет телефон
             * в console.log.
             */
            const phoneRequestPromise =
                page.waitForEvent(
                    "request",
                    (request) =>
                        request.url().startsWith("tel:"),
                    {
                        timeout: 10000,
                    }
                );

            await page.getByRole(
                "button",
                {
                    name: /Позвонить/i,
                }
            ).click();

            const request =
                await phoneRequestPromise;

            expect(
                decodeURIComponent(request.url())
            ).toBe("tel:+79780032978");
        }
    );

    test("кнопка Маршрут открывает Яндекс.Навигатор", async ({ page }) => {
        await page.evaluate(() => {
            window.__openedUrl = null;

            window.confirm = () => true;

            window.open = (url) => {
                window.__openedUrl = String(url);

                return {
                    closed: false,
                    focus() {},
                };
            };
        });

        const routeButton = page.getByRole("button", {
            name: /^Маршрут$/,
        });

        await expect(routeButton).toBeVisible();
        await expect(routeButton).toBeEnabled();

        await routeButton.click();

        await expect
            .poll(
                () => page.evaluate(() => window.__openedUrl),
                {
                    timeout: 10000,
                }
            )
            .toContain("https://yandex.ru/navi/");

        const openedUrl = await page.evaluate(
            () => window.__openedUrl
        );

        expect(openedUrl).toContain("55.7558");
        expect(openedUrl).toContain("37.6176");
    });

    test("открывает модалку спора", async ({ page }) => {
        await page.getByRole("button", { name: /Открыть спор/i }).click();

        const modal = disputeModal(page);

        await expect(modal.getByRole("heading", { name: "Открыть спор" })).toBeVisible();
        await expect(modal.getByText("Заказ №101")).toBeVisible();

        await expect(
            modal.getByPlaceholder("Например: работа выполнена не полностью")
        ).toBeVisible();

        await expect(
            modal.getByPlaceholder("Опишите подробно, в чём проблема, что произошло, что именно не устраивает")
        ).toBeVisible();
    });

    test("закрывает модалку спора", async ({ page }) => {
        await page.getByRole("button", { name: /Открыть спор/i }).click();

        const modal = disputeModal(page);

        await expect(modal.getByRole("heading", { name: "Открыть спор" })).toBeVisible();

        await modal.getByRole("button", { name: /Отмена/i }).click({ force: true });

        await expect(modal.getByRole("heading", { name: "Открыть спор" })).not.toBeVisible();
    });

    test("не отправляет спор без краткой причины", async ({ page }) => {
        let disputeOpenCalled = false;

        await page.route("**/api/disputes/open", async (route) => {
            disputeOpenCalled = true;

            await route.fulfill({
                status: 400,
                contentType: "application/json",
                body: JSON.stringify({
                    message: "Не должно было отправиться",
                }),
            });
        });

        await page.getByRole("button", { name: /Открыть спор/i }).click();

        const modal = disputeModal(page);

        await expect(modal.getByRole("heading", { name: "Открыть спор" })).toBeVisible();

        page.once("dialog", async (dialog) => {
            await dialog.accept();
        });

        await clickDisputeSubmit(page);

        await page.waitForTimeout(500);

        expect(disputeOpenCalled).toBe(false);

        await expect(modal.getByRole("heading", { name: "Открыть спор" })).toBeVisible();
    });

    test("отправляет спор", async ({ page }) => {
        let disputeRequestBody = null;
        let disputeContentType = null;

        const alertMessages = [];

        await page.route(
            "**/api/disputes/open",
            async (route) => {
                const request = route.request();

                expect(request.method()).toBe("POST");

                disputeRequestBody =
                    request.postData();

                disputeContentType =
                    request.headers()["content-type"];

                await route.fulfill({
                    status: 200,
                    json: {
                        dispute: {
                            id: 555,
                            orderId: 101,
                            orderType: "regular",
                            status: "open",
                            reasonCode: "poor_quality",
                            reason:
                                "Работа выполнена плохо",
                            description:
                                "Исполнитель повредил груз",
                        },
                    },
                });
            }
        );

        page.on("dialog", async (dialog) => {
            if (dialog.type() === "alert") {
                alertMessages.push(
                    dialog.message()
                );
            }

            await dialog.accept();
        });

        await page.getByRole(
            "button",
            {
                name: /Открыть спор/i,
            }
        ).click();

        const modal = disputeModal(page);

        await expect(modal).toBeVisible();

        // Выбираем конкретную причину.
        await modal
            .locator("select.dispute-input")
            .selectOption("poor_quality");

        await modal
            .getByPlaceholder(
                "Например: работа выполнена не полностью"
            )
            .fill("Работа выполнена плохо");

        await modal
            .getByPlaceholder(
                "Опишите подробно, в чём проблема, что произошло, что именно не устраивает"
            )
            .fill("Исполнитель повредил груз");

        await clickDisputeSubmit(page);

        // Ожидаем фактическую отправку формы.
        await expect
            .poll(() => disputeRequestBody)
            .not.toBeNull();

        expect(disputeContentType).toContain(
            "multipart/form-data"
        );

        /*
         * Проверяем фактические поля FormData.
         * Границу multipart не фиксируем:
         * браузер формирует её самостоятельно.
         */
        expect(disputeRequestBody).toMatch(
            /name="orderId"\r?\n\r?\n101/
        );

        expect(disputeRequestBody).toMatch(
            /name="orderType"\r?\n\r?\nregular/
        );

        expect(disputeRequestBody).toMatch(
            /name="reasonCode"\r?\n\r?\npoor_quality/
        );

        expect(disputeRequestBody).toMatch(
            /name="reason"\r?\n\r?\nРабота выполнена плохо/
        );

        expect(disputeRequestBody).toMatch(
            /name="description"\r?\n\r?\nИсполнитель повредил груз/
        );

        await expect
            .poll(() =>
                alertMessages.some((message) =>
                    message.includes(
                        "Обращение успешно отправлено"
                    )
                )
            )
            .toBe(true);

        await expect(
            page.locator(".dispute-modal-content")
        ).not.toBeVisible();

        // Проверяем исправленное отображение спора.
        await expect(
            page.locator(".dispute-status-badge")
        ).toContainText("Спор: open");
    });

    test(
        "завершает заказ после подтверждения",
        async ({ page }) => {
            let completionConfirmed = false;
            let completeRequestBody = null;

            const alertMessages = [];

            /*
             * До подтверждения исполнитель
             * ещё не отметил завершение.
             *
             * После подтверждения заказ
             * ожидает вторую сторону.
             */
            await page.route(
                "**/api/orders/active-orders",
                async (route) => {
                    await route.fulfill({
                        status: 200,
                        json: {
                            orders: [
                                {
                                    ...regularOrder,

                                    completedBy:
                                        completionConfirmed
                                            ? [1]
                                            : [],

                                    status: "active",
                                },
                            ],

                            notifications: [],
                        },
                    });
                }
            );

            await page.route(
                "**/api/orders/complete/101",
                async (route) => {
                    const request =
                        route.request();

                    expect(request.method()).toBe(
                        "POST"
                    );

                    completeRequestBody =
                        request.postDataJSON();

                    completionConfirmed = true;

                    await route.fulfill({
                        status: 200,
                        json: {
                            ...regularOrder,

                            completedBy: [1],

                            status: "active",

                            completionPhase:
                                "awaiting_other",
                        },
                    });
                }
            );

            page.on("dialog", async (dialog) => {
                if (dialog.type() === "alert") {
                    alertMessages.push(
                        dialog.message()
                    );
                }

                await dialog.accept();
            });

            // Открываем форму завершения.
            await page.getByRole(
                "button",
                {
                    name: /^Завершить$/,
                }
            ).click();

            const modal = page.locator(
                ".completion-work-modal__content"
            );

            await expect(modal).toBeVisible();

            await expect(
                modal.getByRole("heading", {
                    name: "Завершить заказ?",
                })
            ).toBeVisible();

            // Исполнитель получил оплату.
            await modal.getByLabel(
                "Да, полностью"
            ).check();

            await expect(
                modal.getByLabel(
                    "Да, полностью"
                )
            ).toBeChecked();

            // Подтверждаем завершение.
            await modal.getByRole(
                "button",
                {
                    name: "Подтвердить завершение",
                }
            ).click();

            // Проверяем отправку.
            await expect
                .poll(() => completeRequestBody)
                .not.toBeNull();

            expect(completeRequestBody).toEqual({
                completion: {
                    workConfirmed: true,

                    qualityDecision: null,
                    remarks: null,

                    payoutAuthorized: false,

                    cashStatus: "full",
                    cashAmountKopecks: null,
                },
            });

            // Исполнитель подтвердил завершение.
            await expect(
                page.getByText(
                    "Вы подтвердили завершение.",
                    {
                        exact: true,
                    }
                )
            ).toBeVisible();

            // Ожидаем второго участника.
            await expect(
                page.getByRole("button", {
                    name: /Ждём подтверждения/i,
                })
            ).toBeDisabled();

            await expect(
                page.getByRole("button", {
                    name: /Напомнить/i,
                })
            ).toBeVisible();

            await expect
                .poll(() =>
                    alertMessages.some((message) =>
                        message.includes(
                            "Ваше подтверждение сохранено"
                        )
                    )
                )
                .toBe(true);
        }
    );

    test("отправляет напоминание, если пользователь уже подтвердил завершение", async ({ page }) => {
        await page.route("**/api/orders/active-orders", async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    orders: [
                        {
                            ...regularOrder,
                            completedBy: [1],
                            status: "active",
                        },
                    ],
                    notifications: [],
                }),
            });
        });

        await page.route("**/api/orders/101/remind-complete", async (route) => {
            expect(route.request().method()).toBe("POST");

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                }),
            });
        });

        await page.reload();

        await expect(page.getByText("Вы подтвердили завершение.")).toBeVisible();

        const dialogPromise = page.waitForEvent("dialog");

        await page.getByRole("button", { name: /Напомнить/i }).click();

        const dialog = await dialogPromise;

        expect(dialog.message()).toContain("Напоминание отправлено");

        await dialog.accept();
    });

    test("загружает фото ДО от исполнителя", async ({ page }) => {
        await page.route("**/api/orders/101/executor-before-photos", async (route) => {
            expect(route.request().method()).toBe("POST");

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                }),
            });
        });

        page.on("dialog", async (dialog) => {
            await dialog.accept();
        });

        const fileInput = page.locator('input[type="file"]').first();

        await fileInput.setInputFiles({
            name: "photo.jpg",
            mimeType: "image/jpeg",
            buffer: Buffer.from("fake-image"),
        });

        await expect(
            page.getByText("Заказ №101", {
                exact: true,
            })
        ).toBeVisible();
    });

    test("переключает вкладку на созданные заказы", async ({ page }) => {
        await page.getByRole("button", { name: /Мои заказы выполняют/i }).click();

        await expect(page.getByText("Ваши заказы, которые сейчас выполняются")).toBeVisible();

        await expect(page.getByText("Нет активных заказов.")).toBeVisible();
    });

    test("если backend вернул ошибку, показывает сообщение об ошибке", async ({ page }) => {
        await page.route("**/api/orders/active-orders", async (route) => {
            await route.fulfill({
                status: 500,
                contentType: "application/json",
                body: JSON.stringify({
                    message: "Server error",
                }),
            });
        });

        await page.reload();

        await expect(page.getByText("Не удалось загрузить заказы.")).toBeVisible();
    });
});

// ============================================================
// CARGOCAMP — REGULAR RESERVATIONS E2E
// ============================================================

const reservedOrder = {
    ...regularOrder,

    id: 202,

    description: "Следующая перевозка",
    address: "Симферополь, улица Киевская, 10",

    status: "reserved",

    proposedSum: 1800,
    finalPriceKopecks: 180000,

    creatorId: 2,
    executorId: 1,

    reservationSourceOrderId: 101,
    reservationSourceCompleted: false,

    reservationAvailableAt:
        "2035-04-12T18:30:00.000Z",

    workStartedAt: null,
    completedBy: [],

    contractPath: null,

    images: [],
    executorBeforePhotos: [],
    executorAfterPhotos: [],
    customerBeforePhotos: [],
    customerAfterPhotos: [],
};

/*
 * Создаём полностью искусственное состояние
 * двух заказов.
 */
async function openReservationScenario(
    page,
    {
        busy = true,
        customerView = false,
        activationError = false,
    } = {}
) {
    await setFakeAuthToken(page);
    await setupFrontendMocks(page);

    const reservation = {
        ...reservedOrder,

        creatorId: customerView ? 1 : 2,
        executorId: customerView ? 2 : 1,

        reservationSourceCompleted: !busy,
    };

    const state = {
        orders: busy
            ? [
                regularOrder,
                reservation,
            ]
            : [reservation],

        activationCalls: 0,
        cancellationCalls: 0,
    };

    /*
     * GET активных и забронированных заказов.
     */
    await page.route(
        "**/api/orders/active-orders",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    orders: state.orders,
                    notifications: [],
                },
            });
        }
    );

    /*
     * Активация бронирования.
     */
    await page.route(
        "**/api/orders/202/activate-reservation",
        async (route) => {
            state.activationCalls++;

            if (activationError) {
                await route.fulfill({
                    status: 409,
                    json: {
                        message:
                            "Предыдущий заказ ещё не завершён",
                    },
                });

                return;
            }

            state.orders = [
                {
                    ...reservation,

                    status: "active",

                    reservationSourceCompleted: true,

                    workStartedAt:
                        "2035-04-12T18:30:00.000Z",
                },
            ];

            await route.fulfill({
                status: 200,
                json: {
                    success: true,
                    orderId: 202,
                    status: "active",
                },
            });
        }
    );

    /*
     * Отмена бронирования.
     */
    await page.route(
        "**/api/orders/202/cancel-reservation",
        async (route) => {
            state.cancellationCalls++;

            state.orders = state.orders.filter(
                (order) => order.id !== 202
            );

            await route.fulfill({
                status: 200,
                json: {
                    success: true,
                },
            });
        }
    );

    const view = customerView
        ? "created"
        : "performing";

    await page.goto(
        `${FRONT_URL}/active-orders?platform=web&view=${view}`,
        {
            waitUntil: "domcontentloaded",
        }
    );

    await expect(
        page.getByText("Активные заказы")
    ).toBeVisible();

    await expect(
        page.locator(".cc-reserved-order")
    ).toHaveCount(1);

    return state;
}

/*
 * Раскрываем карточку бронирования.
 */
async function expandReservation(page) {
    const card = page.locator(
        ".cc-reserved-order"
    );

    await card.locator("summary").click();

    await expect(
        card.locator(".cc-reserved-content")
    ).toBeVisible();

    return card;
}

// ============================================================
// TESTS
// ============================================================

test.describe(
    "ActiveOrdersPage — бронирование следующего заказа",
    () => {

        // ------------------------------------------------
        // 1. АКТИВНЫЙ + ЗАБРОНИРОВАННЫЙ
        // ------------------------------------------------

        test(
            "показывает активный и забронированный заказ",
            async ({ page }) => {
                await openReservationScenario(page, {
                    busy: true,
                });

                await expect(
                    page.locator(".cc-collapse-toggle")
                ).toContainText(
                    "Заказ №101 · В работе"
                );

                const card =
                    await expandReservation(page);

                await expect(card).toContainText(
                    "Заказ №202"
                );

                await expect(card).toContainText(
                    "Ожидает освобождения"
                );

                await expect(card).toContainText(
                    "Симферополь, улица Киевская, 10"
                );

                await expect(card).toContainText(
                    "1 800 ₽"
                );

                await expect(
                    card.getByRole("button", {
                        name: "Активировать заказ",
                    })
                ).toHaveCount(0);
            }
        );

        // ------------------------------------------------
        // 2. АКТИВАЦИЯ ПОСЛЕ ОСВОБОЖДЕНИЯ
        // ------------------------------------------------

        test(
            "активирует бронь после завершения предыдущего заказа",
            async ({ page }) => {
                const state =
                    await openReservationScenario(page, {
                        busy: false,
                    });

                const card =
                    await expandReservation(page);

                await expect(card).toContainText(
                    "Ожидает начала"
                );

                await expect(card).toContainText(
                    "Предыдущий заказ завершён"
                );

                page.on("dialog", async (dialog) => {
                    await dialog.accept();
                });

                await card.getByRole(
                    "button",
                    {
                        name: "Активировать заказ",
                    }
                ).click();

                await expect.poll(
                    () => state.activationCalls
                ).toBe(1);

                await expect(
                    page.locator(".cc-reserved-order")
                ).toHaveCount(0);

                await expect(
                    page.locator(".cc-collapse-toggle")
                ).toContainText(
                    "Заказ №202 · В работе"
                );
            }
        );

        // ------------------------------------------------
        // 3. ОТМЕНА АКТИВАЦИИ
        // ------------------------------------------------

        test(
            "не активирует бронь при отмене подтверждения",
            async ({ page }) => {
                const state =
                    await openReservationScenario(page, {
                        busy: false,
                    });

                const card =
                    await expandReservation(page);

                page.once(
                    "dialog",
                    async (dialog) => {
                        expect(dialog.type()).toBe(
                            "confirm"
                        );

                        await dialog.dismiss();
                    }
                );

                await card.getByRole(
                    "button",
                    {
                        name: "Активировать заказ",
                    }
                ).click();

                expect(
                    state.activationCalls
                ).toBe(0);

                await expect(card).toContainText(
                    "Ожидает начала"
                );
            }
        );

        // ------------------------------------------------
        // 4. ОТМЕНА БРОНИРОВАНИЯ
        // ------------------------------------------------

        test(
            "отменяет бронь и убирает карточку",
            async ({ page }) => {
                const state =
                    await openReservationScenario(page, {
                        busy: true,
                    });

                const card =
                    await expandReservation(page);

                page.on(
                    "dialog",
                    async (dialog) => {
                        await dialog.accept();
                    }
                );

                await card.getByRole(
                    "button",
                    {
                        name: "Отменить бронь",
                    }
                ).click();

                await expect.poll(
                    () => state.cancellationCalls
                ).toBe(1);

                await expect(
                    page.locator(".cc-reserved-order")
                ).toHaveCount(0);

                await expect(
                    page.locator(".cc-collapse-toggle")
                ).toContainText(
                    "Заказ №101 · В работе"
                );
            }
        );

        // ------------------------------------------------
        // 5. BACKEND ОТКЛОНЯЕТ АКТИВАЦИЮ
        // ------------------------------------------------

        test(
            "сохраняет бронь при отказе сервера в активации",
            async ({ page }) => {
                const state =
                    await openReservationScenario(page, {
                        busy: false,
                        activationError: true,
                    });

                const card =
                    await expandReservation(page);

                const messages = [];

                page.on(
                    "dialog",
                    async (dialog) => {
                        messages.push(
                            dialog.message()
                        );

                        await dialog.accept();
                    }
                );

                await card.getByRole(
                    "button",
                    {
                        name: "Активировать заказ",
                    }
                ).click();

                await expect.poll(
                    () => state.activationCalls
                ).toBe(1);

                await expect.poll(
                    () =>
                        messages.some((message) =>
                            message.includes(
                                "Предыдущий заказ ещё не завершён"
                            )
                        )
                ).toBe(true);

                await expect(
                    page.locator(".cc-reserved-order")
                ).toHaveCount(1);

                await expect(
                    page.locator(".cc-collapse-toggle")
                ).toHaveCount(0);
            }
        );

        // ------------------------------------------------
        // 6. ЗАКАЗЧИК НЕ МОЖЕТ АКТИВИРОВАТЬ
        // ------------------------------------------------

        test(
            "заказчик видит бронь, но не может её активировать",
            async ({ page }) => {
                await openReservationScenario(page, {
                    busy: false,
                    customerView: true,
                });

                const card =
                    await expandReservation(page);

                await expect(card).toContainText(
                    "Заказ №202"
                );

                await expect(
                    card.getByRole("button", {
                        name: "Активировать заказ",
                    })
                ).toHaveCount(0);

                await expect(
                    card.getByRole("button", {
                        name: "Отменить бронь",
                    })
                ).toBeVisible();
            }
        );
    }
);