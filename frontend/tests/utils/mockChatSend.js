async function mockSuccessfulChatSend(page, messageId) {
    const requests = [];

    await page.route("**/api/messages", async (route) => {
        const request = route.request();

        if (request.method() !== "POST") {
            await route.fulfill({
                status: 405,
                json: {
                    message: "Метод не поддерживается",
                },
            });
            return;
        }

        const body = request.postDataJSON();

        requests.push(body);

        // Имитируем успешное сохранение сообщения.
        await route.fulfill({
            status: 201,
            json: {
                id: messageId,
                content: body.content,
                senderId: 1,
                receiverId: Number(body.receiverId),
                orderId: Number(body.orderId),
                orderType: body.orderType,
                clientMessageId: body.clientMessageId,
                replyToMessageId: body.replyToMessageId,
                createdAt: "2026-07-01T10:10:00.000Z",
                readAt: null,
            },
        });
    });

    return requests;
}

module.exports = {
    mockSuccessfulChatSend,
};