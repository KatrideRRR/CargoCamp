
const FIELD_LABELS = {
    destinationAddress: "Адрес назначения",
    destination: "Адрес назначения",
    deliveryAddress: "Адрес доставки",
    endAddress: "Конечный адрес",
    dropoffAddress: "Адрес выгрузки",
    helpersRequired: "Нужны грузчики",
    helpersCount: "Количество грузчиков",
    helperHours: "Часы работы грузчиков",
    floorFrom: "Этаж загрузки",
    floorTo: "Этаж выгрузки",
    elevatorFrom: "Лифт при загрузке",
    elevatorTo: "Лифт при выгрузке",
    cargoType: "Тип груза",
    distanceKm: "Расстояние, км",
    estimatedRoadDistanceKm: "Расстояние по дороге, км",
};

function asObject(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);

            if (
                parsed &&
                typeof parsed === "object" &&
                !Array.isArray(parsed)
            ) {
                return parsed;
            }
        } catch {
            return {};
        }
    }

    return {};
}

function hasValue(value) {
    return value !== null &&
        value !== undefined &&
        value !== "" &&
        (!Array.isArray(value) || value.length > 0);
}

function formatValue(value, field = {}) {
    if (typeof value === "boolean") {
        return value ? "Да" : "Нет";
    }

    if (field.type === "select") {
        const option = (field.options || []).find(
            (item) => String(item.value) === String(value)
        );

        if (option) return String(option.label);
    }

    if (Array.isArray(value)) {
        return value.map((item) => formatValue(item)).join(", ");
    }

    if (value && typeof value === "object") {
        return JSON.stringify(value);
    }

    return String(value);
}

function fallbackLabel(key) {
    if (FIELD_LABELS[key]) {
        return FIELD_LABELS[key];
    }

    return String(key)
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/_/g, " ")
        .replace(/^./, (letter) => letter.toUpperCase());
}

function buildOrderContractDetails(order) {
    const details = asObject(order?.serviceDetails);
    const config = asObject(order?.subcategory?.formConfig);

    const fields = Array.isArray(config.fields)
        ? config.fields
        : [];

    const rows = [];
    const used = new Set();
    const coordinateKeys = new Set();

    // Поля формы отображаем с названиями из конфигурации.
    for (const field of fields) {
        if (!field?.key) continue;

        if (field.type === "address") {
            coordinateKeys.add(
                field.coordinatesKey ||
                `${field.key}Coordinates`
            );
        }

        const value = details[field.key];
        if (!hasValue(value)) continue;

        rows.push({
            key: field.key,
            label: String(field.label || fallbackLabel(field.key)),
            value: formatValue(value, field),
        });

        used.add(field.key);
    }

    // Не теряем старые или нестандартные поля,
    // которых больше нет в конфигурации подкатегории.
    for (const [key, value] of Object.entries(details)) {
        if (used.has(key) || !hasValue(value)) continue;

        // Координаты храним в снимке данных,
        // но не выводим как отдельный текстовый пункт PDF.
        if (
            coordinateKeys.has(key) ||
            /coordinates|coords|latitude|longitude/i.test(key)
        ) {
            continue;
        }

        rows.push({
            key,
            label: fallbackLabel(key),
            value: formatValue(value),
        });
    }

    // Отдельная копия исходных параметров.
    // После создания договора она не зависит от изменений заказа.
    const raw = JSON.parse(JSON.stringify(details));

    return {
        raw,
        rows,
    };
}

module.exports = {
    buildOrderContractDetails,
};
