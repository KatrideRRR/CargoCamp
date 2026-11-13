const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

const {
    loadIsolatedRouter,
} = require("./helpers/loadIsolatedRouter");

const {
    getAdminSelfActionError,
} = require("../utils/adminRoleSafety");

const VEHICLE = {
    id: 101,
    role: "user",
    vehicleBrand: "Toyota",
    vehicleModel: "Camry",
    vehicleColor: "Чёрный",
    vehiclePlate: "А123АА82",
    vehicleYear: 2020,
    vehiclePhoto: "/uploads/test-car.jpg",
    vehicleVerificationStatus: "pending",
    vehicleVerificationNote: null,
};

const INCOMPLETE_VEHICLE = {
    ...VEHICLE,
    id: 102,
    vehicleModel: null,
};

async function createTestServer({
                                    saveFails = false,
                                    notificationFails = false,
                                } = {}) {
    // Искусственная база пользователей.
    const users = new Map([
        [101, { ...VEHICLE }],
        [102, { ...INCOMPLETE_VEHICLE }],
    ]);

    const notifications = [];
    const writes = [];

    const User = {
        async findByPk(id) {
            const record = users.get(Number(id));

            if (!record) {
                return null;
            }

            return {
                ...record,

                async save() {
                    if (saveFails) {
                        throw new Error(
                            "TEST_DATABASE_WRITE_FAILED"
                        );
                    }

                    const {
                        save,
                        ...updated
                    } = this;

                    const stored = { ...updated };

                    users.set(
                        Number(this.id),
                        stored
                    );

                    writes.push({
                        id: this.id,
                        vehicleVerificationStatus:
                        this.vehicleVerificationStatus,
                    });
                },
            };
        },
    };

    // Искусственная авторизация.
    const authMiddleware = (req, res, next) => {
        const authorization =
            req.headers.authorization;

        if (authorization === "Bearer admin-test") {
            req.user = {
                id: 1,
                role: "admin",
            };

            return next();
        }

        if (authorization === "Bearer user-test") {
            req.user = {
                id: 2,
                role: "user",
            };

            return next();
        }

        return res.status(401).json({
            message: "Нет доступа",
        });
    };

    const adminMiddleware = (req, res, next) => {
        if (req.user?.role !== "admin") {
            return res.status(403).json({
                message: "Доступ запрещен",
            });
        }

        return next();
    };

    const notifyUser = async (notification) => {
        notifications.push(notification);

        if (notificationFails) {
            throw new Error(
                "TEST_NOTIFICATION_FAILED"
            );
        }
    };

    const models = {
        User,
        Message: {},
        Order: {},
        ExpressOrder: {},
        Category: {},
        Subcategory: {},
        Dispute: {},
        ActionLog: {},
        Service: {},
        sequelize: {
            async transaction(callback) {
                return callback({
                    LOCK: {
                        UPDATE: "UPDATE",
                    },
                });
            },
        },
    };

    const vehicleService = loadIsolatedService(
        "vehicleVerificationService.js",
        {
            "../models": models,
        }
    );
    // Загружаем реальный backend/routes/admin.js,
    // но полностью заменяем внешние зависимости.
    const router = loadIsolatedRouter(
        "admin.js",
        {
            express,

            "../middlewares/adminAuth": {
                authMiddleware,
                adminMiddleware,
            },

            jsonwebtoken: {},

            "node-geocoder": () => ({
                geocode: async () => [],
            }),

            sequelize: {
                Op: {},
            },

            "../services/vehicleVerificationService":
            vehicleService,

            "../services/notificationService": {
                notifyUser,
            },

            "../models": models,

            bcrypt: {},

            "../services/recommendedPriceService": {
                calculateRecommendedPrice: () => null,
            },

            "../services/authSessionService": {
                createAuthSession: async () => null,
                refreshAuthSession: async () => null,
                revokeAuthSession: async () => null,
            },

            "../utils/adminSessionCookie": {
                validateAdminSessionOrigin: () => {},
                getAdminRefreshToken: () => null,
                setAdminRefreshCookie: () => {},
                clearAdminRefreshCookie: () => {},
            },

            "../utils/adminRoleSafety": {
                getAdminSelfActionError,
            },
        }
    );

    const app = express();

    app.use(express.json());
    app.use("/api/admin", router);

    // ОС выбирает свободный локальный порт.
    const server = await new Promise((resolve, reject) => {
        const instance = app.listen(
            0,
            "127.0.0.1",
            () => resolve(instance)
        );

        instance.once("error", reject);
    });

    const baseURL =
        `http://127.0.0.1:${server.address().port}`;

    async function request(
        method,
        endpoint,
        body,
        token = "admin-test"
    ) {


        let requestBody = body;

        if (
            method === "PUT" &&
            /\/vehicle-verification$/.test(endpoint) &&
            body &&
            !Object.prototype.hasOwnProperty.call(
                body,
                "expectedVehicle"
            )
        ) {
            const match = endpoint.match(
                /\/users\/(\d+)\/vehicle-verification$/
            );

            const current = match
                ? users.get(Number(match[1]))
                : null;

            if (current) {
                requestBody = {
                    ...body,
                    expectedVehicle:
                        vehicleService.getVehicleSnapshot(
                            current
                        ),
                };
            }
        }


        const response = await fetch(
            `${baseURL}${endpoint}`,
            {
                method,

                headers: {
                    "Content-Type": "application/json",

                    ...(token
                        ? {
                            Authorization:
                                `Bearer ${token}`,
                        }
                        : {}),
                },

                ...(body === undefined
                    ? {}
                    : {
                        body: JSON.stringify(requestBody),
                    }),
            }
        );

        return {
            status: response.status,
            body: await response.json(),
        };
    }

    return {
        request,

        getUser(id) {
            return users.get(Number(id));
        },

        setUser(id, changes) {
            users.set(Number(id), {
                ...users.get(Number(id)),
                ...changes,
            });
        },

        notifications,
        writes,

        async close() {
            await new Promise((resolve, reject) => {
                server.close((error) => {
                    if (error) {
                        reject(error);
                    } else {
                        resolve();
                    }
                });

                server.closeAllConnections?.();
            });
        },
    };
}

async function withServer(callback, options = {}) {
    const api = await createTestServer(options);

    try {
        await callback(api);
    } finally {
        await api.close();
    }
}

const VERIFY =
    "/api/admin/users/101/vehicle-verification";

const VERIFY_INCOMPLETE =
    "/api/admin/users/102/vehicle-verification";

test("HTTP: без авторизации проверка автомобиля запрещена", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "PUT",
            VERIFY,
            { status: "verified" },
            null
        );

        assert.equal(response.status, 401);
        assert.equal(api.writes.length, 0);
    });
});

test("HTTP: обычный пользователь не может проверять автомобили", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "PUT",
            VERIFY,
            { status: "verified" },
            "user-test"
        );

        assert.equal(response.status, 403);
        assert.equal(api.writes.length, 0);
    });
});

test("HTTP: некорректный ID отклоняется", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "PUT",
            "/api/admin/users/0/vehicle-verification",
            { status: "verified" }
        );

        assert.equal(response.status, 400);
        assert.equal(api.writes.length, 0);
    });
});

test("HTTP: неизвестный статус отклоняется", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "PUT",
            VERIFY,
            { status: "pending" }
        );

        assert.equal(response.status, 400);
        assert.equal(api.writes.length, 0);
    });
});

test("HTTP: неизвестный пользователь возвращает 404", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "PUT",
            "/api/admin/users/999/vehicle-verification",
            { status: "verified" }
        );

        assert.equal(response.status, 404);
    });
});

test("HTTP: нельзя подтвердить автомобиль с неполными данными", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "PUT",
            VERIFY_INCOMPLETE,
            { status: "verified" }
        );

        assert.equal(response.status, 400);

        assert.equal(
            api.getUser(102).vehicleVerificationStatus,
            "pending"
        );

        assert.equal(api.writes.length, 0);
        assert.equal(api.notifications.length, 0);
    });
});

test("HTTP: нельзя отклонить автомобиль без причины", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "PUT",
            VERIFY,
            {
                status: "rejected",
            }
        );

        assert.equal(response.status, 400);
        assert.equal(api.writes.length, 0);
    });
});

test("HTTP: причина из одних пробелов не принимается", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "PUT",
            VERIFY,
            {
                status: "rejected",
                note: "   ",
            }
        );

        assert.equal(response.status, 400);
        assert.equal(api.writes.length, 0);
    });
});

test("HTTP: автомобиль без обязательных данных можно отклонить", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "PUT",
            VERIFY_INCOMPLETE,
            {
                status: "rejected",
                note: "  Не указана модель  ",
            }
        );

        assert.equal(response.status, 200);

        assert.equal(
            api.getUser(102).vehicleVerificationStatus,
            "rejected"
        );

        assert.equal(
            api.getUser(102).vehicleVerificationNote,
            "Не указана модель"
        );

        assert.equal(api.writes.length, 1);
        assert.equal(api.notifications.length, 1);
    });
});

test("HTTP: подтверждение сохраняет статус и отправляет уведомление", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "PUT",
            VERIFY,
            { status: "verified" }
        );

        assert.equal(response.status, 200);

        assert.equal(
            api.getUser(101).vehicleVerificationStatus,
            "verified"
        );

        assert.equal(api.writes.length, 1);

        assert.equal(
            api.notifications[0].type,
            "vehicle_verification"
        );

        assert.equal(
            api.notifications[0].userId,
            101
        );
    });
});

test("HTTP: повторное одобрение очищает старую причину отказа", async () => {
    await withServer(async (api) => {
        api.setUser(101, {
            vehicleVerificationStatus: "rejected",
            vehicleVerificationNote: "Старое замечание",
        });

        const response = await api.request(
            "PUT",
            VERIFY,
            { status: "verified" }
        );

        assert.equal(response.status, 200);

        assert.equal(
            api.getUser(101).vehicleVerificationStatus,
            "verified"
        );

        assert.equal(
            api.getUser(101).vehicleVerificationNote,
            null
        );
    });
});

test("HTTP: ошибка уведомления не отменяет сохранённую проверку", async () => {
    await withServer(
        async (api) => {
            const response = await api.request(
                "PUT",
                VERIFY,
                { status: "verified" }
            );

            assert.equal(response.status, 200);

            assert.equal(
                api.getUser(101).vehicleVerificationStatus,
                "verified"
            );

            assert.equal(api.writes.length, 1);
        },
        {
            notificationFails: true,
        }
    );
});

test("HTTP: ошибка сохранения не меняет запись", async () => {
    await withServer(
        async (api) => {
            const response = await api.request(
                "PUT",
                VERIFY,
                { status: "verified" }
            );

            assert.equal(response.status, 500);

            assert.equal(
                api.getUser(101).vehicleVerificationStatus,
                "pending"
            );

            assert.equal(api.notifications.length, 0);
            assert.equal(api.writes.length, 0);
        },
        {
            saveFails: true,
        }
    );
});

test("HTTP: удаление автомобиля очищает все его данные", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "DELETE",
            "/api/admin/users/101/vehicle"
        );

        assert.equal(response.status, 200);

        const user = api.getUser(101);

        assert.equal(user.vehicleBrand, null);
        assert.equal(user.vehicleModel, null);
        assert.equal(user.vehicleColor, null);
        assert.equal(user.vehiclePlate, null);
        assert.equal(user.vehicleYear, null);
        assert.equal(user.vehiclePhoto, null);

        assert.equal(
            user.vehicleVerificationStatus,
            "none"
        );

        assert.equal(
            user.vehicleVerificationNote,
            null
        );

        assert.equal(api.writes.length, 1);
    });
});

test("HTTP: удаление неизвестного автомобиля возвращает 404", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "DELETE",
            "/api/admin/users/999/vehicle"
        );

        assert.equal(response.status, 404);
        assert.equal(api.writes.length, 0);
    });
});

test("HTTP: ошибка сохранения не удаляет автомобиль", async () => {
    await withServer(
        async (api) => {
            const response = await api.request(
                "DELETE",
                "/api/admin/users/101/vehicle"
            );

            assert.equal(response.status, 500);

            assert.equal(
                api.getUser(101).vehicleBrand,
                "Toyota"
            );

            assert.equal(
                api.getUser(101).vehicleVerificationStatus,
                "pending"
            );

            assert.equal(api.writes.length, 0);
        },
        {
            saveFails: true,
        }
    );
});


test("HTTP: отсутствующий снимок автомобиля запрещает подтверждение", async () => {
    await withServer(async (api) => {
        const response = await api.request(
            "PUT",
            VERIFY,
            {
                status: "verified",
                expectedVehicle: null,
            }
        );

        assert.equal(response.status, 409);
        assert.equal(api.writes.length, 0);
        assert.equal(
            api.getUser(101).vehicleVerificationStatus,
            "pending"
        );
    });
});

test("HTTP: устаревший снимок автомобиля запрещает подтверждение", async () => {
    await withServer(async (api) => {
        const expectedVehicle = {
            vehicleBrand: "Toyota",
            vehicleModel: "Camry",
            vehicleColor: "Чёрный",
            vehiclePlate: "А123АА82",
            vehicleYear: 2020,
            vehiclePhoto: "/uploads/test-car.jpg",
            vehicleVerificationStatus: "pending",
        };

        api.setUser(101, {
            vehiclePlate: "В456ВВ82",
        });

        const response = await api.request(
            "PUT",
            VERIFY,
            {
                status: "verified",
                expectedVehicle,
            }
        );

        assert.equal(response.status, 409);
        assert.equal(api.writes.length, 0);
        assert.equal(
            api.getUser(101).vehicleVerificationStatus,
            "pending"
        );
    });
});
