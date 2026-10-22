
const {
    IdentityVerification,
} = require("../models");

/*
 * Не использовать старый userStatus === "verified".
 * Проверяем реальную IdentityVerification.
 */
async function hasVerifiedIdentity(userId) {
    const id = Number(userId);

    if (!Number.isSafeInteger(id) || id <= 0) {
        return false;
    }

    const latest =
        await IdentityVerification.findOne({
            where: {
                userId: id,
                countryCode: "RU",
            },

            order: [
                ["createdAt", "DESC"],
                ["id", "DESC"],
            ],
        });

    if (!latest) return false;

    const now = Date.now();
    const verifiedAt = latest.verifiedAt
        ? new Date(latest.verifiedAt).getTime()
        : NaN;

    const expiresAt = latest.expiresAt
        ? new Date(latest.expiresAt).getTime()
        : null;

    return (
        latest.status === "verified" &&
        Number.isFinite(verifiedAt) &&
        verifiedAt <= now &&
        (
            expiresAt === null ||
            (
                Number.isFinite(expiresAt) &&
                expiresAt > now
            )
        )
    );
}

/*
 * Закрыто до завершения интеграции
 * настоящего YooKassa Safe Deal.
 *
 * Нельзя включать по одной только
 * переменной окружения, пока сервер
 * не создаёт и не сверяет сделку.
 */
function isSafeDealOperational() {
    return false;
}

async function getGuaranteeEligibility(userId) {
    const verified =
        await hasVerifiedIdentity(userId);

    return {
        verified,
        operational:
            isSafeDealOperational(),

        available:
            verified &&
            isSafeDealOperational(),

        provider: "yookassa_safe_deal",
    };
}

module.exports = {
    hasVerifiedIdentity,
    getGuaranteeEligibility,
    isSafeDealOperational,
};
