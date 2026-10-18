const { Op } = require("sequelize");

const {
    UserBenefitVerification,
} = require("../models");

const {
    BENEFIT_PROGRAMS,
    getBenefitProgram,
} = require("../config/benefitPrograms");

function isActiveVerification(record, now = new Date()) {
    if (!record) return false;

    if (record.status !== "verified") {
        return false;
    }

    if (!record.verifiedAt) {
        return false;
    }

    if (new Date(record.verifiedAt) > now) {
        return false;
    }

    if (record.revokedAt) {
        return false;
    }

    if (
        record.expiresAt &&
        new Date(record.expiresAt) <= now
    ) {
        return false;
    }

    return true;
}

async function hasVerifiedBenefit({
                                      userId,
                                      benefitCode,
                                      countryCode = "RU",
                                  }) {
    const id = Number(userId);

    if (!Number.isSafeInteger(id) || id <= 0) {
        return false;
    }

    const program = getBenefitProgram(benefitCode);

    if (
        !program ||
        program.countryCode !== countryCode
    ) {
        return false;
    }

    const now = new Date();

    const verification =
        await UserBenefitVerification.findOne({
            where: {
                userId: id,
                benefitCode,
                countryCode,
                status: "verified",

                verifiedAt: {
                    [Op.lte]: now,
                },

                revokedAt: null,

                [Op.or]: [
                    { expiresAt: null },
                    {
                        expiresAt: {
                            [Op.gt]: now,
                        },
                    },
                ],
            },

            order: [
                ["verifiedAt", "DESC"],
                ["id", "DESC"],
            ],
        });

    return Boolean(verification);
}

async function getMyBenefitOverview(userId) {
    const id = Number(userId);

    if (!Number.isSafeInteger(id) || id <= 0) {
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
        const records = verifications.filter(
            (record) =>
                record.benefitCode === program.code
        );

        const activeRecord = records.find(
            (record) =>
                isActiveVerification(record, now)
        );

        const latestRecord = records[0] || null;

        let status = "not_requested";

        if (activeRecord) {
            status = "verified";
        } else if (latestRecord) {
            status = latestRecord.status;

            if (latestRecord.revokedAt) {
                status = "revoked";
            } else if (
                latestRecord.status === "verified" &&
                latestRecord.expiresAt &&
                new Date(latestRecord.expiresAt) <= now
            ) {
                status = "expired";
            }
        }

        const effectiveRecord =
            activeRecord || latestRecord;

        return {
            code: program.code,
            title: program.title,
            description: program.description,
            countryCode: program.countryCode,
            status,

            verifiedAt:
                effectiveRecord?.verifiedAt || null,

            expiresAt:
                effectiveRecord?.expiresAt || null,
        };
    });
}

module.exports = {
    hasVerifiedBenefit,
    getMyBenefitOverview,
};