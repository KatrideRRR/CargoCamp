let approvalBody = null;

await page.route(
    "**/api/express/express-orders/201/reservation/requests",
    async (route) => {
        await route.fulfill({
            status: 200,

            json: {
                success: true,

                requests: [
                    {
                        id: 501,

                        executor: {
                            id: 20,

                            username:
                                "Тестовый водитель",

                            rating: 4.9,

                            vehicleBrand:
                                "Toyota",

                            vehicleModel:
                                "Camry",

                            vehicleColor:
                                "Белый",
                        },

                        expiresAt:
                            new Date(
                                Date.now() +
                                120000
                            ).toISOString(),
                    },
                ],
            },
        });
    }
);

await page.route(
    "**/api/express/express-orders/201/reservation/approve",
    async (route) => {
        approvalBody =
            route.request().postDataJSON();

        await route.fulfill({
            status: 200,

            json: {
                success: true,

                order: {
                    id: 201,
                    status: "reserved",
                    executorId: 20,
                },
            },
        });
    }
);

const requestCard =
    page.locator(".cc-express-requests");

await expect(
    requestCard
).toBeVisible();

await expect(
    requestCard
).toContainText(
    "Тестовый водитель"
);

await expect(
    requestCard
).toContainText(
    "Toyota Camry"
);

page.once(
    "dialog",
    (dialog) => dialog.accept()
);

await requestCard.getByRole(
    "button",
    {
        name:
            "Согласиться подождать",

        exact: true,
    }
).click();

await expect
    .poll(
        () => approvalBody
    )
    .toEqual({
        requestId: 501,
    });

await page.route(
    "**/api/express/express-orders/*/reservation/requests",
    async (route) => {
        await route.fulfill({
            status: 200,

            json: {
                success: true,
                requests: [],
            },
        });
    }
);


await page.route(
    "**/api/express/express-orders/reservation/me",
    async (route) => {
        await route.fulfill({
            status: 200,

            json: {
                success: true,
                request: null,
            },
        });
    }
);