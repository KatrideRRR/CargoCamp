
const {
    getCurrentIdentityVerification,
} = require("./identityStatusService");

const {
    getActiveCommissionBenefitCodes,
} = require("./benefitService");

async function getPublicUserBadges(userId) {
    const [identity, benefitCodes] =
        await Promise.all([
            getCurrentIdentityVerification(userId),
            getActiveCommissionBenefitCodes({ userId }),
        ]);

    return {
        identityVerified: Boolean(identity.verified),

        // Оставляем для совместимости
        // со старыми версиями приложения.
        isPensioner:
            benefitCodes.includes("pension_recipient"),

        // Единый публичный признак.
        // Конкретные основания льготы
        // наружу не передаём.
        hasSocialBenefit:
            benefitCodes.length > 0,
    };
}

module.exports = {
    getPublicUserBadges,
};
