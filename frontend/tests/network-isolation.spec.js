const {
    test,
    expect,
} = require("./fixtures/safeTest");

test(
    "тестовый Socket.IO подключается без реального backend",
    async ({ page }) => {
        await page.goto("about:blank");

        const response = await page.evaluate(() => {
            return new Promise((resolve, reject) => {
                const socket = new WebSocket(
                    "ws://127.0.0.1:59999/socket.io/" +
                    "?EIO=4&transport=websocket"
                );

                const timeout = setTimeout(() => {
                    socket.close();

                    reject(
                        new Error(
                            "Тестовый Socket.IO не ответил"
                        )
                    );
                }, 5000);

                socket.onmessage = (event) => {
                    const message = String(event.data);

                    if (message.startsWith("0")) {
                        socket.send("40");
                        return;
                    }

                    if (message.startsWith("40")) {
                        clearTimeout(timeout);

                        socket.close();

                        resolve(message);
                    }
                };

                socket.onerror = () => {
                    clearTimeout(timeout);

                    reject(
                        new Error(
                            "Ошибка тестового WebSocket"
                        )
                    );
                };
            });
        });

        expect(response).toContain(
            "isolated-default-socket"
        );
    }
);