
const {
    IdentityVerification,
} = require("../models");

const {
    getCurrentVerifiedIdentity,
} = require("./identityStatusService");

/*
 * Не использовать старый userStatus === "verified".
 * Проверяем реальную IdentityVerification.
 */
async function hasVerifiedIdentity(userId) {
    const verification =
        await getCurrentVerifiedIdentity(
            userId
        );

    return Boolean(verification);
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
