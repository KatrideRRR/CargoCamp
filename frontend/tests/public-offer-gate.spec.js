
import { test, expect } from "./fixtures/safeTest";
import { mockAppShell } from "./utils/mockAppShell";
import { createMockJwt } from "./utils/mockAuthSession";

test("существующий пользователь принимает новую оферту", async ({ page }) => {
    const fakeToken = createMockJwt({
        id: 42,
        username: "existing-user",
        role: "user",
    });

    await page.addInitScript((token) => {
        localStorage.setItem("authToken", token);
    }, fakeToken);

    await mockAppShell(page, {
        profile: {
            id: 42,
            username: "existing-user",
            role: "user",
        },
    });

    await page.route(
        "**/api/legal/offer/status",
        async (route) => {
            await route.fulfill({
                status: 200,
                json: {
                    version: "2026-11-09",
                    sha256: "mock-offer-sha256",
                    accepted: false,
                    acceptedAt: null,
                },
            });
        }
    );

    let acceptPayload = null;

    await page.route(
        "**/api/legal/offer/accept",
        async (route) => {
            acceptPayload = route.request().postDataJSON();

            await route.fulfill({
                status: 200,
                json: {
                    accepted: true,
                    version: "2026-11-09",
                    alreadyAccepted: false,
                    acceptedAt: new Date().toISOString(),
                },
            });
        }
    );

    await page.goto(
        "http://localhost:3000/info?platform=web"
    );

    const dialog = page.getByRole("dialog", {
        name: "Принятие публичной оферты",
    });

    await expect(dialog).toBeVisible();

    await expect(
        page.locator(".info-page")
    ).toHaveCount(0);

    await expect(
        dialog.locator('[data-offer-version="2026-11-09"]')
    ).toBeVisible();

    const button = dialog.getByRole("button", {
        name: "Принять оферту",
    });

    await expect(button).toBeDisabled();

    await dialog.getByRole("checkbox", {
        name: /ознакомился с публичной офертой/i,
    }).check();

    await expect(button).toBeEnabled();

    await button.click();

    await expect.poll(() => acceptPayload).toEqual({
        version: "2026-11-09",
        sha256: "mock-offer-sha256",
        confirmed: true,
    });

    await expect(dialog).not.toBeVisible();
    await expect(
        page.locator(".info-page")
    ).toBeVisible();
});


test("уже принявший оферту пользователь работает без повторного окна", async ({ page }) => {
    const token = createMockJwt({
        id: 77,
        username: "accepted-user",
        role: "user",
    });

    await page.addInitScript((value) => {
        localStorage.setItem("authToken", value);
    }, token);

    await mockAppShell(page, {
        profile: {
            id: 77,
            username: "accepted-user",
            role: "user",
        },
    });

    await page.goto(
        "http://localhost:3000/info?platform=web"
    );

    await expect(
        page.locator(".info-page")
    ).toBeVisible();

    await expect(
        page.getByRole("dialog", {
            name: "Принятие публичной оферты",
        })
    ).toHaveCount(0);
});

test("ошибка проверки оферты блокирует рабочие страницы", async ({ page }) => {
    const token = createMockJwt({
        id: 78,
        username: "offer-check-error",
        role: "user",
    });

    await page.addInitScript((value) => {
        localStorage.setItem("authToken", value);
    }, token);

    await mockAppShell(page, {
        profile: {
            id: 78,
            username: "offer-check-error",
            role: "user",
        },
    });

    await page.route(
        "**/api/legal/offer/status",
        async (route) => {
            await route.fulfill({
                status: 503,
                json: {
                    message: "Временная ошибка",
                },
            });
        }
    );

    await page.goto(
        "http://localhost:3000/info?platform=web"
    );

    const dialog = page.getByRole("dialog", {
        name: "Принятие публичной оферты",
    });

    await expect(dialog).toBeVisible();

    await expect(
        dialog.getByRole("button", {
            name: "Повторить проверку",
        })
    ).toBeVisible();

    await expect(
        page.locator(".info-page")
    ).toHaveCount(0);
});
