const {
    getCurrentIdentityVerification,
} = require("./identityStatusService");

const {
    hasVerifiedBenefit,
} = require("./benefitService");

async function getPublicUserBadges(userId) {
    const [identity, isPensioner] =
        await Promise.all([
            getCurrentIdentityVerification(userId),

            hasVerifiedBenefit({
                userId,
                benefitCode: "pension_recipient",
            }),
        ]);

    return {
        identityVerified: Boolean(identity.verified),
        isPensioner: Boolean(isPensioner),
    };
}

module.exports = {
    getPublicUserBadges,
};