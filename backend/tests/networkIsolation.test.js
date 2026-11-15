
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const net = require("node:net");
const tls = require("node:tls");

function assertBlocked(connect) {
    let socket;

    try {
        socket = connect();
    } catch (error) {
        assert.equal(
            error.code,
            "ERR_CARGOCAMP_TEST_NETWORK_BLOCKED"
        );
        return;
    }

    socket?.destroy();

    assert.fail(
        "External connection was not blocked"
    );
}

test(
    "Node.js tests block external TCP connections",
    () => {
        assertBlocked(() =>
            net.createConnection({
                host: "network-test.invalid",
                port: 443,
            })
        );
    }
);

test(
    "Node.js tests block external TLS connections",
    () => {
        assertBlocked(() =>
            tls.connect({
                host: "network-test.invalid",
                port: 443,
            })
        );
    }
);
