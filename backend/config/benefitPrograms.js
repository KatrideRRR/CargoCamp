const BENEFIT_PROGRAMS = Object.freeze([
    {
        code: "pension_recipient",
        title: "Пенсионер",
        description: "Подтверждение пенсионного статуса",
        countryCode: "RU",
        requiresVerification: true,
        sensitive: false,
    },
    {
        code: "disability_status",
        title: "Человек с инвалидностью",
        description: "Подтверждение права на соответствующую льготу",
        countryCode: "RU",
        requiresVerification: true,
        sensitive: true,
    },
    {
        code: "large_family_parent",
        title: "Многодетная семья",
        description: "Подтверждение статуса родителя многодетной семьи",
        countryCode: "RU",
        requiresVerification: true,
        sensitive: false,
    },
]);

const BENEFIT_CODES = Object.freeze(
    BENEFIT_PROGRAMS.map((program) => program.code)
);

function getBenefitProgram(code) {
    return (
        BENEFIT_PROGRAMS.find(
            (program) => program.code === code
        ) || null
    );
}

module.exports = {
    BENEFIT_PROGRAMS,
    BENEFIT_CODES,
    getBenefitProgram,
};