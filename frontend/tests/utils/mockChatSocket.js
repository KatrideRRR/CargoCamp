async function mockChatSocket(page) {
    const connections = [];

    await page.routeWebSocket("**/socket.io/**", (ws) => {
        const connection = {
            clientMessages: [],

            emit(event, payload) {
                ws.send(
                    `42${JSON.stringify([event, payload])}`
                );
            },
        };

        connections.push(connection);

        ws.onMessage((message) => {
            const raw = String(message);

            connection.clientMessages.push(raw);

            // Socket.IO подключение.
            if (raw.startsWith("40")) {
                ws.send('40{"sid":"mock-socket-1"}');
                return;
            }

            // Engine.IO heartbeat.
            if (raw === "2") {
                ws.send("3");
            }
        });

        // Поддельное Engine.IO соединение.
        ws.send(
            '0{"sid":"mock-engine-1",' +
            '"upgrades":[],' +
            '"pingInterval":25000,' +
            '"pingTimeout":20000,' +
            '"maxPayload":1000000}'
        );
    });

    return connections;
}

module.exports = {
    mockChatSocket,
};