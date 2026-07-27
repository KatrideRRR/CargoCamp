function parseObject(value) {
    if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value)
    ) {
        return value;
    }

    if (typeof value !== "string") {
        return {};
    }

    try {
        const parsed = JSON.parse(value);

        return (
            parsed &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
        )
            ? parsed
            : {};
    } catch {
        return {};
    }
}

function isEmptyValue(value) {
    return (
        value === undefined ||
        value === null ||
        value === ""
    );
}

function formatNumber(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return String(value ?? "");
    }

    return number.toLocaleString("ru-RU", {
        maximumFractionDigits: 2,
    });
}

function formatBoolean(value) {
    if (
        value === true ||
        value === 1 ||
        value === "1" ||
        value === "true"
    ) {
        return "Да";
    }

    return "Нет";
}

function findSelectLabel(field, value) {
    const options = Array.isArray(field?.options)
        ? field.options
        : [];

    const selectedOption = options.find(
        (option) =>
            String(option?.value) ===
            String(value)
    );

    return selectedOption?.label || String(value);
}

function formatFieldValue(field, value) {
    if (field.type === "boolean") {
        return formatBoolean(value);
    }

    if (field.type === "select") {
        return findSelectLabel(field, value);
    }

    if (field.type === "number") {
        return formatNumber(value);
    }

    return String(value);
}

function getFallbackDetailRows(
    details,
    existingRows
) {
    const existingKeys = new Set(
        existingRows.map((row) => row.key)
    );

    const rows = [];

    const fallbackFields = [
        {
            key: "destinationAddress",
            label: "Куда доставить",
        },
        {
            key: "destination",
            label: "Адрес назначения",
        },
        {
            key: "deliveryAddress",
            label: "Адрес доставки",
        },
        {
            key: "endAddress",
            label: "Конечный адрес",
        },
        {
            key: "dropoffAddress",
            label: "Место выгрузки",
        },
    ];

    fallbackFields.forEach((field) => {
        if (existingKeys.has(field.key)) {
            return;
        }

        const value = details[field.key];

        if (isEmptyValue(value)) {
            return;
        }

        rows.push({
            key: field.key,
            label: field.label,
            value: String(value),
            type: "address",
        });
    });

    return rows;
}

function getTechnicalRows(details) {
    const rows = [];

    const roadDistance = Number(
        details.estimatedRoadDistanceKm ??
        details.distanceKm
    );

    if (
        Number.isFinite(roadDistance) &&
        roadDistance >= 0
    ) {
        rows.push({
            key: "estimated_distance",
            label:
                "Ориентировочное расстояние",
            value:
                `≈ ${roadDistance.toLocaleString(
                    "ru-RU",
                    {
                        maximumFractionDigits: 1,
                    }
                )} км`,
        });
    }

    return rows;
}

export function getOrderServiceDetails(order) {
    const details =
        parseObject(order?.serviceDetails);

    const subcategoryFormConfig =
        parseObject(
            order?.subcategory?.formConfig
        );

    const categoryFormConfig =
        parseObject(
            order?.category?.formConfig
        );

    const directFormConfig =
        parseObject(
            order?.formConfig
        );

    const formConfig =
        Array.isArray(
            subcategoryFormConfig?.fields
        )
            ? subcategoryFormConfig
            : Array.isArray(
                categoryFormConfig?.fields
            )
                ? categoryFormConfig
                : directFormConfig;

    const fields =
        Array.isArray(formConfig?.fields)
            ? formConfig.fields
            : [];

    const fieldRows = fields
        .map((field) => {
            if (!field?.key || !field?.label) {
                return null;
            }

            const value =
                details[field.key];

            /*
             * Boolean показываем даже при false,
             * остальные пустые значения скрываем.
             */
            if (
                field.type !== "boolean" &&
                isEmptyValue(value)
            ) {
                return null;
            }

            if (
                field.type === "boolean" &&
                isEmptyValue(value)
            ) {
                return null;
            }

            return {
                key: field.key,
                label: field.label,
                value:
                    formatFieldValue(
                        field,
                        value
                    ),
                type: field.type,
            };
        })
        .filter(Boolean);

    const fallbackRows =
        getFallbackDetailRows(
            details,
            fieldRows
        );

    const technicalRows =
        getTechnicalRows(details);

    const pricingBreakdown =
        Array.isArray(
            details.pricingBreakdown
        )
            ? details.pricingBreakdown
                .map((item, index) => {
                    const amount =
                        Number(item?.amount);

                    if (
                        !item?.label ||
                        !Number.isFinite(amount)
                    ) {
                        return null;
                    }

                    return {
                        key:
                            item.key ||
                            `price-${index}`,
                        label:
                            String(item.label),
                        amount,
                    };
                })
                .filter(Boolean)
            : [];

    const recommendedPrice =
        Number(details.recommendedPrice);

    const recommendedPriceMin =
        Number(
            details.recommendedPriceMin
        );

    const recommendedPriceMax =
        Number(
            details.recommendedPriceMax
        );

    const hasRecommendedPrice =
        Number.isFinite(recommendedPrice);

    const hasRecommendedRange =
        Number.isFinite(
            recommendedPriceMin
        ) &&
        Number.isFinite(
            recommendedPriceMax
        );

    return {
        details,

        rows: [
            ...fieldRows,
            ...fallbackRows,
            ...technicalRows,
        ],

        pricingBreakdown,

        recommendedPrice:
            hasRecommendedPrice
                ? recommendedPrice
                : null,

        recommendedPriceMin:
            Number.isFinite(
                recommendedPriceMin
            )
                ? recommendedPriceMin
                : null,

        recommendedPriceMax:
            Number.isFinite(
                recommendedPriceMax
            )
                ? recommendedPriceMax
                : null,

        hasRecommendedRange,

        pricingSource:
            details.pricingSource || null,

        distanceType:
            details.distanceType || null,
    };
}