const test = require("node:test");
const assert = require("node:assert/strict");

const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

const UUID =
    "123e4567-e89b-42d3-a456-426614174000";

const ACCESS = {
    orderId: 101,
    orderType: "regular",
    userId: 1,
    otherUserId: 2,
};

function makeAccessService({
                               order = {
                                   id: 101,
                                   creatorId: 2,
                                   executorId: 1,
                               },
                           } = {}) {
    const Order = {
        async findByPk(id) {
            return Number(id) === 101
                ? order
                : null;
        },
    };

    const ExpressOrder = {
        async findByPk(id) {
            return Number(id) === 101
                ? order
                : null;
        },
    };

    return loadIsolatedService(
        "chatOrderAccess.js",
        {
            "../models": {
                Order,
                ExpressOrder,
            },
        }
    );
}

function makeChatIdempotencyService(existing = null) {
    const Message = {
        async findOne({ where }) {
            assert.deepEqual(where, {
                senderId: 1,
                clientMessageId: UUID,
            });

            return existing;
        },

        async findByPk(id) {
            if (!existing || id !== existing.id) {
                return null;
            }

            return {
                ...existing,
                hydrated: true,
            };
        },
    };

    return loadIsolatedService(
        "chatMessageIdempotency.js",
        {
            "../models": {
                Message,
                User: {},
            },

            "./chatOrderAccess":
                makeAccessService(),

            "./chatReplyService": {
                getChatMessageIncludes: () => [],
            },
        }
    );
}

function makeSupportService({
                                simulateDuplicateRace = false,
                            } = {}) {
    const rows = [];
    let createCalls = 0;

    const SupportMessage = {
        async findOne({ where }) {
            return rows.find((row) =>
                row.senderId === where.senderId &&
                row.clientMessageId ===
                where.clientMessageId
            ) || null;
        },

        async findByPk(id) {
            return rows.find(
                (row) => row.id === id
            ) || null;
        },

        async create(data) {
            createCalls++;

            const row = {
                id: 500 + createCalls,
                ...data,
            };

            rows.push(row);

            if (simulateDuplicateRace) {
                const error = new Error(
                    "Duplicate entry"
                );

                error.name =
                    "SequelizeUniqueConstraintError";

                throw error;
            }

            return row;
        },
    };

    const chatIdempotency =
        makeChatIdempotencyService();

    const service = loadIsolatedService(
        "supportMessageIdempotency.js",
        {
            "../models": {
                SupportMessage,
                User: {},
            },

            "./chatMessageIdempotency": {
                normalizeClientMessageId:
                chatIdempotency.normalizeClientMessageId,

                isDuplicateKeyError:
                chatIdempotency.isDuplicateKeyError,
            },
        }
    );

    return {
        service,
        rows,
        get createCalls() {
            return createCalls;
        },
    };
}

/*
 * 1. Проверка UUID.
 */
test("backend: проверяет и нормализует UUID сообщения", () => {
    const service =
        makeChatIdempotencyService();

    assert.equal(
        service.normalizeClientMessageId(
            UUID.toUpperCase()
        ),
        UUID
    );

    assert.equal(
        service.normalizeClientMessageId(null),
        null
    );

    assert.throws(
        () => service.normalizeClientMessageId(
            "invalid-uuid"
        ),
        {
            status: 400,
        }
    );
});

/*
 * 2. Чужая переписка недоступна.
 */
test("backend: посторонний не получает доступ к чату заказа", async () => {
    const service = makeAccessService();

    const ownerAccess =
        await service.requireChatOrderAccess({
            orderId: 101,
            orderType: "regular",
            userId: 1,
        });

    assert.equal(
        ownerAccess.otherUserId,
        2
    );

    await assert.rejects(
        () => service.requireChatOrderAccess({
            orderId: 101,
            orderType: "regular",
            userId: 999,
        }),
        {
            status: 404,
            message: "Заказ не найден",
        }
    );
});

/*
 * 3. Express-заказ тоже проверяет участников.
 */
test("backend: проверяет доступ к express-чату", async () => {
    const service = makeAccessService();

    const access =
        await service.requireChatOrderAccess({
            orderId: 101,
            orderType: "express",
            userId: 2,
        });

    assert.equal(access.orderType, "express");
    assert.equal(access.otherUserId, 1);

    await assert.rejects(
        () => service.requireChatOrderAccess({
            orderId: 101,
            orderType: "express",
            userId: 999,
        }),
        {
            status: 404,
        }
    );
});

/*
 * 4. Повтор обычного сообщения.
 */
test("backend: повтор с тем же UUID возвращает существующее сообщение", async () => {
    const existing = {
        id: 77,
        orderId: 101,
        orderType: "regular",
        senderId: 1,
        receiverId: 2,
        content: "Привет",
        clientMessageId: UUID,
        replyToMessageId: null,
    };

    const service =
        makeChatIdempotencyService(existing);

    const result =
        await service.findExistingChatMessage({
            access: ACCESS,
            clientMessageId: UUID,
            content: "Привет",
            replyToMessageId: null,
        });

    assert.equal(result.id, 77);
    assert.equal(result.hydrated, true);
});

/*
 * 5. Нельзя использовать прежний UUID
 * для другого сообщения.
 */
test("backend: запрещает подмену сообщения с прежним UUID", async () => {
    const existing = {
        id: 77,
        orderId: 101,
        orderType: "regular",
        senderId: 1,
        receiverId: 2,
        content: "Привет",
        clientMessageId: UUID,
        replyToMessageId: null,
    };

    const service =
        makeChatIdempotencyService(existing);

    await assert.rejects(
        () => service.findExistingChatMessage({
            access: ACCESS,
            clientMessageId: UUID,
            content: "Другой текст",
        }),
        {
            status: 409,
        }
    );

    // Другую цитату также нельзя
    // отправить с прежним UUID.
    await assert.rejects(
        () => service.findExistingChatMessage({
            access: ACCESS,
            clientMessageId: UUID,
            content: "Привет",
            replyToMessageId: 50,
        }),
        {
            status: 409,
        }
    );
});

/*
 * 6. Поддержка: одно сообщение,
 * даже если клиент повторил отправку.
 */
test("backend: поддержка не создаёт дубль при повторе UUID", async () => {
    const harness = makeSupportService();

    const request = {
        userId: 101,
        senderId: 101,
        senderRole: "user",
        text: "Нужна помощь",
        rawClientMessageId: UUID,
    };

    const first =
        await harness.service.createSupportMessage(
            request
        );

    assert.equal(first.created, true);
    assert.equal(first.message.id, 501);

    const second =
        await harness.service.createSupportMessage(
            request
        );

    assert.equal(second.created, false);
    assert.equal(second.message.id, 501);

    assert.equal(harness.createCalls, 1);
    assert.equal(harness.rows.length, 1);
});

/*
 * 7. Поддержка: нельзя переиспользовать UUID
 * для другого текста или диалога.
 */
test("backend: поддержка запрещает конфликт UUID", async () => {
    const harness = makeSupportService();

    const request = {
        userId: 101,
        senderId: 1,
        senderRole: "admin",
        text: "Здравствуйте",
        rawClientMessageId: UUID,
    };

    await harness.service.createSupportMessage(
        request
    );

    await assert.rejects(
        () => harness.service.createSupportMessage({
            ...request,
            text: "Другой ответ",
        }),
        {
            status: 409,
        }
    );

    await assert.rejects(
        () => harness.service.createSupportMessage({
            ...request,
            userId: 202,
        }),
        {
            status: 409,
        }
    );

    assert.equal(harness.createCalls, 1);
});

/*
 * 8. Два параллельных запроса:
 * MySQL сообщил о дубликате.
 */
test("backend: восстанавливается после ошибки уникальности UUID", async () => {
    const harness = makeSupportService({
        simulateDuplicateRace: true,
    });

    const result =
        await harness.service.createSupportMessage({
            userId: 101,
            senderId: 101,
            senderRole: "user",
            text: "Повторная отправка",
            rawClientMessageId: UUID,
        });

    // Вместо ошибки возвращается
    // уже сохранённая запись.
    assert.equal(result.created, false);
    assert.equal(result.message.id, 501);

    assert.equal(harness.createCalls, 1);
    assert.equal(harness.rows.length, 1);
});