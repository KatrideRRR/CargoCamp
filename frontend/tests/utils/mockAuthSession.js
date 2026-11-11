
const jsonResponse = (body, status = 200) => ({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
});

function base64url(value) {
    return Buffer.from(JSON.stringify(value))
        .toString("base64")
        .replace(/=/g, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
}

// Только для изолированных Playwright-тестов.
// Реальная криптографическая подпись здесь не нужна.
export function createMockJwt(user, overrides = {}) {
    const header = {
        alg: "HS256",
        typ: "JWT",
    };

    const payload = {
        id: user.id,
        role: user.role || "user",
        name: user.username || user.name || "test",
        sid: "playwright-test-session",
        scope: "user",
        exp: Math.floor(Date.now() / 1000) + 86400,
        ...overrides,
    };

    return `${base64url(header)}.${base64url(payload)}.test-signature`;
}

export async function mockAnonymousRefresh(page) {
    await page.route(
        "**/api/auth/session/refresh",
        async (route) => {
            await route.fulfill(
                jsonResponse(
                    { message: "Сессия отсутствует" },
                    401
                )
            );
        }
    );
}

export async function mockProfileAfterAuth(page, user) {
    const profile = {
        ...user,
        username: user.username || user.name || "TestUser",
        subscriptionType: "basic",
        userStatus: "unverified",
        preferredCategoryIds: [],
        locationAddress: "Симферополь",
        yookassaPaymentMethodId: null,
    };

    const responses = [
        ["**/api/auth/profile", profile],
        ["**/api/orders/me/status", { debt: 0 }],
        ["**/api/category", []],
        [
            "**/api/identity/me",
            {
                success: true,
                verification: null,
            },
        ],
        [
            "**/api/benefits/me",
            {
                success: true,
                benefits: [],
            },
        ],
    ];

    for (const [pattern, body] of responses) {
        await page.route(pattern, async (route) => {
            await route.fulfill(jsonResponse(body));
        });
    }
}
