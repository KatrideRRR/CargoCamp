const {
    mockAdminSocket,
} = require("./mockAdminSocket");

// Безопасный GET-мок.
// Неизвестные методы передаются в сетевой блокировщик safeTest.
async function mockGet(page, path, response) {
    await page.route(`**${path}`, async (route) => {
        if (route.request().method() !== "GET") {
            await route.fallback();
            return;
        }

        await route.fulfill({
            status: 200,
            json: response,
        });
    });
}

// Переход на страницу пользователей.
async function mockUsersNavigation(page) {
    await mockGet(
        page,
        "/api/admin/users",
        []
    );

    await mockGet(
        page,
        "/api/admin/pep/enrollments",
        {
            success: true,
            enrollments: [],
        }
    );
}

// Переход к списку заказов.
async function mockOrdersNavigation(page) {
    await mockGet(
        page,
        "/api/admin/orders",
        []
    );

    await mockGet(
        page,
        "/api/admin/express-orders",
        []
    );
}

// Переход в поддержку.
async function mockSupportNavigation(page) {
    await mockAdminSocket(page);

    await mockGet(
        page,
        "/api/admin/support/chats",
        []
    );
}

// Переход в детали обычного заказа.
async function mockOrderDetailsNavigation(page, id) {
    await mockGet(
        page,
        `/api/admin/orders/${id}`,
        {
            id,
            status: "pending",
            address: "Тестовый адрес",
            creatorId: 10,
            executorId: null,
            proposedSum: 1500,
            paymentType: "cash",
            adminDeleted: false,
            creatorHidden: false,
            images: [],
            disputes: [],
        }
    );

    await mockGet(
        page,
        `/api/admin/orders/${id}/logs`,
        {
            rows: [],
        }
    );
}

// Переход в детали экспресс-заказа.
async function mockExpressOrderDetailsNavigation(
    page,
    id
) {
    await mockGet(
        page,
        `/api/admin/express-orders/${id}`,
        {
            id,
            type: "taxi",
            status: "created",
            creatorId: 10,
            executorId: null,
            totalPrice: 700,
            paymentType: "cash",
            fromAddress: "Тестовая точка А",
            toAddress: "Тестовая точка Б",
            adminDeleted: false,
            creatorHidden: false,
        }
    );

    await mockGet(
        page,
        `/api/admin/express-orders/${id}/logs`,
        {
            rows: [],
        }
    );

    // У экспресс-заказа споры загружаются отдельно.
    await page.route(
        (url) =>
            url.pathname === "/api/admin/disputes" &&
            url.searchParams.get("orderType") ===
            "express" &&
            url.searchParams.get("orderId") ===
            String(id),

        async (route) => {
            if (route.request().method() !== "GET") {
                await route.fallback();
                return;
            }

            await route.fulfill({
                status: 200,
                json: {
                    disputes: [],
                },
            });
        }
    );
}

// Переход к переписке обычного заказа.
// Сам заказ уже замокан исходным тестом.
async function mockMessagesNavigation(page, orderId) {
    await mockGet(
        page,
        `/api/admin/orders/${orderId}/messages`,
        []
    );
}

// Переход на создание заказа.
// Яндекс.Карты заменяем полностью искусственным объектом.
async function mockCreateOrderNavigation(page) {
    await page.route(
        "https://api-maps.yandex.ru/2.1/**",
        async (route) => {
            await route.fulfill({
                status: 200,
                contentType: "application/javascript",
                body: `
                    window.ymaps = {
                        ready: function () {
                            return Promise.resolve();
                        },
                        route: function () {
                            return Promise.resolve({
                                getLength: function () {
                                    return 5400;
                                },
                                getTime: function () {
                                    return 900;
                                }
                            });
                        }
                    };
                `,
            });
        }
    );
}

module.exports = {
    mockUsersNavigation,
    mockOrdersNavigation,
    mockSupportNavigation,
    mockOrderDetailsNavigation,
    mockExpressOrderDetailsNavigation,
    mockMessagesNavigation,
    mockCreateOrderNavigation,
};