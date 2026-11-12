
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");

const {
    createOfferGuard,
    requiresCurrentOffer,
} = require("../services/publicOfferAccessPolicy");

const OFFER = {
    version: "2026-11-09",
    sha256: "a".repeat(64),
};

test("защищены операции создания новых обязательств", () => {
    for (const path of [
        "/orders",
        "/orders/12/request",
        "/orders/12/reserve",
        "/orders/12/approve",
        "/orders/12/activate-reservation",
        "/orders/12/restore",
        "/express/express-orders",
        "/express/express-orders/5/accept",
        "/payments/premium/create",
        "/tbank-payments/premium/create",
        "/payments/order/promotion/create",
        "/tbank-payments/order/promotion/create",
        "/payments/order/promotion/retry/prepare",
    ]) {
        assert.equal(
            requiresCurrentOffer("POST", path),
            true,
            path
        );
    }
});

test("старые обязательства и банковские вебхуки не блокируются", () => {
    for (const path of [
        "/payments/debt/create",
        "/tbank-payments/debt/create",
        "/payments/yookassa/webhook",
        "/tbank-payments/webhook",
        "/legal/offer/accept",
        "/orders/12/start-work",
        "/express/express-orders/5/complete",
        "/support",
    ]) {
        assert.equal(
            requiresCurrentOffer("POST", path),
            false,
            path
        );
    }

    assert.equal(
        requiresCurrentOffer("GET", "/orders"),
        false
    );
});

async function withServer(options, callback) {
    const app = express();

    let databaseChecks = 0;

    app.use(
        "/api",
        createOfferGuard({
            currentOffer: OFFER,

            authenticate(req, res, next) {
                if (
                    req.headers.authorization !==
                    "Bearer valid-test-token"
                ) {
                    return res.status(401).json({
                        message: "Недействительная сессия",
                    });
                }

                req.user = { id: 42 };
                return next();
            },

            async findAcceptance(userId, offer) {
                databaseChecks++;

                assert.equal(userId, 42);
                assert.equal(offer.version, OFFER.version);

                if (options.failDatabase) {
                    throw new Error(
                        "TEST_DATABASE_UNAVAILABLE"
                    );
                }

                return options.accepted
                    ? { id: 1 }
                    : null;
            },
        })
    );

    app.use((req, res) => {
        res.json({
            allowed: true,
            path: req.path,
        });
    });

    const server = await new Promise((resolve) => {
        const instance = app.listen(
            0,
            "127.0.0.1",
            () => resolve(instance)
        );
    });

    const base =
        `http://127.0.0.1:${server.address().port}`;

    const request = async (
        path,
        {
            token = true,
            method = "POST",
        } = {}
    ) => {
        const response = await fetch(base + path, {
            method,
            headers: token
                ? {
                    Authorization:
                        "Bearer valid-test-token",
                }
                : {},
        });

        return {
            status: response.status,
            body: await response.json(),
        };
    };

    try {
        await callback({
            request,
            get databaseChecks() {
                return databaseChecks;
            },
        });
    } finally {
        await new Promise((resolve, reject) => {
            server.close((error) =>
                error ? reject(error) : resolve()
            );
        });
    }
}

test("без авторизации создать заказ нельзя", async () => {
    await withServer(
        { accepted: false },
        async ({ request }) => {
            const result = await request(
                "/api/orders",
                { token: false }
            );

            assert.equal(result.status, 401);
        }
    );
});

test("без акцепта новая операция возвращает 428", async () => {
    await withServer(
        { accepted: false },
        async ({ request }) => {
            const result = await request(
                "/api/express/express-orders/7/accept"
            );

            assert.equal(result.status, 428);
            assert.equal(
                result.body.code,
                "PUBLIC_OFFER_REQUIRED"
            );
        }
    );
});

test("после акцепта операция разрешена", async () => {
    await withServer(
        { accepted: true },
        async ({ request, databaseChecks }) => {
            const result = await request(
                "/api/orders"
            );

            assert.equal(result.status, 200);
            assert.equal(result.body.allowed, true);
        }
    );
});

test("долг и банковский вебхук не требуют нового акцепта", async () => {
    await withServer(
        { accepted: false },
        async ({ request }) => {
            const debt = await request(
                "/api/payments/debt/create"
            );

            const webhook = await request(
                "/api/tbank-payments/webhook",
                { token: false }
            );

            assert.equal(debt.status, 200);
            assert.equal(webhook.status, 200);
        }
    );
});

test("ошибка БД не разрешает новую операцию", async () => {
    await withServer(
        {
            accepted: false,
            failDatabase: true,
        },
        async ({ request }) => {
            const result = await request(
                "/api/orders"
            );

            assert.equal(result.status, 503);
            assert.equal(
                result.body.code,
                "PUBLIC_OFFER_CHECK_UNAVAILABLE"
            );
        }
    );
});
