function sameId(a, b) {
    return /^[1-9]\d{0,19}$/.test(String(a ?? "")) &&
        String(a) === String(b);
}

function sameHash(a, b) {
    return /^[a-f0-9]{64}$/i.test(String(a || "")) &&
        String(a).toLowerCase() ===
        String(b || "").toLowerCase();
}

function time(value) {
    if (!value) return NaN;
    return new Date(value).getTime();
}

function validSmsProof(signature, challenge) {
    if (!signature || !challenge) return false;

    const evidence = signature.evidence || {};

    const created = time(challenge.createdAt);
    const verified = time(challenge.verifiedAt);
    const consumed = time(challenge.consumedAt);
    const signed = time(signature.signedAt);
    const expires = time(challenge.expiresAt);

    return (
        signature.method === "otp_sms" &&
        challenge.method === "otp_sms" &&
        challenge.status === "consumed" &&

        sameId(challenge.id, evidence.challengeId) &&
        sameId(challenge.contractId, signature.contractId) &&
        sameId(challenge.userId, signature.userId) &&
        sameId(challenge.agreementId, evidence.agreementId) &&

        challenge.partyRole === signature.partyRole &&

        sameHash(
            challenge.documentHash,
            signature.documentHash
        ) &&

        sameHash(
            challenge.recipientFingerprint,
            evidence.recipientFingerprint
        ) &&

        [created, verified, consumed, signed, expires]
            .every(Number.isFinite) &&

        created <= verified &&
        verified <= consumed &&
        consumed <= signed &&
        signed < expires
    );
}

function verifySignatureEvidence({
                                     signature,
                                     agreement,
                                     archiveValid,
                                     challenge,
                                     bootstrapSignature,
                                     bootstrapChallenge,
                                 }) {
    const warnings = [];
    const evidence = signature.evidence || {};

    if (
        !agreement ||
        !archiveValid ||
        !sameId(agreement.id, evidence.agreementId) ||
        !sameId(agreement.userId, signature.userId) ||
        !sameHash(
            agreement.policySha256,
            evidence.policySha256
        ) ||
        agreement.policyCode !== signature.signaturePolicyCode ||
        agreement.policyVersion !== signature.signaturePolicyVersion ||
        !Number.isFinite(time(agreement.acceptedAt)) ||
        time(agreement.acceptedAt) > time(signature.signedAt)
    ) {
        warnings.push(
            "Не подтверждено принятие архивной редакции правил ПЭП."
        );
    }

    if (signature.method === "otp_sms") {
        if (!validSmsProof(signature, challenge)) {
            warnings.push(
                "Отсутствует согласованное SMS-подтверждение."
            );
        }
    } else if (signature.method === "authenticated_click") {
        const snapshot =
            evidence.pepEnrollmentSnapshot;

        if (!snapshot) {
            warnings.push(
                "Отсутствует исторический снимок активации ПЭП."
            );
        } else {
            const signed = time(signature.signedAt);
            const activated = time(snapshot.activatedAt);
            const expires = time(snapshot.expiresAt);
            const bootstrapSigned =
                time(bootstrapSignature?.signedAt);

            const valid =
                evidence.method === "authenticated_click" &&
                evidence.intentConfirmed === true &&

                sameId(evidence.sessionId, evidence.sessionId) &&

                sameHash(
                    evidence.documentHash,
                    signature.documentHash
                ) &&

                sameId(
                    evidence.pepEnrollmentId,
                    snapshot.id
                ) &&

                sameId(
                    evidence.bootstrapSignatureId,
                    snapshot.bootstrapSignatureId
                ) &&

                sameId(
                    evidence.agreementId,
                    snapshot.agreementId
                ) &&

                sameId(
                    signature.verificationId,
                    snapshot.verificationId
                ) &&

                sameHash(
                    evidence.policySha256,
                    snapshot.policySha256
                ) &&

                snapshot.policyCode ===
                signature.signaturePolicyCode &&

                snapshot.policyVersion ===
                signature.signaturePolicyVersion &&

                snapshot.revokedAt === null &&

                sameId(
                    bootstrapSignature?.id,
                    snapshot.bootstrapSignatureId
                ) &&

                sameId(
                    bootstrapChallenge?.id,
                    snapshot.bootstrapChallengeId
                ) &&

                sameId(
                    bootstrapSignature?.userId,
                    signature.userId
                ) &&

                sameId(
                    bootstrapSignature?.verificationId,
                    snapshot.verificationId
                ) &&

                bootstrapSignature?.signaturePolicyCode ===
                snapshot.policyCode &&

                bootstrapSignature?.signaturePolicyVersion ===
                snapshot.policyVersion &&

                sameId(
                    bootstrapSignature?.evidence?.agreementId,
                    snapshot.agreementId
                ) &&

                sameHash(
                    bootstrapSignature?.evidence?.policySha256,
                    snapshot.policySha256
                ) &&

                sameHash(
                    bootstrapChallenge?.recipientFingerprint,
                    snapshot.phoneFingerprint
                ) &&

                validSmsProof(
                    bootstrapSignature,
                    bootstrapChallenge
                ) &&

                [signed, activated, expires, bootstrapSigned]
                    .every(Number.isFinite) &&

                bootstrapSigned <= activated &&
                activated <= signed &&
                signed < expires;

            if (!valid) {
                warnings.push(
                    "Не подтверждена цепочка первичной SMS-подписи и активации ПЭП."
                );
            }
        }
    } else {
        warnings.push(
            "Неизвестный способ электронной подписи."
        );
    }

    return warnings.map(
        (message) =>
            `Подпись №${signature.id}: ${message}`
    );
}

module.exports = {
    validSmsProof,
    verifySignatureEvidence,
};