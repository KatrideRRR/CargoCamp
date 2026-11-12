const {
    test: base,
    expect,
} = require("@playwright/test");

const FRONT_ORIGIN = "http://localhost:3000";

const test = base.extend({
    networkFence: [
        async ({ context }, use, testInfo) => {
            const unexpectedRequests = [];

            /*
             * Запрещаем обращения к любым
             * внешним адресам.
             *
             * Разрешаем только frontend.
             *
             * Специальные моки page.route()
             * имеют приоритет над этим
             * обработчиком.
             */
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

            await context.route(
                "**/api/legal/offer/status",
                async (route) => {
                    if (route.request().method() !== "GET") {
                        await route.fallback();
                        return;
                    }

                    await route.fulfill({
                        status: 200,
                        contentType: "application/json",
                        body: JSON.stringify({
                            version: "2026-11-09",
                            sha256: "isolated-playwright-offer",
                            accepted: true,
                            acceptedAt: "2026-11-12T00:00:00.000Z",
                        }),
                    });
                }
            );

            await context.routeWebSocket(
                "**/*",
                (webSocket) => {
                    const url = new URL(
                        webSocket.url()
                    );

                    const isLocalDevSocket =
                        url.protocol === "ws:" &&
                        url.hostname === "localhost" &&
                        url.port === "3000" &&
                        url.pathname === "/ws";

                    if (isLocalDevSocket) {
                        webSocket.connectToServer();
                        return;
                    }

                    /*
 * Стандартный тестовый Socket.IO.
 *
 * Разрешаем исключительно фиктивный адрес,
 * заданный в playwright.config.js.
 *
 * Реальный backend никогда не вызывается.
 */
                    const isFakeBackendSocket =
                        url.protocol === "ws:" &&
                        url.hostname === "127.0.0.1" &&
                        url.port === "59999" &&
                        url.pathname === "/socket.io/";

                    if (isFakeBackendSocket) {
                        webSocket.onMessage((message) => {
                            const raw = String(message);

                            // Socket.IO namespace handshake.
                            if (raw.startsWith("40")) {
                                webSocket.send(
                                    '40{"sid":"isolated-default-socket"}'
                                );

                                return;
                            }

                            // Engine.IO heartbeat.
                            if (raw === "2") {
                                webSocket.send("3");
                            }
                        });

                        // Поддельное Engine.IO-соединение.
                        webSocket.send(
                            '0{"sid":"isolated-engine",' +
                            '"upgrades":[],' +
                            '"pingInterval":25000,' +
                            '"pingTimeout":20000,' +
                            '"maxPayload":1000000}'
                        );

                        return;
                    }

                    unexpectedRequests.push(
                        `WEBSOCKET ${webSocket.url()}`
                    );

                    webSocket.close({
                        code: 1008,
                        reason:
                            "Blocked by isolated Playwright test",
                    });
                }
            );

            await use();

            /*
             * Тест не должен считаться успешным,
             * если приложение попыталось
             * обратиться к незамокированному API
             * или внешнему сервису.
             */
            expect(
                unexpectedRequests,
                `В тесте "${testInfo.title}" обнаружены ` +
                "незамокированные сетевые запросы"
            ).toEqual([]);
        },

        { auto: true },
    ],
});

module.exports = {
    test,
    expect,
};