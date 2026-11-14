"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const {
    createErrorMonitor,
    createHttpErrorObserver,
} = require("../services/operationalErrorMonitor");

test("expected 4xx never goes to Telegram", async () => {
    const sent = [];
    const monitor = createErrorMonitor({ send: async (x) => { sent.push(x); return {success:true}; } });
    for (const status of [400, 401, 403, 404, 409, 429]) {
        await monitor.record({ error: { name: "ValidationError", status }, module: "api.auth" });
    }
    assert.equal(sent.length, 0);
});

test("system message excludes raw error, stack and sensitive URL", async () => {
    const sent = [];
    const monitor = createErrorMonitor({ send: async (x) => { sent.push(x); return { success: true }; } });
    const error = new Error("password=my-pass sms_code=123456 phone=+79999999999");
    error.code = "ER_LOCK_DEADLOCK";
    error.stack = "JWT eyJabc.def.ghi secret=top-secret";
    await monitor.record({
        error,
        req: { method: "POST", originalUrl: "/api/payments/abc?token=query-secret", user: { id: 42 } },
        orderId: 77,
    });
    assert.equal(sent.length, 1);
    const message = sent[0].message;
    assert.match(message, /api.payments/);
    assert.match(message, /ER_LOCK_DEADLOCK/);
    assert.match(message, /CC-[a-f0-9]{8}/);
    assert.match(message, /User ID.*42/);
    assert.match(message, /Order ID.*77/);
    for (const forbidden of ["my-pass", "123456", "79999999999", "query-secret", "top-secret", "eyJabc", "abc?"]) {
        assert.equal(message.includes(forbidden), false, `exposed ${forbidden}`);
    }
});

test("duplicates grouped and reported after window", async () => {
    let time = 1000;
    const sent = [];
    const monitor = createErrorMonitor({
        send: async (x) => { sent.push(x); return { success: true }; },
        now: () => time,
        windowMs: 300000,
    });
    const error = { name: "DatabaseError", code: "ER_LOCK_WAIT_TIMEOUT" };
    await monitor.record({ error, module: "mysql", phase: "transaction" });
    await monitor.record({ error, module: "mysql", phase: "transaction" });
    await monitor.record({ error, module: "mysql", phase: "transaction" });
    assert.equal(sent.length, 1);
    time += 300001;
    await monitor.flush();
    assert.equal(sent.length, 2);
    assert.match(sent[1].message, /Событий за окно: 2/);
    assert.match(sent[1].message, /Всего в группе: 3/);
    assert.equal(sent[1].message.match(/CC-[a-f0-9]{8}/)[0], sent[0].message.match(/CC-[a-f0-9]{8}/)[0]);
});

test("Telegram failure does not throw and retries", async () => {
    let time = 1;
    let attempts = 0;
    const monitor = createErrorMonitor({
        send: async () => { attempts += 1; if (attempts === 1) throw new Error("network"); return {success:true}; },
        now: () => time,
        windowMs: 300000,
        retryMs: 60000,
    });
    assert.deepEqual(await monitor.record({ error: new Error("failure"), module: "socket" }), {success:false});
    time += 60001;
    await monitor.flush();
    assert.equal(attempts, 2);
});

test("handled HTTP 5xx is reported once; 4xx and already reported are ignored", () => {
    const observed = [];
    const middleware = createHttpErrorObserver({notifySystemError: (payload) => {observed.push(payload); return Promise.resolve();}});
    function finish(status, reported = false) {
        const res = new EventEmitter();
        res.statusCode = status;
        res.locals = {cargoCampErrorReported: reported};
        let nextCount = 0;
        middleware({ method: "GET", originalUrl: "/api/orders/22?password=hidden" },res,()=>nextCount++);
        res.emit("finish");
        assert.equal(nextCount, 1);
    }
    finish(500);
    finish(403);
    finish(500, true);
    assert.equal(observed.length, 1);
    assert.equal(observed[0].error.code, "HTTP_500");
});
