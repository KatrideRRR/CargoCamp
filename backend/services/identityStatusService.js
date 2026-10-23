
const {
    IdentityVerification,
} = require("../models");

const {
    evaluateIdentityVerification,
} = require("../utils/evaluateIdentityVerification");

/*
 * Источником статуса служит последняя
 * заявка пользователя.
 *
 * Если после старой проверки появились
 * отзыв, отказ или новая заявка,
 * старый документ не даёт права
 * на новое подписание и гарантию.
 */
async function getCurrentIdentityVerification(
    userId,
    {
        transaction = null,
        now = new Date(),
    } = {}
) {
    const id = Number(userId);

    if (
        !Number.isSafeInteger(id) ||
        id <= 0
    ) {
        return {
            record: null,
            status: "not_requested",
            verified: false,
        };
    }

    const record =
        await IdentityVerification.findOne({
            where: {
                userId: id,
                countryCode: "RU",
            },

            order: [
                ["createdAt", "DESC"],
                ["id", "DESC"],
            ],

            transaction,
        });

    return {
        record,

        ...evaluateIdentityVerification(
            record,
            now
        ),
    };
}

async function getCurrentVerifiedIdentity(
    userId,
    options = {}
) {
    const result =
        await getCurrentIdentityVerification(
            userId,
            options
        );

    return result.verified
        ? result.record
        : null;
}

module.exports = {
    getCurrentIdentityVerification,
    getCurrentVerifiedIdentity,
};
