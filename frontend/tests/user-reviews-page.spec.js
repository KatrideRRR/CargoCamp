import { test, expect } from "@playwright/test";

const FRONT_URL = "http://localhost:3000";

const testUser = {
    id: 2,
    username: "viewer",
    role: "customer",
};

const reviewedUser = {
    id: 123,
    username: "testuser",
};

const reviews = [
    {
        id: 1,
        orderId: 101,
        fromUserId: 2,
        rating: 5,
        text: "Отличный заказчик, всё быстро согласовали",
        createdAt: "2026-07-01T10:00:00.000Z",
    },
    {
        id: 2,
        orderId: 102,
        fromUserId: 3,
        rating: 4,
        text: "",
        createdAt: "2026-07-02T12:30:00.000Z",
    },
];

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

async function setupReviewsMocks(page, options = {}) {
    const {
        userBody = reviewedUser,
        userStatus = 200,
        reviewsBody = { reviews },
        reviewsStatus = 200,
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

    await page.route("**/api/auth/profile", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(testUser),
        });
    });

    await page.route("**/api/auth/user/123", async (route) => {
        await route.fulfill({
            status: userStatus,
            contentType: "application/json",
            body: JSON.stringify(userBody),
        });
    });

    await page.route("**/api/auth/reviews/user/123", async (route) => {
        await route.fulfill({
            status: reviewsStatus,
            contentType: "application/json",
            body: JSON.stringify(reviewsBody),
        });
    });
}

async function openReviewsPage(page, options = {}) {
    await setFakeAuth(page);
    await setupReviewsMocks(page, options);

    const query = options.query || "platform=web";

    await page.goto(`${FRONT_URL}/complaints/123?${query}`, {

        waitUntil: "domcontentloaded",

        timeout: 30000,

    });

    if (options.waitForPage === false) return;

    if (page.url().includes("/login")) {
        await page.screenshot({
            path: "user-reviews-redirected-to-login.png",
            fullPage: true,
        });

        throw new Error("UserReviewsPage редиректит на /login. Fake JWT не применился или роут другой.");
    }

    await expect(page.locator(".title")).toHaveText("Отзывы", {
        timeout: 15000,
    });
}

function reviewCard(page, text) {
    return page.locator(".reviewCard").filter({
        hasText: text,
    });
}

test.describe("UserReviewsPage", () => {
    test.beforeEach(async ({ page }) => {
        await openReviewsPage(page);
    });

    test("отображает страницу отзывов", async ({ page }) => {
        await expect(page.locator(".reviewsPage")).toBeVisible();
        await expect(page.locator(".reviewsWrap")).toBeVisible();

        await expect(page.locator(".title")).toHaveText("Отзывы");
        await expect(page.locator(".countPill")).toHaveText("2");
    });

    test("ставит web-класс при platform=web", async ({ page }) => {
        await openReviewsPage(page, {
            query: "platform=web",
        });

        await expect(page.locator(".reviewsPage")).toHaveClass(/reviewsPage--web/);
    });

    test("ставит ios-класс при platform=ios", async ({ page }) => {
        await openReviewsPage(page, {
            query: "platform=ios",
        });

        await expect(page.locator(".reviewsPage")).toHaveClass(/reviewsPage--ios/);
    });

    test("ставит android-класс при platform=android", async ({ page }) => {
        await openReviewsPage(page, {
            query: "platform=android",
        });

        await expect(page.locator(".reviewsPage")).toHaveClass(/reviewsPage--android/);
    });

    test("показывает карточку пользователя", async ({ page }) => {
        await expect(page.locator(".userCard")).toBeVisible();
        await expect(page.locator(".userName")).toHaveText("testuser");
        await expect(page.locator(".userMeta")).toHaveText("ID: 123");
    });

    test("считает средний рейтинг по отзывам", async ({ page }) => {
        await expect(page.locator(".ratingValue")).toHaveText("4.5");
        await expect(page.locator(".ratingHint")).toHaveText("средняя по отзывам");

        await expect(page.locator(".ratingBox .stars")).toHaveAttribute(
            "aria-label",
            "Рейтинг 4.5 из 5"
        );
    });

    test("показывает список отзывов", async ({ page }) => {
        await expect(page.locator(".reviewsList")).toBeVisible();
        await expect(page.locator(".reviewCard")).toHaveCount(2);

        await expect(page.getByText("Отличный заказчик, всё быстро согласовали")).toBeVisible();
        await expect(page.getByText("Без комментария")).toBeVisible();
    });

    test("показывает данные первого отзыва", async ({ page }) => {
        const card = reviewCard(page, "Отличный заказчик");

        await expect(card).toBeVisible();
        await expect(card.locator(".orderPill")).toHaveText("Заказ #101");
        await expect(card.locator(".score")).toHaveText("5");
        await expect(card.locator(".fromUser")).toHaveText("От пользователя ID: 2");
        await expect(card.locator(".reviewText")).toHaveText("Отличный заказчик, всё быстро согласовали");
    });

    test("показывает Без комментария для пустого текста", async ({ page }) => {
        const card = reviewCard(page, "Заказ #102");

        await expect(card.locator(".reviewText")).toHaveText("Без комментария");
        await expect(card.locator(".reviewText")).toHaveClass(/muted/);
    });

    test("показывает звёзды рейтинга у каждого отзыва", async ({ page }) => {
        const firstCard = reviewCard(page, "Заказ #101");
        const secondCard = reviewCard(page, "Заказ #102");

        await expect(firstCard.locator(".stars")).toHaveAttribute(
            "aria-label",
            "Рейтинг 5 из 5"
        );

        await expect(secondCard.locator(".stars")).toHaveAttribute(
            "aria-label",
            "Рейтинг 4 из 5"
        );

        await expect(firstCard.locator(".star.on")).toHaveCount(5);
        await expect(secondCard.locator(".star.on")).toHaveCount(4);
    });

    test("показывает даты отзывов", async ({ page }) => {
        const firstCard = reviewCard(page, "Заказ #101");
        const secondCard = reviewCard(page, "Заказ #102");

        await expect(firstCard.locator(".datePill")).toContainText("2026");
        await expect(secondCard.locator(".datePill")).toContainText("2026");
    });

    test("ссылка ведёт на заказы пользователя", async ({ page }) => {
        const link = page.getByRole("link", {
            name: "Посмотреть заказы пользователя",
        });

        await expect(link).toHaveAttribute("href", "/user-orders/123");

        await link.click();

        await expect(page).toHaveURL(/\/user-orders\/123/);
    });

    test("кнопка назад возвращает на предыдущую страницу", async ({ page }) => {
        await setFakeAuth(page);
        await setupReviewsMocks(page);

        await page.route("**/test-previous-page", async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "text/html",
                body: "<html><body>Previous page</body></html>",
            });
        });

        await page.goto(`${FRONT_URL}/test-previous-page`);
        await page.goto(`${FRONT_URL}/complaints/123?platform=web`);

        await expect(page.locator(".title")).toHaveText("Отзывы", {
            timeout: 15000,
        });

        await page.getByRole("button", { name: /Назад/i }).click();

        await expect(page).toHaveURL(/\/test-previous-page/);
    });

    test("показывает пустое состояние, если отзывов нет", async ({ page }) => {
        await openReviewsPage(page, {
            reviewsBody: {
                reviews: [],
            },
        });

        await expect(page.locator(".countPill")).toHaveText("0");
        await expect(page.locator(".ratingValue")).toHaveText("—");
        await expect(page.locator(".emptyState")).toHaveText("Пока нет отзывов.");
    });

    test("при отсутствии username показывает Пользователь", async ({ page }) => {
        await openReviewsPage(page, {
            userBody: {
                id: 123,
                username: "",
            },
        });

        await expect(page.locator(".userName")).toHaveText("Пользователь");
        await expect(page.locator(".userMeta")).toHaveText("ID: 123");
    });

    test("показывает ошибку, если профиль пользователя не загрузился", async ({ page }) => {
        await openReviewsPage(page, {
            userStatus: 500,
            userBody: {
                message: "Пользователь не найден",
            },
            waitForPage: false,
        });

        await expect(page.locator(".reviewsPageState.error")).toHaveText(
            "Ошибка: Пользователь не найден"
        );
    });

    test("показывает ошибку, если отзывы не загрузились", async ({ page }) => {
        await openReviewsPage(page, {
            reviewsStatus: 500,
            reviewsBody: {
                message: "Отзывы недоступны",
            },
            waitForPage: false,
        });

        await expect(page.locator(".reviewsPageState.error")).toHaveText(
            "Ошибка: Отзывы недоступны"
        );
    });

    test("pull-to-refresh повторно загружает профиль и отзывы", async ({ page }) => {
        let userCalls = 0;
        let reviewsCalls = 0;

        await setFakeAuth(page);

        await page.route("**/api/auth/profile", async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(testUser),
            });
        });

        await page.route("**/api/auth/user/123", async (route) => {
            userCalls += 1;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify(reviewedUser),
            });
        });

        await page.route("**/api/auth/reviews/user/123", async (route) => {
            reviewsCalls += 1;

            await route.fulfill({
                status: 200,
                contentType: "application/json",
                body: JSON.stringify({
                    reviews,
                }),
            });
        });

        await page.goto(`${FRONT_URL}/complaints/123?platform=web`, {

            waitUntil: "domcontentloaded",

            timeout: 30000,

        });

        await expect(page.locator(".title")).toHaveText("Отзывы", {
            timeout: 15000,
        });

        await expect
            .poll(() => userCalls, {
                timeout: 10000,
            })
            .toBeGreaterThanOrEqual(1);

        await expect
            .poll(() => reviewsCalls, {
                timeout: 10000,
            })
            .toBeGreaterThanOrEqual(1);

        await page.waitForTimeout(500);

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
            .poll(() => userCalls, {
                timeout: 10000,
            })
            .toBeGreaterThanOrEqual(2);

        await expect
            .poll(() => reviewsCalls, {
                timeout: 10000,
            })
            .toBeGreaterThanOrEqual(2);

        await expect
            .poll(async () => {
                return await page.evaluate(() => window.__pullDone === true);
            }, {
                timeout: 10000,
            })
            .toBe(true);
    });
});