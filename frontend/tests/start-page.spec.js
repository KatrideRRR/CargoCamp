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

async function setupStartPageMocks(page) {
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

    await page.route("**/api/auth/profile", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(testUser),
        });
    });
}

async function openStartPage(page) {
    await setFakeAuth(page);
    await setupStartPageMocks(page);

    await page.goto(`${FRONT_URL}/`, {

        waitUntil: "domcontentloaded",

        timeout: 30000,

    });

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "start-page-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("StartPage редиректит на /login. Fake JWT не применился или стартовый роут другой.");
    }

    await expect(page.locator(".title")).toHaveText("CargoCamp", {
        timeout: 15000,
    });
}

test.describe("StartPage", () => {
    test.beforeEach(async ({ page }) => {
        await openStartPage(page);
    });

    test("отображает стартовую страницу", async ({ page }) => {
        await expect(page.locator(".start-page-container")).toBeVisible();
        await expect(page.locator(".start-page-content")).toBeVisible();

        await expect(page.locator(".title")).toHaveText("CargoCamp");
        await expect(page.locator(".subtitle")).toHaveText("Что вы хотите сделать?");
    });

    test("отображает три основные кнопки действий", async ({ page }) => {
        await expect(page.locator(".role-button")).toHaveCount(3);

        await expect(page.getByRole("button", { name: /Создать заказ/i })).toBeVisible();
        await expect(page.getByRole("button", { name: /Такси \/ Курьер/i })).toBeVisible();
        await expect(page.getByRole("button", { name: /Все заказы/i })).toBeVisible();
    });

    test("отображает кнопку создания обычного заказа", async ({ page }) => {
        const button = page.getByRole("button", {
            name: /Создать заказ/i,
        });

        await expect(button).toBeVisible();
        await expect(button).toContainText("🧾");
        await expect(button).toContainText("Создать заказ");
        await expect(button).toContainText("Обычный заказ на услугу");
    });

    test("отображает кнопку Такси / Курьер", async ({ page }) => {
        const button = page.getByRole("button", {
            name: /Такси \/ Курьер/i,
        });

        await expect(button).toBeVisible();
        await expect(button).toContainText("🚕");
        await expect(button).toContainText("Такси / Курьер");
        await expect(button).toContainText("Быстрый заказ “здесь и сейчас”");
    });

    test("отображает кнопку Все заказы", async ({ page }) => {
        const button = page.getByRole("button", {
            name: /Все заказы/i,
        });

        await expect(button).toBeVisible();
        await expect(button).toHaveClass(/role-button-soft/);
        await expect(button).toContainText("📋");
        await expect(button).toContainText("Все заказы");
        await expect(button).toContainText("Найти заказ и откликнуться");
    });

    test("переходит на создание обычного заказа", async ({ page }) => {
        await page.getByRole("button", { name: /Создать заказ/i }).click();

        await expect(page).toHaveURL(/\/create-order/);
    });

    test("переходит на создание express-заказа", async ({ page }) => {
        await page.getByRole("button", { name: /Такси \/ Курьер/i }).click();

        await expect(page).toHaveURL(/\/express/);
    });

    test("переходит на страницу всех заказов", async ({ page }) => {
        await page.getByRole("button", { name: /Все заказы/i }).click();

        await expect(page).toHaveURL(/\/orders/);
    });

    test("кнопки имеют type button и не являются submit", async ({ page }) => {
        const buttons = page.locator(".role-button");

        await expect(buttons.nth(0)).toHaveAttribute("type", "button");
        await expect(buttons.nth(1)).toHaveAttribute("type", "button");
        await expect(buttons.nth(2)).toHaveAttribute("type", "button");
    });

    test("страница не содержит старые элементы выбора ролей", async ({ page }) => {
        await expect(page.getByText("Добро пожаловать!")).not.toBeVisible();
        await expect(page.getByText("Кем вы хотите быть сегодня?")).not.toBeVisible();

        await expect(page.getByRole("button", { name: /я заказчик/i })).not.toBeVisible();
        await expect(page.getByRole("button", { name: /я исполнитель/i })).not.toBeVisible();
    });

    test("страница не содержит старые юридические модалки", async ({ page }) => {
        await expect(page.getByRole("button", { name: /политика конфиденциальности/i })).not.toBeVisible();
        await expect(page.getByRole("button", { name: /публичная оферта/i })).not.toBeVisible();

        await expect(page.locator(".modal-overlay")).not.toBeVisible();
    });
});