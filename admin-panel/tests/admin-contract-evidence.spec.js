import {
    test,
    expect,
} from "./fixtures/safeTest";

import {
    setAdminAuth,
} from "./utils/adminTestAuth";

import {
    readFile,
} from "node:fs/promises";

const HASH_1 = "a".repeat(64);
const HASH_2 = "b".repeat(64);

const ORDER = {
    id: 777,
    creatorId: 1201,
    executorId: 2202,
    status: "completed",
};

const DOCUMENTS = [
    {
        id: 401,
        orderId: 777,
        parentContractId: null,
        type: "verified_assignment",
        version: 1,
        status: "fully_signed",
        documentNumber: "CC-777-1",
        documentHash: HASH_1,
        createdAt: "2026-11-01T10:00:00.000Z",
    },
    {
        id: 402,
        orderId: 777,
        parentContractId: null,
        type: "verified_completion_act",
        version: 2,
        status: "fully_signed",
        documentNumber: "CC-777-ACT-2",
        documentHash: HASH_2,
        createdAt: "2026-11-02T10:00:00.000Z",
    },
    {
        id: 403,
        orderId: 777,
        parentContractId: null,
        type: "verified_assignment",
        version: 3,
        status: "draft",
        documentNumber: "CC-777-3",
        documentHash: null,
        createdAt: "2026-11-03T10:00:00.000Z",
    },
];

function makeEvidence(id) {
    const document = DOCUMENTS.find(
        (item) => item.id === id
    );

    return {
        schemaVersion: "1.0",
        reportType: "cargocamp_contract_evidence",
        generatedAt: "2026-11-06T10:00:00.000Z",
        legalQualification: "technical_evidence_report",

        order: ORDER,

        document: {
            id: String(document.id),
            type: document.type,
            version: document.version,
            status: document.status,
            documentNumber: document.documentNumber,
            sha256: document.documentHash,
        },

        integrity: {
            pdfPresent: true,
            hashMatches: true,
            expectedSha256: document.documentHash,
            actualSha256: document.documentHash,
        },

        signatures: [],
        events: [],
        warnings: [],
    };
}

async function setupMocks(page, options = {}) {
    const {
        listStatus = 200,
        reportStatus = 200,
        reportErrorFormat = "json",
        documents = DOCUMENTS,
    } = options;

    const state = {
        searches: [],
        reports: [],
    };

    // Два запроса родительской страницы Identity.
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

    await page.route(
        "**/api/admin/identity/verified**",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    success: true,
                    users: [],
                    total: 0,
                },
            });
        }
    );

    // Список документов заказа.
    await page.route(
        "**/api/admin/identity/orders/*/contracts",
        async (route) => {
            const url = new URL(route.request().url());

            const match = url.pathname.match(
                /\/orders\/(\d+)\/contracts$/
            );

            const orderId = match?.[1];

            state.searches.push({
                method: route.request().method(),
                orderId,
            });

            if (listStatus !== 200) {
                await route.fulfill({
                    status: listStatus,
                    json: {
                        success: false,
                        message:
                            "Не удалось загрузить документы заказа",
                    },
                });

                return;
            }

            if (orderId === "888") {
                await route.fulfill({
                    status: 200,
                    json: {
                        success: true,
                        order: {
                            ...ORDER,
                            id: 888,
                            executorId: null,
                        },
                        documents: [],
                    },
                });

                return;
            }

            if (orderId !== "777") {
                await route.fulfill({
                    status: 404,
                    json: {
                        success: false,
                        message: "Заказ не найден",
                    },
                });

                return;
            }

            await route.fulfill({
                status: 200,
                json: {
                    success: true,
                    order: ORDER,
                    documents,
                },
            });
        }
    );

    // Защищённая выгрузка JSON-отчётов.
    await page.route(
        "**/api/admin/identity/contracts/*/evidence",
        async (route) => {
            const url = new URL(route.request().url());

            const match = url.pathname.match(
                /\/contracts\/(\d+)\/evidence$/
            );

            const contractId = Number(match?.[1]);

            state.reports.push({
                method: route.request().method(),
                contractId,
            });

            if (reportStatus !== 200) {
                if (reportErrorFormat === "text") {
                    await route.fulfill({
                        status: reportStatus,
                        contentType: "text/plain",
                        body: "Internal server error",
                    });

                    return;
                }

                await route.fulfill({
                    status: reportStatus,
                    json: {
                        success: false,
                        message:
                            "Нет доступа к доказательствам",
                    },
                });

                return;
            }

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                headers: {
                    "Cache-Control": "private, no-store",
                    "Content-Disposition":
                        `attachment; filename="server-report-${contractId}.json"`,
                },
                body: JSON.stringify(
                    makeEvidence(contractId)
                ),
            });
        }
    );

    return state;
}

async function openEvidence(page, options = {}) {
    await setAdminAuth(page);

    const state = await setupMocks(page, options);

    await page.goto("/identity");

    await expect(
        page.locator(".cc-contract-evidence")
    ).toBeVisible();

    return state;
}

async function searchOrder(page, id) {
    const section = page.locator(
        ".cc-contract-evidence"
    );

    await section.getByRole("textbox", {
        name: "Номер заказа",
    }).fill(String(id));

    await section.getByRole("button", {
        name: "Найти документы",
    }).click();

    return section;
}

function documentCard(page, id) {
    return page
        .locator(".cc-contract-evidence-card")
        .filter({
            hasText: `CC-777-${id}`,
        });
}

test.describe("AdminContractEvidencePanel", () => {

    test("отображает форму поиска документов", async ({ page }) => {
        const state = await openEvidence(page);

        const section = page.locator(
            ".cc-contract-evidence"
        );

        await expect(
            section.getByRole("heading", {
                name: "Доказательства по договорам",
            })
        ).toBeVisible();

        await expect(
            section.getByRole("textbox", {
                name: "Номер заказа",
            })
        ).toBeVisible();

        await expect(
            section.getByRole("button", {
                name: "Найти документы",
            })
        ).toBeVisible();

        expect(state.searches).toHaveLength(0);
    });

    test("не отправляет некорректный номер заказа", async ({ page }) => {
        const state = await openEvidence(page);

        const section = page.locator(
            ".cc-contract-evidence"
        );

        for (const value of [
            "",
            "0",
            "-1",
            "abc",
            "1.5",
        ]) {
            await section.getByRole("textbox", {
                name: "Номер заказа",
            }).fill(value);

            await section.getByRole("button", {
                name: "Найти документы",
            }).click();

            await expect(
                section.getByRole("alert")
            ).toHaveText("Укажите ID заказа");
        }

        expect(state.searches).toHaveLength(0);
    });

    test("ищет заказ по ID и убирает лишние пробелы", async ({ page }) => {
        const state = await openEvidence(page);

        const section = await searchOrder(
            page,
            " 777 "
        );

        await expect(
            section.locator(
                ".cc-contract-evidence-order"
            )
        ).toContainText("Заказ №777");

        expect(state.searches).toEqual([
            {
                method: "GET",
                orderId: "777",
            },
        ]);
    });

    test("показывает договор и акт с версиями", async ({ page }) => {
        await openEvidence(page);

        const section = await searchOrder(page, 777);

        const cards = page.locator(
            ".cc-contract-evidence-card"
        );

        await expect(cards).toHaveCount(3);

        await expect(cards.nth(0)).toContainText(
            "Договор-задание"
        );

        await expect(cards.nth(0)).toContainText(
            "версия 1"
        );

        await expect(cards.nth(1)).toContainText(
            "Акт завершения"
        );

        await expect(cards.nth(1)).toContainText(
            "версия 2"
        );

        await expect(cards.nth(1)).toContainText(
            "CC-777-ACT-2"
        );

        await expect(section).toContainText(
            "Заказчик: #1201"
        );

        await expect(section).toContainText(
            "Исполнитель: #2202"
        );
    });

    test("отображает SHA-256 каждого документа", async ({ page }) => {
        await openEvidence(page);

        await searchOrder(page, 777);

        const cards = page.locator(
            ".cc-contract-evidence-card"
        );

        await expect(cards.nth(0)).toContainText(
            HASH_1
        );

        await expect(cards.nth(1)).toContainText(
            HASH_2
        );

        await expect(cards.nth(2)).toContainText(
            "SHA-256: отсутствует"
        );
    });

    test("показывает отсутствие документов", async ({ page }) => {
        await openEvidence(page);

        const section = await searchOrder(
            page,
            888
        );

        await expect(
            section.locator(
                ".cc-contract-evidence-order"
            )
        ).toContainText("Заказ №888");

        await expect(
            section.locator(
                ".cc-contract-evidence-card"
            )
        ).toHaveCount(0);

        await expect(section).toContainText(
            "Подтверждённых документов у заказа пока нет"
        );
    });

    test("корректно показывает заказ без исполнителя", async ({ page }) => {
        await openEvidence(page);

        const section = await searchOrder(
            page,
            888
        );

        await expect(
            section.locator(
                ".cc-contract-evidence-order"
            )
        ).toContainText("Исполнитель: #—");
    });

    test("очищает старые документы при новом поиске", async ({ page }) => {
        await openEvidence(page);

        await searchOrder(page, 777);

        await expect(
            page.locator(
                ".cc-contract-evidence-card"
            )
        ).toHaveCount(3);

        await searchOrder(page, 888);

        await expect(
            page.locator(
                ".cc-contract-evidence-card"
            )
        ).toHaveCount(0);

        await expect(
            page.locator(
                ".cc-contract-evidence-order"
            )
        ).toContainText("Заказ №888");
    });

    test("показывает ошибку для несуществующего заказа", async ({ page }) => {
        await openEvidence(page);

        const section = await searchOrder(
            page,
            999
        );

        await expect(
            section.getByRole("alert")
        ).toHaveText("Заказ не найден");
    });

    test("показывает ошибку сервера при поиске", async ({ page }) => {
        await openEvidence(page, {
            listStatus: 500,
        });

        const section = await searchOrder(
            page,
            777
        );

        await expect(
            section.getByRole("alert")
        ).toHaveText(
            "Не удалось загрузить документы заказа"
        );

        await expect(
            section.locator(
                ".cc-contract-evidence-card"
            )
        ).toHaveCount(0);
    });

    test("обрабатывает отсутствие массива документов в ответе", async ({ page }) => {
        await openEvidence(page, {
            documents: null,
        });

        const section = await searchOrder(
            page,
            777
        );

        await expect(
            section.locator(
                ".cc-contract-evidence-card"
            )
        ).toHaveCount(0);

        await expect(section).toContainText(
            "Подтверждённых документов у заказа пока нет"
        );
    });

    test("скачивает JSON-отчёт договора", async ({ page }) => {
        const state = await openEvidence(page);

        await searchOrder(page, 777);

        const card = page.locator(
            ".cc-contract-evidence-card"
        ).nth(0);

        const downloadPromise =
            page.waitForEvent("download");

        await card.getByRole("button", {
            name: "Скачать отчёт",
        }).click();

        const download = await downloadPromise;

        expect(
            download.suggestedFilename()
        ).toBe(
            "cargocamp-evidence-401.json"
        );

        const content = await readFile(
            await download.path(),
            "utf8"
        );

        const evidence = JSON.parse(content);

        expect(evidence.reportType).toBe(
            "cargocamp_contract_evidence"
        );

        expect(evidence.order.id).toBe(777);

        expect(evidence.document.id).toBe("401");

        expect(
            evidence.integrity.expectedSha256
        ).toBe(HASH_1);

        expect(state.reports).toEqual([
            {
                method: "GET",
                contractId: 401,
            },
        ]);
    });

    test("скачивает отчёт для второй версии документа", async ({ page }) => {
        const state = await openEvidence(page);

        await searchOrder(page, 777);

        const card = page.locator(
            ".cc-contract-evidence-card"
        ).nth(1);

        const downloadPromise =
            page.waitForEvent("download");

        await card.getByRole("button", {
            name: "Скачать отчёт",
        }).click();

        const download = await downloadPromise;

        expect(
            download.suggestedFilename()
        ).toBe(
            "cargocamp-evidence-402.json"
        );

        const content = await readFile(
            await download.path(),
            "utf8"
        );

        const evidence = JSON.parse(content);

        expect(evidence.document.version).toBe(2);

        expect(
            evidence.integrity.expectedSha256
        ).toBe(HASH_2);

        expect(state.reports[0].contractId).toBe(402);
    });

    test("показывает ошибку доступа к отчёту", async ({ page }) => {
        const state = await openEvidence(page, {
            reportStatus: 403,
        });

        await searchOrder(page, 777);

        const card = page.locator(
            ".cc-contract-evidence-card"
        ).nth(0);

        await card.getByRole("button", {
            name: "Скачать отчёт",
        }).click();

        await expect(
            page.locator(
                ".cc-contract-evidence-error"
            )
        ).toHaveText(
            "Нет доступа к доказательствам"
        );

        expect(state.reports).toHaveLength(1);
    });

    test("обрабатывает не-JSON ошибку формирования отчёта", async ({ page }) => {
        const state = await openEvidence(page, {
            reportStatus: 500,
            reportErrorFormat: "text",
        });

        await searchOrder(page, 777);

        const card = page.locator(
            ".cc-contract-evidence-card"
        ).nth(0);

        await card.getByRole("button", {
            name: "Скачать отчёт",
        }).click();

        await expect(
            page.locator(
                ".cc-contract-evidence-error"
            )
        ).toHaveText(
            "Не удалось выгрузить доказательства"
        );

        expect(state.reports).toHaveLength(1);

        await expect(
            page.locator(
                ".cc-contract-evidence-card"
            )
        ).toHaveCount(3);
    });

});