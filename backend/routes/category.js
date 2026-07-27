const express = require('express');
const { Category, Subcategory, Service, ServiceSearchAlias } = require('../models');
const router = express.Router();

function normalizeServiceText(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/ё/g, "е")
        .replace(/[–—-]/g, " ")
        .replace(/[^a-zа-я0-9\s]/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function getWords(value) {
    return normalizeServiceText(value)
        .split(" ")
        .filter((word) => word.length > 1);
}

function levenshteinDistance(a, b) {
    const first = normalizeServiceText(a);
    const second = normalizeServiceText(b);

    if (first === second) return 0;
    if (!first.length) return second.length;
    if (!second.length) return first.length;

    const previous = Array.from(
        { length: second.length + 1 },
        (_, index) => index
    );

    for (let i = 1; i <= first.length; i += 1) {
        const current = [i];

        for (let j = 1; j <= second.length; j += 1) {
            const substitutionCost =
                first[i - 1] === second[j - 1] ? 0 : 1;

            current[j] = Math.min(
                current[j - 1] + 1,
                previous[j] + 1,
                previous[j - 1] + substitutionCost
            );
        }

        for (let j = 0; j < current.length; j += 1) {
            previous[j] = current[j];
        }
    }

    return previous[second.length];
}

function similarityRatio(a, b) {
    const first = normalizeServiceText(a);
    const second = normalizeServiceText(b);

    if (!first || !second) return 0;
    if (first === second) return 1;

    const maxLength = Math.max(first.length, second.length);
    const distance = levenshteinDistance(first, second);

    return 1 - distance / maxLength;
}

function calculateWordSimilarity(queryWord, candidateWord) {
    if (queryWord === candidateWord) return 1;

    if (
        candidateWord.startsWith(queryWord) ||
        queryWord.startsWith(candidateWord)
    ) {
        return 0.9;
    }

    if (queryWord.length < 4 || candidateWord.length < 4) {
        return 0;
    }

    return similarityRatio(queryWord, candidateWord);
}

function calculateServiceMatchScore(query, candidate) {
    const normalizedQuery = normalizeServiceText(query);
    const normalizedCandidate = normalizeServiceText(candidate);

    if (!normalizedQuery || !normalizedCandidate) {
        return 0;
    }

    if (normalizedQuery === normalizedCandidate) {
        return 1000;
    }

    let score = 0;

    if (normalizedCandidate.startsWith(normalizedQuery)) {
        score += 850;
    }

    if (normalizedQuery.startsWith(normalizedCandidate)) {
        score += 780;
    }

    if (normalizedCandidate.includes(normalizedQuery)) {
        score += 720;
    }

    if (normalizedQuery.includes(normalizedCandidate)) {
        score += 650;
    }

    const queryWords = getWords(normalizedQuery);
    const candidateWords = getWords(normalizedCandidate);

    let matchedWords = 0;
    let wordSimilarityTotal = 0;

    for (const queryWord of queryWords) {
        let bestWordSimilarity = 0;

        for (const candidateWord of candidateWords) {
            const currentSimilarity = calculateWordSimilarity(
                queryWord,
                candidateWord
            );

            if (currentSimilarity > bestWordSimilarity) {
                bestWordSimilarity = currentSimilarity;
            }
        }

        if (bestWordSimilarity >= 0.72) {
            matchedWords += 1;
            wordSimilarityTotal += bestWordSimilarity;
        }
    }

    if (queryWords.length > 0) {
        const coverage = matchedWords / queryWords.length;
        score += coverage * 500;
    }

    if (matchedWords > 0) {
        score += (wordSimilarityTotal / matchedWords) * 220;
    }

    const fullSimilarity = similarityRatio(
        normalizedQuery,
        normalizedCandidate
    );

    if (fullSimilarity >= 0.55) {
        score += fullSimilarity * 300;
    }

    return Math.round(score);
}

router.get("/search", async (req, res) => {
    try {
        const query = normalizeServiceText(req.query.q);

        if (query.length < 2) {
            return res.json({
                query,
                results: [],
            });
        }

        const [aliases, subcategories, categories] = await Promise.all([
            ServiceSearchAlias.findAll({
                where: {
                    isActive: true,
                },
                include: [
                    {
                        model: Category,
                        as: "category",
                        required: true,
                        where: {
                            is_express: false,
                        },
                        attributes: ["id", "name", "is_express"],
                    },
                    {
                        model: Subcategory,
                        as: "subcategory",
                        required: false,
                        attributes: [
                            "id",
                            "name",
                            "code",
                            "categoryId",
                            "price",
                            "formConfig",
                            "pricingConfig",
                        ],
                    },
                ],
            }),

            Subcategory.findAll({
                include: [
                    {
                        model: Category,
                        as: "category",
                        required: true,
                        where: {
                            is_express: false,
                        },
                        attributes: ["id", "name", "is_express"],
                    },
                ],
                attributes: [
                    "id",
                    "name",
                    "code",
                    "categoryId",
                    "price",
                    "formConfig",
                    "pricingConfig",
                ],
            }),

            Category.findAll({
                where: {
                    is_express: false,
                },
                attributes: ["id", "name", "is_express"],
            }),
        ]);

        const candidates = [];

        // =====================================================
        // 1. Поисковые фразы
        // =====================================================

        for (const alias of aliases) {
            if (!alias.category) continue;

            const aliasText =
                alias.normalizedPhrase ||
                alias.phrase;

            let score = calculateServiceMatchScore(
                query,
                aliasText
            );

            if (score <= 0) continue;

            const hasSubcategory =
                alias.subcategoryId &&
                alias.subcategory;

            // Подкатегории всегда получают преимущество.
            score += hasSubcategory ? 400 : 80;

            // Приоритет, заданный в таблице.
            score += Number(alias.priority || 0);

            candidates.push({
                type: hasSubcategory
                    ? "subcategory"
                    : "category",

                categoryId: alias.category.id,
                categoryName: alias.category.name,

                subcategoryId: hasSubcategory
                    ? alias.subcategory.id
                    : null,

                subcategoryName: hasSubcategory
                    ? alias.subcategory.name
                    : null,

                subcategoryCode: hasSubcategory
                    ? alias.subcategory.code
                    : null,

                formConfig: hasSubcategory
                    ? alias.subcategory.formConfig
                    : null,

                price: hasSubcategory
                    ? alias.subcategory.price
                    : null,

                label: hasSubcategory
                    ? alias.subcategory.name
                    : alias.category.name,

                pricingConfig: hasSubcategory
                    ? alias.subcategory.pricingConfig
                    : null,

                matchedPhrase: alias.phrase,
                matchedBy: "alias",
                score,
            });
        }

        // =====================================================
        // 2. Прямой поиск по названиям подкатегорий
        // =====================================================

        for (const subcategory of subcategories) {
            if (!subcategory.category) continue;

            let score = calculateServiceMatchScore(
                query,
                subcategory.name
            );

            if (score <= 0) continue;

            // Прямое совпадение с названием подкатегории
            // должно быть выше совпадения по общей категории.
            score += 650;

            candidates.push({
                type: "subcategory",

                categoryId: subcategory.category.id,
                categoryName: subcategory.category.name,

                subcategoryId: subcategory.id,
                subcategoryName: subcategory.name,

                price: subcategory.price,

                label: subcategory.name,
                matchedPhrase: subcategory.name,
                matchedBy: "subcategory_name",
                pricingConfig: subcategory.pricingConfig,
                score,
            });
        }

        // =====================================================
        // 3. Прямой поиск по названиям категорий
        // =====================================================

        for (const category of categories) {
            let score = calculateServiceMatchScore(
                query,
                category.name
            );

            if (score <= 0) continue;

            score += 100;

            candidates.push({
                type: "category",

                categoryId: category.id,
                categoryName: category.name,

                subcategoryId: null,
                subcategoryName: null,

                price: null,

                label: category.name,
                matchedPhrase: category.name,
                matchedBy: "category_name",
                score,
            });
        }

        // =====================================================
        // Убираем слабые совпадения
        // =====================================================

        const minimumScore = 260;

        const relevantCandidates = candidates.filter(
            (candidate) => candidate.score >= minimumScore
        );

        // =====================================================
        // Убираем дубли
        //
        // Одна подкатегория может совпасть сразу:
        // - по названию;
        // - по нескольким alias-фразам.
        //
        // Оставляем вариант с максимальным score.
        // =====================================================

        const uniqueMap = new Map();

        for (const candidate of relevantCandidates) {
            const key = candidate.subcategoryId
                ? `subcategory:${candidate.subcategoryId}`
                : `category:${candidate.categoryId}`;

            const existing = uniqueMap.get(key);

            if (
                !existing ||
                candidate.score > existing.score
            ) {
                uniqueMap.set(key, candidate);
            }
        }

        const results = Array.from(uniqueMap.values())
            .sort((a, b) => {
                // При сопоставимом результате подкатегория выше.
                if (a.type !== b.type) {
                    return a.type === "subcategory" ? -1 : 1;
                }

                return b.score - a.score;
            })
            .slice(0, 8)
            .map((candidate) => ({
                type: candidate.type,

                categoryId: candidate.categoryId,
                categoryName: candidate.categoryName,

                subcategoryId: candidate.subcategoryId,
                subcategoryName: candidate.subcategoryName,
                subcategoryCode: candidate.subcategoryCode || null,

                formConfig: candidate.formConfig || null,

                price: candidate.price,
                pricingConfig:
                    candidate.pricingConfig || null,

                label: candidate.label,
                matchedPhrase: candidate.matchedPhrase,
            }));

        return res.json({
            query,
            results,
        });
    } catch (error) {
        console.error("Ошибка поиска категории услуги:", error);

        return res.status(500).json({
            message: "Не удалось выполнить поиск услуги",
        });
    }
});

router.get('/', async (req, res) => {
    try {
        const categories = await Category.findAll({
            include: [{ model: Subcategory, as: 'subcategory', attributes: ['id', 'name'] }]
        });
        res.json(categories);
    } catch (error) {
        console.error("Ошибка при получении категорий:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

router.get('/subcategory/:categoryId', async (req, res) => {
    const { categoryId } = req.params;
    try {
        const subcategories = await Subcategory.findAll({
            where: { categoryId },
            attributes: ['id', 'name'], // 👈 важно включить price

        });
        res.json(subcategories);
    } catch (error) {
        res.status(500).json({ error: 'Не удалось загрузить подкатегории.' });
    }
});

router.get('/services/:subcategoryId', async (req, res) => {
    const { subcategoryId } = req.params;
    try {
        const services = await Service.findAll({
            where: { subcategoryId },
            attributes: ['id', 'name'],
            order: [['name', 'ASC']]
        });
        res.json(services);
    } catch (error) {
        console.error("Ошибка при получении услуг:", error);
        res.status(500).json({ message: "Ошибка сервера" });
    }
});

module.exports = router;
