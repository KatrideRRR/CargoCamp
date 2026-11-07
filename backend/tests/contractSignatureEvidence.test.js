const test = require("node:test");
const assert = require("node:assert/strict");

const {
    verifySignatureEvidence,
} = require("../services/contractSignatureEvidence");

const hash = "a".repeat(64);
const policyHash = "b".repeat(64);
const phoneHash = "c".repeat(64);
const otherHash = "d".repeat(64);

function fixtures() {
    const activatedAt = "2026-11-01T10:00:00.000Z";
    const signedAt = "2026-11-02T10:00:00.000Z";

    const agreement = {
        id: 7,
        userId: 9,
        policyCode: "cargocamp_simple_signature",
        policyVersion: "1.1",
        policySha256: policyHash,
        acceptedAt: "2026-10-30T10:00:00.000Z",
    };

    const bootstrapSignature = {
        id: 5,
        contractId: 11,
        userId: 9,
        partyRole: "creator",
        method: "otp_sms",
        verificationId: 3,
        signaturePolicyCode: agreement.policyCode,
        signaturePolicyVersion: "1.1",
        documentHash: hash,
        signedAt: activatedAt,
        evidence: {
            challengeId: "6",
            agreementId: "7",
            policySha256: policyHash,
            recipientFingerprint: phoneHash,
        },
    };

    const bootstrapChallenge = {
        id: 6,
        contractId: 11,
        userId: 9,
        agreementId: 7,
        partyRole: "creator",
        method: "otp_sms",
        status: "consumed",
        documentHash: hash,
        recipientFingerprint: phoneHash,
        createdAt: "2026-11-01T09:59:00.000Z",
        verifiedAt: activatedAt,
        consumedAt: activatedAt,
        expiresAt: "2026-11-01T10:04:00.000Z",
    };

    const signature = {
        id: 8,
        contractId: 12,
        userId: 9,
        partyRole: "creator",
        method: "authenticated_click",
        verificationId: 3,
        signaturePolicyCode: agreement.policyCode,
        signaturePolicyVersion: "1.1",
        documentHash: otherHash,
        signedAt,
        evidence: {
            method: "authenticated_click",
            sessionId: "23",
            pepEnrollmentId: "44",
            bootstrapSignatureId: "5",
            agreementId: "7",
            policySha256: policyHash,
            documentHash: otherHash,
            intentConfirmed: true,

            pepEnrollmentSnapshot: {
                id: "44",
                agreementId: "7",
                verificationId: "3",
                bootstrapSignatureId: "5",
                bootstrapChallengeId: "6",
                policyCode: agreement.policyCode,
                policyVersion: "1.1",
                policySha256: policyHash,
                phoneFingerprint: phoneHash,
                activatedAt,
                expiresAt: "2027-04-30T10:00:00.000Z",
                revokedAt: null,
            },
        },
    };

    return {
        signature,
        agreement,
        archiveValid: true,
        bootstrapSignature,
        bootstrapChallenge,
    };
}

function check(data) {
    return verifySignatureEvidence(data);
}

test("Действующая ПЭП позволяет подпись кнопкой", () => {
    assert.deepEqual(check(fixtures()), []);
});

test("Первичная SMS-подпись проходит проверку", () => {
    const data = fixtures();

    data.signature = data.bootstrapSignature;
    data.challenge = data.bootstrapChallenge;

    assert.deepEqual(check(data), []);
});

test("Отсутствие исторического снимка обнаруживается", () => {
    const data = fixtures();

    delete data.signature.evidence.pepEnrollmentSnapshot;

    assert.notEqual(check(data).length, 0);
});

test("Подмена первичной подписи обнаруживается", () => {
    const data = fixtures();

    data.signature.evidence.bootstrapSignatureId = "999";

    assert.notEqual(check(data).length, 0);
});

test("Истёкшая на момент подписания ПЭП запрещена", () => {
    const data = fixtures();

    data.signature.evidence
        .pepEnrollmentSnapshot.expiresAt =
        "2026-11-01T11:00:00.000Z";

    assert.notEqual(check(data).length, 0);
});

test("Отозванная на момент подписания ПЭП запрещена", () => {
    const data = fixtures();

    data.signature.evidence
        .pepEnrollmentSnapshot.revokedAt =
        "2026-11-01T11:00:00.000Z";

    assert.notEqual(check(data).length, 0);
});

test("Подмена номера телефона обнаруживается", () => {
    const data = fixtures();

    data.signature.evidence
        .pepEnrollmentSnapshot.phoneFingerprint =
        "f".repeat(64);

    assert.notEqual(check(data).length, 0);
});

test("Неподтверждённая SMS не создаёт доказательство", () => {
    const data = fixtures();

    data.bootstrapChallenge.status = "pending";

    assert.notEqual(check(data).length, 0);
});

test("Недействительный архив правил обнаруживается", () => {
    const data = fixtures();

    data.archiveValid = false;

    assert.notEqual(check(data).length, 0);
});

test("Неизвестный способ подписи запрещён", () => {
    const data = fixtures();

    data.signature.method = "unknown";

    assert.notEqual(check(data).length, 0);
});

test("Нулевой ID сессии не принимается", () => {
    const data = fixtures();

    data.signature.evidence.sessionId = "0";

    assert.notDeepEqual(check(data), []);
});

test("Чужая первичная SMS-подпись запрещена", () => {
    const data = fixtures();

    data.bootstrapSignature.userId = 999;

    assert.notDeepEqual(check(data), []);
});

test("Подмена времени активации обнаруживается", () => {
    const data = fixtures();

    data.signature.evidence
        .pepEnrollmentSnapshot.activatedAt =
        "2026-11-01T10:01:00.000Z";

    assert.notDeepEqual(check(data), []);
});

test("Согласие после создания SMS-запроса недопустимо", () => {
    const data = fixtures();

    data.agreement.acceptedAt =
        "2026-11-01T09:59:30.000Z";

    assert.notDeepEqual(check(data), []);
});

test("Изменение пользователя SMS-запроса обнаруживается", () => {
    const data = fixtures();

    data.bootstrapChallenge.userId = 999;

    assert.notDeepEqual(check(data), []);
});

test("Изменение документа первичной SMS обнаруживается", () => {
    const data = fixtures();

    data.bootstrapChallenge.documentHash =
        "f".repeat(64);

    assert.notDeepEqual(check(data), []);
});