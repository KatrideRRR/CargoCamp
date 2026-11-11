import { mockOrderAssets } from "./mockOrderAssets";

export async function mockAppShell(page, {
    profile,
    identity = false,
    benefits = false,
    pendingActs = false,
} = {}) {
    await mockOrderAssets(page);

    const responses = [
        [
            "**/api/orders/me/status",
            { debt: 0 },
        ],
    ];

    if (profile !== undefined) {
        responses.push([
            "**/api/auth/profile",
            profile,
        ]);
    }

    if (identity) {
        responses.push([
            "**/api/identity/me",
            {
                success: true,
                verification: null,
            },
        ]);
    }

    if (benefits) {
        responses.push([
            "**/api/benefits/me",
            {
                success: true,
                benefits: [],
            },
        ]);
    }

    if (pendingActs) {
        responses.push([
            "**/api/orders/pending-act-signatures",
            {
                acts: [],
                missingOrderIds: [],
            },
        ]);
    }

    for (const [pattern, body] of responses) {
        await page.route(pattern, async (route) => {
            if (route.request().method() !== "GET") {
                await route.fallback();
                return;
            }

            await route.fulfill({
                status: 200,
                json: body,
            });
        });
    }
}