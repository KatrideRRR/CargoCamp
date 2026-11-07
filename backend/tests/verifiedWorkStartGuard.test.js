const test = require("node:test");
const assert = require("node:assert/strict");

const {
    getVerifiedWorkStartBlockReason,
} = require("../services/verifiedWorkStartGuard");

const hash = "a".repeat(64);

function signedAssignment() {
    return {
        type: "verified_assignment",
        status: "fully_signed",
        fullySignedAt: new Date(),
        supersededAt: null,
        documentHash: hash,
    };
}

test("Обычный заказ без подтверждённого договора", () => {
    assert.equal(
        getVerifiedWorkStartBlockReason(null),
        null
    );
});

test("Подписанный договор разрешает работу", () => {
    assert.equal(
        getVerifiedWorkStartBlockReason(
            signedAssignment()
        ),
        null
    );
});

test("Черновик договора блокирует начало работы", () => {
    const assignment = signedAssignment();

    assignment.status = "draft";

    assert.ok(
        getVerifiedWorkStartBlockReason(assignment)
    );
});

test("Подпись одной стороны недостаточна", () => {
    const assignment = signedAssignment();

    assignment.status = "partially_signed";
    assignment.fullySignedAt = null;

    assert.ok(
        getVerifiedWorkStartBlockReason(assignment)
    );
});

test("Договор без SHA-256 блокирует начало", () => {
    const assignment = signedAssignment();

    assignment.documentHash = null;

    assert.ok(
        getVerifiedWorkStartBlockReason(assignment)
    );
});

test("Заменённый договор блокирует начало", () => {
    const assignment = signedAssignment();

    assignment.supersededAt = new Date();

    assert.ok(
        getVerifiedWorkStartBlockReason(assignment)
    );
});