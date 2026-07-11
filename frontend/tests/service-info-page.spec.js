import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3000";

const testUser = {
    id: 1,
    username: "testuser",
    role: "customer",
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

async function setFakeAuth(page, user = testUser) {
    const fakeToken = createFakeJwt({
        id: user.id,
        role: user.role,
        name: user.username,
        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
    });

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

async function openServiceInfoPage(page) {
    await setFakeAuth(page);

    await page.route("**/api/auth/profile", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(testUser),
        });
    });

    await page.goto(`${FRONT_URL}/services`);
    await page.waitForLoadState("domcontentloaded");

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "service-info-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("ServiceInfoPage редиректит на /login. Fake JWT не применился или роут другой.");
    }

    await expect(page.locator(".info-title")).toHaveText(
        "Услуги сервиса CargoCamp и цены",
        {
            timeout: 15000,
        }
    );
}

test.describe("ServiceInfoPage", () => {
    test.beforeEach(async ({ page }) => {
        await openServiceInfoPage(page);
    });

    test("отображает страницу услуг сервиса", async ({ page }) => {
        await expect(page.locator(".info-page-container")).toBeVisible();
        await expect(page.locator(".info-page-card")).toBeVisible();

        await expect(page.locator(".info-title")).toHaveText(
            "Услуги сервиса CargoCamp и цены"
        );

        await expect(page.locator(".info-subtitle")).toContainText(
            "CargoCamp — онлайн-платформа"
        );

        await expect(page.locator(".info-subtitle")).toContainText(
            "Платежи через интернет-эквайринг принимаются только за услуги сервиса"
        );
    });

    test("показывает все основные разделы страницы", async ({ page }) => {
        await expect(page.locator(".info-section-title")).toHaveCount(6);

        await expect(page.getByText("1. О сервисе")).toBeVisible();
        await expect(page.getByText("2. Услуги сервиса и фиксированные цены")).toBeVisible();
        await expect(page.getByText("3. За что мы не принимаем оплату")).toBeVisible();
        await expect(page.getByText("4. Как проходят платежи")).toBeVisible();
        await expect(page.getByText("5. Условия оказания услуг")).toBeVisible();
        await expect(page.getByText("6. Контакты и реквизиты")).toBeVisible();
    });

    test("показывает описание сервиса", async ({ page }) => {
        const section = page.locator(".info-section").filter({
            hasText: "1. О сервисе",
        });

        await expect(section).toContainText(
            "Платформа предоставляет заказчикам и исполнителям техническую возможность"
        );

        await expect(section).toContainText(
            "Стоимость работ по заказу определяется сторонами самостоятельно"
        );
    });

    test("показывает список тарифов", async ({ page }) => {
        await expect(page.locator(".tariff-item")).toHaveCount(6);

        await expect(page.getByText("Размещение заказа в системе")).toBeVisible();
        await expect(page.getByText("Продвижение заказа в выдаче")).toBeVisible();
        await expect(page.getByText(/Комиссия сервиса за взятие заказа/i)).toBeVisible();
        await expect(page.getByText("Сервисный сбор при безопасной сделке")).toBeVisible();
        await expect(page.getByText("Погашение задолженности перед сервисом")).toBeVisible();
        await expect(page.getByText("Покупка статуса Premium")).toBeVisible();
    });

    test("показывает цену размещения заказа", async ({ page }) => {
        const tariff = page.locator(".tariff-item").filter({
            hasText: "Размещение заказа в системе",
        });

        await expect(tariff.locator(".tariff-price")).toHaveText("0 ₽");

        await expect(tariff).toContainText(
            "Создание и публикация заказа на платформе"
        );
    });

    test("показывает цены продвижения заказа", async ({ page }) => {
        const tariff = page.locator(".tariff-item").filter({
            hasText: "Продвижение заказа в выдаче",
        });

        await expect(tariff.locator(".tariff-price")).toHaveText("50 ₽ / 100 ₽ / 150 ₽");

        await expect(tariff).toContainText("Выделение цветом");
        await expect(tariff).toContainText("рекомендуемый заказ");
        await expect(tariff).toContainText("пуш уведомление");
    });

    test("показывает комиссию за наличный заказ", async ({ page }) => {
        const tariff = page.locator(".tariff-item").filter({
            hasText: "Комиссия сервиса за взятие заказа",
        });

        await expect(tariff.locator(".tariff-price")).toHaveText("200 ₽");

        await expect(tariff).toContainText("фиксированную комиссию");
        await expect(tariff).toContainText("задолженность в 200 ₽");
    });

    test("показывает сервисный сбор безопасной сделки", async ({ page }) => {
        const tariff = page.locator(".tariff-item").filter({
            hasText: "Сервисный сбор при безопасной сделке",
        });

        await expect(tariff.locator(".tariff-price")).toHaveText("10% от суммы заказа");

        await expect(tariff).toContainText(
            "организацию безопасного удержания и перевода"
        );
    });

    test("показывает погашение задолженности", async ({ page }) => {
        const tariff = page.locator(".tariff-item").filter({
            hasText: "Погашение задолженности перед сервисом",
        });

        await expect(tariff.locator(".tariff-price")).toHaveText(
            "Сумма задолженности (фиксировано)"
        );

        await expect(tariff).toContainText("Задолженность");
        await expect(tariff).toContainText("Конкретная сумма оплаты");
    });

    test("показывает цены Premium", async ({ page }) => {
        const tariff = page.locator(".tariff-item").filter({
            hasText: "Покупка статуса Premium",
        });

        await expect(tariff.locator(".tariff-price")).toHaveText("2500 ₽/ 9000 ₽");

        await expect(tariff).toContainText("на неделю или месяц");
        await expect(tariff).toContainText("без комиссии");
    });

    test("объясняет, за что сервис не принимает оплату", async ({ page }) => {
        const section = page.locator(".info-section").filter({
            hasText: "3. За что мы не принимаем оплату",
        });

        await expect(section).toContainText(
            "CargoCamp не принимает оплату за сами работы или услуги исполнителей"
        );

        await expect(section).toContainText(
            "осуществляются напрямую между ними"
        );
    });

    test("показывает порядок платежей", async ({ page }) => {
        const section = page.locator(".info-section").filter({
            hasText: "4. Как проходят платежи",
        });

        await expect(section.locator("li")).toHaveCount(4);

        await expect(section).toContainText("Пользователь выбирает услугу сервиса");
        await expect(section).toContainText("Перед оплатой всегда показана конкретная сумма");
        await expect(section).toContainText("Оплата проводится через платёжного провайдера");
        await expect(section).toContainText("После успешной оплаты пользователь видит подтверждение");
    });

    test("показывает условия оказания услуг", async ({ page }) => {
        const section = page.locator(".info-section").filter({
            hasText: "5. Условия оказания услуг",
        });

        await expect(section.locator(".info-subhead")).toHaveCount(4);

        await expect(section.locator(".info-subhead").nth(0)).toHaveText("Срок предоставления услуг");
        await expect(section.locator(".info-subhead").nth(1)).toHaveText("Порядок оплаты");
        await expect(section.locator(".info-subhead").nth(2)).toHaveText("Доставка");
        await expect(section.locator(".info-subhead").nth(3)).toHaveText("Возвраты");

        await expect(section).toContainText("активируется сразу после оплаты");
        await expect(section).toContainText("Срок действия — 24 часа");
        await expect(section).toContainText("7 дней / 30 дней");
    });

    test("показывает, что онлайн-оплата не принимается за работы исполнителей", async ({ page }) => {
        const section = page.locator(".info-section").filter({
            hasText: "Порядок оплаты",
        });

        await expect(section).toContainText(
            "Оплата работ исполнителей онлайн не принимается"
        );

        await expect(section).toContainText(
            "рассчитываются между собой наличными напрямую"
        );
    });

    test("показывает условия возврата", async ({ page }) => {
        const section = page.locator(".info-section").filter({
            hasText: "Возвраты",
        });

        await expect(section).toContainText(
            "Возврат возможен, если услуга фактически не была предоставлена"
        );

        await expect(section).toContainText("partner@cargocamp.ru");
        await expect(section).toContainText("до 10 календарных дней");
    });

    test("показывает контакты и реквизиты", async ({ page }) => {
        const section = page.locator(".info-section").filter({
            hasText: "6. Контакты и реквизиты",
        });

        await expect(section).toContainText("partner@cargocamp.ru");
        await expect(section).toContainText("+7 (978) 686-41-18");
        await expect(section).toContainText("ИП: Аджиаметов Аким Ибришевич");
        await expect(section).toContainText("ИНН: 9109 0845 7603");
        await expect(section).toContainText("ОГРНИП: 325911200109660");
    });

    test("показывает финальное юридическое примечание", async ({ page }) => {
        await expect(page.locator(".info-note")).toContainText(
            "Дополнительную юридическую информацию"
        );

        await expect(page.locator(".info-note")).toContainText(
            "Публичная оферта"
        );

        await expect(page.locator(".info-note")).toContainText(
            "Политика конфиденциальности"
        );
    });
});