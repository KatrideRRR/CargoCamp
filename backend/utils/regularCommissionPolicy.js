function calculateRegularCommissionKopecks({
                                               isCash = true,
                                               isPremium = false,
                                               isRecommended = false,
                                               isPensioner = false,
                                           } = {}) {
    if (!isCash || isPremium) {
        return 0;
    }

    const baseKopecks = isRecommended
        ? 10000
        : 20000;

    return isPensioner
        ? Math.round(baseKopecks / 2)
        : baseKopecks;
}

module.exports = {
    calculateRegularCommissionKopecks,
};