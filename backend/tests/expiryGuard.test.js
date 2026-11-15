
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    isFutureTimestamp,
} = require("../utils/expiryGuard");

const NOW = Date.parse(
    "2026-11-15T12:00:00.000Z"
);

test("Future expiration is accepted", () => {
    assert.equal(
        isFutureTimestamp(
            new Date(NOW + 60000),
            NOW
        ),
        true
    );

    assert.equal(
        isFutureTimestamp(
            new Date(NOW + 1).toISOString(),
            NOW
        ),
        true
    );
});

test("Expired and boundary dates are rejected", () => {
    for (const value of [
        NOW,
        NOW - 1,
        new Date(NOW - 60000),
    ]) {
        assert.equal(
            isFutureTimestamp(value, NOW),
            false
        );
    }
});

test("Corrupted or missing dates are rejected", () => {
    for (const value of [
        null,
        undefined,
        "",
        "invalid-date",
        new Date(NaN),
        Infinity,
        {},
    ]) {
        assert.equal(
            isFutureTimestamp(value, NOW),
            false
        );
    }
});

test("Invalid clock value does not grant access", () => {
    assert.equal(
        isFutureTimestamp(
            new Date(NOW + 60000),
            NaN
        ),
        false
    );
});
