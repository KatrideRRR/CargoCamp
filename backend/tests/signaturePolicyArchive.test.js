
const test = require("node:test");
const assert = require("node:assert/strict");

const {
    getSignaturePolicy,
} = require("../config/signaturePolicy");

const {
    sha256,
    validatePolicyRevision,
} = require(
    "../utils/signaturePolicyArchiveIntegrity"
);

const policy = getSignaturePolicy();

const archived = {
    jurisdiction: policy.jurisdiction,
    policyCode: policy.code,
    policyVersion: policy.version,
    policySha256: policy.sha256,
    policyText: policy.text,
};

test("SHA-256 исходного текста совпадает", () => {
    assert.equal(
        sha256(policy.text),
        policy.sha256
    );
});

test("Неизменённая редакция проходит проверку", () => {
    assert.equal(
        validatePolicyRevision(
            archived,
            policy
        ),
        true
    );
});

test("Подмена текста обнаруживается", () => {
    assert.equal(
        validatePolicyRevision(
            {
                ...archived,
                policyText:
                    archived.policyText + "\nИзменение",
            },
            policy
        ),
        false
    );
});

test("Другой номер версии запрещён", () => {
    assert.equal(
        validatePolicyRevision(
            {
                ...archived,
                policyVersion: "1.0",
            },
            policy
        ),
        false
    );
});

test("Подмена сохранённого SHA-256 обнаруживается", () => {
    assert.equal(
        validatePolicyRevision(
            {
                ...archived,
                policySha256: "a".repeat(64),
            },
            policy
        ),
        false
    );
});

test("Отсутствующий архив не считается действующим", () => {
    assert.equal(
        validatePolicyRevision(
            null,
            policy
        ),
        false
    );
});
