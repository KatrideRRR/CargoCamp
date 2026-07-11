import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3000";

// Если у тебя маршрут другой — поменяй только эту строку.
const INFO_URL = `${FRONT_URL}/info?platform=web`;

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

async function setFakeAuth(page) {
    const fakeToken = createFakeJwt({
        id: 1,
        role: "customer",
        name: "test-user",
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
    });

    await page.addInitScript((token) => {
        localStorage.setItem("authToken", token);
    }, fakeToken);
}

async function openInfoPage(page, platform = "web") {
    await setFakeAuth(page);

    await page.goto(`${FRONT_URL}/info?platform=${platform}`);

    await page.waitForLoadState("domcontentloaded");

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: `info-page-redirected-to-login-${platform}.png`,
            fullPage: true,
        });

        throw new Error("InfoPage редиректит на /login. Fake JWT не применился.");
    }

    await expect(page.locator(".info-page")).toBeVisible({
        timeout: 15000,
    });

    await expect(page.locator(".info-title")).toHaveText("Информация", {
        timeout: 15000,
    });
}

test.describe("InfoPage", () => {
    test.beforeEach(async ({ page }) => {
        await openInfoPage(page);
    });

    test("отображает страницу информации", async ({ page }) => {
        await expect(page.locator(".info-page")).toBeVisible();

        await expect(page.locator(".info-title")).toHaveText("Информация");
        await expect(page.locator(".info-subtitle")).toHaveText(
            "Документы, контакты и как работает сервис"
        );

        await expect(page.getByRole("button", { name: /Назад/i })).toBeVisible();

        await expect(page.locator(".info-card-title", { hasText: "Услуги и цены CargoCamp" })).toBeVisible();
        await expect(page.locator(".info-card-title", { hasText: "Как работает CargoCamp" })).toBeVisible();
        await expect(page.locator(".info-card-title", { hasText: "Политика конфиденциальности" })).toBeVisible();
        await expect(page.locator(".info-card-title", { hasText: "Публичная оферта" })).toBeVisible();
    });

    test("ставит web-класс при platform=web", async ({ page }) => {
        await openInfoPage(page, "web");

        await expect(page.locator(".info-page")).toHaveClass(/info-page--web/);
    });

    test("ставит ios-класс при platform=ios", async ({ page }) => {
        await openInfoPage(page, "ios");

        await expect(page.locator(".info-page")).toHaveClass(/info-page--ios/);
    });

    test("ставит android-класс при platform=android", async ({ page }) => {
        await openInfoPage(page, "android");

        await expect(page.locator(".info-page")).toHaveClass(/info-page--android/);
    });

    test("показывает карточку услуг и цен", async ({ page }) => {
        const servicesCard = page.locator(".info-card--link");

        await expect(servicesCard).toBeVisible();
        await expect(servicesCard.locator(".info-card-title")).toHaveText(
            "Услуги и цены CargoCamp"
        );
        await expect(servicesCard.locator(".info-pill")).toHaveText("Открыть");
        await expect(servicesCard).toContainText(
            "Фиксированные тарифы сервиса и условия работы."
        );
    });

    test("переходит на страницу услуг при клике на карточку услуг", async ({ page }) => {
        await page.locator(".info-card--link").click();

        await expect(page).toHaveURL(/\/services/);
    });

    test("показывает блок как работает CargoCamp", async ({ page }) => {
        const card = page.locator(".info-card").filter({
            has: page.locator(".info-card-title", {
                hasText: "Как работает CargoCamp",
            }),
        });

        await expect(card).toBeVisible();
        await expect(card.locator(".info-pill")).toHaveText("Коротко");

        await expect(card.locator("li")).toHaveCount(4);

        await expect(card).toContainText(
            "Заказчик размещает заказ с описанием задачи."
        );
        await expect(card).toContainText(
            "Исполнители откликаются и предлагают условия."
        );
        await expect(card).toContainText(
            "Стороны договариваются о стоимости и сроках."
        );
        await expect(card).toContainText(
            "Сервис берёт оплату только за услуги платформы."
        );
    });

    test("политика конфиденциальности изначально закрыта", async ({ page }) => {
        const details = page.locator("details").filter({
            has: page.locator(".info-card-title", {
                hasText: "Политика конфиденциальности",
            }),
        });

        await expect(details).not.toHaveAttribute("open", "");

        await expect(
            details.getByText("Настоящая Политика регулирует порядок обработки")
        ).not.toBeVisible();
    });

    test("открывает политику конфиденциальности", async ({ page }) => {
        const details = page.locator("details").filter({
            has: page.locator(".info-card-title", {
                hasText: "Политика конфиденциальности",
            }),
        });

        await details.locator("summary").click();

        await expect(details).toHaveAttribute("open", "");

        await expect(details).toContainText("1. Общие положения");
        await expect(details).toContainText("2. Какие данные мы собираем");
        await expect(details).toContainText("3. Цели обработки данных");
        await expect(details).toContainText("4. Передача данных третьим лицам");
        await expect(details).toContainText("Мы не продаём персональные данные.");
        await expect(details).toContainText("partner@cargocamp.ru");
        await expect(details).toContainText("+7 (978) 686 41 18");
    });

    test("закрывает политику конфиденциальности повторным кликом", async ({ page }) => {
        const details = page.locator("details").filter({
            has: page.locator(".info-card-title", {
                hasText: "Политика конфиденциальности",
            }),
        });

        await details.locator("summary").click();

        await expect(details).toHaveAttribute("open", "");

        await details.locator("summary").click();

        await expect(details).not.toHaveAttribute("open", "");
    });

    test("публичная оферта изначально закрыта", async ({ page }) => {
        const details = page.locator("details").filter({
            has: page.locator(".info-card-title", {
                hasText: "Публичная оферта",
            }),
        });

        await expect(details).not.toHaveAttribute("open", "");

        await expect(
            details.getByText("Настоящая Публичная оферта является предложением")
        ).not.toBeVisible();
    });

    test("открывает публичную оферту", async ({ page }) => {
        const details = page.locator("details").filter({
            has: page.locator(".info-card-title", {
                hasText: "Публичная оферта",
            }),
        });

        await details.locator("summary").click();

        await expect(details).toHaveAttribute("open", "");

        await expect(details).toContainText("1. Общие положения");
        await expect(details).toContainText("2. Предмет оферты");
        await expect(details).toContainText("6. Платные услуги сервиса и порядок оформления");
        await expect(details).toContainText("8. Возвраты");
        await expect(details).toContainText("10. Доставка");
        await expect(details).toContainText("Споры решаются в соответствии с законодательством Российской Федерации.");
    });

    test("может открыть оба документа одновременно", async ({ page }) => {
        const privacy = page.locator("details").filter({
            has: page.locator(".info-card-title", {
                hasText: "Политика конфиденциальности",
            }),
        });

        const offer = page.locator("details").filter({
            has: page.locator(".info-card-title", {
                hasText: "Публичная оферта",
            }),
        });

        await privacy.locator("summary").click();
        await offer.locator("summary").click();

        await expect(privacy).toHaveAttribute("open", "");
        await expect(offer).toHaveAttribute("open", "");

        await expect(privacy).toContainText("Какие данные мы собираем");
        await expect(offer).toContainText("Предмет оферты");
    });

    test("показывает контакты и реквизиты в футере", async ({ page }) => {
        const footer = page.locator(".info-footer-card");

        await expect(footer).toBeVisible();

        await expect(footer).toContainText("Email");
        await expect(footer).toContainText("partner@cargocamp.ru");

        await expect(footer).toContainText("Телефон");
        await expect(footer).toContainText("+7 (978) 686 41 18");

        await expect(footer).toContainText("ИП");
        await expect(footer).toContainText("Аджиаметов Аким Ибришевич");

        await expect(footer).toContainText("ИНН");
        await expect(footer).toContainText("9109 0845 7603");

        await expect(footer).toContainText("ОГРН/ОГРНИП");
        await expect(footer).toContainText("325911200109660");

        await expect(footer).toContainText("Адрес");
        await expect(footer).toContainText(
            "Республика Крым, г. Симферополь, улица Балаклавская 39"
        );
    });

    test("кнопка Назад возвращает на предыдущую страницу", async ({ page }) => {
        await page.goto(`${FRONT_URL}/services`);
        await page.goto(INFO_URL);

        await page.getByRole("button", { name: /Назад/i }).click();

        await expect(page).toHaveURL(/\/services/);
    });

    test("на странице есть safe-area блок для нижнего меню", async ({ page }) => {
        await expect(page.locator(".info-safe-area")).toBeVisible();
    });
});