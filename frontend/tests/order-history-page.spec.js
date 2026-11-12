import { test, expect } from "./fixtures/safeTest";

import { mockOrderAssets } from "./utils/mockOrderAssets";

import { createMockJwt } from "./utils/mockAuthSession";

const FRONT_URL = "http://localhost:3000";

const testUser = {
    id: 1,
    username: "creator",
    role: "customer",
};

const longDescription =
    "Нужно было аккуратно перевезти мебель, разобрать шкаф, вынести коробки, доставить всё по новому адресу и поднять на этаж. Работа выполнена полностью, без повреждений, в согласованные сроки.";

const completedOrders = [
    {
        id: 123,
        category: {
            name: "Грузоперевозка",
        },
        description: longDescription,
        address: "Симферополь, улица Пушкина, 1",
        proposedSum: 3000,
        creatorId: 1,
        executorId: 10,
        status: "completed",
        completedAt: "2026-07-01T12:00:00.000Z",
        contractPath: "uploads/contracts/contract_123.pdf",
    },
    {
        id: 124,
        type: "Ремонт",
        description: "Починить розетку",
        address: "Симферополь, Киевская 10",
        proposedSum: 1500,
        creatorId: 1,
        executorId: 11,
        status: "completed",
        completedAt: "2026-07-02T12:00:00.000Z",
        contractPath: null,
    },
    {
        id: 125,
        type: "Курьер",
        description: "Доставить документы",
        address: "Симферополь, центр",
        proposedSum: 700,
        creatorId: 1,
        executorId: 12,
        status: "completed",
        completedAt: "2026-07-03T12:00:00.000Z",
        contractPath: "contracts/contract_125.pdf",
    },
];

async function setFakeAuth(page, user = testUser) {

    await mockOrderAssets(page);

    const fakeToken = createMockJwt(user);

    await page.addInitScript(({ token, user }) => {
        localStorage.setItem("authToken", token);
        localStorage.setItem("user", JSON.stringify(user));
        localStorage.setItem("currentUser", JSON.stringify(user));
        localStorage.setItem("userData", JSON.stringify(user));
    }, {
        token: fakeToken,
        user,
    });
}

async function setupHistoryMocks(page, options = {}) {
    const {
        userId = 1,
        orders = completedOrders,
        ordersStatus = 200,
        ordersBody = orders,
        reviews = [],
        reviewsStatus = 200,
        reviewPostStatus = 200,
        reviewPostBody = {
            success: true,
        },
        expressStatus = 200,
        expressOrders = [],
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

    // Профиль тестового пользователя.
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

// Проверка задолженности.
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

// История экспресс-заказов.
    await page.route(
        "**/api/express/express-orders/me**",
        async (route) => {
            const request = route.request();
            const url = new URL(request.url());

            expect(request.method()).toBe("GET");
            expect(url.pathname).toBe(
                "/api/express/express-orders/me"
            );
            expect(url.searchParams.get("mode")).toBe("history");
            await route.fulfill({
                status: expressStatus,
                json: expressStatus === 200
                    ? {
                        success: true,
                        orders: expressOrders,
                    }
                    : {
                        message: "Ошибка истории экспресс-заказов",
                    },
            });
        }
    );

// Договоры и акты завершённых заказов.
    await page.route(
        "**/api/contracts/assignments/summary",
        async (route) => {
            expect(
                route.request().method()
            ).toBe("POST");

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

    await page.route(`**/api/orders/completed/${userId}`, async (route) => {
        await route.fulfill({
            status: ordersStatus,
            contentType: "application/json",
            body: JSON.stringify(ordersBody),
        });
    });

    await page.route("**/api/auth/reviews/my", async (route) => {
        await route.fulfill({
            status: reviewsStatus,
            contentType: "application/json",
            body: JSON.stringify({
                reviews,
            }),
        });
    });

    await page.route("**/api/auth/review", async (route) => {
        await route.fulfill({
            status: reviewPostStatus,
            contentType: "application/json",
            body: JSON.stringify(reviewPostBody),
        });
    });
}

async function openHistoryPage(page, options = {}) {
    await setFakeAuth(page);
    await setupHistoryMocks(page, options);

    const userId = options.userId || 1;
    const query = options.query || "platform=web";

    await page.goto(`${FRONT_URL}/orders-history/${userId}?${query}`, {

        waitUntil: "domcontentloaded",

        timeout: 30000,

    });

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "order-history-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("OrderHistoryPage редиректит на /login. Fake JWT не применился.");
    }

    await expect(page.getByText("Загрузка истории заказов…")).not.toBeVisible({
        timeout: 15000,
    });
}

function historyCard(page, text) {
    return page.locator(".oh-card").filter({
        hasText: text,
    });
}

async function expectLegacyPdfDownload(page, orderId) {
    const pdf = Buffer.from(
        "%PDF-1.4\n" +
        "1 0 obj\n<<>>\nendobj\n" +
        "%%EOF\n"
    );

    await page.route(
        `**/api/orders/${orderId}/contract-file`,
        async (route) => {
            expect(
                route.request().method()
            ).toBe("GET");

            await route.fulfill({
                status: 200,
                contentType: "application/pdf",
                body: pdf,
            });
        }
    );

    const card = historyCard(
        page,
        `Заказ №${orderId}`
    );

    const downloadPromise =
        page.waitForEvent("download");

    await card.getByRole(
        "button",
        {
            name: "Скачать договор (PDF)",
        }
    ).click();

    const download = await downloadPromise;

    expect(
        download.suggestedFilename()
    ).toBe(`contract_${orderId}.pdf`);
}

test.describe("OrderHistoryPage", () => {
    test.beforeEach(async ({ page }) => {
        await openHistoryPage(page);
    });

    test("отображает страницу истории заказов", async ({ page }) => {
        await expect(page.locator(".oh-page")).toBeVisible();

        await expect(page.locator(".oh-title")).toHaveText("История заказов");
        await expect(page.locator(".oh-subtitle")).toHaveText(
            "Здесь отображаются завершённые обычные и экспресс-заказы"
        );

        await expect(page.locator(".oh-count")).toHaveText("3");
    });

    test("ставит web-класс при platform=web", async ({ page }) => {
        await openHistoryPage(page, {
            query: "platform=web",
        });

        await expect(page.locator(".oh-page")).toHaveClass(/oh-page--web/);
        await expect(page.locator(".order-history-page")).toHaveClass(/order-history-page--web/);
    });

    test("ставит ios-класс при platform=ios", async ({ page }) => {
        await openHistoryPage(page, {
            query: "platform=ios",
        });

        await expect(page.locator(".oh-page")).toHaveClass(/oh-page--ios/);
        await expect(page.locator(".order-history-page")).toHaveClass(/order-history-page--ios/);
    });

    test("ставит android-класс при platform=android", async ({ page }) => {
        await openHistoryPage(page, {
            query: "platform=android",
        });

        await expect(page.locator(".oh-page")).toHaveClass(/oh-page--android/);
        await expect(page.locator(".order-history-page")).toHaveClass(/order-history-page--android/);
    });

    test("показывает список завершённых заказов", async ({ page }) => {
        await expect(page.getByText("Заказ №123")).toBeVisible();
        await expect(page.getByText("Заказ №124")).toBeVisible();
        await expect(page.getByText("Заказ №125")).toBeVisible();

        await expect(page.locator(".oh-card .oh-pill--done")).toHaveCount(3);
    });

    test("показывает заказы в обратном порядке", async ({ page }) => {
        const cards = page.locator(".oh-card");

        await expect(cards.first()).toContainText("Заказ №125");
        await expect(cards.nth(1)).toContainText("Заказ №124");
        await expect(cards.nth(2)).toContainText("Заказ №123");
    });

    test("показывает данные заказа", async ({ page }) => {
        const card = historyCard(page, "Заказ №123");

        await expect(card).toContainText("Грузоперевозка");
        await expect(card).toContainText("Симферополь, улица Пушкина, 1");
        await expect(card).toContainText("3000 ₽");
        await expect(card).toContainText("ID заказчика");
        await expect(card).toContainText("1");
        await expect(card).toContainText("ID исполнителя");
        await expect(card).toContainText("10");
    });

    test("показывает дату Не указана, если completedAt отсутствует", async ({ page }) => {
        await openHistoryPage(page, {
            orders: [
                {
                    id: 200,
                    type: "Без даты",
                    description: "Описание",
                    address: "Адрес",
                    proposedSum: 1000,
                    creatorId: 1,
                    executorId: 2,
                    status: "completed",
                    completedAt: null,
                },
            ],
        });

        const card = historyCard(page, "Заказ №200");

        await expect(card).toContainText("Дата: Не указана");
    });

    test("разворачивает и сворачивает длинное описание", async ({ page }) => {
        const card = historyCard(page, "Заказ №123");

        const desc = card.locator(".oh-desc");

        await expect(card.getByRole("button", { name: "Подробнее" })).toBeVisible();
        await expect(desc).toHaveClass(/collapsed/);

        await card.getByRole("button", { name: "Подробнее" }).click();

        await expect(desc).toHaveClass(/expanded/);
        await expect(card.getByRole("button", { name: "Свернуть" })).toBeVisible();

        await card.getByRole("button", { name: "Свернуть" }).click();

        await expect(desc).toHaveClass(/collapsed/);
    });

    test("для короткого описания не показывает кнопку Подробнее", async ({ page }) => {
        const card = historyCard(page, "Заказ №124");

        await expect(card.getByRole("button", { name: "Подробнее" })).not.toBeVisible();
        await expect(card).toContainText("Починить розетку");
    });

    test(
        "скачивает PDF договора заказа 123",
        async ({ page }) => {
            await expectLegacyPdfDownload(page, 123);
        }
    );

    test(
        "скачивает PDF договора независимо от старого contractPath",
        async ({ page }) => {
            await expectLegacyPdfDownload(page, 125);
        }
    );

    test("если договора нет, ссылку не показывает", async ({ page }) => {
        const card = historyCard(page, "Заказ №124");

        await expect(
            card.getByRole("button", {
                name: /Скачать договор/i,
            })
        ).toHaveCount(0);
    });

    test("показывает кнопку оставить отзыв, если отзыв ещё не сохранён", async ({ page }) => {
        const card = historyCard(page, "Заказ №123");

        await expect(card.getByRole("button", { name: /Оставить отзыв/i })).toBeVisible();
    });

    test("показывает Отзыв сохранён, если заказ уже есть в моих отзывах", async ({ page }) => {
        await openHistoryPage(page, {
            reviews: [
                {
                    id: 1,
                    orderId: 123,
                    rating: 5,
                    text: "Отлично",
                },
            ],
        });

        const card = historyCard(page, "Заказ №123");

        await expect(card.getByText("Отзыв сохранён")).toBeVisible();
        await expect(card.getByRole("button", { name: /Оставить отзыв/i })).not.toBeVisible();
    });

    test("не даёт оставить отзыв, если у заказа нет executorId", async ({ page }) => {
        await openHistoryPage(page, {
            orders: [
                {
                    id: 300,
                    type: "Без исполнителя",
                    description: "Описание",
                    address: "Адрес",
                    proposedSum: 1000,
                    creatorId: 1,
                    executorId: null,
                    status: "completed",
                    completedAt: "2026-07-01T12:00:00.000Z",
                },
            ],
        });

        const card = historyCard(page, "Заказ №300");

        await expect(card.getByText("Отзыв сохранён")).toBeVisible();
        await expect(card.getByRole("button", { name: /Оставить отзыв/i })).not.toBeVisible();
    });

    test("открывает и закрывает модалку отзыва", async ({ page }) => {
        const card = historyCard(page, "Заказ №123");

        await card.getByRole("button", { name: /Оставить отзыв/i }).click();

        await expect(page.locator(".oh-modal-overlay")).toBeVisible();
        await expect(page.locator(".oh-modal-title")).toHaveText("Отзыв по заказу №123");

        await page.getByRole("button", { name: "Закрыть" }).click();

        await expect(page.locator(".oh-modal-overlay")).not.toBeVisible();
    });

    test("выбирает оценку в модалке", async ({ page }) => {
        const card = historyCard(page, "Заказ №123");

        await card.getByRole("button", { name: /Оставить отзыв/i }).click();

        await page.getByLabel("Поставить 5").click();

        await expect(page.getByLabel("Поставить 5")).toHaveClass(/selected/);
        await expect(page.getByRole("button", { name: "Отправить отзыв" })).toBeEnabled();
    });

    test("очищает текст отзыва", async ({ page }) => {
        const card = historyCard(page, "Заказ №123");

        await card.getByRole("button", { name: /Оставить отзыв/i }).click();

        const textarea = page.getByPlaceholder("Комментарий (необязательно)");

        await textarea.fill("Хороший исполнитель");
        await expect(textarea).toHaveValue("Хороший исполнитель");

        await page.getByRole("button", { name: "Очистить" }).click();

        await expect(textarea).toHaveValue("");
    });

    test("кнопка отправки отзыва отключена без оценки", async ({ page }) => {
        const card = historyCard(page, "Заказ №123");

        await card.getByRole("button", { name: /Оставить отзыв/i }).click();

        await expect(page.getByRole("button", { name: "Отправить отзыв" })).toBeDisabled();
    });

    test("успешно отправляет отзыв", async ({ page }) => {
        let reviewRequestBody = null;

        await page.route("**/api/auth/review", async (route) => {
            reviewRequestBody = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                }),
            });
        });

        page.once("dialog", async (dialog) => {
            expect(dialog.message()).toBe("Отзыв сохранён");
            await dialog.accept();
        });

        const card = historyCard(page, "Заказ №123");

        await card.getByRole("button", { name: /Оставить отзыв/i }).click();

        await page.getByLabel("Поставить 5").click();
        await page.getByPlaceholder("Комментарий (необязательно)").fill("Отличный исполнитель");

        await page.getByRole("button", { name: "Отправить отзыв" }).click();

        await expect
            .poll(() => reviewRequestBody, {
                timeout: 10000,
            })
            .toEqual({
                orderId: 123,
                rating: 5,
                text: "Отличный исполнитель",
                orderType: "regular",
            });

        await expect(page.locator(".oh-modal-overlay")).not.toBeVisible();

        const updatedCard = historyCard(page, "Заказ №123");

        await expect(updatedCard.getByText("Отзыв сохранён")).toBeVisible();
    });

    test("показывает alert при ошибке отправки отзыва", async ({ page }) => {
        await page.route("**/api/auth/review", async (route) => {
            await route.fulfill({
                status: 400,
                contentType: "application/json",
                body: JSON.stringify({
                    message: "Отзыв уже существует",
                }),
            });
        });

        let alertText = "";

        page.once("dialog", async (dialog) => {
            alertText = dialog.message();
            await dialog.accept();
        });

        const card = historyCard(page, "Заказ №123");

        await card.getByRole("button", { name: /Оставить отзыв/i }).click();

        await page.getByLabel("Поставить 4").click();
        await page.getByPlaceholder("Комментарий (необязательно)").fill("Текст");

        await page.getByRole("button", { name: "Отправить отзыв" }).click();

        await expect
            .poll(() => alertText, {
                timeout: 10000,
            })
            .toBe("Отзыв уже существует");

        await expect(page.locator(".oh-modal-overlay")).toBeVisible();
    });

    test("показывает пустое состояние, если заказов нет", async ({ page }) => {
        await openHistoryPage(page, {
            orders: [],
        });

        await expect(page.locator(".oh-empty-title")).toHaveText("Пока пусто");
        await expect(page.locator(".oh-empty-sub")).toHaveText(
            "Завершённых обычных и экспресс-заказов ещё нет."
        );
        await expect(page.locator(".oh-count")).toHaveText("0");
    });

    test("показывает ошибку при сбое загрузки заказов", async ({ page }) => {
        await openHistoryPage(page, {
            ordersStatus: 500,
            expressStatus: 500,
            ordersBody: {
                message: "Ошибка сервера",
            },
        });

        await expect(page.locator(".oh-state--error")).toHaveText(
            "Ошибка: Ошибка сервера"
        );
    });

    test("если отзывы не загрузились, история всё равно отображается", async ({ page }) => {
        await openHistoryPage(page, {
            reviewsStatus: 500,
        });

        await expect(page.locator(".oh-title")).toHaveText("История заказов");
        await expect(page.getByText("Заказ №123")).toBeVisible();
    });

    test("pull-to-refresh повторно загружает историю и вызывает done", async ({ page }) => {
        let completedCalls = 0;

        await setFakeAuth(page);

        await setupHistoryMocks(page);

        await page.route("**/api/orders/completed/1", async (route) => {
            completedCalls += 1;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(completedOrders),
            });
        });

        await page.route("**/api/auth/reviews/my", async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    reviews: [],
                }),
            });
        });

        await page.route("**/api/auth/review", async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    success: true,
                }),
            });
        });

        await page.goto(`${FRONT_URL}/orders-history/1?platform=web`, {

            waitUntil: "domcontentloaded",

            timeout: 30000,

        });

        await expect(page.locator(".oh-title")).toHaveText("История заказов", {
            timeout: 15000,
        });

        await expect
            .poll(() => completedCalls, {
                timeout: 10000,
            })
            .toBeGreaterThanOrEqual(1);

        await page.evaluate(() => {
            window.__pullDone = false;

            window.dispatchEvent(
                new CustomEvent("appPullToRefresh", {
                    detail: {
                        done: () => {
                            window.__pullDone = true;
                        },
                    },
                })
            );
        });

        await expect
            .poll(() => completedCalls, {
                timeout: 10000,
            })
            .toBeGreaterThanOrEqual(2);

        const doneCalled = await page.evaluate(() => window.__pullDone === true);

        expect(doneCalled).toBe(true);
    });

    test(
        "исторический акт доступен для PDF и ПЭП без повторной приёмки",
        async ({ page }) => {
            const legacyRequests = [];

            page.on("request", (request) => {
                const pathname = new URL(
                    request.url()
                ).pathname;

                if (
                    /\/api\/contracts\/acts\/601\/(acceptance|remediation)(\/|$)/
                        .test(pathname)
                ) {
                    legacyRequests.push(pathname);
                }
            });

            const act = {
                id: 601,
                orderId: 123,
                parentContractId: 501,
                type: "verified_completion_act",
                version: 1,
                status: "draft",
                documentNumber: "CC-ACT-123-v1",
                documentHash: "a".repeat(64),
                createdAt: "2026-11-09T10:00:00.000Z",
                fullySignedAt: null,
            };

            await page.route(
                "**/api/contracts/assignments/summary",
                async (route) => {
                    expect(
                        route.request().method()
                    ).toBe("POST");

                    await route.fulfill({
                        status: 200,
                        json: {
                            success: true,
                            assignments: [],
                            acts: [act],
                        },
                    });
                }
            );

            await page.reload();

            const card = historyCard(
                page,
                "Заказ №123"
            ).locator(".cc-completion-act");

            await expect(card).toBeVisible();

            await expect(card).toContainText(
                "CC-ACT-123-v1"
            );

            await expect(
                card.locator(".cc-va-status")
            ).toHaveText("Проект");

            await expect(
                card.getByRole("button", {
                    name: /Скачать акт/,
                })
            ).toBeVisible();

            await expect(
                card.locator(".cc-signing-toggle")
            ).toBeVisible();

            // Старых форм больше нет.
            await expect(
                card.locator(
                    ".cc-act-acceptance, .cc-remediation"
                )
            ).toHaveCount(0);

            // Их API также не запрашиваются.
            expect(legacyRequests).toEqual([]);
        }
    );
});

// ============================================================
// ЭТАП 10 — ОБЩАЯ ИСТОРИЯ ОБЫЧНЫХ И ЭКСПРЕСС-ЗАКАЗОВ
// ============================================================

const completedTaxiOrder = {
    id: 123,
    type: "taxi",
    status: "completed",
    creatorId: 1,
    executorId: 20,
    totalPrice: 900,
    paymentType: "cash",
    fromAddress: "Симферополь, вокзал",
    toAddress: "Симферополь, центр",
    completedAt: "2026-07-04T12:00:00.000Z",
};

test.describe("OrderHistoryPage — итоговые сценарии", () => {

    test(
        "объединяет обычные и экспресс-заказы в правильном порядке",
        async ({ page }) => {
            await openHistoryPage(page, {
                expressOrders: [
                    completedTaxiOrder,
                    {
                        ...completedTaxiOrder,
                        id: 205,
                        status: "cancelled",
                    },
                ],
            });

            const cards = page.locator(".oh-card");

            await expect(cards).toHaveCount(4);
            await expect(page.locator(".oh-count")).toHaveText("4");

            await expect(cards.first()).toContainText(
                "Экспресс-заказ №123"
            );

            await expect(cards.nth(1)).toContainText(
                "Заказ №125"
            );

            await expect(
                page.locator(".oh-history-summary__item").first()
            ).toContainText("3");

            await expect(
                page.locator(".oh-history-summary__item--express")
            ).toContainText("1");

            const taxi = page.locator(".oh-card--express");

            await expect(taxi).toContainText("Такси");
            await expect(taxi).toContainText("900 ₽");
            await expect(taxi).toContainText("Симферополь, вокзал");
            await expect(taxi).toContainText("Симферополь, центр");
        }
    );

    test(
        "показывает экспресс-историю при ошибке загрузки обычных заказов",
        async ({ page }) => {
            await openHistoryPage(page, {
                ordersStatus: 500,
                ordersBody: {
                    message: "Обычная история недоступна",
                },
                expressOrders: [completedTaxiOrder],
            });

            await expect(
                page.locator(".oh-state--error")
            ).toHaveCount(0);

            await expect(
                page.locator(".oh-card--express")
            ).toHaveCount(1);

            await expect(
                page.locator(".oh-count")
            ).toHaveText("1");
        }
    );

    test(
        "экспресс и обычный заказ с одинаковым ID не смешиваются",
        async ({ page }) => {
            await openHistoryPage(page, {
                expressOrders: [completedTaxiOrder],
            });

            const regular = page.locator(".oh-card--regular")
                .filter({ hasText: "Заказ №123" });

            const express = page.locator(".oh-card--express")
                .filter({ hasText: "Экспресс-заказ №123" });

            await expect(regular).toHaveCount(1);
            await expect(express).toHaveCount(1);

            // Отзывы через текущую форму поддерживаются
            // только для обычных заказов.
            await expect(
                regular.getByRole("button", {
                    name: /Оставить отзыв/i,
                })
            ).toBeVisible();

            await expect(
                express.getByRole("button", {
                    name: /Оставить отзыв/i,
                })
            ).toHaveCount(0);
        }
    );
});