
const test = require("node:test");
const assert = require("node:assert/strict");

const {
    evaluateIdentityVerification,
} = require("../utils/evaluateIdentityVerification");

const now = new Date(
    "2026-10-23T12:00:00.000Z"
);

const approved = {
    status: "verified",
    verifiedAt:
        "2026-10-20T10:00:00.000Z",

    expiresAt:
        "2027-10-20T10:00:00.000Z",
};

test("Нет заявки — личность не подтверждена", () => {
    const result =
        evaluateIdentityVerification(null, now);

    assert.equal(
        result.status,
        "not_requested"
    );

    assert.equal(result.verified, false);
});

test("Действующая проверка разрешена", () => {
    const result =
        evaluateIdentityVerification(approved, now);

    assert.equal(result.status, "verified");
    assert.equal(result.verified, true);
});

test("Ожидающая заявка не даёт доступа", () => {
    const result =
        evaluateIdentityVerification(
            { status: "pending" },
            now
        );

    assert.equal(result.verified, false);
});

test("Отказ блокирует доступ", () => {
    const result =
        evaluateIdentityVerification(
            { status: "rejected" },
            now
        );

    assert.equal(result.verified, false);
});

test("Отзыв блокирует доступ", () => {
    const result =
        evaluateIdentityVerification(
            {
                ...approved,
                status: "revoked",
            },
            now
        );

    assert.equal(result.status, "revoked");
    assert.equal(result.verified, false);
});

test("Истёкшая проверка недействительна", () => {
    const result =
        evaluateIdentityVerification(
            {
                ...approved,
                expiresAt:
                    "2026-10-22T10:00:00.000Z",
            },
            now
        );

    assert.equal(result.status, "expired");
    assert.equal(result.verified, false);
});

test("Проверка без срока действия недействительна", () => {
    const result =
        evaluateIdentityVerification(
            {
                ...approved,
                expiresAt: null,
            },
            now
        );

    assert.equal(result.status, "invalid");
    assert.equal(result.verified, false);
});

test("Некорректная дата блокирует доступ", () => {
    const result =
        evaluateIdentityVerification(
            {
                ...approved,
                verifiedAt: "bad-date",
            },
            now
        );

    assert.equal(result.verified, false);
});

test("Будущая дата подтверждения блокирует доступ", () => {
    const result =
        evaluateIdentityVerification(
            {
                ...approved,
                verifiedAt:
                    "2026-10-24T10:00:00.000Z",
            },
            now
        );

    assert.equal(result.verified, false);
});
