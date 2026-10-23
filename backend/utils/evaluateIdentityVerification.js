
function evaluateIdentityVerification(
    record,
    now = new Date()
) {
    if (!record) {
        return {
            status: "not_requested",
            verified: false,
        };
    }

    const status = String(
        record.status || ""
    );

    if ([
        "pending",
        "rejected",
        "revoked",
    ].includes(status)) {
        return {
            status,
            verified: false,
        };
    }

    if (status !== "verified") {
        return {
            status: "invalid",
            verified: false,
        };
    }

    const verifiedAt = record.verifiedAt
        ? new Date(record.verifiedAt)
        : null;

    const expiresAt = record.expiresAt
        ? new Date(record.expiresAt)
        : null;

    const currentTime = new Date(now).getTime();

    if (
        !Number.isFinite(currentTime) ||
        !verifiedAt ||
        !Number.isFinite(verifiedAt.getTime()) ||
        verifiedAt.getTime() > currentTime ||
        !expiresAt ||
        !Number.isFinite(expiresAt.getTime())
    ) {
        return {
            status: "invalid",
            verified: false,
        };
    }

    if (expiresAt.getTime() <= currentTime) {
        return {
            status: "expired",
            verified: false,
        };
    }

    return {
        status: "verified",
        verified: true,
    };
}

module.exports = {
    evaluateIdentityVerification,
};
