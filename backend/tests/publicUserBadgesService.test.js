
const test = require("node:test");
const assert = require("node:assert/strict");

const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

function createService({
                           identityVerified = false,
                           benefitCodes = [],
                       } = {}) {
    const calls = {
        identity: [],
        benefits: [],
    };

    const service = loadIsolatedService(
        "publicUserBadgesService.js",
        {
            "./identityStatusService": {
                async getCurrentIdentityVerification(userId) {
                    calls.identity.push(userId);

                    return {
                        verified: identityVerified,
                    };
                },
            },

            "./benefitService": {
                async getActiveCommissionBenefitCodes({ userId }) {
                    calls.benefits.push(userId);
                    return benefitCodes;
                },
            },
        }
    );

    return { service, calls };
}

test("Без подтверждений публичные бейджи отсутствуют", async () => {
    const { service } = createService();

    assert.deepEqual(
        await service.getPublicUserBadges(101),
        {
            identityVerified: false,
            isPensioner: false,
            hasSocialBenefit: false,
        }
    );
});

for (const benefitCode of [
    "pension_recipient",
    "disability_status",
    "large_family_parent",
]) {
    test(
        `Подтверждение ${benefitCode} даёт единый льготный бейдж`,
        async () => {
            const { service } = createService({
                benefitCodes: [benefitCode],
            });

            assert.deepEqual(
                await service.getPublicUserBadges(101),
                {
                    identityVerified: false,
                    isPensioner:
                        benefitCode === "pension_recipient",
                    hasSocialBenefit: true,
                }
            );
        }
    );
}

test("Верификация личности и социальная льгота независимы", async () => {
    const { service, calls } = createService({
        identityVerified: true,
        benefitCodes: ["large_family_parent"],
    });

    assert.deepEqual(
        await service.getPublicUserBadges(101),
        {
            identityVerified: true,
            isPensioner: false,
            hasSocialBenefit: true,
        }
    );

    assert.deepEqual(calls.identity, [101]);
    assert.deepEqual(calls.benefits, [101]);
});
