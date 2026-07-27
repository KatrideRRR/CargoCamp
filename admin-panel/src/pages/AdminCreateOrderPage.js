import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import "../styles/AdminCreateOrderPage.css";
import DynamicServiceFields from "../components/DynamicServiceFields";
import { calculateRecommendedPrice } from "../utils/calculateRecommendedPrice";

const apiUrl = process.env.REACT_APP_API_URL;

function isValidOrderCoords(position) {
    if (!Array.isArray(position) || position.length !== 2) {
        return false;
    }

    const lat = Number(position[0]);
    const lng = Number(position[1]);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return false;
    }

    if (lat < -90 || lat > 90) {
        return false;
    }

    if (lng < -180 || lng > 180) {
        return false;
    }

    if (
        Math.abs(lat) < 0.000001 &&
        Math.abs(lng) < 0.000001
    ) {
        return false;
    }

    return true;
}

function calculateStraightDistanceKm(
    startLat,
    startLng,
    endLat,
    endLng
) {
    const lat1 = Number(startLat);
    const lng1 = Number(startLng);
    const lat2 = Number(endLat);
    const lng2 = Number(endLng);

    if (
        !Number.isFinite(lat1) ||
        !Number.isFinite(lng1) ||
        !Number.isFinite(lat2) ||
        !Number.isFinite(lng2)
    ) {
        return null;
    }

    const earthRadiusKm = 6371;

    const toRadians = (degrees) =>
        degrees * (Math.PI / 180);

    const deltaLat = toRadians(lat2 - lat1);
    const deltaLng = toRadians(lng2 - lng1);

    const a =
        Math.sin(deltaLat / 2) ** 2 +
        Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(deltaLng / 2) ** 2;

    const c =
        2 *
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );

    return Math.round(
        earthRadiusKm * c * 10
    ) / 10;
}

function parseYandexGeocoderSuggestions(data) {
    const members = data?.response?.GeoObjectCollection?.featureMember || [];

    return members
        .map((m) => {
            const g = m?.GeoObject;
            const text = g?.metaDataProperty?.GeocoderMetaData?.text;
            const pos = g?.Point?.pos;
            if (!text || !pos) return null;

            const [lon, lat] = pos.split(" ").map(Number);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

            return {
                label: text,
                address: text,
                lat,
                lon,
            };
        })
        .filter(Boolean);
}

function plusHour(d) {
    const x = new Date(d);
    x.setSeconds(0, 0);
    x.setHours(x.getHours() + 1);
    return x;
}

function toNum(v) {
    const n = typeof v === "string" ? Number(v) : v;
    return Number.isFinite(n) ? n : null;
}

function loadYMaps(apiKey) {
    if (window.ymaps) return Promise.resolve(window.ymaps);

    const id = "yandex-maps-script";
    const existing = document.getElementById(id);

    if (existing) {
        return new Promise((resolve, reject) => {
            existing.addEventListener("load", () => resolve(window.ymaps));
            existing.addEventListener("error", reject);
        });
    }

    return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.id = id;
        s.async = true;
        s.src = `https://api-maps.yandex.ru/2.1/?apikey=${apiKey}&lang=ru_RU`;
        s.onload = () => resolve(window.ymaps);
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

async function calcRouteByYmaps({ apiKey, fromLat, fromLng, toLat, toLng }) {
    const ymaps = await loadYMaps(apiKey);
    await ymaps.ready();

    const route = await ymaps.route(
        [
            [Number(fromLat), Number(fromLng)],
            [Number(toLat), Number(toLng)],
        ],
        { mapStateAutoApply: false }
    );

    const meters = typeof route.getLength === "function" ? route.getLength() : null;
    const seconds = typeof route.getTime === "function" ? route.getTime() : null;

    return {
        distanceKm: Number.isFinite(meters) ? meters / 1000 : null,
        durationMin: Number.isFinite(seconds) ? Math.round(seconds / 60) : null,
    };
}

const PRICING = {
    taxi: { base: 150, perKm: 20 },
    courier: { base: 120, perKm: 15 },
};

function AdminCreateOrderPage() {
    const { userId } = useParams();
    const navigate = useNavigate();
    const token = localStorage.getItem("authToken");
    const YM_KEY = process.env.REACT_APP_YANDEX_API_KEY;

    const [mode, setMode] = useState("regular");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const [regularForm, setRegularForm] = useState({
        description: "",
        address: "",
        workTime: plusHour(new Date()),
        proposedSum: "",
    });

    const [markerPosition, setMarkerPosition] = useState(null);
    const [selectedCategory, setSelectedCategory] = useState("");
    const [selectedSubcategory, setSelectedSubcategory] = useState("");

    const [selectedService, setSelectedService] =
        useState(null);

    const [serviceDetails, setServiceDetails] =
        useState({});

    const [serviceQuery, setServiceQuery] =
        useState("");

    const [serviceSuggestions, setServiceSuggestions] =
        useState([]);

    const [serviceSearchOpen, setServiceSearchOpen] =
        useState(false);

    const [serviceSearching, setServiceSearching] =
        useState(false);

    const serviceSearchTimerRef = useRef(null);
    const serviceSearchAbortRef = useRef(null);
    const serviceSearchBoxRef = useRef(null);

    const [addressSuggestions, setAddressSuggestions] = useState([]);
    const suggestTimerRef = useRef(null);
    const suggestAbortRef = useRef(null);
    const [isAsap, setIsAsap] = useState(true);

    const [expressType, setExpressType] = useState("taxi");
    const [expressForm, setExpressForm] = useState({
        subcategory: "",
        totalPrice: "",
        description: "",
        fromAddress: "",
        fromLat: "",
        fromLng: "",
        toAddress: "",
        toLat: "",
        toLng: "",
    });

    const [expressSuggestions, setExpressSuggestions] = useState({ from: [], to: [] });
    const expressSuggestTimerRef = useRef({ from: null, to: null });
    const expressSuggestAbortRef = useRef({ from: null, to: null });

    const expressSubcategoryOptions = {
        taxi: [
            { label: "Перевозка пассажиров", icon: "🚕" },
            { label: "Перевозка детей", icon: "🧒" },
            { label: "Перевозка животных", icon: "🐶" },
            { label: "Между городами", icon: "🛣️" },
        ],
        courier: [
            { label: "Цветы", icon: "💐" },
            { label: "Еда/продукты", icon: "🍔" },
            { label: "Документы", icon: "📄" },
        ],
    };

    const recommendedRegularPrice = useMemo(() => {
        return calculateRecommendedPrice({
            pricingConfig:
            selectedService?.pricingConfig,

            serviceDetails,
        });
    }, [
        selectedService?.pricingConfig,
        serviceDetails,
    ]);
    useEffect(() => {
        setServiceDetails((previous) => {
            const current = previous || {};

            if (!recommendedRegularPrice) {
                if (
                    current.recommendedPrice === undefined &&
                    current.recommendedPriceMin === undefined &&
                    current.recommendedPriceMax === undefined &&
                    current.pricingCalculator === undefined
                ) {
                    return current;
                }

                const next = { ...current };

                delete next.recommendedPrice;
                delete next.recommendedPriceMin;
                delete next.recommendedPriceMax;
                delete next.pricingCalculator;

                return next;
            }

            if (
                current.recommendedPrice ===
                recommendedRegularPrice.recommendedPrice &&
                current.recommendedPriceMin ===
                recommendedRegularPrice.minPrice &&
                current.recommendedPriceMax ===
                recommendedRegularPrice.maxPrice &&
                current.pricingCalculator ===
                recommendedRegularPrice.calculator
            ) {
                return current;
            }

            return {
                ...current,

                recommendedPrice:
                recommendedRegularPrice.recommendedPrice,

                recommendedPriceMin:
                recommendedRegularPrice.minPrice,

                recommendedPriceMax:
                recommendedRegularPrice.maxPrice,

                pricingCalculator:
                recommendedRegularPrice.calculator,
            };
        });
    }, [
        recommendedRegularPrice?.recommendedPrice,
        recommendedRegularPrice?.minPrice,
        recommendedRegularPrice?.maxPrice,
        recommendedRegularPrice?.calculator,
    ]);

    useEffect(() => {
        const destination =
            serviceDetails?.destinationCoordinates;

        const hasStart =
            isValidOrderCoords(markerPosition);

        const destinationLat =
            Number(destination?.lat);

        const destinationLng =
            Number(destination?.lng);

        const hasDestination =
            Number.isFinite(destinationLat) &&
            Number.isFinite(destinationLng);

        if (!hasStart || !hasDestination) {
            setServiceDetails((previous) => {
                if (
                    previous?.straightDistanceKm === undefined &&
                    previous?.estimatedRoadDistanceKm === undefined &&
                    previous?.distanceKm === undefined &&
                    previous?.distanceType === undefined
                ) {
                    return previous;
                }

                const next = {
                    ...(previous || {}),
                };

                delete next.straightDistanceKm;
                delete next.estimatedRoadDistanceKm;
                delete next.distanceKm;
                delete next.distanceType;
                delete next.distanceCoefficient;

                return next;
            });

            return;
        }

        const straightDistanceKm =
            calculateStraightDistanceKm(
                markerPosition[0],
                markerPosition[1],
                destinationLat,
                destinationLng
            );

        if (straightDistanceKm === null) {
            return;
        }

        const distanceCoefficient = 1.35;

        const estimatedRoadDistanceKm =
            Math.round(
                straightDistanceKm *
                distanceCoefficient *
                10
            ) / 10;

        setServiceDetails((previous) => {
            if (
                previous?.straightDistanceKm ===
                straightDistanceKm &&
                previous?.estimatedRoadDistanceKm ===
                estimatedRoadDistanceKm &&
                previous?.distanceType ===
                "estimated_from_coordinates"
            ) {
                return previous;
            }

            return {
                ...(previous || {}),

                straightDistanceKm,
                estimatedRoadDistanceKm,

                distanceKm:
                estimatedRoadDistanceKm,

                distanceCoefficient,

                distanceType:
                    "estimated_from_coordinates",
            };
        });
    }, [
        markerPosition?.[0],
        markerPosition?.[1],
        serviceDetails?.destinationCoordinates?.lat,
        serviceDetails?.destinationCoordinates?.lng,
    ]);

    const clearSelectedService = () => {
        setSelectedService(null);
        setSelectedCategory("");
        setSelectedSubcategory("");
        setServiceDetails({});
    };

    const clearServiceSearchTimer = () => {
        if (serviceSearchTimerRef.current) {
            clearTimeout(
                serviceSearchTimerRef.current
            );

            serviceSearchTimerRef.current = null;
        }
    };

    const abortServiceSearch = () => {
        if (serviceSearchAbortRef.current) {
            serviceSearchAbortRef.current.abort();
            serviceSearchAbortRef.current = null;
        }
    };

    const handleServiceQueryChange = (event) => {
        const value = event.target.value;

        setServiceQuery(value);
        setError("");

        if (selectedService) {
            clearSelectedService();
        }

        clearServiceSearchTimer();
        abortServiceSearch();

        const query = value.trim();

        if (query.length < 2) {
            setServiceSuggestions([]);
            setServiceSearchOpen(false);
            setServiceSearching(false);
            return;
        }

        setServiceSearchOpen(true);
        setServiceSearching(true);

        serviceSearchTimerRef.current =
            setTimeout(async () => {
                const controller =
                    new AbortController();

                serviceSearchAbortRef.current =
                    controller;

                try {
                    const response =
                        await axios.get(
                            `${apiUrl}/api/category/search`,
                            {
                                params: {
                                    q: query,
                                },

                                signal:
                                controller.signal,
                            }
                        );

                    const results =
                        Array.isArray(
                            response.data?.results
                        )
                            ? response.data.results
                            : [];

                    const safeResults =
                        results.filter((item) => {
                            const categoryName =
                                String(
                                    item?.categoryName ||
                                    ""
                                )
                                    .trim()
                                    .toLowerCase();

                            return ![
                                "такси",
                                "курьер",
                            ].includes(categoryName);
                        });

                    setServiceSuggestions(
                        safeResults
                    );

                    setServiceSearchOpen(true);
                } catch (searchError) {
                    if (
                        searchError?.name ===
                        "CanceledError" ||
                        searchError?.name ===
                        "AbortError" ||
                        searchError?.code ===
                        "ERR_CANCELED"
                    ) {
                        return;
                    }

                    console.error(
                        "Ошибка поиска услуги:",
                        searchError
                    );

                    setServiceSuggestions([]);
                    setServiceSearchOpen(true);
                } finally {
                    if (
                        serviceSearchAbortRef.current ===
                        controller
                    ) {
                        serviceSearchAbortRef.current =
                            null;

                        setServiceSearching(false);
                    }
                }
            }, 300);
    };

    const handleServiceSelect = (option) => {
        const categoryId =
            Number(option?.categoryId);

        const subcategoryId =
            option?.subcategoryId
                ? Number(option.subcategoryId)
                : null;

        if (
            !Number.isFinite(categoryId) ||
            categoryId <= 0
        ) {
            return;
        }

        setServiceDetails({});

        setSelectedCategory(
            String(categoryId)
        );

        setSelectedSubcategory(
            Number.isFinite(subcategoryId) &&
            subcategoryId > 0
                ? String(subcategoryId)
                : ""
        );

        setSelectedService({
            type: option.type,

            categoryId,
            categoryName:
            option.categoryName,

            subcategoryId:
                Number.isFinite(
                    subcategoryId
                ) && subcategoryId > 0
                    ? subcategoryId
                    : null,

            subcategoryName:
                option.subcategoryName ||
                null,

            subcategoryCode:
                option.subcategoryCode ||
                null,

            formConfig:
                option.formConfig || null,

            pricingConfig:
                option.pricingConfig || null,

            label: option.label,

            matchedPhrase:
                option.matchedPhrase || null,

            price:
                option.price ?? null,
        });

        setServiceQuery(
            option.subcategoryName ||
            option.categoryName ||
            option.label ||
            ""
        );

        setServiceSuggestions([]);
        setServiceSearchOpen(false);
        setServiceSearching(false);
        setError("");
    };

    const handleServiceClear = () => {
        clearServiceSearchTimer();
        abortServiceSearch();

        setServiceQuery("");
        setServiceSuggestions([]);
        setServiceSearchOpen(false);
        setServiceSearching(false);

        clearSelectedService();
    };

    useEffect(() => {
        return () => {
            clearServiceSearchTimer();
            abortServiceSearch();
        };
    }, []);

    useEffect(() => {
        const handleOutsideClick = (event) => {
            if (
                serviceSearchBoxRef.current &&
                !serviceSearchBoxRef.current
                    .contains(event.target)
            ) {
                setServiceSearchOpen(false);
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

    const validateServiceDetails = () => {
        const fields = Array.isArray(
            selectedService?.formConfig?.fields
        )
            ? selectedService.formConfig.fields
            : [];

        for (const field of fields) {
            const value =
                serviceDetails?.[field.key];

            if (field.required) {
                const isEmpty =
                    value === undefined ||
                    value === null ||
                    String(value).trim() === "";

                if (isEmpty) {
                    return `Заполните поле «${field.label}»`;
                }
            }

            if (
                field.type === "address" &&
                value &&
                field.required
            ) {
                const coordinatesKey =
                    field.coordinatesKey ||
                    `${field.key}Coordinates`;

                const coordinates =
                    serviceDetails?.[
                        coordinatesKey
                        ];

                const lat =
                    Number(coordinates?.lat);

                const lng =
                    Number(coordinates?.lng);

                if (
                    !Number.isFinite(lat) ||
                    !Number.isFinite(lng)
                ) {
                    return `Выберите точный адрес в поле «${field.label}» из подсказки`;
                }
            }

            if (
                field.type === "number" &&
                value !== "" &&
                value !== undefined &&
                value !== null
            ) {
                const numberValue =
                    Number(value);

                if (
                    !Number.isFinite(numberValue)
                ) {
                    return `В поле «${field.label}» должно быть число`;
                }

                if (
                    field.min !== undefined &&
                    numberValue <
                    Number(field.min)
                ) {
                    return `Минимальное значение поля «${field.label}» — ${field.min}`;
                }

                if (
                    field.max !== undefined &&
                    numberValue >
                    Number(field.max)
                ) {
                    return `Максимальное значение поля «${field.label}» — ${field.max}`;
                }
            }
        }

        return null;
    };

    const coordsOk = useMemo(() => {
        const fLat = toNum(expressForm.fromLat);
        const fLng = toNum(expressForm.fromLng);
        const tLat = toNum(expressForm.toLat);
        const tLng = toNum(expressForm.toLng);
        return [fLat, fLng, tLat, tLng].every(Number.isFinite);
    }, [expressForm.fromLat, expressForm.fromLng, expressForm.toLat, expressForm.toLng]);

    const [routeCalc, setRouteCalc] = useState({
        loading: false,
        distanceKm: null,
        durationMin: null,
        err: "",
    });

    const recommended = useMemo(() => {
        const km = routeCalc.distanceKm;
        if (!Number.isFinite(km)) return null;

        const { base, perKm } = PRICING[expressType] || PRICING.taxi;
        const rec = Math.round(base + perKm * km);

        return {
            rec,
            km,
            min: routeCalc.durationMin,
        };
    }, [routeCalc.distanceKm, routeCalc.durationMin, expressType]);

    const routeStatus = useMemo(() => {
        if (!coordsOk) return "Укажите точки A и B — покажем расстояние и время.";
        if (routeCalc.loading) return "Считаем маршрут…";
        if (routeCalc.err) return `Маршрут не рассчитан: ${routeCalc.err}`;
        if (recommended) {
            return `~${recommended.km} км · ${Number.isFinite(recommended.min) ? `~${recommended.min} мин` : "—"}`;
        }
        return "Маршрут готов.";
    }, [coordsOk, routeCalc.loading, routeCalc.err, recommended]);

    const applyRecommended = () => {
        if (!recommended?.rec) return;

        setExpressForm((p) => ({
            ...p,
            totalPrice: String(recommended.rec),
        }));
    };

    useEffect(() => {
        let alive = true;

        const run = async () => {
            if (!coordsOk) {
                setRouteCalc({
                    loading: false,
                    distanceKm: null,
                    durationMin: null,
                    err: "",
                });
                return;
            }

            if (!YM_KEY) {
                setRouteCalc({
                    loading: false,
                    distanceKm: null,
                    durationMin: null,
                    err: "Нет REACT_APP_YANDEX_API_KEY",
                });
                return;
            }

            setRouteCalc({
                loading: true,
                distanceKm: null,
                durationMin: null,
                err: "",
            });

            try {
                const r = await calcRouteByYmaps({
                    apiKey: YM_KEY,
                    fromLat: expressForm.fromLat,
                    fromLng: expressForm.fromLng,
                    toLat: expressForm.toLat,
                    toLng: expressForm.toLng,
                });

                if (!alive) return;

                setRouteCalc({
                    loading: false,
                    distanceKm: Number.isFinite(r.distanceKm) ? Number(r.distanceKm.toFixed(2)) : null,
                    durationMin: Number.isFinite(r.durationMin) ? r.durationMin : null,
                    err: "",
                });
            } catch (e) {
                console.error("route calc error:", e);

                if (!alive) return;

                setRouteCalc({
                    loading: false,
                    distanceKm: null,
                    durationMin: null,
                    err: "Не удалось рассчитать маршрут",
                });
            }
        };

        run();

        return () => {
            alive = false;
        };
    }, [
        coordsOk,
        YM_KEY,
        expressForm.fromLat,
        expressForm.fromLng,
        expressForm.toLat,
        expressForm.toLng,
    ]);

    const getMinTime = (selectedDate) => {
        const currentDate = new Date();

        if (!selectedDate || selectedDate.toDateString() === currentDate.toDateString()) {
            return new Date(
                currentDate.getFullYear(),
                currentDate.getMonth(),
                currentDate.getDate(),
                currentDate.getHours(),
                currentDate.getMinutes()
            );
        }

        return new Date(
            selectedDate.getFullYear(),
            selectedDate.getMonth(),
            selectedDate.getDate(),
            0,
            0,
            0
        );
    };

    const handleRegularDescriptionChange = (e) => {
        const textarea = e.target;
        textarea.style.height = "auto";
        textarea.style.height = `${textarea.scrollHeight}px`;

        setRegularForm((p) => ({ ...p, description: textarea.value }));
    };

    const handleRegularAddressChange = (e) => {
        const address = e.target.value;
        setRegularForm((p) => ({ ...p, address }));
        setMarkerPosition(null);

        const q = address.trim();
        if (q.length < 3) {
            setAddressSuggestions([]);
            return;
        }

        if (!YM_KEY) {
            setError("Не задан REACT_APP_YANDEX_API_KEY. Подсказки адреса не работают.");
            return;
        }

        if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);

        suggestTimerRef.current = setTimeout(async () => {
            try {
                if (suggestAbortRef.current) suggestAbortRef.current.abort();
                const ctrl = new AbortController();
                suggestAbortRef.current = ctrl;

                const url =
                    `https://geocode-maps.yandex.ru/1.x/?apikey=${YM_KEY}` +
                    `&geocode=${encodeURIComponent(q)}` +
                    `&format=json&results=10&kind=house`;

                const r = await fetch(url, { signal: ctrl.signal });
                const data = await r.json();

                const suggestions = parseYandexGeocoderSuggestions(data);
                const uniq = Array.from(new Map(suggestions.map((s) => [s.label, s])).values());
                setAddressSuggestions(uniq);
            } catch (err) {
                if (err?.name === "AbortError") return;
                console.error("Ошибка геокодирования:", err);
                setAddressSuggestions([]);
            }
        }, 250);
    };

    const handleRegularAddressSelect = (s) => {
        setRegularForm((p) => ({ ...p, address: s.address }));
        setAddressSuggestions([]);
        setMarkerPosition([s.lat, s.lon]);
        setError("");
    };

    const onExpressAddressInput = (kind, value) => {
        if (kind === "from") {
            setExpressForm((p) => ({
                ...p,
                fromAddress: value,
                fromLat: "",
                fromLng: "",
            }));
        } else {
            setExpressForm((p) => ({
                ...p,
                toAddress: value,
                toLat: "",
                toLng: "",
            }));
        }

        const q = String(value || "").trim();
        if (q.length < 3) {
            setExpressSuggestions((p) => ({ ...p, [kind]: [] }));
            return;
        }

        if (!YM_KEY) {
            setError("Не задан REACT_APP_YANDEX_API_KEY. Подсказки адреса не работают.");
            return;
        }

        const t = expressSuggestTimerRef.current[kind];
        if (t) clearTimeout(t);

        expressSuggestTimerRef.current[kind] = setTimeout(async () => {
            try {
                const prevCtrl = expressSuggestAbortRef.current[kind];
                if (prevCtrl) prevCtrl.abort();

                const ctrl = new AbortController();
                expressSuggestAbortRef.current[kind] = ctrl;

                const url =
                    `https://geocode-maps.yandex.ru/1.x/?apikey=${YM_KEY}` +
                    `&geocode=${encodeURIComponent(q)}` +
                    `&format=json&results=8&kind=house`;

                const r = await fetch(url, { signal: ctrl.signal });
                const data = await r.json();

                const items = parseYandexGeocoderSuggestions(data);
                const uniq = Array.from(new Map(items.map((x) => [x.label, x])).values());

                setExpressSuggestions((p) => ({ ...p, [kind]: uniq }));
            } catch (e) {
                if (e?.name === "AbortError") return;
                console.error("suggest error:", e);
                setExpressSuggestions((p) => ({ ...p, [kind]: [] }));
            }
        }, 250);
    };

    const onPickExpressSuggest = (kind, s) => {
        if (kind === "from") {
            setExpressForm((p) => ({
                ...p,
                fromAddress: s.address,
                fromLat: String(s.lat),
                fromLng: String(s.lon),
            }));
        } else {
            setExpressForm((p) => ({
                ...p,
                toAddress: s.address,
                toLat: String(s.lat),
                toLng: String(s.lon),
            }));
        }

        setExpressSuggestions((p) => ({ ...p, [kind]: [] }));
        setError("");
    };

    const handleSubmitRegular = async () => {
        if (!regularForm.address?.trim()) {
            setError("Укажите адрес");
            return;
        }

        if (
            !selectedCategory ||
            !selectedService
        ) {
            setError(
                "Выберите подходящую услугу из подсказки"
            );

            setServiceSearchOpen(true);
            return;
        }

        if (
            !isValidOrderCoords(
                markerPosition
            )
        ) {
            setError(
                "Выберите точный адрес из подсказки"
            );

            return;
        }

        if (
            !isAsap &&
            !regularForm.workTime
        ) {
            setError(
                "Укажите дату и время выполнения"
            );

            return;
        }

        const serviceDetailsError =
            validateServiceDetails();

        if (serviceDetailsError) {
            setError(serviceDetailsError);
            return;
        }

        const proposedSum =
            Number(
                regularForm.proposedSum
            );

        if (
            !Number.isFinite(proposedSum) ||
            proposedSum <= 0
        ) {
            setError(
                "Укажите корректную сумму за работу"
            );

            return;
        }

        if (proposedSum > 300000) {
            setError(
                "Максимальная стоимость заказа — 300 000 ₽"
            );

            return;
        }

        const normalizedUserId =
            Number(userId);

        if (
            !Number.isFinite(
                normalizedUserId
            ) ||
            normalizedUserId <= 0
        ) {
            setError(
                "Некорректный ID пользователя"
            );

            return;
        }

        setError("");
        setSubmitting(true);

        try {
            const payload = {
                userId:
                normalizedUserId,

                description:
                    regularForm.description ||
                    "",

                address:
                    regularForm.address.trim(),

                isAsap,

                workTime:
                    !isAsap &&
                    regularForm.workTime
                        ? new Date(
                            regularForm.workTime
                        ).toISOString()
                        : null,

                proposedSum:
                    Math.round(proposedSum),

                paymentType: "cash",

                categoryId:
                    Number(selectedCategory),

                subcategoryId:
                    selectedSubcategory
                        ? Number(
                            selectedSubcategory
                        )
                        : null,

                serviceId: null,

                serviceDetails:
                    serviceDetails || {},

                coordinates:
                    `${Number(
                        markerPosition[0]
                    )},${Number(
                        markerPosition[1]
                    )}`,
            };

            await axios.post(
                `${apiUrl}/api/admin/create-order`,
                payload,
                {
                    headers: {
                        Authorization:
                            `Bearer ${token}`,

                        "Content-Type":
                            "application/json",
                    },
                }
            );

            alert(
                "Обычный заказ успешно создан"
            );

            navigate("/orders");
        } catch (err) {
            console.error(
                "Ошибка при создании заказа:",
                err
            );

            console.error(
                "Ответ сервера:",
                err.response?.data
            );

            setError(
                err.response?.data?.message ||
                "Не удалось создать заказ"
            );
        } finally {
            setSubmitting(false);
        }
    };

    const handleSubmitExpress = async () => {
        if (!expressForm.fromAddress?.trim() || !expressForm.toAddress?.trim()) {
            setError("Заполните адреса Откуда и Куда");
            return;
        }

        if (!coordsOk) {
            setError("Выберите оба адреса именно из подсказок.");
            return;
        }

        if (!expressForm.totalPrice || Number(expressForm.totalPrice) <= 0) {
            setError("Укажите цену");
            return;
        }

        setError("");
        setSubmitting(true);

        try {
            const payload = {
                userId: Number(userId),
                type: expressType,
                subcategory: expressForm.subcategory || null,
                paymentType: "cash",
                totalPrice: Number(expressForm.totalPrice),
                description: expressForm.description || null,

                fromAddress: expressForm.fromAddress,
                fromLat: Number(expressForm.fromLat),
                fromLng: Number(expressForm.fromLng),

                toAddress: expressForm.toAddress,
                toLat: Number(expressForm.toLat),
                toLng: Number(expressForm.toLng),
            };

            await axios.post(`${apiUrl}/api/admin/create-express-order`, payload, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            });

            alert("Экспресс-заказ успешно создан");
            navigate("/orders");
        } catch (err) {
            console.error("Ошибка при создании экспресс-заказа:", err);
            setError(err.response?.data?.message || "Не удалось создать экспресс-заказ");
        } finally {
            setSubmitting(false);
        }
    };

    const handleMainSubmit = (e) => {
        e.preventDefault();
        if (submitting) return;

        if (mode === "regular") {
            handleSubmitRegular();
        } else {
            handleSubmitExpress();
        }
    };

    return (
        <div className="admin-create-page">
            <div className="admin-create-shell">
                <div className="admin-glass admin-header-card">
                    <div className="admin-header-row">
                        <div>
                            <div className="admin-page-title">Создать заказ</div>
                            <div className="admin-page-subtitle">
                                Для пользователя #{userId}
                            </div>
                        </div>

                        <div className="admin-mode-switch">
                            <button
                                type="button"
                                className={`admin-mode-btn ${mode === "regular" ? "active" : ""}`}
                                onClick={() => setMode("regular")}
                            >
                                Обычный
                            </button>

                            <button
                                type="button"
                                className={`admin-mode-btn ${mode === "express" ? "active" : ""}`}
                                onClick={() => setMode("express")}
                            >
                                Экспресс
                            </button>
                        </div>
                    </div>
                </div>

                {error && (
                    <div className="admin-glass admin-alert admin-alert-danger">
                        <div className="admin-alert-title">Ошибка</div>
                        <div className="admin-alert-text">{error}</div>
                    </div>
                )}

                <form onSubmit={handleMainSubmit}>
                    {mode === "regular" && (
                        <>
                            <div className="admin-glass admin-section-card">
                                <div className="admin-section-head">
                                    <div>
                                        <div className="admin-section-title">Время и адрес</div>
                                        <div className="admin-section-sub">
                                            Быстрое создание обычного заказа
                                        </div>
                                    </div>
                                </div>

                                <div className="admin-grid-2">
                                    <div className="admin-field">
                                        <div className="admin-label-row">
                                            <div className="admin-label">Режим времени</div>
                                            <button
                                                type="button"
                                                className={`admin-toggle ${isAsap ? "on" : ""}`}
                                                onClick={() => {
                                                    const next = !isAsap;

                                                    setIsAsap(next);

                                                    setRegularForm((previous) => ({
                                                        ...previous,

                                                        workTime: next
                                                            ? null
                                                            : previous.workTime ||
                                                            plusHour(new Date()),
                                                    }));
                                                }}
                                            >
                                                <span className="admin-toggle-knob" />
                                            </button>
                                        </div>

                                        <div className="admin-hint">
                                            {isAsap ? "Срочно" : "Ко времени"}
                                        </div>
                                    </div>

                                    {!isAsap && (
                                        <div className="admin-field">
                                            <div className="admin-label">Дата и время</div>
                                            <DatePicker
                                                selected={regularForm.workTime}
                                                onChange={(date) =>
                                                    setRegularForm((p) => ({ ...p, workTime: date }))
                                                }
                                                showTimeSelect
                                                timeFormat="HH:mm"
                                                timeIntervals={15}
                                                dateFormat="Pp"
                                                placeholderText="Выберите дату и время"
                                                minDate={new Date()}
                                                minTime={getMinTime(regularForm.workTime)}
                                                maxTime={new Date(0, 0, 0, 23, 59, 59)}
                                                className="admin-control"
                                                portalId="date-picker-portal"
                                            />
                                        </div>
                                    )}
                                </div>

                                <div className="admin-field" style={{ marginTop: 12 }}>
                                    <div className="admin-label">Адрес</div>

                                    <input
                                        className="admin-control"
                                        type="text"
                                        placeholder="Введите адрес"
                                        value={regularForm.address}
                                        onChange={handleRegularAddressChange}
                                    />

                                    {addressSuggestions.length > 0 && (
                                        <ul className="admin-suggestions">
                                            {addressSuggestions.map((s, i) => (
                                                <li
                                                    key={`${s.label}-${i}`}
                                                    onClick={() => handleRegularAddressSelect(s)}
                                                >
                                                    {s.label}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </div>

                            <div className="admin-glass admin-section-card">
                                <div className="admin-section-head">
                                    <div>
                                        <div className="admin-section-title">
                                            Что нужно сделать?
                                        </div>

                                        <div className="admin-section-sub">
                                            Начните вводить название работы
                                        </div>
                                    </div>
                                </div>

                                <div
                                    className="admin-field admin-service-search"
                                    ref={serviceSearchBoxRef}
                                >
                                    <div className="admin-label">
                                        Услуга
                                    </div>

                                    <div className="admin-service-control-wrap">
                                        <input
                                            className={`admin-control admin-service-control ${
                                                selectedService
                                                    ? "selected"
                                                    : ""
                                            }`}
                                            type="text"
                                            value={serviceQuery}
                                            onChange={
                                                handleServiceQueryChange
                                            }
                                            onFocus={() => {
                                                if (
                                                    serviceQuery
                                                        .trim()
                                                        .length >= 2 &&
                                                    !selectedService
                                                ) {
                                                    setServiceSearchOpen(
                                                        true
                                                    );
                                                }
                                            }}
                                            placeholder="Например: перевезти диван, починить кран"
                                            autoComplete="off"
                                        />

                                        {serviceSearching && (
                                            <span className="admin-service-spinner" />
                                        )}

                                        {!serviceSearching &&
                                            serviceQuery && (
                                                <button
                                                    type="button"
                                                    className="admin-service-clear"
                                                    onClick={
                                                        handleServiceClear
                                                    }
                                                >
                                                    ×
                                                </button>
                                            )}
                                    </div>

                                    {selectedService && (
                                        <div className="admin-selected-service">
                                            <div className="admin-selected-service-main">
                    <span className="admin-selected-service-check">
                        ✓
                    </span>

                                                <div>
                                                    <div className="admin-selected-service-name">
                                                        {selectedService
                                                                .subcategoryName ||
                                                            selectedService
                                                                .categoryName}
                                                    </div>

                                                    <div className="admin-selected-service-category">
                                                        {selectedService
                                                            .subcategoryName
                                                            ? `Категория: ${selectedService.categoryName}`
                                                            : "Выбрана общая категория"}
                                                    </div>
                                                </div>
                                            </div>

                                            <button
                                                type="button"
                                                className="admin-mini-btn"
                                                onClick={
                                                    handleServiceClear
                                                }
                                            >
                                                Изменить
                                            </button>
                                        </div>
                                    )}

                                    {!selectedService &&
                                        serviceSearchOpen &&
                                        serviceQuery.trim().length >=
                                        2 && (
                                            <div className="admin-service-results">
                                                <div className="admin-service-results-title">
                                                    {serviceSearching
                                                        ? "Ищем услугу…"
                                                        : serviceSuggestions
                                                            .length > 0
                                                            ? "Выберите подходящую услугу"
                                                            : "Ничего не найдено"}
                                                </div>

                                                {!serviceSearching &&
                                                    serviceSuggestions
                                                        .length > 0 && (
                                                        <div className="admin-service-result-list">
                                                            {serviceSuggestions.map(
                                                                (option) => {
                                                                    const resultKey =
                                                                        option.subcategoryId
                                                                            ? `subcategory-${option.subcategoryId}`
                                                                            : `category-${option.categoryId}`;

                                                                    return (
                                                                        <button
                                                                            key={
                                                                                resultKey
                                                                            }
                                                                            type="button"
                                                                            className="admin-service-result"
                                                                            onMouseDown={(
                                                                                event
                                                                            ) => {
                                                                                event.preventDefault();
                                                                            }}
                                                                            onClick={() =>
                                                                                handleServiceSelect(
                                                                                    option
                                                                                )
                                                                            }
                                                                        >
                                                <span>
                                                    <strong>
                                                        {option.subcategoryName ||
                                                            option.categoryName}
                                                    </strong>

                                                    <small>
                                                        {option.subcategoryName
                                                            ? option.categoryName
                                                            : "Общая категория"}
                                                    </small>
                                                </span>

                                                                            <span className="admin-service-result-type">
                                                    {option.subcategoryId
                                                        ? "Услуга"
                                                        : "Категория"}
                                                </span>
                                                                        </button>
                                                                    );
                                                                }
                                                            )}
                                                        </div>
                                                    )}

                                                {!serviceSearching &&
                                                    serviceSuggestions
                                                        .length === 0 && (
                                                        <div className="admin-service-empty">
                                                            Попробуйте написать
                                                            услугу другими
                                                            словами.
                                                        </div>
                                                    )}
                                            </div>
                                        )}
                                </div>
                            </div>

                            {selectedService?.formConfig?.fields
                                ?.length > 0 && (
                                <div className="admin-glass admin-section-card">
                                    <div className="admin-section-head">
                                        <div>
                                            <div className="admin-section-title">
                                                Детали заказа
                                            </div>

                                            <div className="admin-section-sub">
                                                Параметры выбранной услуги
                                            </div>
                                        </div>
                                    </div>

                                    <DynamicServiceFields
                                        config={
                                            selectedService.formConfig
                                        }
                                        value={serviceDetails}
                                        onChange={
                                            setServiceDetails
                                        }
                                        yandexApiKey={YM_KEY}
                                    />

                                    {Number.isFinite(
                                        Number(
                                            serviceDetails
                                                ?.estimatedRoadDistanceKm
                                        )
                                    ) && (
                                        <div className="admin-distance-card">
                                            <div>
                                                <strong>
                                                    Ориентировочное расстояние
                                                </strong>

                                                <span>
                        Приблизительный дорожный
                        маршрут между адресами
                    </span>
                                            </div>

                                            <b>
                                                ≈{" "}
                                                {Number(
                                                    serviceDetails
                                                        .estimatedRoadDistanceKm
                                                ).toFixed(1)}{" "}
                                                км
                                            </b>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="admin-glass admin-section-card">
                                <div className="admin-section-head">
                                    <div>
                                        <div className="admin-section-title">Описание</div>
                                        <div className="admin-section-sub">
                                            Детали задачи
                                        </div>
                                    </div>
                                </div>

                                <div className="admin-field">
                                    <div className="admin-label">Описание</div>
                                    <textarea
                                        className="admin-control admin-textarea"
                                        placeholder="Что нужно сделать?"
                                        value={regularForm.description}
                                        onChange={handleRegularDescriptionChange}
                                        rows={3}
                                    />
                                </div>

                                <div className="admin-field" style={{ marginTop: 12 }}>
                                    {recommendedRegularPrice && (
                                        <div className="admin-recommended-price">
                                            <div className="admin-recommended-price-content">
                                                <div className="admin-recommended-price-title">
                                                    Рекомендуемый бюджет
                                                </div>

                                                <div className="admin-recommended-price-range">
                                                    {recommendedRegularPrice
                                                        .minPrice
                                                        .toLocaleString(
                                                            "ru-RU"
                                                        )}{" "}
                                                    –{" "}
                                                    {recommendedRegularPrice
                                                        .maxPrice
                                                        .toLocaleString(
                                                            "ru-RU"
                                                        )}{" "}
                                                    ₽
                                                </div>

                                                {Array.isArray(
                                                        recommendedRegularPrice.breakdown
                                                    ) &&
                                                    recommendedRegularPrice
                                                        .breakdown.length >
                                                    0 && (
                                                        <div className="admin-recommended-breakdown">
                                                            {recommendedRegularPrice.breakdown.map(
                                                                (item) => (
                                                                    <div
                                                                        key={
                                                                            item.key
                                                                        }
                                                                        className="admin-recommended-breakdown-row"
                                                                    >
                                    <span>
                                        {
                                            item.label
                                        }
                                    </span>

                                                                        <strong>
                                                                            {Math.round(
                                                                                Number(
                                                                                    item.amount
                                                                                )
                                                                            ).toLocaleString(
                                                                                "ru-RU"
                                                                            )}{" "}
                                                                            ₽
                                                                        </strong>
                                                                    </div>
                                                                )
                                                            )}
                                                        </div>
                                                    )}
                                            </div>

                                            <button
                                                type="button"
                                                className="admin-mini-btn"
                                                onClick={() => {
                                                    setRegularForm(
                                                        (previous) => ({
                                                            ...previous,

                                                            proposedSum:
                                                                String(
                                                                    recommendedRegularPrice
                                                                        .recommendedPrice
                                                                ),
                                                        })
                                                    );
                                                }}
                                            >
                                                Указать сумму
                                            </button>
                                        </div>
                                    )}
                                    <div className="admin-label">Сумма за работу</div>
                                    <input
                                        className="admin-control"
                                        type="number"
                                        min="1"
                                        max="300000"
                                        step="1"
                                        placeholder="Например 1500"
                                        value={regularForm.proposedSum}
                                        onChange={(e) => {
                                            const value = e.target.value;

                                            if (value === "") {
                                                setRegularForm((p) => ({
                                                    ...p,
                                                    proposedSum: "",
                                                }));

                                                return;
                                            }

                                            const numberValue =
                                                Number(value);

                                            if (
                                                !Number.isFinite(
                                                    numberValue
                                                )
                                            ) {
                                                return;
                                            }

                                            setRegularForm((p) => ({
                                                ...p,

                                                proposedSum:
                                                    String(
                                                        Math.min(
                                                            numberValue,
                                                            300000
                                                        )
                                                    ),
                                            }));
                                        }}
                                    />
                                </div>
                            </div>
                        </>
                    )}

                    {mode === "express" && (
                        <>
                            <div className="admin-glass admin-section-card">
                                <div className="admin-section-head">
                                    <div>
                                        <div className="admin-section-title">Тип экспресс-заказа</div>
                                        <div className="admin-section-sub">
                                            Такси или курьер
                                        </div>
                                    </div>
                                </div>

                                <div className="admin-type-grid">
                                    <button
                                        type="button"
                                        className={`admin-type-btn ${expressType === "taxi" ? "active" : ""}`}
                                        onClick={() => {
                                            setExpressType("taxi");
                                            setExpressForm((p) => ({ ...p, subcategory: "" }));
                                        }}
                                    >
                                        🚕 Такси
                                    </button>

                                    <button
                                        type="button"
                                        className={`admin-type-btn ${expressType === "courier" ? "active" : ""}`}
                                        onClick={() => {
                                            setExpressType("courier");
                                            setExpressForm((p) => ({ ...p, subcategory: "" }));
                                        }}
                                    >
                                        📦 Курьер
                                    </button>
                                </div>
                            </div>

                            <div className="admin-glass admin-section-card">
                                <div className="admin-section-head">
                                    <div>
                                        <div className="admin-section-title">Маршрут</div>
                                        <div className="admin-section-sub">
                                            Укажите точки A и B
                                        </div>
                                    </div>
                                </div>

                                <div className="admin-grid-2">
                                    <div className="admin-field">
                                        <div className="admin-label">Откуда (A)</div>

                                        <input
                                            className="admin-control"
                                            value={expressForm.fromAddress}
                                            onChange={(e) =>
                                                onExpressAddressInput("from", e.target.value)
                                            }
                                            placeholder="Адрес точки A"
                                        />

                                        {expressSuggestions.from.length > 0 && (
                                            <ul className="admin-suggestions">
                                                {expressSuggestions.from.map((s, i) => (
                                                    <li
                                                        key={`${s.label}-${i}`}
                                                        onClick={() => onPickExpressSuggest("from", s)}
                                                    >
                                                        {s.label}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>

                                    <div className="admin-field">
                                        <div className="admin-label">Куда (B)</div>

                                        <input
                                            className="admin-control"
                                            value={expressForm.toAddress}
                                            onChange={(e) =>
                                                onExpressAddressInput("to", e.target.value)
                                            }
                                            placeholder="Адрес точки B"
                                        />

                                        {expressSuggestions.to.length > 0 && (
                                            <ul className="admin-suggestions">
                                                {expressSuggestions.to.map((s, i) => (
                                                    <li
                                                        key={`${s.label}-${i}`}
                                                        onClick={() => onPickExpressSuggest("to", s)}
                                                    >
                                                        {s.label}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="admin-glass admin-section-card">
                                <div className="admin-section-head">
                                    <div>
                                        <div className="admin-section-title">Параметры заказа</div>
                                        <div className="admin-section-sub">
                                            Цена, опция и комментарий
                                        </div>
                                    </div>
                                </div>

                                <div className="admin-chips-wrap">
                                    {expressSubcategoryOptions[expressType].map((opt) => {
                                        const selected = expressForm.subcategory === opt.label;

                                        return (
                                            <button
                                                key={opt.label}
                                                type="button"
                                                className={`admin-chip ${selected ? "selected" : ""}`}
                                                onClick={() =>
                                                    setExpressForm((p) => ({
                                                        ...p,
                                                        subcategory: selected ? "" : opt.label,
                                                    }))
                                                }
                                            >
                                                <span>{opt.icon}</span>
                                                <span>{opt.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="admin-field" style={{ marginTop: 14 }}>
                                    <div className="admin-label-row">
                                        <div className="admin-label">Цена</div>

                                        {recommended?.rec ? (
                                            <button
                                                type="button"
                                                className="admin-mini-btn"
                                                onClick={applyRecommended}
                                                title="Поставить рекомендуемую цену"
                                            >
                                                Рекомендуем {recommended.rec} ₽
                                            </button>
                                        ) : null}
                                    </div>

                                    <input
                                        className="admin-control"
                                        type="number"
                                        value={expressForm.totalPrice}
                                        onChange={(e) =>
                                            setExpressForm((p) => ({
                                                ...p,
                                                totalPrice: e.target.value,
                                            }))
                                        }
                                        placeholder="Например 500"
                                    />

                                    <div className="admin-route-note">
                                        🧭 {routeStatus}
                                    </div>
                                </div>

                                <div className="admin-field" style={{ marginTop: 14 }}>
                                    <div className="admin-label">Комментарий</div>
                                    <textarea
                                        className="admin-control admin-textarea"
                                        value={expressForm.description}
                                        onChange={(e) =>
                                            setExpressForm((p) => ({
                                                ...p,
                                                description: e.target.value,
                                            }))
                                        }
                                        placeholder="Комментарий к экспресс-заказу"
                                        rows={3}
                                    />
                                </div>
                            </div>
                        </>
                    )}

                    <div className="admin-glass admin-bottom-actions">
                        <button
                            type="button"
                            className="admin-action-btn subtle"
                            onClick={() => navigate(-1)}
                        >
                            Назад
                        </button>

                        <button
                            type="submit"
                            disabled={submitting}
                            className="admin-action-btn primary"
                        >
                            {submitting ? "Создание…" : "Создать заказ"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default AdminCreateOrderPage;