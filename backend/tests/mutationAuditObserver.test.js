
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    EventEmitter,
} = require("node:events");

const {
    buildMutationAuditEntry,
    createMutationAuditObserver,
} = require(
    "../middlewares/mutationAuditObserver"
);

function makeRequest({
                         method = "POST",
                         url = "/api/orders/123/request",
                         route = "/:id/request",
                         userId = 25,
                         admin = false,
                         params = { id: "123" },
                     } = {}) {
    return {
        method,
        originalUrl: url,
        route: {
            path: route,
        },

        params,
        user: userId
            ? {
                id: userId,
                role: admin
                    ? "admin"
                    : "user",
            }
            : null,

        adminSession: admin
            ? { id: 17 }
            : null,

        ip: "127.0.0.1",

        headers: {
            "user-agent": "CargoCamp-Test",

            authorization:
                "Bearer SECRET_SHOULD_NOT_APPEAR",
        },

        body: {
            password:
                "PRIVATE_PASSWORD",

            smsCode:
                "123456",

            cardToken:
                "PRIVATE_BANK_TOKEN",
        },
    };
}

function makeResponse(statusCode = 200) {
    const response = new EventEmitter();

    response.statusCode = statusCode;

    return response;
}

async function nextTick() {
    await new Promise((resolve) =>
        setImmediate(resolve)
    );
}

test(
    "Успешное изменение заказа записывается",
    async () => {
        const entries = [];

        const observer =
            createMutationAuditObserver({
                write: async (entry) => {
                    entries.push(entry);
                },
            });

        const req = makeRequest();
        const res = makeResponse(200);

        let nextCalled = 0;

        observer(req, res, () => {
            nextCalled += 1;
        });

        res.emit("finish");
        await nextTick();

        assert.equal(nextCalled, 1);
        assert.equal(entries.length, 1);

        const entry = entries[0];

        assert.equal(
            entry.actionType,
            "api_mutation"
        );

        assert.equal(
            entry.actorUserId,
            25
        );

        assert.equal(
            entry.entityType,
            "order"
        );

        assert.equal(
            entry.orderId,
            123
        );

        assert.equal(
            entry.meta.method,
            "POST"
        );

        assert.equal(
            entry.meta.route,
            "/:id/request"
        );

        assert.equal(
            entry.meta.httpStatus,
            200
        );
    }
);

test(
    "Отклонённые запросы не считаются выполненными",
    () => {
        for (const status of [
            400,
            401,
            403,
            404,
            409,
            500,
            503,
        ]) {
            const req = makeRequest();

            const entry =
                buildMutationAuditEntry(
                    req,
                    status
                );

            assert.equal(
                entry,
                null
            );
        }
    }
);

test(
    "GET не создаёт запись изменения",
    () => {
        const req = makeRequest({
            method: "GET",
        });

        assert.equal(
            buildMutationAuditEntry(
                req,
                200
            ),
            null
        );
    }
);

test(
    "Неавторизованный запрос не получает чужой actorId",
    () => {
        const req = makeRequest({
            userId: null,
        });

        assert.equal(
            buildMutationAuditEntry(
                req,
                200
            ),
            null
        );
    }
);

test(
    "Административная операция сохраняет администратора",
    () => {
        const req = makeRequest({
            method: "PUT",
            url: "/api/admin/users/42/role",
            route: "/users/:id/role",
            userId: 15,
            admin: true,
            params: {
                id: "42",
            },
        });

        const entry =
            buildMutationAuditEntry(
                req,
                200
            );

        assert.equal(
            entry.actorRole,
            "admin"
        );

        assert.equal(
            entry.actorUserId,
            15
        );

        assert.equal(
            entry.entityType,
            "admin"
        );

        assert.equal(
            entry.entityId,
            42
        );
    }
);

test(
    "Личные данные не попадают в журнал",
    () => {
        const req = makeRequest({
            url:
                "/api/orders/123/request" +
                "?token=PRIVATE_QUERY_SECRET",
        });

        const entry =
            buildMutationAuditEntry(
                req,
                201
            );

        const serialized =
            JSON.stringify(entry);

        for (const forbidden of [
            "PRIVATE_PASSWORD",
            "123456",
            "PRIVATE_BANK_TOKEN",
            "PRIVATE_QUERY_SECRET",
            "SECRET_SHOULD_NOT_APPEAR",
        ]) {
            assert.equal(
                serialized.includes(forbidden),
                false
            );
        }
    }
);

test(
    "Ошибка записи вызывает мониторинг, но не ломает запрос",
    async () => {
        const reports = [];

        const observer =
            createMutationAuditObserver({
                write: async () => {
                    const error =
                        new Error(
                            "PRIVATE_DATABASE_DETAILS"
                        );

                    error.code =
                        "ER_LOCK_DEADLOCK";

                    throw error;
                },

                report: async (error) => {
                    reports.push(error.code);
                },
            });

        const req = makeRequest();
        const res = makeResponse(200);

        let nextCalled = false;

        observer(req, res, () => {
            nextCalled = true;
        });

        res.emit("finish");

        await nextTick();
        await nextTick();

        assert.equal(nextCalled, true);

        assert.deepEqual(
            reports,
            ["ER_LOCK_DEADLOCK"]
        );
    }
);

test(
    "Одно завершение запроса создаёт одну общую запись",
    async () => {
        const entries = [];

        const observer =
            createMutationAuditObserver({
                write: async (entry) => {
                    entries.push(entry);
                },
            });

        const req = makeRequest();
        const res = makeResponse(204);

        observer(req, res, () => {});

        res.emit("finish");
        res.emit("finish");

        await nextTick();

        assert.equal(entries.length, 1);
    }
);
