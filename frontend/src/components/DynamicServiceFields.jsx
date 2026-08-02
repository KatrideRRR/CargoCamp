import React, { useEffect, useMemo } from "react";
import DynamicAddressField from "./DynamicAddressField";

function checkFieldCondition(condition, values) {
    if (!condition || typeof condition !== "object") {
        return true;
    }

    const dependentField = condition.field;

    if (!dependentField) {
        return true;
    }

    const currentValue =
        values?.[dependentField];

    if (
        Object.prototype.hasOwnProperty.call(
            condition,
            "equals"
        )
    ) {
        return currentValue === condition.equals;
    }

    if (
        Object.prototype.hasOwnProperty.call(
            condition,
            "notEquals"
        )
    ) {
        return currentValue !== condition.notEquals;
    }

    if (Array.isArray(condition.in)) {
        return condition.in.includes(currentValue);
    }

    if (Array.isArray(condition.notIn)) {
        return !condition.notIn.includes(currentValue);
    }

    if (condition.truthy === true) {
        return Boolean(currentValue);
    }

    if (condition.falsy === true) {
        return !currentValue;
    }

    return true;
}

export function isDynamicFieldVisible(
    field,
    values
) {
    if (!field?.showWhen) {
        return true;
    }

    /*
     * Можно передать либо один объект:
     *
     * showWhen: {
     *     field: "helpersRequired",
     *     equals: true,
     * }
     *
     * либо массив условий:
     *
     * showWhen: [
     *     {
     *         field: "helpersRequired",
     *         equals: true,
     *     },
     *     {
     *         field: "cargoType",
     *         equals: "moving",
     *     },
     * ]
     */
    const conditions = Array.isArray(
        field.showWhen
    )
        ? field.showWhen
        : [field.showWhen];

    const conditionMode =
        field.showWhenMode === "any"
            ? "any"
            : "all";

    if (conditionMode === "any") {
        return conditions.some((condition) =>
            checkFieldCondition(
                condition,
                values
            )
        );
    }

    return conditions.every((condition) =>
        checkFieldCondition(
            condition,
            values
        )
    );
}

function DynamicServiceFields({
                                  config,
                                  value,
                                  onChange,
                                  yandexApiKey,
                              }) {
    const fields = Array.isArray(config?.fields)
        ? config.fields
        : [];

    const visibleFields = useMemo(
        () =>
            fields.filter((field) =>
                isDynamicFieldVisible(
                    field,
                    value
                )
            ),
        [fields, value]
    );

    /*
     * При скрытии зависимых полей удаляем их старые значения.
     *
     * Например:
     * пользователь включил грузчиков,
     * заполнил этажи, а затем выбрал
     * «Нужна только машина».
     *
     * helpersCount, этажи и лифты не должны
     * остаться в serviceDetails и повлиять
     * на расчёт цены.
     */
    useEffect(() => {
        const hiddenFields = fields.filter(
            (field) =>
                !isDynamicFieldVisible(
                    field,
                    value
                )
        );

        if (hiddenFields.length === 0) {
            return;
        }

        onChange((previous) => {
            const current = {
                ...(previous || {}),
            };

            let changed = false;

            hiddenFields.forEach((field) => {
                if (
                    Object.prototype.hasOwnProperty.call(
                        current,
                        field.key
                    )
                ) {
                    delete current[field.key];
                    changed = true;
                }

                if (field.type === "address") {
                    const coordinatesKey =
                        field.coordinatesKey ||
                        `${field.key}Coordinates`;

                    if (
                        Object.prototype.hasOwnProperty.call(
                            current,
                            coordinatesKey
                        )
                    ) {
                        delete current[
                            coordinatesKey
                            ];

                        changed = true;
                    }
                }
            });

            return changed
                ? current
                : previous;
        });
    }, [fields, value, onChange]);

    if (fields.length === 0) {
        return null;
    }

    const updateField = (
        key,
        nextValue,
        field
    ) => {
        onChange((previous) => {
            const next = {
                ...(previous || {}),
                [key]: nextValue,
            };

            /*
             * Позволяет задавать связанные значения.
             *
             * Пример:
             *
             * onFalseSet: {
             *     helpersCount: 0,
             *     helperHours: 0,
             *     floorFrom: 0,
             *     floorTo: 0,
             * }
             */
            if (
                field?.type === "boolean"
            ) {
                const relatedValues =
                    nextValue === true
                        ? field.onTrueSet
                        : field.onFalseSet;

                if (
                    relatedValues &&
                    typeof relatedValues ===
                    "object" &&
                    !Array.isArray(
                        relatedValues
                    )
                ) {
                    Object.assign(
                        next,
                        relatedValues
                    );
                }
            }

            return next;
        });
    };

    return (
        <div className="dynamicServiceFields">
            {visibleFields.map((field) => {
                const fieldValue =
                    value?.[field.key] ??
                    field.defaultValue ??
                    "";

                if (field.type === "address") {
                    const coordinatesKey =
                        field.coordinatesKey ||
                        `${field.key}Coordinates`;

                    return (
                        <DynamicAddressField
                            key={field.key}
                            field={field}
                            value={
                                value?.[field.key] ||
                                ""
                            }
                            coordinates={
                                value?.[
                                    coordinatesKey
                                    ] || null
                            }
                            apiKey={yandexApiKey}
                            onAddressChange={(
                                nextAddress
                            ) => {
                                onChange(
                                    (previous) => ({
                                        ...(previous ||
                                            {}),

                                        [field.key]:
                                        nextAddress,

                                        /*
                                         * Пользователь изменил
                                         * текст — старые координаты
                                         * больше не считаются
                                         * точными.
                                         */
                                        [coordinatesKey]:
                                            null,
                                    })
                                );
                            }}
                            onAddressSelect={({
                                                  address,
                                                  coordinates,
                                              }) => {
                                onChange(
                                    (previous) => ({
                                        ...(previous ||
                                            {}),

                                        [field.key]:
                                        address,

                                        [coordinatesKey]:
                                        coordinates,
                                    })
                                );
                            }}
                        />
                    );
                }

                if (field.type === "boolean") {
                    return (
                        <label
                            key={field.key}
                            className="dynamicBooleanField"
                        >
                            <span className="dynamicBooleanText">
                                {field.label}
                            </span>

                            <input
                                type="checkbox"
                                checked={
                                    fieldValue === true
                                }
                                onChange={(event) =>
                                    updateField(
                                        field.key,
                                        event.target
                                            .checked,
                                        field
                                    )
                                }
                            />
                        </label>
                    );
                }

                if (field.type === "select") {
                    return (
                        <div
                            key={field.key}
                            className="glass field"
                        >
                            <div className="label">
                                {field.label}
                                {field.required
                                    ? " *"
                                    : ""}
                            </div>

                            <select
                                className="control"
                                value={fieldValue}
                                required={
                                    !!field.required
                                }
                                onChange={(event) =>
                                    updateField(
                                        field.key,
                                        event.target
                                            .value,
                                        field
                                    )
                                }
                            >
                                <option value="">
                                    {field.placeholder ||
                                        "Выберите вариант"}
                                </option>

                                {(field.options ||
                                    []).map(
                                    (option) => (
                                        <option
                                            key={
                                                option.value
                                            }
                                            value={
                                                option.value
                                            }
                                        >
                                            {
                                                option.label
                                            }
                                        </option>
                                    )
                                )}
                            </select>
                        </div>
                    );
                }

                if (
                    field.type === "textarea"
                ) {
                    return (
                        <div
                            key={field.key}
                            className="glass field"
                        >
                            <div className="label">
                                {field.label}
                                {field.required
                                    ? " *"
                                    : ""}
                            </div>

                            <textarea
                                className="control textarea"
                                value={fieldValue}
                                required={
                                    !!field.required
                                }
                                maxLength={
                                    field.maxLength ||
                                    undefined
                                }
                                placeholder={
                                    field.placeholder ||
                                    ""
                                }
                                onChange={(event) =>
                                    updateField(
                                        field.key,
                                        event.target
                                            .value,
                                        field
                                    )
                                }
                            />
                        </div>
                    );
                }

                return (
                    <div
                        key={field.key}
                        className="glass field"
                    >
                        <div className="label">
                            {field.label}
                            {field.required
                                ? " *"
                                : ""}
                        </div>

                        <input
                            className="control"
                            type={
                                field.type ===
                                "number"
                                    ? "number"
                                    : "text"
                            }
                            value={fieldValue}
                            required={
                                !!field.required
                            }
                            min={
                                field.min !==
                                undefined
                                    ? field.min
                                    : undefined
                            }
                            max={
                                field.max !==
                                undefined
                                    ? field.max
                                    : undefined
                            }
                            step={
                                field.step !==
                                undefined
                                    ? field.step
                                    : undefined
                            }
                            maxLength={
                                field.maxLength ||
                                undefined
                            }
                            placeholder={
                                field.placeholder ||
                                ""
                            }
                            onChange={(event) => {
                                const nextValue =
                                    field.type ===
                                    "number"
                                        ? event.target
                                            .value ===
                                        ""
                                            ? ""
                                            : Number(
                                                event
                                                    .target
                                                    .value
                                            )
                                        : event.target
                                            .value;

                                updateField(
                                    field.key,
                                    nextValue,
                                    field
                                );
                            }}
                        />
                    </div>
                );
            })}
        </div>
    );
}

export default DynamicServiceFields;