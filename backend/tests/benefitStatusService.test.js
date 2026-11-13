
const test = require("node:test");
const assert = require("node:assert/strict");

const {
    loadIsolatedService,
} = require("./helpers/loadIsolatedService");

const benefitPrograms = require(
    "../config/benefitPrograms"
);

const date = (days) =>
    new Date(
        Date.now() + days * 86400000
    ).toISOString();

function verification(id, status, overrides = {}) {
    return {
        id,
        userId: 42,
        countryCode: "RU",
        benefitCode: "pension_recipient",
        status,
        verifiedAt: date(-10),
        expiresAt: date(90),
        revokedAt: null,
        createdAt: date(-20 + id),
        ...overrides,
    };
}

function makeService(records) {
    const matching = (where) =>
        records
            .filter((record) =>
                Object.entries(where).every(
                    ([key, value]) =>
                        record[key] === value
                )
            )
            .sort((a, b) => {
                const dates =
                    new Date(b.createdAt) -
                    new Date(a.createdAt);

                return dates || b.id - a.id;
            });

    const model = {
        async findOne(options) {
            assert.deepEqual(
                options.order,
                [
                    ["createdAt", "DESC"],
                    ["id", "DESC"],
                ]
            );

            return matching(options.where)[0] || null;
        },

        async findAll(options) {
            return matching(options.where);
        },
    };

    return loadIsolatedService(
        "benefitService.js",
        {
            "../models": {
                UserBenefitVerification: model,
            },
            "../config/benefitPrograms":
            benefitPrograms,
        }
    );
}

const pension = {
    userId: 42,
    benefitCode: "pension_recipient",
};

async function pensionStatus(service) {
    const overview =
        await service.getMyBenefitOverview(42);

    return overview.find(
        (item) => item.code === "pension_recipient"
    ).status;
}

test("последнее действующее подтверждение даёт льготу", async () => {
    const service = makeService([
        verification(1, "rejected"),
        verification(2, "verified"),
    ]);

    assert.equal(
        await service.hasVerifiedBenefit(pension),
        true
    );

    assert.equal(
        await pensionStatus(service),
        "verified"
    );
});

test("последний отзыв отменяет старое одобрение", async () => {
    const service = makeService([
        verification(1, "verified"),
        verification(2, "revoked", {
            revokedAt: date(-1),
        }),
    ]);

    assert.equal(
        await service.hasVerifiedBenefit(pension),
        false
    );

    assert.equal(
        await pensionStatus(service),
        "revoked"
    );
});

test("последний отказ отменяет старое одобрение", async () => {
    const service = makeService([
        verification(1, "verified"),
        verification(2, "rejected"),
    ]);

    assert.equal(
        await service.hasVerifiedBenefit(pension),
        false
    );

    assert.equal(
        await pensionStatus(service),
        "rejected"
    );
});

test("последняя ожидающая заявка не даёт старую льготу", async () => {
    const service = makeService([
        verification(1, "verified"),
        verification(2, "pending"),
    ]);

    assert.equal(
        await service.hasVerifiedBenefit(pension),
        false
    );

    assert.equal(
        await pensionStatus(service),
        "pending"
    );
});

test("истёкшая льгота перестаёт действовать", async () => {
    const service = makeService([
        verification(1, "verified", {
            expiresAt: date(-1),
        }),
    ]);

    assert.equal(
        await service.hasVerifiedBenefit(pension),
        false
    );

    assert.equal(
        await pensionStatus(service),
        "expired"
    );
});

test("некорректные даты не подтверждают льготу", async () => {
    const service = makeService([
        verification(1, "verified", {
            verifiedAt: "invalid-date",
        }),
    ]);

    assert.equal(
        await service.hasVerifiedBenefit(pension),
        false
    );
});

test("разные льготные программы независимы", async () => {
    const service = makeService([
        verification(1, "rejected"),
        verification(2, "verified", {
            benefitCode: "disability_status",
        }),
    ]);

    assert.equal(
        await service.hasVerifiedBenefit(pension),
        false
    );

    assert.equal(
        await service.hasVerifiedBenefit({
            userId: 42,
            benefitCode: "disability_status",
        }),
        true
    );
});

test("неизвестная программа не даёт льготу", async () => {
    const service = makeService([]);

    assert.equal(
        await service.hasVerifiedBenefit({
            userId: 42,
            benefitCode: "unknown_benefit",
        }),
        false
    );
});


for (const benefitCode of [
    "pension_recipient",
    "disability_status",
    "large_family_parent",
]) {
    test(
        `Социальная комиссия: ${benefitCode} даёт скидку`,
        async () => {
            const service = makeService([
                verification(1, "verified", {
                    benefitCode,
                }),
            ]);

            assert.equal(
                await service.hasSocialCommissionBenefit({
                    userId: 42,
                }),
                true
            );
        }
    );
}

test("Несколько льгот дают одно право на скидку", async () => {
    const service = makeService([
        verification(1, "verified", {
            benefitCode: "pension_recipient",
        }),
        verification(2, "verified", {
            benefitCode: "disability_status",
        }),
        verification(3, "verified", {
            benefitCode: "large_family_parent",
        }),
    ]);

    const active =
        await service.getActiveCommissionBenefitCodes({
            userId: 42,
        });

    assert.equal(active.length, 3);

    assert.equal(
        await service.hasSocialCommissionBenefit({
            userId: 42,
        }),
        true
    );
});

test("Отозванные и истёкшие льготы не дают скидку", async () => {
    const service = makeService([
        verification(1, "revoked", {
            benefitCode: "pension_recipient",
            revokedAt: date(-1),
        }),
        verification(2, "verified", {
            benefitCode: "disability_status",
            expiresAt: date(-1),
        }),
        verification(3, "rejected", {
            benefitCode: "large_family_parent",
        }),
    ]);

    assert.equal(
        await service.hasSocialCommissionBenefit({
            userId: 42,
        }),
        false
    );
});
