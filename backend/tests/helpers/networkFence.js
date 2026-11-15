
"use strict";

const net = require("node:net");
const tls = require("node:tls");

const ALLOWED_HOSTS = new Set([
    "localhost",
    "127.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
]);

function connectionHost(args) {
    const first = args[0];

    // Node.js может передавать нормализованные
    // аргументы Socket.connect вложенным массивом.
    if (Array.isArray(first)) {
        return connectionHost(first);
    }

    if (first && typeof first === "object") {
        if (first.path) {
            return "<unix-socket>";
        }

        if (first.socket) {
            return first.socket.remoteAddress ||
                "<unknown-socket>";
        }

        return first.host ||
            first.hostname ||
            "localhost";
    }

    if (typeof first === "number") {
        return typeof args[1] === "string"
            ? args[1]
            : "localhost";
    }

    return "<unknown>";
}

function assertLocalConnection(args) {
    const host = String(connectionHost(args))
        .toLowerCase()
        .replace(/^\[|\]$/g, "");

    if (ALLOWED_HOSTS.has(host)) {
        return;
    }

    const error = new Error(
        `CARGOCAMP_TEST_NETWORK_BLOCKED: ${host}`
    );

    error.code =
        "ERR_CARGOCAMP_TEST_NETWORK_BLOCKED";

    throw error;
}

const originalSocketConnect =
    net.Socket.prototype.connect;

net.Socket.prototype.connect = function (...args) {
    assertLocalConnection(args);

    return originalSocketConnect.apply(
        this,
        args
    );
};

const originalTlsConnect = tls.connect;

tls.connect = function (...args) {
    assertLocalConnection(args);

    return originalTlsConnect.apply(
        this,
        args
    );
};
