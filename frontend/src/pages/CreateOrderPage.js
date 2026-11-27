import React, {useEffect, useMemo, useRef, useState} from "react";
import axios from "axios";
import DatePicker from "react-datepicker";
import {getCurrentLocation, getLocationErrorMessage} from "../utils/getCurrentLocation";
import "react-datepicker/dist/react-datepicker.css";
import {useNavigate} from "react-router-dom";
import "../styles/CreateOrderPage.css";
import "../styles/CreateOrderPageDark.css";
import imageCompression from "browser-image-compression";
import PromotionOptions, {PROMOTION_PRICES} from "../components/PromotionOptions";
import YandexMapModal from "../components/YandexMapModal";
import PaymentProviderSelect from "../components/PaymentProviderSelect";
import DynamicServiceFields, {isDynamicFieldVisible} from "../components/DynamicServiceFields";
import OrderWizard, {
    OrderWizardStep,
    OrderReview,
    OrderPhotoPreview,
} from "../components/OrderWizard";
import {calculateRecommendedPrice} from "../utils/calculateRecommendedPrice";
import { Check, Paperclip, Timer, X, ChevronUp, ChevronDown } from "lucide-react";

const CASH_ONLY_RELEASE = true;
const apiUrl = process.env.REACT_APP_API_URL;

function formatGuaranteeRub(kopecks) {
    return new Intl.NumberFormat("ru-RU", {
        maximumFractionDigits: 2,
    }).format(kopecks / 100) + " ₽";
}

function looksLikeCoordsString(v) {
    if (!v) return false;
    const s = String(v).trim();
    return s.startsWith("Координаты:") || /^\d{1,3}\.\d+,\s*\d{1,3}\.\d+$/.test(s);
}

function isValidOrderCoords(pos) {
    if (!Array.isArray(pos) || pos.length !== 2) return false;

    const lat = Number(pos[0]);
    const lng = Number(pos[1]);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

    // широта/долгота в допустимых пределах
    if (lat < -90 || lat > 90) return false;
    if (lng < -180 || lng > 180) return false;

    // защита от "нулевой точки" 0,0
    if (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001) return false;

    return true;
}

function parseYandexGeocoderSuggestions(data) {
    const members = data?.response?.GeoObjectCollection?.featureMember || [];

    return members
        .map((m) => {
            const g = m?.GeoObject;
            const text = g?.metaDataProperty?.GeocoderMetaData?.text; // ✅ полный адрес
            const pos = g?.Point?.pos; // "lon lat"
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

    const deltaLat =
        toRadians(lat2 - lat1);

    const deltaLng =
        toRadians(lng2 - lng1);

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

    return (
        Math.round(
            earthRadiusKm * c * 10
        ) / 10
    );
}

async function geocodeAddressYandex({address, apiKey}) {
    if (!apiKey) throw new Error("No Yandex API key");

    const q = String(address || "").trim();

    if (q.length < 3) {
        return null;
    }

    const url =
        `https://geocode-maps.yandex.ru/1.x/?apikey=${apiKey}` +
        `&geocode=${encodeURIComponent(q)}` +
        `&format=json&results=1&kind=house`;

    const r = await fetch(url);
    const data = await r.json();

    const first =
        data?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;

    const text =
        first?.metaDataProperty?.GeocoderMetaData?.text ||
        first?.name ||
        null;

    const pos = first?.Point?.pos; // "lon lat"

    if (!text || !pos) return null;

    const [lng, lat] = pos.split(" ").map(Number);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
    }

    return {
        address: text,
        lat,
        lng,
    };
}

// reverse geocode через Yandex Geocoder: geocode=lng,lat
async function reverseGeocodeYandex({lat, lng, apiKey}) {
    if (!apiKey) throw new Error("No Yandex API key");
    const url = `https://geocode-maps.yandex.ru/1.x/?apikey=${apiKey}&geocode=${lng},${lat}&format=json&results=1&kind=house`;
    const r = await fetch(url);
    const data = await r.json();

    const first = data?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
    const text = first?.metaDataProperty?.GeocoderMetaData?.text || first?.name || null;

    return text;
}

function plusHour(d) {
    const x = new Date(d);
    x.setSeconds(0, 0);
    x.setMinutes(x.getMinutes()); // оставляем как есть
    x.setHours(x.getHours() + 1);
    return x;
}

function CreateOrderPage() {
    const navigate = useNavigate();
    const currentDate = useMemo(() => new Date(), []);
    const YM_KEY = process.env.REACT_APP_YANDEX_API_KEY;

    const [formData, setFormData] = useState({
        description: "",
        address: "",
        workTime: null,
        proposedSum: "",
    });

    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [images, setImages] = useState([]);
    const [wizardStep, setWizardStep] =
        useState(1);

    const [imagesLoading, setImagesLoading] =
        useState(false);

    const submitRef = useRef(false);
    const imageUploadRef = useRef(false);

    const wizardSteps = [
        "Услуга",
        "Где и когда",
        "Стоимость",
        "Проверка",
    ];
    const [markerPosition, setMarkerPosition] = useState(null); // [lat, lng]
    const [addressSuggestions, setAddressSuggestions] = useState([]); // [{label,address,lat,lon}]    const [images, setImages] = useState([]);

    const [serviceQuery, setServiceQuery] = useState("");
    const [serviceSuggestions, setServiceSuggestions] = useState([]);
    const [serviceSearchOpen, setServiceSearchOpen] = useState(false);
    const [serviceSearching, setServiceSearching] = useState(false);

    const [selectedCategory, setSelectedCategory] = useState("");
    const [selectedSubcategory, setSelectedSubcategory] = useState("");
    const [selectedService, setSelectedService] = useState(null);

    const serviceSearchTimerRef = useRef(null);
    const serviceSearchAbortRef = useRef(null);
    const serviceSearchBoxRef = useRef(null);

    const [serviceDetails, setServiceDetails] = useState({});

    const [addressOpen, setAddressOpen] = useState(false);
    const [timeOpen, setTimeOpen] = useState(false);

    const [promotion, setPromotion] = useState({highlight: false, recommended: false, push: false});
    const [selectedProvider, setSelectedProvider] = useState("yookassa");

    const [paymentType, setPaymentType] =
        useState("cash");

    const [
        guaranteeEligibility,
        setGuaranteeEligibility,
    ] = useState({
        verified: false,
        available: false,
        operational: false,
    });

    const [
        guaranteePreview,
        setGuaranteePreview,
    ] = useState(null);

    const [
        guaranteePreviewLoading,
        setGuaranteePreviewLoading,
    ] = useState(false);

    const guaranteePreviewKopecks = useMemo(() => {
        const amount = Number(formData.proposedSum);

        if (
            !Number.isFinite(amount) ||
            amount <= 0 ||
            amount > 300000
        ) {
            return null;
        }

        return Math.round(amount * 100);
    }, [formData.proposedSum]);

    // Пока банк не подключён, гарантию можно
// выбирать только для предпросмотра в разработке.
    const guaranteeChoiceEnabled =
        process.env.NODE_ENV === "development" ||
        guaranteeEligibility.available === true;

// Защита от отображения устаревшего расчёта,
// если пользователь изменил сумму заказа.
    const selectedGuaranteeQuote =
        paymentType === "guarantee" &&
        guaranteePreview?.previewOnly === true &&
        guaranteePreview?.quote?.workPriceKopecks ===
        guaranteePreviewKopecks
            ? guaranteePreview.quote
            : null;

    // address
    const [profile, setProfile] = useState(null);
    const [addressMode, setAddressMode] = useState("profile"); // profile | custom
    const [showMapModal, setShowMapModal] = useState(false);
    const [addrResolving, setAddrResolving] = useState(false);
    const [addrResolveError, setAddrResolveError] = useState(null);
    const suggestTimerRef = React.useRef(null);
    const suggestAbortRef = React.useRef(null);

    // ✅ тумблер: ON = срочно
    const [isAsap, setIsAsap] = useState(true);


    const recommendedPrice = useMemo(() => {
        return calculateRecommendedPrice({
            pricingConfig:
            selectedService?.pricingConfig,
            serviceDetails,
        });
    }, [
        selectedService?.pricingConfig,
        serviceDetails,
    ]);

    const isCargoCategory =
        Number(
            selectedService?.categoryId
        ) === 3;

    const isHourlyCargo =
        isCargoCategory &&
        selectedService?.pricingConfig
            ?.pricingModel === "hourly";

    const isIntercityCargo =
        isCargoCategory &&
        selectedService?.pricingConfig
            ?.pricingModel === "distance";

    const isWasteRemoval =
        Number(
            selectedService?.subcategoryId
        ) === 41;

    useEffect(() => {
        if (!error) {
            return;
        }

        const timer = setTimeout(() => {
            setError("");
        }, 6000);

        return () => {
            clearTimeout(timer);
        };
    }, [error]);

    useEffect(() => {
        setServiceDetails((previous) => {
            const current =
                previous || {};

            if (!recommendedPrice) {
                if (
                    current.recommendedPrice ===
                    undefined &&
                    current.recommendedPriceMin ===
                    undefined &&
                    current.recommendedPriceMax ===
                    undefined &&
                    current.pricingCalculator ===
                    undefined
                ) {
                    return current;
                }

                const next = {
                    ...current,
                };

                delete next.recommendedPrice;
                delete next.recommendedPriceMin;
                delete next.recommendedPriceMax;

                delete next.pricingCalculator;
                delete next.pricingModel;

                delete next.pricingBilledHours;
                delete next.pricingMinimumHours;

                delete next.pricingFirstHourPrice;
                delete next.pricingNextHourPrice;

                delete next.pricingCalloutPrice;
                delete next.pricingVehicleHourlyRate;
                delete next.pricingHelperHourlyRate;

                return next;
            }

            if (
                current.recommendedPrice ===
                recommendedPrice.recommendedPrice &&
                current.recommendedPriceMin ===
                recommendedPrice.minPrice &&
                current.recommendedPriceMax ===
                recommendedPrice.maxPrice &&
                current.pricingCalculator ===
                recommendedPrice.calculator
            ) {
                return current;
            }

            return {
                ...current,

                recommendedPrice:
                recommendedPrice.recommendedPrice,

                recommendedPriceMin:
                recommendedPrice.minPrice,

                recommendedPriceMax:
                recommendedPrice.maxPrice,

                pricingCalculator:
                recommendedPrice.calculator,

                pricingModel:
                recommendedPrice.pricingModel,

                pricingBilledHours:
                recommendedPrice.billedHours,

                pricingMinimumHours:
                recommendedPrice.minimumHours,

                pricingFirstHourPrice:
                recommendedPrice.firstHourPrice,

                pricingNextHourPrice:
                recommendedPrice.nextHourPrice,

                pricingCalloutPrice:
                recommendedPrice.calloutPrice,

                pricingVehicleHourlyRate:
                recommendedPrice.vehicleHourlyRate,

                pricingHelperHourlyRate:
                recommendedPrice.helperHourlyRate,
            };
        });

    }, [recommendedPrice]);


    const startLatitude = markerPosition?.[0];
    const startLongitude = markerPosition?.[1];

    const destinationLatitude =
        serviceDetails?.destinationCoordinates?.lat;

    const destinationLongitude =
        serviceDetails?.destinationCoordinates?.lng;


    useEffect(() => {

        const hasStart = isValidOrderCoords(
            [startLatitude, startLongitude]
        );

        const destinationLat = Number(destinationLatitude);
        const destinationLng = Number(destinationLongitude);


        const hasDestination =
            Number.isFinite(destinationLat) &&
            Number.isFinite(destinationLng);

        if (!hasStart || !hasDestination) {
            setServiceDetails((previous) => {
                if (
                    previous?.straightDistanceKm ===
                    undefined &&
                    previous?.estimatedRoadDistanceKm ===
                    undefined &&
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

                // Удаляем старые данные платного маршрута,
                // если они остались в состоянии.
                delete next.distanceMeters;
                delete next.durationMinutes;
                delete next.durationSeconds;
                delete next.routeMode;
                delete next.routeTrafficType;
                delete next.routeHasTolls;
                delete next.routeCalculatedAt;

                delete next.pricingModel;
                delete next.pricingBilledHours;
                delete next.pricingMinimumHours;
                delete next.pricingFirstHourPrice;
                delete next.pricingNextHourPrice;
                delete next.pricingCalloutPrice;
                delete next.pricingVehicleHourlyRate;
                delete next.pricingHelperHourlyRate;

                return next;
            });

            return;
        }

        const straightDistanceKm =
            calculateStraightDistanceKm(
                startLatitude,
                startLongitude,
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

            const next = {
                ...(previous || {}),

                straightDistanceKm,
                estimatedRoadDistanceKm,

                /*
                 * distanceKm оставляем как общее поле,
                 * чтобы будущая формула цены брала его
                 * независимо от способа расчёта.
                 */
                distanceKm:
                estimatedRoadDistanceKm,

                distanceCoefficient,

                distanceType:
                    "estimated_from_coordinates",
            };

            delete next.distanceMeters;
            delete next.durationMinutes;
            delete next.durationSeconds;
            delete next.routeMode;
            delete next.routeTrafficType;
            delete next.routeHasTolls;
            delete next.routeCalculatedAt;

            return next;
        });

    }, [
        startLatitude,
        startLongitude,
        destinationLatitude,
        destinationLongitude,
    ]);


    const validateServiceDetails = () => {
        const fields = Array.isArray(
            selectedService?.formConfig?.fields
        )
            ? selectedService.formConfig.fields
            : [];

        for (const field of fields) {
            const isVisible =
                isDynamicFieldVisible(
                    field,
                    serviceDetails
                );

            /*
             * Скрытые условные поля не валидируем.
             */
            if (!isVisible) {
                continue;
            }

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
                    serviceDetails?.[coordinatesKey];

                const lat = Number(coordinates?.lat);
                const lng = Number(coordinates?.lng);

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
                const numberValue = Number(value);

                if (!Number.isFinite(numberValue)) {
                    return `В поле «${field.label}» должно быть число`;
                }

                if (
                    field.min !== undefined &&
                    numberValue < Number(field.min)
                ) {
                    return `Минимальное значение поля «${field.label}» — ${field.min}`;
                }

                if (
                    field.max !== undefined &&
                    numberValue > Number(field.max)
                ) {
                    return `Максимальное значение поля «${field.label}» — ${field.max}`;
                }
            }
        }

        return null;
    };

    const promotionTotal = useMemo(() => {
        const safePromotion = {
            highlight: !!promotion?.highlight,
            recommended: !!promotion?.recommended,
            push: !!promotion?.push,
        };

        return Object.entries(safePromotion).reduce((sum, [key, enabled]) => {
            return enabled ? sum + (PROMOTION_PRICES[key] || 0) : sum;
        }, 0);
    }, [promotion]);

    useEffect(() => {
        const token = localStorage.getItem("authToken");
        if (!token) {
            alert("Вы не авторизованы! Пожалуйста, войдите в систему.");
            navigate("/login");
        }
    }, [navigate]);

    // default workTime (asap)
    useEffect(() => {
        setIsAsap(true);
        setTimeOpen(false);

        setFormData((prev) => ({
            ...prev,
            workTime: null,
        }));
    }, []);


    useEffect(() => {
        let cancelled = false;

        const checkGuarantee = async () => {
            const token =
                localStorage.getItem("authToken");

            if (!token) return;

            try {
                const response = await axios.get(
                    `${apiUrl}/api/payments/guarantee/capabilities`,
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    }
                );

                if (!cancelled) {
                    setGuaranteeEligibility(
                        response.data
                    );
                }

            } catch (error) {
                if (!cancelled) {
                    setGuaranteeEligibility({
                        verified: false,
                        available: false,
                        operational: false,
                    });
                }
            }
        };

        if (!CASH_ONLY_RELEASE) checkGuarantee();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (
            process.env.NODE_ENV !== "development" ||
            paymentType !== "guarantee" ||
            guaranteePreviewKopecks === null
        ) {
            setGuaranteePreview(null);
            setGuaranteePreviewLoading(false);
            return;
        }

        const token = localStorage.getItem("authToken");

        if (!token) {
            setGuaranteePreview(null);
            setGuaranteePreviewLoading(false);
            return;
        }

        let active = true;

        setGuaranteePreview(null);
        setGuaranteePreviewLoading(true);

        const timer = setTimeout(async () => {
            try {
                const { data } = await axios.get(
                    `${apiUrl}/api/payments/guarantee/quote`,
                    {
                        params: {
                            workPriceKopecks:
                            guaranteePreviewKopecks,
                        },
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    }
                );

                if (active && data.previewOnly === true) {
                    setGuaranteePreview(data);
                }

            } catch {
                if (active) {
                    setGuaranteePreview(null);
                }

            } finally {
                if (active) {
                    setGuaranteePreviewLoading(false);
                }
            }
        }, 350);

        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [guaranteePreviewKopecks, paymentType]);

    // preload location
    useEffect(() => {
        const token = localStorage.getItem("authToken");
        if (!token) return;

        (async () => {
            try {
                const res = await axios.get(`${apiUrl}/api/auth/location/me`, {
                    headers: {Authorization: `Bearer ${token}`},
                });

                const loc = res.data?.location;
                if (!loc) return;

                setProfile(loc);

                const lat = Number(loc.locationLat);
                const lng = Number(loc.locationLng);
                const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

                if (loc.locationAddress && !looksLikeCoordsString(loc.locationAddress)) {
                    setFormData((p) => ({...p, address: loc.locationAddress}));

                    if (hasCoords) {
                        setMarkerPosition([lat, lng]);
                        return;
                    }

                    setAddrResolving(true);
                    setAddrResolveError(null);

                    const resolved = await geocodeAddressYandex({
                        address: loc.locationAddress,
                        apiKey: YM_KEY,
                    });

                    if (resolved) {
                        setFormData((p) => ({...p, address: resolved.address}));
                        setMarkerPosition([resolved.lat, resolved.lng]);
                        setAddrResolving(false);
                        return;
                    }

                    setAddrResolving(false);
                    setAddrResolveError("Адрес из профиля найден, но координаты не определены. Выберите адрес из подсказки, GPS или на карте.");
                    return;
                }

                if (hasCoords) {
                    setMarkerPosition([lat, lng]);
                    setAddrResolving(true);
                    setAddrResolveError(null);

                    const addr = await reverseGeocodeYandex({lat, lng, apiKey: YM_KEY});
                    if (addr) setFormData((p) => ({...p, address: addr}));
                    else setAddrResolveError("Не удалось распознать адрес. Введите вручную или выберите на карте.");

                    setAddrResolving(false);
                    return;
                }

                setAddrResolveError("В профиле нет адреса. Укажите вручную или выберите на карте.");
            } catch (e) {
                console.error("location preload error:", e);
                setAddrResolveError("Не удалось загрузить местоположение из профиля.");
            } finally {
                setAddrResolving(false);
            }
        })();
    }, [YM_KEY]);

    const handleImageChange = async (event) => {
        const files = Array.from(
            event.target.files || []
        );

        event.target.value = "";

        if (
            !files.length ||
            imageUploadRef.current
        ) {
            return;
        }

        imageUploadRef.current = true;
        setImagesLoading(true);

        const compressed = [];

        try {
            for (const file of files) {
                if (
                    !file.type.startsWith("image/")
                ) {
                    setError(
                        "Можно прикладывать только изображения"
                    );

                    continue;
                }

                try {
                    const compressedFile =
                        await imageCompression(
                            file,
                            {
                                maxSizeMB: 0.5,
                                maxWidthOrHeight: 1024,

                                useWebWorker:
                                    process.env.REACT_APP_E2E_TEST !== "1",
                            }
                        );

                    compressed.push(
                        compressedFile
                    );

                } catch (error) {
                    console.error(
                        "Ошибка сжатия изображения:",
                        error
                    );

                    setError(
                        "Не удалось обработать одну из фотографий"
                    );
                }
            }

            setImages((previous) => [
                ...previous,
                ...compressed,
            ]);

        } finally {
            imageUploadRef.current = false;
            setImagesLoading(false);
        }
    };

    const clearSelectedService = () => {
        setSelectedService(null);
        setSelectedCategory("");
        setSelectedSubcategory("");
        setServiceDetails({});
    };

    const clearServiceSearchTimer = () => {
        if (serviceSearchTimerRef.current) {
            clearTimeout(serviceSearchTimerRef.current);
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

        /*
         * Если пользователь изменил текст после выбора подсказки,
         * прежние categoryId/subcategoryId больше не считаются выбранными.
         */
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

        serviceSearchTimerRef.current = setTimeout(async () => {
            const controller = new AbortController();
            serviceSearchAbortRef.current = controller;

            try {
                const response = await axios.get(
                    `${apiUrl}/api/category/search`,
                    {
                        params: {
                            q: query,
                        },
                        signal: controller.signal,
                    }
                );

                const results = Array.isArray(response.data?.results)
                    ? response.data.results
                    : [];

                /*
                 * Дополнительная клиентская защита:
                 * Такси и Курьер не должны отображаться в этой форме,
                 * даже если backend случайно их вернёт.
                 */
                const safeResults = results.filter((item) => {
                    const categoryName = String(item?.categoryName || "")
                        .trim()
                        .toLowerCase();

                    return !["такси", "курьер"].includes(categoryName);
                });

                setServiceSuggestions(safeResults);
                setServiceSearchOpen(true);
            } catch (searchError) {
                if (
                    searchError?.name === "CanceledError" ||
                    searchError?.name === "AbortError" ||
                    searchError?.code === "ERR_CANCELED"
                ) {
                    return;
                }

                console.error("Ошибка поиска услуги:", searchError);
                setServiceSuggestions([]);
                setServiceSearchOpen(true);
            } finally {
                if (serviceSearchAbortRef.current === controller) {
                    serviceSearchAbortRef.current = null;
                    setServiceSearching(false);
                }
            }
        }, 300);
    };

    const handleServiceSelect = (option) => {
        if (!option?.categoryId) return;

        const categoryId = Number(option.categoryId);
        const subcategoryId = option.subcategoryId
            ? Number(option.subcategoryId)
            : null;

        if (!Number.isFinite(categoryId) || categoryId <= 0) {
            return;
        }

        setServiceDetails({});

        setSelectedCategory(String(categoryId));

        setSelectedSubcategory(
            Number.isFinite(subcategoryId) && subcategoryId > 0
                ? String(subcategoryId)
                : ""
        );

        setSelectedService({
            type: option.type,

            categoryId,
            categoryName: option.categoryName,

            subcategoryId:
                Number.isFinite(subcategoryId) &&
                subcategoryId > 0
                    ? subcategoryId
                    : null,

            subcategoryName:
                option.subcategoryName || null,

            subcategoryCode:
                option.subcategoryCode || null,

            formConfig:
                option.formConfig || null,

            pricingConfig:
                option.pricingConfig || null,

            label: option.label,
            matchedPhrase:
                option.matchedPhrase || null,

            price: option.price ?? null,
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
            if (serviceSearchTimerRef.current) {
                clearTimeout(serviceSearchTimerRef.current);
            }

            if (serviceSearchAbortRef.current) {
                serviceSearchAbortRef.current.abort();
            }
        };
    }, []);

    useEffect(() => {
        const handleOutsideClick = (event) => {
            if (
                serviceSearchBoxRef.current &&
                !serviceSearchBoxRef.current.contains(event.target)
            ) {
                setServiceSearchOpen(false);
            }
        };

        document.addEventListener("mousedown", handleOutsideClick);

        return () => {
            document.removeEventListener("mousedown", handleOutsideClick);
        };
    }, []);

    const getMinTime = (selectedDate) => {
        if (!selectedDate || selectedDate.toDateString() === currentDate.toDateString()) {
            return new Date(
                currentDate.getFullYear(),
                currentDate.getMonth(),
                currentDate.getDate(),
                currentDate.getHours(),
                currentDate.getMinutes()
            );
        }
        return new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 0, 0, 0);
    };

    const handleAddressChange = (e) => {
        const address = e.target.value;

        setFormData((p) => ({...p, address}));
        setAddressMode("custom");

        // Пользователь начал менять адрес вручную — старые координаты больше нельзя считать точными
        setMarkerPosition(null);

        // чистим если мало символов
        const q = address.trim();
        if (q.length < 3) {
            setAddressSuggestions([]);
            return;
        }

        // debounce
        if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);

        suggestTimerRef.current = setTimeout(async () => {
            try {
                // abort предыдущий запрос
                if (suggestAbortRef.current) suggestAbortRef.current.abort();
                const ctrl = new AbortController();
                suggestAbortRef.current = ctrl;

                // ⚠️ results=10 + kind=house → чаще дает адреса до дома
                const url =
                    `https://geocode-maps.yandex.ru/1.x/?apikey=${YM_KEY}` +
                    `&geocode=${encodeURIComponent(q)}` +
                    `&format=json&results=10&kind=house`;

                const r = await fetch(url, {signal: ctrl.signal});
                const data = await r.json();

                const suggestions = parseYandexGeocoderSuggestions(data);

                // можно чуть “умнее”: убрать дубли
                const uniq = Array.from(new Map(suggestions.map(s => [s.label, s])).values());

                setAddressSuggestions(uniq);
            } catch (err) {
                if (err?.name === "AbortError") return;
                console.error("Ошибка геокодирования:", err);
                setAddressSuggestions([]);
            }
        }, 250);
    };

    const handleAddressSelect = (s) => {
        // s = {label,address,lat,lon}
        setFormData((p) => ({...p, address: s.address}));
        setAddressSuggestions([]);
        setAddressMode("custom");
        setMarkerPosition([s.lat, s.lon]);
    };

    const detectGps = async () => {
        setAddrResolving(true);
        setAddrResolveError(null);

        try {
            const location = await getCurrentLocation();

            const lat = location.latitude;
            const lng = location.longitude;

            setMarkerPosition([lat, lng]);
            setAddressMode("custom");

            const addr = await reverseGeocodeYandex({
                lat,
                lng,
                apiKey: YM_KEY,
            });

            if (!addr) {
                setAddrResolveError(
                    "Координаты получены, но адрес распознать не удалось. Введите адрес вручную или выберите точку на карте."
                );
                return;
            }

            setFormData((p) => ({
                ...p,
                address: addr,
            }));
        } catch (err) {
            console.error("detectGps error:", err);
            setAddrResolveError(getLocationErrorMessage(err));
        } finally {
            setAddrResolving(false);
        }
    };

    const handleDescriptionChange = (e) => {
        const textarea = e.target;
        textarea.style.height = "auto";
        textarea.style.height = `${textarea.scrollHeight}px`;
        setFormData((p) => ({...p, description: textarea.value}));
    };

    useEffect(() => {
        if (!addressOpen) setAddressSuggestions([]);
    }, [addressOpen]);

    const goToWizardStep = (nextStep) => {
        if (
            submitRef.current ||
            imageUploadRef.current ||
            nextStep < 1 ||
            nextStep > wizardSteps.length
        ) {
            return;
        }

        setError("");
        setWizardStep(nextStep);
    };

    const validateWizardStep = (step) => {
        if (step === 1) {
            if (
                !selectedCategory ||
                !selectedService
            ) {
                return "Выберите подходящую услугу из подсказки";
            }

            return validateServiceDetails() || "";
        }

        if (step === 2) {
            if (!formData.address?.trim()) {
                return "Адрес обязателен";
            }

            if (
                looksLikeCoordsString(
                    formData.address
                )
            ) {
                return (
                    "Нужно указать адрес текстом " +
                    "(не координаты). Выберите адрес " +
                    "на карте или введите вручную."
                );
            }

            if (
                !isValidOrderCoords(markerPosition)
            ) {
                return (
                    "Не удалось определить координаты адреса. " +
                    "Выберите адрес из подсказки, по GPS или на карте."
                );
            }

            if (!isAsap) {
                const time = new Date(
                    formData.workTime
                ).getTime();

                if (
                    !formData.workTime ||
                    !Number.isFinite(time) ||
                    time <= Date.now()
                ) {
                    return (
                        "Выберите будущую дату " +
                        "и время выполнения"
                    );
                }
            }
        }

        if (step === 3) {
            if (paymentType === "guarantee") {
                return (
                    "Гарантийная оплата пока не подключена. " +
                    "Выберите обычную оплату."
                );
            }

            const amount =
                Number(formData.proposedSum);

            if (
                !Number.isFinite(amount) ||
                amount <= 0
            ) {
                return "Укажите корректную сумму за работу";
            }

            if (amount > 300000) {
                return (
                    "Слишком большая стоимость заказа. " +
                    "Максимум 300 000 ₽."
                );
            }
        }

        return "";
    };

    const revealWizardError = (
        step,
        message
    ) => {
        setWizardStep(step);
        setError(message);

        if (
            step === 1 &&
            !selectedService
        ) {
            setServiceSearchOpen(true);
        }

        if (step === 2) {
            setAddressOpen(true);

            if (!isAsap) {
                setTimeOpen(true);
            }
        }
    };

    const nextWizardStep = () => {
        if (
            submitRef.current ||
            imageUploadRef.current ||
            addrResolving
        ) {
            return;
        }

        const validationError =
            validateWizardStep(wizardStep);

        if (validationError) {
            revealWizardError(
                wizardStep,
                validationError
            );

            return;
        }

        goToWizardStep(wizardStep + 1);
    };

    const handleSubmit = async (e) => {
        e?.preventDefault();

        if (
            submitRef.current ||
            isSubmitting ||
            wizardStep !== 4
        ) {
            return;
        }

        setError("");

        for (const step of [1, 2, 3]) {
            const validationError =
                validateWizardStep(step);

            if (validationError) {
                revealWizardError(
                    step,
                    validationError
                );

                return;
            }
        }

        const proposedSumRaw =
            Number(formData.proposedSum);

        submitRef.current = true;
        setIsSubmitting(true);

        const data = new FormData();

        data.append("description", formData.description || "");
        data.append("address", formData.address);
        data.append("isAsap", String(isAsap));
        data.append(
            "workTime",
            !isAsap && formData.workTime
                ? new Date(formData.workTime).toISOString()
                : ""
        );
        data.append("proposedSum", String(Math.round(proposedSumRaw * 100) / 100));
        data.append("paymentType", paymentType);

        const normalizedCategoryId = Number(selectedCategory);
        const normalizedSubcategoryId = Number(selectedSubcategory);

        data.append("categoryId", String(normalizedCategoryId));

        if (
            Number.isFinite(normalizedSubcategoryId) &&
            normalizedSubcategoryId > 0
        ) {
            data.append(
                "subcategoryId",
                String(normalizedSubcategoryId)
            );
        }

        data.append(
            "serviceDetails",
            JSON.stringify(serviceDetails || {})
        );

        const cleanPromotion = {
            highlight: !!promotion.highlight,
            recommended: !!promotion.recommended,
            push: !!promotion.push,
        };

        const cleanPromotionTotal = Object.entries(cleanPromotion).reduce(
            (sum, [key, enabled]) => enabled ? sum + (PROMOTION_PRICES[key] || 0) : sum,
            0
        );

        data.append("promotion", JSON.stringify(cleanPromotion));

        images.forEach((img) => data.append("images", img));

        data.append("coordinates", `${Number(markerPosition[0])},${Number(markerPosition[1])}`);

        const token = localStorage.getItem("authToken");
        if (!token) {
            setError(
                "Вы не авторизованы! Пожалуйста, войдите в систему."
            );

            submitRef.current = false;
            setIsSubmitting(false);

            return;
        }

        let createdOrderId = null;

        const openCreatedOrder = (
            orderId,
            paymentResult = "pending"
        ) => {
            const user = JSON.parse(
                localStorage.getItem("user") || "{}"
            );

            if (!user?.id) {
                navigate("/orders", {
                    replace: true,
                });

                return;
            }

            const params = new URLSearchParams({
                orderId: String(orderId),
                promotionResult: paymentResult,
            });

            navigate(
                `/my-orders/${user.id}?${params.toString()}`,
                {
                    replace: true,
                }
            );
        };

        try {
            const response = await axios.post(`${apiUrl}/api/orders/`, data, {
                headers: {Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data"},
            });

            const orderId = response.data.id;

            createdOrderId = orderId;

            if (cleanPromotionTotal > 0) {
                const endpoint =
                    selectedProvider === "tbank"
                        ? "/api/tbank-payments/order/promotion/create"
                        : "/api/payments/order/promotion/create";

                const payResp = await axios.post(
                    `${apiUrl}${endpoint}`,
                    {orderId},
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    }
                );

                if (!payResp.data?.success) {
                    openCreatedOrder(
                        orderId,
                        "failed"
                    );

                    return;
                }

                if (payResp.data.paidBySavedCard) {
                    if (payResp.data.paid) {
                        alert("Заказ создан, продвижение оплачено с привязанной карты");
                        navigate("/orders");
                        return;
                    }

                    openCreatedOrder(
                        orderId,
                        "processing"
                    );

                    return;
                }

                if (payResp.data.confirmationUrl) {
                    window.location.href = payResp.data.confirmationUrl;
                    return;
                }

                openCreatedOrder(
                    orderId,
                    "pending"
                );

                return;
            } else {
                alert("Заказ успешно создан");
                navigate("/orders");
            }
        } catch (err) {
            console.error("Ошибка при создании заказа:", err);
            if (createdOrderId) {
                openCreatedOrder(
                    createdOrderId,
                    "pending"
                );

                return;
            }
            setError(
                err.response?.data?.message ||
                "Не удалось создать заказ. Попробуйте снова."
            );

            submitRef.current = false;
            setIsSubmitting(false);
        }
    };

    const toggleAsap = () => {
        const nextIsAsap = !isAsap;

        setIsAsap(nextIsAsap);

        if (nextIsAsap) {
            setTimeOpen(false);

            setFormData((prev) => ({
                ...prev,
                workTime: null,
            }));

            return;
        }

        setTimeOpen(true);

        setFormData((prev) => ({
            ...prev,
            workTime: prev.workTime || plusHour(new Date()),
        }));
    };


    const reviewFields = (
        selectedService?.formConfig?.fields || []
    )
        .filter(field =>
            isDynamicFieldVisible(
                field,
                serviceDetails
            )
        )
        .map(field => {
            const value =
                serviceDetails?.[field.key];

            const option =
                field.options?.find(item =>
                    String(item.value) === String(value)
                );

            return {
                label: field.label,
                value:
                    typeof value === "boolean"
                        ? value ? "Да" : "Нет"
                        : option?.label ??
                            (value == null ? "" : String(value)),
            };
        });

    const reviewGroups = [
        {
            step: 1,
            title: "Услуга и описание",
            fields: [
                {
                    label: "Услуга",
                    value:
                        selectedService?.subcategoryName ||
                        selectedService?.categoryName ||
                        "Не выбрана",
                },
                ...reviewFields,
                {
                    label: "Описание",
                    value:
                        formData.description ||
                        "Без описания",
                },
                {
                    label: "Фотографии",
                    value: String(images.length),
                },
            ],
        },
        {
            step: 2,
            title: "Адрес и время",
            fields: [
                {
                    label: "Адрес",
                    value: formData.address,
                },
                {
                    label: "Когда выполнить",
                    value: isAsap
                        ? "Как можно скорее"
                        : formData.workTime
                            ? new Date(
                                formData.workTime
                            ).toLocaleString("ru-RU")
                            : "Время не выбрано",
                },
            ],
        },
        {
            step: 3,
            title: "Стоимость и оплата",
            fields: [
                {
                    label: "Стоимость работы",
                    value:
                        formData.proposedSum
                            ? Number(formData.proposedSum)
                                .toLocaleString("ru-RU") + " ₽"
                            : "Не указана",
                },
                {
                    label: "Оплата исполнителю",
                    value: "Наличными",
                },
                {
                    label: "Продвижение",
                    value: promotionTotal
                        ? [
                            promotion.highlight && "Выделение",
                            promotion.recommended && "Рекомендация",
                            promotion.push && "Push-уведомление",
                        ].filter(Boolean).join(", ")
                        : "Не выбрано",
                },
                {
                    label: "Стоимость продвижения",
                    value: promotionTotal + " ₽",
                },
                ...(promotionTotal > 0
                    ? [{
                        label: "Оплата продвижения",
                        value: selectedProvider === "tbank"
                            ? "Т-Банк"
                            : "ЮKassa",
                    }]
                    : []),
            ],
        },
    ];

    return (
        <OrderWizard
            title="Создать заказ"
            steps={wizardSteps}
            step={wizardStep}
            onStepChange={goToWizardStep}
            onNext={nextWizardStep}
            onPublish={handleSubmit}
            busy={isSubmitting || imagesLoading || addrResolving}
            dirty={Boolean(
                selectedService ||
                serviceQuery.trim() ||
                formData.description.trim() ||
                formData.proposedSum ||
                images.length ||
                promotionTotal ||
                !isAsap ||
                addressMode === "custom"
            )}
            error={error}
            errorClassName="createOrderErrorToast__message"
            contentClassName="create-page"
            auxiliary={showMapModal ? {
                title: "Выбрать адрес на карте",
                onBack: () => setShowMapModal(false),
                content: (
                    <YandexMapModal embedded
                                                isOpen={showMapModal}
                                                onClose={() => setShowMapModal(false)}
                                                initialLat={markerPosition?.[0]}
                                                initialLng={markerPosition?.[1]}
                                                onPick={(picked) => {
                                                    setFormData((p) => ({...p, address: picked.address}));
                                                    setMarkerPosition([picked.lat, picked.lng]);
                                                    setAddressMode("custom");
                                                    setShowMapModal(false);
                                                }}
                                            />
                ),
            } : null}
        >
            <OrderWizardStep number={1}>
                {/* Service search */}
                    <div className="glass section-card">
                        <div className="section-head">
                            <div>
                                <div className="section-title">Что нужно сделать?</div>
                                <div className="section-sub">
                                    Начните вводить название работы — мы предложим подходящую услугу
                                </div>
                            </div>
                        </div>

                        <div
                            className="glass field serviceSearchField"
                            ref={serviceSearchBoxRef}
                        >
                            <label htmlFor="order-service-search" className="cc-sr-only">
                                Услуга
                            </label>

                            <div className="serviceSearchControlWrap">
                                <input
                                    className={`control serviceSearchControl ${
                                        selectedService ? "selected" : ""
                                    }`}
                                    id="order-service-search"
                                    type="text"
                                    value={serviceQuery}
                                    onChange={handleServiceQueryChange}
                                    onFocus={() => {
                                        if (
                                            serviceQuery.trim().length >= 2 &&
                                            !selectedService
                                        ) {
                                            setServiceSearchOpen(true);
                                        }
                                    }}
                                    placeholder="Например: перевезти диван, починить кран"
                                    autoComplete="off"
                                    spellCheck="true"
                                    aria-label="Поиск услуги"
                                />

                                {serviceSearching && (
                                    <span
                                        className="serviceSearchSpinner"
                                        aria-label="Поиск"
                                    />
                                )}

                                {!serviceSearching && serviceQuery && (
                                    <button
                                        type="button"
                                        className="serviceSearchClear"
                                        onClick={handleServiceClear}
                                        aria-label="Очистить выбранную услугу"
                                        title="Очистить"
                                    >
                                        <X size={18} aria-hidden="true" />
                                    </button>
                                )}
                            </div>

                            {selectedService && (
                                <div className="selectedServiceCard">
                                    <div className="selectedServiceTop">
                                        <div className="selectedServiceCheck" aria-hidden="true">
                                            <Check size={16} strokeWidth={2.4} />
                                        </div>

                                        <div className="selectedServiceContent">
                                            <div className="selectedServiceName">
                                                {selectedService.subcategoryName ||
                                                    selectedService.categoryName}
                                            </div>

                                            {selectedService.subcategoryName && (
                                                <div className="selectedServiceCategory">
                                                    Категория: {selectedService.categoryName}
                                                </div>
                                            )}

                                            {!selectedService.subcategoryName && (
                                                <div className="selectedServiceCategory">
                                                    Выбрана общая категория
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <button
                                        type="button"
                                        className="selectedServiceChange"
                                        onClick={() => {
                                            clearSelectedService();
                                            setServiceQuery("");
                                            setServiceSuggestions([]);
                                            setServiceSearchOpen(false);
                                        }}
                                    >
                                        Изменить
                                    </button>
                                </div>
                            )}

                            {!selectedService &&
                                serviceSearchOpen &&
                                serviceQuery.trim().length >= 2 && (
                                    <div className="serviceSuggestionPanel">
                                        <div className="serviceSuggestionTitle">
                                            {serviceSearching
                                                ? "Ищем подходящую услугу…"
                                                : serviceSuggestions.length > 0
                                                    ? "Возможно, вы имели в виду"
                                                    : "Подходящая услуга не найдена"}
                                        </div>

                                        {!serviceSearching &&
                                            serviceSuggestions.length > 0 && (
                                                <div className="serviceSuggestionList">
                                                    {serviceSuggestions.map((option) => {
                                                        const resultKey = option.subcategoryId
                                                            ? `subcategory-${option.subcategoryId}`
                                                            : `category-${option.categoryId}`;

                                                        return (
                                                            <button
                                                                key={resultKey}
                                                                type="button"
                                                                className="serviceSuggestionItem"
                                                                onMouseDown={(event) => {
                                                                    /*
                                                                     * Не даём input потерять фокус раньше,
                                                                     * чем отработает выбор результата.
                                                                     */
                                                                    event.preventDefault();
                                                                }}
                                                                onClick={() =>
                                                                    handleServiceSelect(option)
                                                                }
                                                            >
                                            <span className="serviceSuggestionMain">
                                                <span className="serviceSuggestionName">
                                                    {option.subcategoryName ||
                                                        option.categoryName}
                                                </span>

                                                <span className="serviceSuggestionCategory">
                                                    {option.subcategoryName
                                                        ? option.categoryName
                                                        : "Общая категория"}
                                                </span>
                                            </span>

                                                                <span
                                                                    className={`serviceSuggestionType ${
                                                                        option.subcategoryId
                                                                            ? "subcategory"
                                                                            : "category"
                                                                    }`}
                                                                >
                                                {option.subcategoryId
                                                    ? "Услуга"
                                                    : "Категория"}
                                            </span>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}

                                        {!serviceSearching &&
                                            serviceSuggestions.length === 0 && (
                                                <div className="serviceSuggestionEmpty">
                                                    Попробуйте написать другими словами, например:
                                                    «нужен грузчик» или «починить розетку».
                                                </div>
                                            )}
                                    </div>
                                )}

                            {!selectedService && !serviceSearchOpen && (
                                <div className="hint">
                                    Выберите один из предложенных вариантов. Подкатегории
                                    показываются в первую очередь.
                                </div>
                            )}
                        </div>
                    </div>

                    {selectedService?.formConfig?.fields?.length > 0 && (
                        <div className="glass section-card">
                            <div className="section-head">
                                <div>
                                    <div className="section-title">
                                        Детали заказа
                                    </div>

                                    <div className="section-sub">
                                        Уточните параметры, чтобы исполнители
                                        точнее оценили работу
                                    </div>
                                </div>
                            </div>

                            <DynamicServiceFields
                                config={selectedService.formConfig}
                                value={serviceDetails}
                                onChange={setServiceDetails}
                                yandexApiKey={YM_KEY}
                            />

                            {Number.isFinite(
                                Number(
                                    serviceDetails
                                        ?.estimatedRoadDistanceKm
                                )
                            ) && (
                                <div className="distanceEstimateCard">
                                    <div>
                                        <div className="distanceEstimateLabel">
                                            Ориентировочное расстояние
                                        </div>

                                        <div className="distanceEstimateHint">
                                            Рассчитано приблизительно между
                                            выбранными точками с учётом
                                            коэффициента дорожного маршрута.
                                        </div>
                                    </div>

                                    <div className="distanceEstimateValue">
                                        ≈{" "}
                                        {Number(
                                            serviceDetails
                                                .estimatedRoadDistanceKm
                                        ).toFixed(1)}{" "}
                                        км
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Description */}
                    <div className="glass section-card">

                        <div className="section-head">
                            <div>
                                <div className="section-title">
                                    Описание
                                </div>

                                <div className="section-sub">
                                    Необязательно. Расскажите исполнителю подробнее
                                    о необходимой работе
                                </div>
                            </div>
                        </div>

                        <div className="glass field">
                            <label
                                className="cc-sr-only"
                                htmlFor="order-description"
                            >
                                Описание задачи
                            </label>

                            <textarea
                                id="order-description"
                                className="control textarea"
                                rows={3}
                                placeholder="Описание работы (необязательно)"
                                value={formData.description}
                                onChange={handleDescriptionChange}
                            />
                        </div>


                        <div className="glass field">


                            <label className="upload inline">
                                <input type="file" multiple accept="image/*" aria-label="Фотографии заказа" disabled={imagesLoading} onChange={handleImageChange}
                                       style={{display: "none"}}/>
                                <span className="order-photo-add">
    <Paperclip size={17} strokeWidth={1.9} aria-hidden="true" />
    Добавить фотографии (необязательно)
</span>
                            </label>

                            {images.length > 0 ? (
                                
    <div className="cc-order-photo-grid">
        {images.map((img, index) => (
            <OrderPhotoPreview
                key={index}
                file={img}
                index={index}
                onRemove={() =>
                    setImages(previous =>
                        previous.filter(
                            (_, i) => i !== index
                        )
                    )
                }
            />
        ))}
    </div>
    ) : null}

                        </div>
                    </div>
            </OrderWizardStep>

            <OrderWizardStep number={2}>
                <div className="glass header-card">
                        <div className="header-top">
<div id="date-picker-portal" />
                            <div className="headerTopRow">
                                <div className="header-titles">
                                    
                                    <div className="header-sub">Адрес и время подставятся автоматически</div>
                                </div>

                                {/* компактный чип времени справа */}
                                <div className="timeChip" role="group" aria-label="Время выполнения">
                                    <div className="timeChipText">
                                        <div className="timeChipLabel">Время</div>
                                        <div className="timeChipValue">{isAsap ? "Как можно скорее" : "Ко времени"}</div>
                                    </div>

                                    <button
                                        type="button"
                                        className={`toggle mini ${isAsap ? "on" : ""}`}
                                        onClick={toggleAsap}
                                        aria-label="Срочно / ко времени"
                                        title="Срочно / ко времени"
                                    >
                                        <span className="toggleKnob"/>
                                    </button>
                                </div>
                            </div>
                            {/* ✅ 2 независимые мини-карточки в 2 колонки */}

                            {/* RIGHT: Time mini card */}
                            {!isAsap && (
                                <div className={`miniCard ${timeOpen ? "open" : ""}`}>
                                    {timeOpen && (
                                        <div className="miniDrop">
                                            <div className="glass field">
                                                <label htmlFor="order-work-time" className="cc-sr-only">
                                                    Дата и время выполнения
                                                </label>
                                                <DatePicker
                                                    id="order-work-time"
                                                    selected={formData.workTime}
                                                    onChange={(date) => setFormData((p) => ({...p, workTime: date}))}
                                                    showTimeSelect
                                                    timeFormat="HH:mm"
                                                    timeIntervals={15}
                                                    dateFormat="Pp"
                                                    placeholderText="Выберите дату и время"
                                                    minDate={new Date()}
                                                    minTime={getMinTime(formData.workTime)}
                                                    maxTime={new Date(0, 0, 0, 23, 59, 59)}
                                                    className="control"
                                                    portalId="date-picker-portal"
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="headerMiniGrid">
                                {/* LEFT: Address mini card */}
                                <div className={`miniCard ${addressOpen ? "open" : ""}`}>
                                    <button
                                        type="button"
                                        className="miniCardBtn"
                                        onClick={() => {
                                            setAddressOpen((p) => !p);
                                            
                                        }}
                                    >
                                        <div className="miniTop">
                                            <span className="miniLabel">Адрес</span>
                                            <span className="miniChevron">{addressOpen ? (
                                                <ChevronUp size={17} aria-hidden="true" />
                                            ) : (
                                                <ChevronDown size={17} aria-hidden="true" />
                                            )}
                                            </span>
                                        </div>

                                        <div className={`miniValue ${formData.address ? "" : "danger"}`}>
                                            {formData.address ? "Указан" : "Не указан"}
                                        </div>

                                        {/* мелким — реальный адрес (если есть), иначе подсказка */}
                                        <div className="miniSub">
                                            {addrResolving
                                                ? "Определяем…"
                                                : formData.address
                                                    ? formData.address
                                                    : "Нажмите, чтобы указать"}
                                        </div>
                                    </button>

                                    {/* раскрытие адреса — только под address */}
                                    {addressOpen && (
                                        <div className="miniDrop">
                                            <div className="glass field">
                                                <label htmlFor="order-address" className="cc-sr-only">
                                                    Адрес заказа
                                                </label>
                                                <input
                                                    id="order-address"
                                                    className="control"
                                                    type="text"
                                                    placeholder="Введите адрес"
                                                    value={formData.address}
                                                    onChange={handleAddressChange}
                                                />

                                                {addrResolveError &&
                                                    <div className="inline-error">{addrResolveError}</div>}

                                                {addressSuggestions.length > 0 && (
                                                    <ul className="suggestions">
                                                        {addressSuggestions.map((s, i) => (
                                                            <li key={`${s.label}-${i}`}
                                                                onClick={() => handleAddressSelect(s)}>
                                                                {s.label}
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )}
                                            </div>

                                            <div className="address-row" style={{marginTop: 10, paddingTop: 10}}>
                                                <div className="muted-strong">Адрес из профиля?</div>

                                                <div className="chip-row">
                                                    <button
                                                        type="button"
                                                        className={`chip-btn ${addressMode === "profile" ? "active" : ""}`}
                                                        onClick={async () => {
                                                            setAddressMode("profile");
                                                            setAddrResolveError(null);

                                                            const addr = profile?.locationAddress;
                                                            const lat = Number(profile?.locationLat);
                                                            const lng = Number(profile?.locationLng);
                                                            const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

                                                            if (addr && !looksLikeCoordsString(addr)) {
                                                                setFormData((p) => ({...p, address: addr}));

                                                                if (hasCoords) {
                                                                    setMarkerPosition([lat, lng]);
                                                                    return;
                                                                }

                                                                setAddrResolving(true);

                                                                const resolved = await geocodeAddressYandex({
                                                                    address: addr,
                                                                    apiKey: YM_KEY,
                                                                });

                                                                setAddrResolving(false);

                                                                if (resolved) {
                                                                    setFormData((p) => ({
                                                                        ...p,
                                                                        address: resolved.address
                                                                    }));
                                                                    setMarkerPosition([resolved.lat, resolved.lng]);
                                                                    return;
                                                                }

                                                                setAddrResolveError("Адрес из профиля есть, но координаты не найдены. Выберите адрес из подсказки, GPS или на карте.");
                                                                return;
                                                            }

                                                            if (hasCoords) {
                                                                setMarkerPosition([lat, lng]);
                                                                setAddrResolving(true);
                                                                const resolved = await reverseGeocodeYandex({
                                                                    lat,
                                                                    lng,
                                                                    apiKey: YM_KEY
                                                                });
                                                                setAddrResolving(false);

                                                                if (resolved) setFormData((p) => ({
                                                                    ...p,
                                                                    address: resolved
                                                                }));
                                                                else setAddrResolveError("В профиле нет распознанного адреса. Введите вручную или выберите на карте.");
                                                                return;
                                                            }

                                                            setAddrResolveError("В профиле нет адреса. Введите вручную или выберите на карте.");
                                                        }}
                                                    >
                                                        Да
                                                    </button>

                                                    <button
                                                        type="button"
                                                        className={`chip-btn ${addressMode === "custom" ? "active" : ""}`}
                                                        onClick={() => setAddressMode("custom")}
                                                    >
                                                        Нет
                                                    </button>
                                                </div>

                                                {addressMode === "custom" && (
                                                    <div className="grid2" style={{marginTop: 10}}>
                                                        <button type="button" className="action-btn subtle"
                                                                onClick={() => setShowMapModal(true)}>
                                                            На карте
                                                        </button>
                                                        <button type="button" className="action-btn subtle"
                                                                onClick={detectGps} disabled={addrResolving}>
                                                            GPS
                                                        </button>
                                                    </div>
                                                )}
                                            </div>

                                            
                                        </div>
                                    )}
                                </div>


                            </div>
                        </div>
                    </div>
            </OrderWizardStep>

            <OrderWizardStep number={3}>
                {/* Payment + promotion */}
                    <div className="glass section-card">
                        <div className="section-head">
                            <div>
                                <div className="section-title">Оплата и продвижение</div>
                                <div className="section-sub">Сумма за работу + способ оплаты + опции продвижения</div>
                            </div>
                        </div>

                        <div className="glass field">

                            {recommendedPrice && (
                                <div className="recommendedPriceCard">
                                    <div className="recommendedPriceContent">
                                        <div className="recommendedPriceTitle">
                                            {isHourlyCargo
                                                ? `Ориентировочная стоимость за ${
                                                    recommendedPrice.billedHours || 1
                                                } ч`
                                                : "Рекомендуемый бюджет"}
                                        </div>

                                        <div className="recommendedPriceRange">
                                            {recommendedPrice.minPrice
                                                .toLocaleString("ru-RU")}{" "}
                                            –{" "}
                                            {recommendedPrice.maxPrice
                                                .toLocaleString("ru-RU")}{" "}
                                            ₽
                                        </div>

                                        {isHourlyCargo && (
                                            <div className="cargoHourlySummary">
                                                {Number.isFinite(
                                                    Number(
                                                        recommendedPrice.firstHourPrice
                                                    )
                                                ) && (
                                                    <div className="cargoHourlySummaryRow">
                <span>
                    Первый час
                </span>

                                                        <strong>
                                                            {Number(
                                                                recommendedPrice.firstHourPrice
                                                            ).toLocaleString(
                                                                "ru-RU"
                                                            )}{" "}
                                                            ₽
                                                        </strong>
                                                    </div>
                                                )}

                                                {Number.isFinite(
                                                    Number(
                                                        recommendedPrice.nextHourPrice
                                                    )
                                                ) && (
                                                    <div className="cargoHourlySummaryRow">
                <span>
                    Каждый следующий час
                </span>

                                                        <strong>
                                                            {Number(
                                                                recommendedPrice.nextHourPrice
                                                            ).toLocaleString(
                                                                "ru-RU"
                                                            )}{" "}
                                                            ₽/ч
                                                        </strong>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {Array.isArray(
                                                recommendedPrice.breakdown
                                            ) &&
                                            recommendedPrice.breakdown.length > 0 && (
                                                <div className="recommendedPriceBreakdown">
                                                    {recommendedPrice.breakdown.map(
                                                        (item) => (
                                                            <div
                                                                key={item.key}
                                                                className="recommendedPriceBreakdownRow"
                                                            >
                        <span>
                            {item.label}
                        </span>

                                                                <strong>
                                                                    {Math.round(
                                                                        Number(item.amount)
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

                                        <div className="recommendedPriceHint">
                                            {isHourlyCargo ? (
                                                <>
                                                    В первый час включены вызов машины,
                                                    работа машины, выбранные грузчики и
                                                    доплата за этажи без лифта. В каждый
                                                    следующий час оплачиваются машина и
                                                    грузчики. Итоговое время согласовывается
                                                    с исполнителем.
                                                </>
                                            ) : isIntercityCargo ? (
                                                <>
                                                    Расчёт выполнен по приблизительному
                                                    расстоянию, подаче машины, выбранным
                                                    грузчикам и этажам. Итоговая стоимость
                                                    маршрута согласовывается с исполнителем.
                                                </>
                                            ) : (
                                                <>
                                                    Ориентировочная сумма рассчитана по
                                                    указанным параметрам. Итоговая стоимость
                                                    согласовывается с исполнителем.
                                                </>
                                            )}
                                        </div>
                                    </div>

                                    <button
                                        type="button"
                                        className="recommendedPriceApply"
                                        onClick={() => {
                                            setFormData((previous) => ({
                                                ...previous,
                                                proposedSum:
                                                    String(
                                                        recommendedPrice
                                                            .recommendedPrice
                                                    ),
                                            }));
                                        }}
                                    >
                                        Указать эту сумму
                                    </button>
                                </div>
                            )}


                            <label
                                htmlFor="order-proposed-sum"
                                className="cc-sr-only"
                            >
                                {isHourlyCargo
                                    ? "Ориентировочная сумма"
                                    : isIntercityCargo
                                        ? "Ориентировочная сумма за перевозку"
                                        : "Сумма за работу"}
                            </label>


                            <input
                                className="control"
                                type="number"
                                id="order-proposed-sum"
                                min="1"
                                max="300000"
                                step="1"
                                inputMode="numeric"

                                placeholder={
                                    isHourlyCargo
                                        ? "Ориентировочная сумма, ₽"
                                        : isIntercityCargo
                                            ? "Сумма за перевозку, ₽"
                                            : "Сумма за работу, ₽"
                                }

                                value={formData.proposedSum}
                                onChange={(e) => {
                                    const value = e.target.value;

                                    if (value === "") {
                                        setFormData((p) => ({...p, proposedSum: ""}));
                                        return;
                                    }

                                    const n = Number(value);

                                    if (!Number.isFinite(n)) return;

                                    if (n > 300000) {
                                        setFormData((p) => ({...p, proposedSum: "300000"}));
                                        return;
                                    }

                                    if (n < 0) {
                                        setFormData((p) => ({...p, proposedSum: ""}));
                                        return;
                                    }

                                    setFormData((p) => ({...p, proposedSum: value}));
                                }}
                                required
                            />

                            {isHourlyCargo && (
                                <div className="cargoHourlyNotice">
                                    <div className="cargoHourlyNoticeIcon" aria-hidden="true">
                                        <Timer size={18} strokeWidth={1.9} />
                                    </div>

                                    <div>
                                        <strong>
                                            Перевозка оплачивается по времени
                                        </strong>

                                        <span>
    Указанная сумма рассчитана за{" "}
                                            {recommendedPrice?.billedHours ||
                                                Number(serviceDetails?.estimatedHours) ||
                                                1}{" "}
                                            ч. Если работа займёт больше времени,
    дополнительные часы оплачиваются по
    согласованной ставке. Вызов машины
    повторно не начисляется.
</span>
                                    </div>
                                </div>
                            )}

                            <div className="hint">

                                {isHourlyCargo ? (

                                    <>
                                        Фактическая стоимость зависит от реального
                                        времени выполнения и согласовывается с
                                        исполнителем.
                                    </>

                                ) : isWasteRemoval ? (

                                    <>

                                        Стоимость рассчитана по типу и объёму

                                        мусора, необходимости погрузки и этажу.

                                        Итоговая сумма согласовывается с

                                        исполнителем.

                                    </>

                                ) : (

                                    <>

                                        Эту сумму вы оплачиваете исполнителю.

                                        Сейчас оплачивается только продвижение.

                                    </>

                                )}

                            </div>
                        </div>


                        <div className="glass field">
                            <strong>Способ оплаты заказа</strong>

                            <label
                                style={{
                                    display: "flex",
                                    alignItems: "flex-start",
                                    gap: 10,
                                    marginTop: 12,
                                }}
                            >
                                <input
                                    type="radio"
                                    name="paymentType"
                                    value="cash"
                                    checked={paymentType === "cash"}
                                    onChange={() =>
                                        setPaymentType("cash")
                                    }
                                />

                                <span>
            <strong>Оплата напрямую исполнителю</strong>

            <small style={{ display: "block" }}>
                По договорённости между участниками.
            </small>
        </span>
                            </label>

                            {!CASH_ONLY_RELEASE && (
                                <>
                            <label
                                style={{
                                    display: "flex",
                                    alignItems: "flex-start",
                                    gap: 10,
                                    marginTop: 12,
                                    opacity: guaranteeChoiceEnabled ? 1 : 0.6,
                                }}
                            >
                                <input
                                    type="radio"
                                    name="paymentType"
                                    value="guarantee"
                                    checked={paymentType === "guarantee"}
                                    disabled={!guaranteeChoiceEnabled}
                                    onChange={() =>
                                        setPaymentType("guarantee")
                                    }
                                />

                                <span>
            <strong>Гарантийная сделка</strong>

            <small style={{ display: "block" }}>
                Деньги резервируются у платёжного
                партнёра до выполнения условий сделки.
            </small>
        </span>
                            </label>

                            {paymentType === "guarantee" &&
                                !guaranteeEligibility.verified && (
                                    <small>
                                        Для гарантии потребуется подтверждение
                                        личности заказчика.
                                    </small>
                                )}

                            {paymentType === "guarantee" &&
                                !guaranteeEligibility.operational && (
                                    <small>
                                        Гарантийные расчёты находятся
                                        на этапе подключения.
                                    </small>
                                )}
                                </>
                            )}
                        </div>

                        {!CASH_ONLY_RELEASE &&
                            process.env.NODE_ENV === "development" &&
                            paymentType === "guarantee" &&
                            guaranteePreviewKopecks !== null && (
                                <div
                                    className="glass field"
                                    style={{ marginTop: 12 }}
                                >
                                    <strong>
                                        Предварительный расчёт гарантии
                                    </strong>

                                    <small
                                        style={{
                                            display: "block",
                                            marginTop: 8,
                                        }}
                                    >
                                        Демонстрация. Банковские тарифы
                                        пока не подтверждены.
                                        Оплата гарантией отключена.
                                    </small>

                                    {guaranteePreviewLoading ? (
                                        <div style={{ marginTop: 12 }}>
                                            Рассчитываем…
                                        </div>
                                    ) : selectedGuaranteeQuote ? (
                                        <div
                                            style={{
                                                display: "grid",
                                                gap: 8,
                                                marginTop: 12,
                                            }}
                                        >
                                            <div>
                                                Стоимость работы:{" "}
                                                <b>
                                                    {formatGuaranteeRub(
                                                        selectedGuaranteeQuote
                                                            .workPriceKopecks
                                                    )}
                                                </b>
                                            </div>

                                            <div>
                                                Сбор с заказчика:{" "}
                                                <b>
                                                    {formatGuaranteeRub(
                                                        selectedGuaranteeQuote
                                                            .buyerFeeKopecks
                                                    )}
                                                </b>
                                            </div>

                                            <div>
                                                Итого заказчик оплатит:{" "}
                                                <b>
                                                    {formatGuaranteeRub(
                                                        selectedGuaranteeQuote
                                                            .customerTotalKopecks
                                                    )}
                                                </b>
                                            </div>

                                            <div>
                                                Сбор с исполнителя:{" "}
                                                <b>
                                                    {formatGuaranteeRub(
                                                        selectedGuaranteeQuote
                                                            .executorFeeKopecks
                                                    )}
                                                </b>
                                            </div>

                                            <div>
                                                Исполнителю к выплате:{" "}
                                                <b>
                                                    {formatGuaranteeRub(
                                                        selectedGuaranteeQuote
                                                            .executorPayoutKopecks
                                                    )}
                                                </b>
                                            </div>
                                        </div>
                                    ) : (
                                        <small>
                                            Для указанной суммы
                                            предварительный расчёт
                                            недоступен.
                                        </small>
                                    )}
                                </div>
                            )}

                        <div className="glass promoBox">
                            <PromotionOptions value={promotion} onChange={setPromotion}/>
                        </div>

                        {(promotionTotal > 0 || paymentType === "guarantee") && (
                            <div className="glass field" style={{marginTop: 10}}>
                                <PaymentProviderSelect
                                    selectedProvider={selectedProvider}
                                    onSelect={setSelectedProvider}
                                    disabled={isSubmitting}
                                    title={
                                        paymentType === "guarantee"
                                            ? "Провайдер гарантийной оплаты (предпросмотр)"
                                            : "Способ оплаты продвижения"
                                    }
                                />
                            </div>
                        )}

                        <div className="glass total">
                            <div>
                                <div className="totalTitle">
                                    {paymentType === "guarantee"
                                        ? "К оплате по гарантии"
                                        : "К оплате сейчас"}
                                </div>

                                <div className="totalSub">
                                    {paymentType === "guarantee"
                                        ? "Работа + доля сбора заказчика + продвижение"
                                        : "Только продвижение. За работу — напрямую исполнителю."}
                                </div>
                            </div>

                            <div className="totalAmount">
                                {paymentType === "guarantee"
                                    ? selectedGuaranteeQuote
                                        ? formatGuaranteeRub(
                                            selectedGuaranteeQuote.customerTotalKopecks +
                                            promotionTotal * 100
                                        )
                                        : "—"
                                    : `${promotionTotal} ₽`}
                            </div>
                        </div>

                        <div className="muted">
                            {paymentType === "guarantee"
                                ? "Предварительный расчёт. Гарантийная оплата пока не подключена — списания не выполняются."
                                : promotionTotal > 0
                                    ? "Сейчас оплачивается только выбранное продвижение."
                                    : "При создании заказа ничего оплачивать не нужно."}
                        </div>
                    </div>
            </OrderWizardStep>

            <OrderWizardStep number={4}>
                <OrderReview
                    groups={reviewGroups}
                    payment={promotionTotal + " ₽"}
                    onEdit={goToWizardStep}
                />
            </OrderWizardStep>
        </OrderWizard>
    );
}

export default CreateOrderPage;
