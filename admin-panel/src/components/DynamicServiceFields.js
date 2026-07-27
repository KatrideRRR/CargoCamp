import React from "react";
import DynamicAddressField from "./DynamicAddressField";

function DynamicServiceFields({
                                  config,
                                  value,
                                  onChange,
                                  yandexApiKey,
                              }) {
    const fields = Array.isArray(config?.fields)
        ? config.fields
        : [];

    if (fields.length === 0) {
        return null;
    }

    const updateField = (key, nextValue) => {
        onChange((previous) => ({
            ...(previous || {}),
            [key]: nextValue,
        }));
    };

    return (
        <div className="dynamicServiceFields">
            {fields.map((field) => {
                const fieldValue =
                    value?.[field.key] ?? "";

                if (field.type === "address") {
                    const coordinatesKey =
                        field.coordinatesKey ||
                        `${field.key}Coordinates`;

                    return (
                        <DynamicAddressField
                            key={field.key}
                            field={field}
                            value={value?.[field.key] || ""}
                            coordinates={
                                value?.[coordinatesKey] || null
                            }
                            apiKey={yandexApiKey}
                            onAddressChange={(nextAddress) => {
                                onChange((previous) => ({
                                    ...(previous || {}),

                                    [field.key]: nextAddress,

                                    /*
                                     * Пользователь изменил текст:
                                     * старые координаты сбрасываем.
                                     */
                                    [coordinatesKey]: null,
                                }));
                            }}
                            onAddressSelect={({
                                                  address,
                                                  coordinates,
                                              }) => {
                                onChange((previous) => ({
                                    ...(previous || {}),
                                    [field.key]: address,
                                    [coordinatesKey]: coordinates,
                                }));
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
                                checked={fieldValue === true}
                                onChange={(event) =>
                                    updateField(
                                        field.key,
                                        event.target.checked
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
                                {field.required ? " *" : ""}
                            </div>

                            <select
                                className="control"
                                value={fieldValue}
                                required={!!field.required}
                                onChange={(event) =>
                                    updateField(
                                        field.key,
                                        event.target.value
                                    )
                                }
                            >
                                <option value="">
                                    Выберите вариант
                                </option>

                                {(field.options || []).map(
                                    (option) => (
                                        <option
                                            key={option.value}
                                            value={option.value}
                                        >
                                            {option.label}
                                        </option>
                                    )
                                )}
                            </select>
                        </div>
                    );
                }

                if (field.type === "textarea") {
                    return (
                        <div
                            key={field.key}
                            className="glass field"
                        >
                            <div className="label">
                                {field.label}
                                {field.required ? " *" : ""}
                            </div>

                            <textarea
                                className="control textarea"
                                value={fieldValue}
                                required={!!field.required}
                                maxLength={
                                    field.maxLength || undefined
                                }
                                placeholder={
                                    field.placeholder || ""
                                }
                                onChange={(event) =>
                                    updateField(
                                        field.key,
                                        event.target.value
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
                            {field.required ? " *" : ""}
                        </div>

                        <input
                            className="control"
                            type={
                                field.type === "number"
                                    ? "number"
                                    : "text"
                            }
                            value={fieldValue}
                            required={!!field.required}
                            min={
                                field.min !== undefined
                                    ? field.min
                                    : undefined
                            }
                            max={
                                field.max !== undefined
                                    ? field.max
                                    : undefined
                            }
                            maxLength={
                                field.maxLength || undefined
                            }
                            placeholder={
                                field.placeholder || ""
                            }
                            onChange={(event) => {
                                const nextValue =
                                    field.type === "number"
                                        ? event.target.value === ""
                                            ? ""
                                            : Number(
                                                event.target.value
                                            )
                                        : event.target.value;

                                updateField(
                                    field.key,
                                    nextValue
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