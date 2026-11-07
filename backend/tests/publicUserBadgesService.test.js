const test = require("node:test");
const assert = require("node:assert/strict");

const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

function createService({
                           identityVerified = false,
                           pensionVerified = false,
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
                async hasVerifiedBenefit(input) {
                    calls.benefits.push(input);

                    return pensionVerified;
                },
            },
        }
    );

    return {
        service,
        calls,
    };
}

test("Неподтверждённый пользователь не получает значки", async () => {
    const { service } = createService();

    assert.deepEqual(
        await service.getPublicUserBadges(101),
        {
            identityVerified: false,
            isPensioner: false,
        }
    );
});

test("Проверка личности не создаёт пенсионную льготу", async () => {
    const { service } = createService({
        identityVerified: true,
    });

    assert.deepEqual(
        await service.getPublicUserBadges(101),
        {
            identityVerified: true,
            isPensioner: false,
        }
    );
});

test("Пенсионная льгота не подтверждает личность", async () => {
    const { service } = createService({
        pensionVerified: true,
    });

    assert.deepEqual(
        await service.getPublicUserBadges(101),
        {
            identityVerified: false,
            isPensioner: true,
        }
    );
});

test("Два независимых подтверждения могут действовать одновременно", async () => {
    const { service, calls } = createService({
        identityVerified: true,
        pensionVerified: true,
    });

    assert.deepEqual(
        await service.getPublicUserBadges(101),
        {
            identityVerified: true,
            isPensioner: true,
        }
    );

    assert.deepEqual(calls.identity, [101]);

    assert.deepEqual(
        calls.benefits,
        [
            {
                userId: 101,
                benefitCode: "pension_recipient",
            },
        ]
    );
});