import { test, expect } from "./fixtures/safeTest";
import { mockAppShell } from "./utils/mockAppShell";
import { createMockJwt } from "./utils/mockAuthSession";
const FRONT_URL = "http://localhost:3000";

// Если у тебя маршрут другой — поменяй только эту строку.
const INFO_URL = `${FRONT_URL}/info?platform=web`;

async function setFakeAuth(page) {
    const fakeToken = createMockJwt({
        id: 1,
        username: "test-user",
        role: "customer",
    });

    await page.addInitScript((token) => {
        localStorage.setItem("authToken", token);
    }, fakeToken);
}

async function openInfoPage(page, platform = "web") {
    await setFakeAuth(page);

    await mockAppShell(page, {
        profile: {
            id: 1,
            username: "test-user",
            role: "customer",
        },
    });

    await page.goto(`${FRONT_URL}/info?platform=${platform}`, {

        waitUntil: "domcontentloaded",

        timeout: 30000,

    });

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
            "Способ оплаты зависит от заказа"
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
        await expect(details).toContainText("+7 (979) 019-99-79");
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
            details.locator('[data-offer-version="2026-11-09"]')
        ).not.toBeVisible();
    });


    test("открывает публичную оферту", async ({ page }) => {
        const details = page.locator("details.info-details").filter({
            has: page.locator(".info-card-title", {
                hasText: "Публичная оферта",
            }),
        });

        await details.locator(":scope > summary").click();

        await expect(details).toHaveAttribute("open", "");

        await expect(
            details.locator('[data-offer-version="2026-11-09"]')
        ).toBeVisible();

        for (const heading of [
            "1. Стороны и предмет",
            "2. Заказ и роли участников",
            "3. Цена заказа и услуги Платформы",
            "4. Порядок оплаты и выплаты",
            "5. Отмена, возвраты и споры",
            "6. Обращения и данные",
            "7. Действие оферты и реквизиты",
        ]) {
            await expect(details).toContainText(heading);
        }
    });

    test("может открыть оба документа одновременно", async ({ page }) => {
        const privacy = page.locator("details.info-details").filter({
            has: page.locator(".info-card-title", {
                hasText: "Политика конфиденциальности",
            }),
        });

        const offer = page.locator("details.info-details").filter({
            has: page.locator(".info-card-title", {
                hasText: "Публичная оферта",
            }),
        });

        await privacy.locator(":scope > summary").click();
        await offer.locator(":scope > summary").click();

        await expect(privacy).toHaveAttribute("open", "");
        await expect(offer).toHaveAttribute("open", "");

        await expect(privacy).toContainText(
            "Какие данные мы собираем"
        );

        await expect(offer).toContainText(
            "Цена заказа и услуги Платформы"
        );
    });



    test("сохраняет предыдущую редакцию оферты в архиве", async ({ page }) => {
        const offer = page.locator("details.info-details").filter({
            has: page.locator(".info-card-title", {
                hasText: "Публичная оферта",
            }),
        });

        await offer.locator(":scope > summary").click();

        const archive = offer.locator("details.info-offer-archive");

        await expect(archive).not.toHaveAttribute("open", "");

        await archive.locator("summary").click();

        await expect(archive).toHaveAttribute("open", "");
        await expect(archive).toContainText(
            "6. Платные услуги сервиса и порядок оформления"
        );
        await expect(archive).toContainText("12. Заключительные положения");
    });


    test("показывает контакты и реквизиты в футере", async ({ page }) => {
        const footer = page.locator(".info-footer-card");

        await expect(footer).toBeVisible();

        await expect(footer).toContainText("Email");
        await expect(footer).toContainText("partner@cargocamp.ru");

        await expect(footer).toContainText("Телефон");
        await expect(footer).toContainText("+7 (979) 019-99-79");

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