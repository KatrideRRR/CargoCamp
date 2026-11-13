
const {
    UserBenefitVerification,
} = require("../models");

const {
    BENEFIT_PROGRAMS,
    getBenefitProgram,
} = require("../config/benefitPrograms");

function isActiveVerification(record, now = new Date()) {
    if (
        !record ||
        record.status !== "verified" ||
        !record.verifiedAt ||
        record.revokedAt
    ) {
        return false;
    }

    const nowTime = now.getTime();
    const verifiedTime = new Date(
        record.verifiedAt
    ).getTime();

    if (
        !Number.isFinite(verifiedTime) ||
        verifiedTime > nowTime
    ) {
        return false;
    }

    if (record.expiresAt != null) {
        const expiresTime = new Date(
            record.expiresAt
        ).getTime();

        if (
            !Number.isFinite(expiresTime) ||
            expiresTime <= nowTime
        ) {
            return false;
        }
    }

    return true;
}

async function getCurrentBenefitVerification({
                                                 userId,
                                                 benefitCode,
                                                 countryCode = "RU",
                                                 transaction = null,
                                             }) {
    const id = Number(userId);

    if (
        !Number.isSafeInteger(id) ||
        id <= 0
    ) {
        return null;
    }

    const program = getBenefitProgram(benefitCode);

    if (
        !program ||
        program.countryCode !== countryCode
    ) {
        return null;
    }

    // Последняя заявка является источником
    // текущего статуса, как и для Identity.
    return UserBenefitVerification.findOne({
        where: {
            userId: id,
            benefitCode,
            countryCode,
        },
        order: [
            ["createdAt", "DESC"],
            ["id", "DESC"],
        ],
        transaction,
    });
}

async function hasVerifiedBenefit(options) {
    const record =
        await getCurrentBenefitVerification(options);

    return isActiveVerification(record);
}

async function getMyBenefitOverview(userId) {
    const id = Number(userId);

    if (
        !Number.isSafeInteger(id) ||
        id <= 0
    ) {
        throw new Error("Некорректный пользователь");
    }

    const verifications =
        await UserBenefitVerification.findAll({
            where: {
                userId: id,
                countryCode: "RU",
            },
            attributes: [
                "id",
                "benefitCode",
                "status",
                "verifiedAt",
                "expiresAt",
                "revokedAt",
                "createdAt",
            ],
            order: [
                ["createdAt", "DESC"],
                ["id", "DESC"],
            ],
        });

    const now = new Date();

    return BENEFIT_PROGRAMS.map((program) => {
        const latestRecord =
            verifications.find(
                (record) =>
                    record.benefitCode === program.code
            ) || null;

        let status = "not_requested";

        if (latestRecord) {
            if (latestRecord.status === "verified") {
                status = isActiveVerification(
                    latestRecord,
                    now
                )
                    ? "verified"
                    : latestRecord.revokedAt
                        ? "revoked"
                        : "expired";
            } else {
                status = latestRecord.status;
            }
        }

        return {
            code: program.code,
            title: program.title,
            description: program.description,
            countryCode: program.countryCode,
            status,
            verifiedAt:
                latestRecord?.verifiedAt || null,
            expiresAt:
                latestRecord?.expiresAt || null,
        };
    });
}

module.exports = {
    isActiveVerification,
    getCurrentBenefitVerification,
    hasVerifiedBenefit,
    getMyBenefitOverview,
};
