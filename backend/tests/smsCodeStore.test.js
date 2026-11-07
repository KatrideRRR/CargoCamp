const {
    test,
    after,
} = require("node:test");

const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

const originalSecret =
    process.env.SMS_CODE_SECRET;

process.env.SMS_CODE_SECRET =
    "a".repeat(64);

after(() => {
    if (originalSecret === undefined) {
        delete process.env.SMS_CODE_SECRET;
    } else {
        process.env.SMS_CODE_SECRET =
            originalSecret;
    }
});

const PHONE = "79990000001";

function createEnvironment() {
    const records = new Map();

    let queue = Promise.resolve();

    let transactions = 0;

    const transactionToken = {
        LOCK: {
            UPDATE: "UPDATE",
        },
    };

    function createRecord(phone) {
        return {
            phone,
            purpose: null,
            codeHash: null,
            status: "idle",
            attempts: 0,
            reservationId: null,
            pendingUntil: null,
            expiresAt: null,
            lastSentAt: null,
            windowStartedAt: null,
            sendCount: 0,

            async update(values, options) {
                assert.equal(
                    options.transaction,
                    transactionToken
                );

                Object.assign(this, values);
            },
        };
    }

    const SmsCodeState = {
        async findOrCreate({ where }) {
            if (!records.has(where.phone)) {
                records.set(
                    where.phone,
                    createRecord(where.phone)
                );
            }

            return [
                records.get(where.phone),
                false,
            ];
        },

        async findByPk(phone, options) {
            assert.equal(
                options.transaction,
                transactionToken
            );

            assert.equal(
                options.lock,
                transactionToken.LOCK.UPDATE
            );

            return records.get(phone) || null;
        },
    };

    const sequelize = {
        async transaction(callback) {
            const previous = queue;

            let unlock;

            queue = new Promise((resolve) => {
                unlock = resolve;
            });

            await previous;

            transactions++;

            try {
                return await callback(
                    transactionToken
                );
            } finally {
                unlock();
            }
        },
    };

    const service = loadIsolatedService(
        "smsCodeStore.js",
        {
            "node:crypto": crypto,

            "../models": {
                sequelize,
                SmsCodeState,
            },
        }
    );

    return {
        service,

        getRecord(phone = PHONE) {
            return records.get(phone);
        },

        get transactions() {
            return transactions;
        },

        async reserve(purpose = "login") {
            return service.reserveSmsCode({
                phone: PHONE,
                purpose,
            });
        },

        async activate(reservation) {
            return service.completeSmsSend({
                phone: PHONE,
                reservationId:
                reservation.reservationId,
                success: true,
            });
        },

        async consume(code, purpose = "login") {
            return service.consumeSmsCode({
                phone: PHONE,
                purpose,
                code,
            });
        },
    };
}

test("SMS Store: сохраняет HMAC, а не открытый код", async () => {
    const env = createEnvironment();

    const reserved = await env.reserve();
    const state = env.getRecord();

    assert.match(
        reserved.code,
        /^\d{6}$/
    );

    assert.match(
        state.codeHash,
        /^[a-f0-9]{64}$/
    );

    assert.notEqual(
        state.codeHash,
        reserved.code
    );

    assert.equal(state.status, "pending");
});

test("SMS Store: не принимает код до подтверждения отправки", async () => {
    const env = createEnvironment();

    const reserved = await env.reserve();

    const result = await env.consume(
        reserved.code
    );

    assert.deepEqual(result, {
        ok: false,
        reason: "not_found",
    });
});

test("SMS Store: подтверждённый код можно использовать один раз", async () => {
    const env = createEnvironment();

    const reserved = await env.reserve();

    assert.equal(
        await env.activate(reserved),
        true
    );

    assert.deepEqual(
        await env.consume(reserved.code),
        { ok: true }
    );

    assert.deepEqual(
        await env.consume(reserved.code),
        {
            ok: false,
            reason: "not_found",
        }
    );

    assert.equal(
        env.getRecord().sendCount,
        1
    );
});

test("SMS Store: код нельзя использовать для другого назначения", async () => {
    const env = createEnvironment();

    const reserved = await env.reserve(
        "login"
    );

    await env.activate(reserved);

    const wrongPurpose = await env.consume(
        reserved.code,
        "password_reset"
    );

    assert.equal(
        wrongPurpose.ok,
        false
    );

    assert.deepEqual(
        await env.consume(
            reserved.code,
            "login"
        ),
        { ok: true }
    );
});

test("SMS Store: пять неверных попыток блокируют код", async () => {
    const env = createEnvironment();

    const reserved = await env.reserve();

    await env.activate(reserved);

    for (let i = 0; i < 5; i++) {
        const result = await env.consume(
            "000000"
        );

        assert.equal(result.ok, false);
    }

    assert.equal(
        env.getRecord().status,
        "idle"
    );

    assert.equal(
        (await env.consume(
            reserved.code
        )).ok,
        false
    );
});

test("SMS Store: повторная отправка блокируется на 60 секунд", async () => {
    const env = createEnvironment();

    const reserved = await env.reserve();

    await env.activate(reserved);

    await env.consume(reserved.code);

    await assert.rejects(
        () => env.reserve(),
        (error) => {
            assert.equal(
                error.status,
                429
            );

            return true;
        }
    );
});

test("SMS Store: два одновременных запроса не резервируют две SMS", async () => {
    const env = createEnvironment();

    const results = await Promise.allSettled([
        env.reserve(),
        env.reserve(),
    ]);

    assert.equal(
        results.filter(
            (item) =>
                item.status === "fulfilled"
        ).length,
        1
    );

    assert.equal(
        results.filter(
            (item) =>
                item.status === "rejected"
        ).length,
        1
    );

    assert.equal(
        env.getRecord().sendCount,
        1
    );
});

test("SMS Store: два одновременных запроса не используют код дважды", async () => {
    const env = createEnvironment();

    const reserved = await env.reserve();

    await env.activate(reserved);

    const results = await Promise.all([
        env.consume(reserved.code),
        env.consume(reserved.code),
    ]);

    assert.equal(
        results.filter(
            (item) => item.ok
        ).length,
        1
    );

    assert.equal(
        results.filter(
            (item) => !item.ok
        ).length,
        1
    );
});

test("SMS Store: неудачная отправка отменяет код, но сохраняет лимит", async () => {
    const env = createEnvironment();

    const reserved = await env.reserve();

    const completed =
        await env.service.completeSmsSend({
            phone: PHONE,
            reservationId:
            reserved.reservationId,
            success: false,
        });

    assert.equal(completed, true);

    assert.equal(
        env.getRecord().status,
        "idle"
    );

    assert.equal(
        env.getRecord().sendCount,
        1
    );

    assert.equal(
        (await env.consume(
            reserved.code
        )).ok,
        false
    );
});

test("SMS Store: истёкший код отклоняется", async () => {
    const env = createEnvironment();

    const reserved = await env.reserve();

    await env.activate(reserved);

    env.getRecord().expiresAt =
        new Date(Date.now() - 1000);

    const result = await env.consume(
        reserved.code
    );

    assert.deepEqual(result, {
        ok: false,
        reason: "expired",
    });
});

test("SMS Store: лимит отправок сохраняется после использования кода", async () => {
    const env = createEnvironment();

    for (let i = 0; i < 5; i++) {
        const reserved = await env.reserve();

        await env.activate(reserved);
        await env.consume(reserved.code);

        // Искусственно завершаем cooldown,
        // но оставляем 15-минутное окно.
        env.getRecord().lastSentAt =
            new Date(
                Date.now() - 61_000
            );
    }

    await assert.rejects(
        () => env.reserve(),
        (error) => {
            assert.equal(error.status, 429);

            return true;
        }
    );

    assert.equal(
        env.getRecord().sendCount,
        5
    );
});

test("SMS Store: не позволяет активировать устаревшую резервацию", async () => {
    const env = createEnvironment();

    const reserved = await env.reserve();

    env.getRecord().pendingUntil =
        new Date(Date.now() - 1000);

    assert.equal(
        await env.activate(reserved),
        false
    );
});