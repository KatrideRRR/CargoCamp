async function mockAdminSocket(page) {
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

            if (raw.startsWith("40")) {
                ws.send('40{"sid":"mock-admin-socket"}');
                return;
            }

            if (raw === "2") {
                ws.send("3");
            }
        });

        ws.send(
            '0{"sid":"mock-engine",' +
            '"upgrades":[],' +
            '"pingInterval":25000,' +
            '"pingTimeout":20000,' +
            '"maxPayload":1000000}'
        );
    });

    return connections;
}

module.exports = {
    mockAdminSocket,
};