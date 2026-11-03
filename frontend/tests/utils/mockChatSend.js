async function mockSuccessfulChatSend(
    page,
    messageId,
    { replyTo = null } = {}
) {
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

        const replyToMessageId =
            body.replyToMessageId == null
                ? null
                : Number(body.replyToMessageId);

        const replyToMessage =
            replyToMessageId &&
            Number(replyTo?.id) === replyToMessageId
                ? {
                    id: Number(replyTo.id),
                    senderId: replyTo.senderId,
                    content: replyTo.content,
                    createdAt: replyTo.createdAt,
                }
                : null;

        const savedMessage = {
            id: messageId,
            content: body.content,

            senderId: 1,
            receiverId: Number(body.receiverId),

            orderId: Number(body.orderId),
            orderType: body.orderType,

            clientMessageId: body.clientMessageId,

            // Связь с исходным сообщением
            replyToMessageId,

            // Содержимое цитируемого сообщения
            replyTo: replyToMessage,

            createdAt: "2026-07-01T10:10:00.000Z",
            readAt: null,
        };

        await route.fulfill({
            status: 201,
            json: savedMessage,
        });
    });

    return requests;
}

async function mockChatSendAfterFailure(page, {
    firstStatus = 500,
    firstMessage = "Тестовая ошибка сервера",
    messageId = 1002,
    replyTo = null,
} = {}) {
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

        // Первая отправка завершается ошибкой.
        if (requests.length === 1) {
            await route.fulfill({
                status: firstStatus,
                json: {
                    message: firstMessage,
                },
            });
            return;
        }

        // Повторная отправка успешно подтверждается.
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

                replyTo:
                    body.replyToMessageId != null &&
                    Number(body.replyToMessageId) === Number(replyTo?.id)
                        ? {
                            id: Number(replyTo.id),
                            senderId: replyTo.senderId,
                            content: replyTo.content,
                            createdAt: replyTo.createdAt,
                        }
                        : null,

                createdAt: "2026-07-01T10:15:00.000Z",
                readAt: null,
            },
        });
    });

    return requests;
}

module.exports = {
    mockSuccessfulChatSend,
    mockChatSendAfterFailure,
};