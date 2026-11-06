const {
    test: base,
    expect,
} = require("@playwright/test");

const FRONT_ORIGIN = "http://localhost:3001";

const test = base.extend({
    networkFence: [
        async ({ context }, use, testInfo) => {
            const unexpectedRequests = [];

            await context.route("**/*", async (route) => {
                const request = route.request();

                let url;

                try {
                    url = new URL(request.url());
                } catch {
                    unexpectedRequests.push(request.url());
                    await route.abort("blockedbyclient");
                    return;
                }

                if (url.origin === FRONT_ORIGIN) {
                    await route.continue();
                    return;
                }

                unexpectedRequests.push(
                    `${request.method()} ${url.href}`
                );

                await route.abort("blockedbyclient");
            });

            await context.routeWebSocket(
                "**/*",
                (webSocket) => {
                    const url = new URL(webSocket.url());

                    // Разрешаем только служебный WebSocket
                    // локального React Dev Server.
                    if (
                        url.protocol === "ws:" &&
                        url.hostname === "localhost" &&
                        url.port === "3001" &&
                        url.pathname === "/ws"
                    ) {
                        webSocket.connectToServer();
                        return;
                    }

                    // Любые остальные WebSocket-соединения
                    // должны быть явно замоканы в тестах.
                    unexpectedRequests.push(
                        `WEBSOCKET ${webSocket.url()}`
                    );

                    webSocket.close({
                        code: 1008,
                        reason: "Blocked by isolated Playwright test",
                    });
                }
            );

            await use();

            expect(
                unexpectedRequests,
                `Незамокированные запросы в тесте: ${testInfo.title}`
            ).toEqual([]);
        },

        { auto: true },
    ],
});

module.exports = {
    test,
    expect,
};