import React, { useEffect, useRef, useState } from "react";

function parseYandexSuggestions(data) {
    const members =
        data?.response?.GeoObjectCollection?.featureMember || [];

    return members
        .map((member) => {
            const geoObject = member?.GeoObject;

            const address =
                geoObject?.metaDataProperty
                    ?.GeocoderMetaData?.text ||
                geoObject?.name ||
                null;

            const position = geoObject?.Point?.pos;

            if (!address || !position) {
                return null;
            }

            const [lng, lat] = position
                .split(" ")
                .map(Number);

            if (
                !Number.isFinite(lat) ||
                !Number.isFinite(lng)
            ) {
                return null;
            }

            return {
                label: address,
                address,
                lat,
                lng,
            };
        })
        .filter(Boolean);
}

function DynamicAddressField({
                                 field,
                                 value,
                                 coordinates,
                                 apiKey,
                                 onAddressChange,
                                 onAddressSelect,
                             }) {
    const [suggestions, setSuggestions] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [searchError, setSearchError] = useState("");

    const timerRef = useRef(null);
    const abortRef = useRef(null);
    const fieldRef = useRef(null);

    useEffect(() => {
        const handleOutsideClick = (event) => {
            if (
                fieldRef.current &&
                !fieldRef.current.contains(event.target)
            ) {
                setIsOpen(false);
            }
        };

        document.addEventListener(
            "mousedown",
            handleOutsideClick
        );

        return () => {
            document.removeEventListener(
                "mousedown",
                handleOutsideClick
            );
        };
    }, []);

    useEffect(() => {
        return () => {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
            }

            if (abortRef.current) {
                abortRef.current.abort();
                abortRef.current = null;
            }
        };
    }, []);

    const performSearch = (query) => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
        }

        if (abortRef.current) {
            abortRef.current.abort();
        }

        if (query.length < 3) {
            setSuggestions([]);
            setIsOpen(false);
            setIsSearching(false);
            setSearchError("");
            return;
        }

        setIsSearching(true);
        setIsOpen(true);
        setSearchError("");

        timerRef.current = setTimeout(async () => {
            const controller = new AbortController();
            abortRef.current = controller;

            try {
                if (!apiKey) {
                    throw new Error(
                        "Yandex API key is missing"
                    );
                }

                const url =
                    "https://geocode-maps.yandex.ru/1.x/" +
                    `?apikey=${apiKey}` +
                    `&geocode=${encodeURIComponent(query)}` +
                    "&format=json" +
                    "&results=10" +
                    "&kind=house";

                const response = await fetch(url, {
                    signal: controller.signal,
                });

                if (!response.ok) {
                    throw new Error(
                        `Geocoder HTTP ${response.status}`
                    );
                }

                const data = await response.json();
                const parsed =
                    parseYandexSuggestions(data);

                const uniqueSuggestions = Array.from(
                    new Map(
                        parsed.map((item) => [
                            item.label,
                            item,
                        ])
                    ).values()
                );

                setSuggestions(uniqueSuggestions);
                setIsOpen(true);
            } catch (error) {
                if (error?.name === "AbortError") {
                    return;
                }

                console.error(
                    "Ошибка поиска второго адреса:",
                    error
                );

                setSuggestions([]);
                setSearchError(
                    "Не удалось получить подсказки адреса"
                );
                setIsOpen(true);
            } finally {
                if (abortRef.current === controller) {
                    abortRef.current = null;
                    setIsSearching(false);
                }
            }
        }, 300);
    };

    const handleInputChange = (event) => {
        const nextValue = event.target.value;

        /*
         * При ручном изменении адреса прежние координаты
         * больше нельзя считать точными.
         */
        onAddressChange(nextValue);
        performSearch(nextValue.trim());
    };

    const handleSelect = (suggestion) => {
        onAddressSelect({
            address: suggestion.address,
            coordinates: {
                lat: suggestion.lat,
                lng: suggestion.lng,
            },
        });

        setSuggestions([]);
        setIsOpen(false);
        setSearchError("");
    };

    const hasValidCoordinates =
        Number.isFinite(Number(coordinates?.lat)) &&
        Number.isFinite(Number(coordinates?.lng));

    return (
        <div
            ref={fieldRef}
            className="glass field dynamicAddressField"
        >
            <div className="label">
                {field.label}
                {field.required ? " *" : ""}
            </div>

            <div className="dynamicAddressControlWrap">
                <input
                    className={`control ${
                        hasValidCoordinates
                            ? "dynamicAddressSelected"
                            : ""
                    }`}
                    type="text"
                    value={value || ""}
                    placeholder={field.placeholder || ""}
                    autoComplete="off"
                    onChange={handleInputChange}
                    onFocus={() => {
                        if (
                            String(value || "").trim().length >= 3
                        ) {
                            setIsOpen(true);
                        }
                    }}
                />

                {isSearching && (
                    <span
                        className="serviceSearchSpinner"
                        aria-label="Поиск адреса"
                    />
                )}
            </div>

            {hasValidCoordinates && (
                <div className="dynamicAddressConfirmed">
                    <span className="dynamicAddressCheck">
                        ✓
                    </span>
                    Адрес выбран
                </div>
            )}

            {searchError && (
                <div className="inline-error">
                    {searchError}
                </div>
            )}

            {isOpen && !hasValidCoordinates && (
                <div className="dynamicAddressSuggestions">
                    <div className="serviceSuggestionTitle">
                        {isSearching
                            ? "Ищем адрес…"
                            : suggestions.length > 0
                                ? "Выберите точный адрес"
                                : "Адреса не найдены"}
                    </div>

                    {!isSearching &&
                        suggestions.map((suggestion, index) => (
                            <button
                                key={`${suggestion.label}-${index}`}
                                type="button"
                                className="dynamicAddressSuggestion"
                                onMouseDown={(event) =>
                                    event.preventDefault()
                                }
                                onClick={() =>
                                    handleSelect(suggestion)
                                }
                            >
                                {suggestion.label}
                            </button>
                        ))}

                    {!isSearching &&
                        suggestions.length === 0 &&
                        !searchError && (
                            <div className="serviceSuggestionEmpty">
                                Уточните город, улицу и номер
                                дома.
                            </div>
                        )}
                </div>
            )}
        </div>
    );
}

export default DynamicAddressField;