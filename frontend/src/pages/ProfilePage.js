import { toast } from "react-toastify";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import {
    useNavigate,
    useLocation,
} from "react-router-dom";
import { getCurrentLocation, getLocationErrorMessage } from "../utils/getCurrentLocation";
import { useAuth } from "../utils/authContext";
import axios from "axios";
import axiosInstance from "../utils/axiosInstance";
import {FaHeadset, FaLightbulb, FaTrophy, FaPaperPlane,} from "react-icons/fa";
import "../styles/ProfilePage.css";
import "../styles/ProfilePageDark.css";
import UserBenefitsSection from "../components/UserBenefitsSection";
import UserIdentityVerification from "../components/UserIdentityVerification";
import {
    CardBindingAgreement,
} from "../components/AgreementModal";
import YandexMapModal from "../components/YandexMapModal";
import PaymentProviderSelect from "../components/PaymentProviderSelect";
import SupportPhoneLink from "../components/SupportPhoneLink";
import {
    CreditCard,
    Sparkles,
    ShieldCheck,
    CarFront,
    Check,
    ChevronRight,
    X,
    MapPin,
    Camera,
    Navigation,
    Map,
} from "lucide-react";
import AccountDeletionSection from "../components/AccountDeletionSection";
import { App as CapacitorApp } from "@capacitor/app";
import { openPaymentPage } from "../utils/openPaymentPage";

import {
    BottomSheet,
    Button,
    SectionCard,
    SettingsRow,
    LoadingState,
    SheetScreen,
    PaymentCardOption,
    TextField,
    StatusBadge,
} from "../components/ui";

import {
    BriefcaseBusiness,
} from "lucide-react";

import "../styles/ProfileRedesign.css";

const apiUrl = process.env.REACT_APP_API_URL;

// Включать только если нужны демо-скрины привязки карты без реальной ЮKassa
const CARD_BIND_SCREENSHOT_MODE = false;

function buildFileUrl(path) {
    if (!path) {
        return "";
    }

    const value =
        String(path).trim();

    if (
        /^https?:\/\//i.test(value)
    ) {
        return value;
    }

    const normalizedPath =
        value.startsWith("/")
            ? value
            : `/${value}`;

    return `${apiUrl}${normalizedPath}`;
}

function looksLikeCoordsString(v) {
    if (!v) return false;

    const s = String(v).trim();

    return (
        s.startsWith("Координаты:") ||
        /^\d{1,3}\.\d+,\s*\d{1,3}\.\d+$/.test(s)
    );
}

async function geocodeAddressYandex({ address, apiKey }) {
    if (!apiKey) throw new Error("No Yandex API key");

    const q = String(address || "").trim();

    if (q.length < 3) {
        return null;
    }

    const url =
        `https://geocode-maps.yandex.ru/1.x/?apikey=${apiKey}` +
        `&geocode=${encodeURIComponent(q)}` +
        `&format=json&results=1&lang=ru_RU`;

    const r = await fetch(url);

    if (!r.ok) {
        throw new Error(`Yandex geocoder HTTP ${r.status}`);
    }

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

async function reverseGeocodeYandex({ lat, lng, apiKey }) {
    if (!apiKey) throw new Error("No Yandex API key");

    const url =
        `https://geocode-maps.yandex.ru/1.x/?apikey=${apiKey}` +
        `&geocode=${lng},${lat}` +
        `&format=json&results=1&lang=ru_RU`;

    const r = await fetch(url);

    if (!r.ok) {
        throw new Error(`Yandex geocoder HTTP ${r.status}`);
    }

    const data = await r.json();

    const first =
        data?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;

    return (
        first?.metaDataProperty?.GeocoderMetaData?.text ||
        first?.name ||
        null
    );
}

const ProfilePage = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const { logout, isAuthenticated } = useAuth();

    const YM_KEY = process.env.REACT_APP_YANDEX_API_KEY;

    const platform = useMemo(() => {
        const params = new URLSearchParams(window.location.search);
        const forcedPlatform = params.get("platform");

        if (forcedPlatform === "ios") return "ios";
        if (forcedPlatform === "android") return "android";
        if (forcedPlatform === "web") return "web";

        const currentPlatform = Capacitor.getPlatform();

        if (currentPlatform === "ios") return "ios";
        if (currentPlatform === "android") return "android";

        return "web";
    }, []);

    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [activeProfileSheet, setActiveProfileSheet] =
        useState(null);

    const [cardScreen, setCardScreen] =
        useState("main");

    const [cardDirection, setCardDirection] =
        useState(1);

    const [autoCardSaving, setAutoCardSaving] =
        useState(false);

    const navigateCardScreen = (screen) => {
        setCardDirection(1);
        setCardScreen(screen);
    };

    const backCardScreen = () => {
        setCardDirection(-1);

        setCardScreen((current) =>
            current === "agreement"
                ? "bind"
                : "main"
        );

        setCardAgreementChecked(false);
    };

    const openProfileSheet = (sheet) => {
        setCardScreen("main");
        setCardDirection(1);

        setPremiumDuration(null);
        setPremiumPaymentMethod(null);
        setPremiumDirection(1);

        setActiveProfileSheet(sheet);
        setCardAgreementChecked(false);
        setPremiumStep("plans");
        setPremiumMode("redirect");
        setPremiumProvider("yookassa");
        setPremiumAgreementChecked(false);
        if (sheet === "location") {
            setLocationScreen("main");
            setLocationDirection(1);
        }
        if (sheet === "vehicle") {
            setVehicleEditing(false);
            setVehicleDirection(1);
            resetVehicleDraft();
        }
    };

    const closeProfileSheet = () => {
        setActiveProfileSheet(null);
    };

    const [showVerificationModal, setShowVerificationModal] = useState(false);
    const [
        cardAgreementChecked,
        setCardAgreementChecked,
    ] = useState(false);

    const [
        unbindCardId,
        setUnbindCardId,
    ] = useState(null);

    const [
        cardUnbinding,
        setCardUnbinding,
    ] = useState(false);

    const cardUnbindingRef = useRef(false);

    const [showSuggestionModal, setShowSuggestionModal] = useState(false);
    const [suggestionText, setSuggestionText] = useState("");
    const [suggestionSending, setSuggestionSending] = useState(false);

    const [paymentMethodId, setPaymentMethodId] = useState(null);
    const [cardBinding, setCardBinding] =
        useState(false);
    const cardBindingRef = useRef(false);

    const [hasDebt, setHasDebt] = useState(false);
    const [debtAmount, setDebtAmount] = useState(0);

    const [debtPayLoading, setDebtPayLoading] =
        useState(false);

    const debtPayRef = useRef(false);
    const debtSectionRef = useRef(null);

    useEffect(() => {
        const params = new URLSearchParams(
            location.search
        );

        if (
            params.get("section") !== "debt" ||
            !hasDebt
        ) {
            return;
        }

        const frame = requestAnimationFrame(() => {
            debtSectionRef.current?.scrollIntoView({
                behavior: "smooth",
                block: "center",
            });
        });

        return () => {
            cancelAnimationFrame(frame);
        };
    }, [
        location.search,
        location.key,
        hasDebt,
    ]);

    const [locationDraft, setLocationDraft] = useState("");
    const [locLoading, setLocLoading] = useState(false);
    const [locError, setLocError] = useState(null);
    const [gpsCandidate, setGpsCandidate] = useState(null);
    const [locationScreen, setLocationScreen] =
        useState("main");

    const [locationDirection, setLocationDirection] =
        useState(1);

    const openLocationMap = () => {
        setLocationDirection(1);
        setLocationScreen("map");
    };

    const backToLocation = () => {
        setLocationDirection(-1);
        setLocationScreen("main");
    };
    const [pickedCoords, setPickedCoords] = useState(null);

    const [addressSuggestions, setAddressSuggestions] = useState([]);
    const [addressQuery, setAddressQuery] = useState("");

    const addressRequestIdRef = useRef(0);
    const addressAbortRef = useRef(null);

    const [avatarUploading, setAvatarUploading] = useState(false);

    const [categories, setCategories] = useState([]);
    const [categoryPick, setCategoryPick] = useState([]);
    const [catSaving, setCatSaving] = useState(false);

    const [premiumDuration, setPremiumDuration] =
        useState(null);

    const [premiumPaymentMethod, setPremiumPaymentMethod] =
        useState(null);

    const [premiumStep, setPremiumStep] =
        useState("plans");

    const [premiumMode, setPremiumMode] =
        useState("redirect");

    const [
        premiumAgreementChecked,
        setPremiumAgreementChecked,
    ] = useState(false);

    const [
        premiumProvider,
        setPremiumProvider,
    ] = useState("yookassa");

    const [premiumDirection, setPremiumDirection] =
        useState(1);

    const [premiumPayLoading, setPremiumPayLoading] =
        useState(false);

    const premiumPayRef = useRef(false);

    const [selectedDebtProvider, setSelectedDebtProvider] = useState("yookassa");

    const [
        pendingBindProvider,
        setPendingBindProvider,
    ] = useState("yookassa");

    const [vehicleForm, setVehicleForm] = useState({
        vehicleBrand: "",
        vehicleModel: "",
        vehicleColor: "",
        vehiclePlate: "",
        vehicleYear: "",
    });

    const resetVehicleDraft = () => {
        setVehicleForm({
            vehicleBrand:
                profile?.vehicleBrand || "",

            vehicleModel:
                profile?.vehicleModel || "",

            vehicleColor:
                profile?.vehicleColor || "",

            vehiclePlate:
                profile?.vehiclePlate || "",

            vehicleYear:
                profile?.vehicleYear
                    ? String(profile.vehicleYear)
                    : "",
        });
    };

    const openVehicleEditor = () => {
        resetVehicleDraft();

        setVehicleDirection(1);
        setVehicleEditing(true);
    };

    const backToVehicleSummary = () => {
        resetVehicleDraft();

        setVehicleDirection(-1);
        setVehicleEditing(false);
    };

    const [vehicleEditing, setVehicleEditing] =
        useState(false);

    const [vehicleDirection, setVehicleDirection] =
        useState(1);

    const [vehicleSaving, setVehicleSaving] =
        useState(false);

    const [vehiclePhotoUploading, setVehiclePhotoUploading] =
        useState(false);

    // Только для демо-режима
    const [demoCardBound, setDemoCardBound] = useState(false);
    const [demoCardData, setDemoCardData] = useState({
        cardType: "Visa",
        cardLastFour: "1234",
    });

    const getRemainingDays = (expiresAt) => {
        if (!expiresAt) return 0;

        const now = new Date();
        const expiration = new Date(expiresAt);
        const diff = expiration - now;

        return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    };

    const renderRating = (rating) => {
        if (!rating) return "Нет";
        return Number(rating).toFixed(1);
    };

    const subscriptionLabel = useMemo(() => {
        if (!profile) return "";

        if (profile.subscriptionType === "premium") {
            return `Премиум активен • осталось ${getRemainingDays(profile.subscriptionExpiresAt)} дн.`;
        }

        if (profile.subscriptionType === "trial") {
            return `Пробная подписка • осталось ${getRemainingDays(profile.subscriptionExpiresAt)} дн.`;
        }

        return "Обычный аккаунт";
    }, [profile]);

    const sortedCategories = useMemo(() => {
        return [...categories].sort((a, b) => {
            const ap = a.id === 12 || a.id === 13 ? 0 : 1;
            const bp = b.id === 12 || b.id === 13 ? 0 : 1;

            if (ap !== bp) return ap - bp;

            return String(a.name).localeCompare(String(b.name), "ru");
        });
    }, [categories]);

    const isCardBound = CARD_BIND_SCREENSHOT_MODE
        ? demoCardBound
        : !!paymentMethodId;

    const cardTypeView = CARD_BIND_SCREENSHOT_MODE
        ? demoCardData.cardType
        : profile?.cardType;

    const cardLastFourView = CARD_BIND_SCREENSHOT_MODE
        ? demoCardData.cardLastFour
        : profile?.cardLastFour;

    const savedPaymentCards = [
        ...(isCardBound
            ? [
                {
                    id: "yookassa",
                    title: [
                        cardTypeView || "Банковская карта",
                        cardLastFourView
                            ? `•••• ${cardLastFourView}`
                            : "",
                    ]
                        .filter(Boolean)
                        .join(" "),
                },
            ]
            : []),

        ...(profile?.tbankCardBound
            ? [
                {
                    id: "tbank",
                    title:
                        profile.tbankCardMask ||
                        "Сохранённая карта",
                },
            ]
            : []),
    ];

    const premiumAvailableCards =
        savedPaymentCards.filter(
            (card) => card.id === "yookassa"
        );
    const cardToUnbind =
        savedPaymentCards.find(
            (card) => card.id === unbindCardId
        );

    const autoCommissionCard =
        savedPaymentCards.find(
            (card) =>
                card.id === profile?.autoCommissionProvider
        );

    const fetchProfileData = async () => {
        const token = localStorage.getItem("authToken");

        if (!token) {
            navigate("/login");
            return null;
        }

        const response =
            await axios.get(
                `${apiUrl}/api/auth/profile`,
                {
                    headers: {
                        Authorization:
                            `Bearer ${token}`,
                    },
                }
            );

        const raw =
            response.data || {};

        const normalizedProfile = {
            ...raw,

            vehicleBrand:
                raw.vehicleBrand ??
                raw.vehicle_brand ??
                null,

            vehicleModel:
                raw.vehicleModel ??
                raw.vehicle_model ??
                null,

            vehicleColor:
                raw.vehicleColor ??
                raw.vehicle_color ??
                null,

            vehiclePlate:
                raw.vehiclePlate ??
                raw.vehicle_plate ??
                null,

            vehicleYear:
                raw.vehicleYear ??
                raw.vehicle_year ??
                null,

            vehiclePhoto:
                raw.vehiclePhoto ??
                raw.vehicle_photo ??
                null,

            vehicleVerificationStatus:
                raw.vehicleVerificationStatus ??
                raw.vehicle_verification_status ??
                "none",

            vehicleVerificationNote:
                raw.vehicleVerificationNote ??
                raw.vehicle_verification_note ??
                null,
        };

        setProfile(
            normalizedProfile
        );

        setPaymentMethodId(
            normalizedProfile
                .yookassaPaymentMethodId ||
            null
        );

        return normalizedProfile;
    };

    const loadDebtStatus = async () => {
        try {
            const response =
                await axiosInstance.get(
                    "/orders/me/status"
                );

            const rawDebt =
                response.data?.debt;

            const debt = Number(rawDebt);

            if (
                rawDebt == null ||
                rawDebt === "" ||
                !Number.isSafeInteger(debt) ||
                debt < 0
            ) {
                throw new Error(
                    "Сервер вернул некорректную задолженность"
                );
            }

            setDebtAmount(debt);
            setHasDebt(debt > 0);

            window.dispatchEvent(
                new Event(
                    "cargocamp:debt-updated"
                )
            );

            return debt;
        } catch (error) {
            console.error(
                "Ошибка проверки задолженности:",
                error.message
            );

            return null;
        }
    };

    const fetchAddressSuggestions = async (query) => {
        const cleanQuery = String(query || "").trim();

        if (cleanQuery.length < 3 || !YM_KEY) {
            addressAbortRef.current?.abort();
            setAddressSuggestions([]);
            return;
        }

        const requestId = ++addressRequestIdRef.current;

        addressAbortRef.current?.abort();

        const controller = new AbortController();
        addressAbortRef.current = controller;

        try {
            const url =
                `https://geocode-maps.yandex.ru/1.x/?apikey=${YM_KEY}` +
                `&geocode=${encodeURIComponent(cleanQuery)}` +
                `&format=json&results=6&lang=ru_RU`;

            const response = await fetch(url, {
                signal: controller.signal,
            });

            if (!response.ok) {
                throw new Error(
                    `Yandex suggestions HTTP ${response.status}`
                );
            }

            const data = await response.json();

            /*
             * Пока запрос выполнялся, пользователь мог уже изменить текст.
             * Старому запросу не разрешаем менять список.
             */
            if (requestId !== addressRequestIdRef.current) {
                return;
            }

            const items =
                data?.response?.GeoObjectCollection?.featureMember
                    ?.map((feature) => {
                        const geoObject = feature?.GeoObject;
                        const position = String(
                            geoObject?.Point?.pos || ""
                        )
                            .split(" ")
                            .map(Number);

                        const lng = position[0];
                        const lat = position[1];

                        const label =
                            geoObject?.metaDataProperty
                                ?.GeocoderMetaData?.text ||
                            geoObject?.name ||
                            "";

                        if (
                            !label ||
                            !Number.isFinite(lat) ||
                            !Number.isFinite(lng)
                        ) {
                            return null;
                        }

                        return {
                            label,
                            lat,
                            lng,
                        };
                    })
                    .filter(Boolean) || [];

            setAddressSuggestions(items);
        } catch (error) {
            if (error?.name === "AbortError") {
                return;
            }

            console.error("address suggest error:", error);

            if (requestId === addressRequestIdRef.current) {
                setAddressSuggestions([]);
            }
        }
    };

    const saveVehicle = async () => {
        const token =
            localStorage.getItem("authToken");

        if (!token) {
            toast.error("Вы не авторизованы");
            return;
        }

        const brand =
            vehicleForm.vehicleBrand.trim();

        const model =
            vehicleForm.vehicleModel.trim();

        const color =
            vehicleForm.vehicleColor.trim();

        const plate =
            vehicleForm.vehiclePlate.trim();

        if (!brand) {
            toast.error("Укажите марку автомобиля");
            return;
        }

        if (!model) {
            toast.error("Укажите модель автомобиля");
            return;
        }

        if (!color) {
            toast.error("Укажите цвет автомобиля");
            return;
        }

        if (!plate) {
            toast.error("Укажите госномер автомобиля");
            return;
        }

        try {
            setVehicleSaving(true);

            const res = await axios.post(
                `${apiUrl}/api/auth/vehicle/me`,
                {
                    vehicleBrand: brand,
                    vehicleModel: model,
                    vehicleColor: color,
                    vehiclePlate: plate,
                    vehicleYear:
                        vehicleForm.vehicleYear || null,
                },
                {
                    headers: {
                        Authorization:
                            `Bearer ${token}`,
                    },
                }
            );

            toast.success(
                res.data?.message ||
                "Автомобиль отправлен на проверку"
            );

            setProfile((prev) => ({
                ...prev,
                ...res.data.vehicle,
            }));
        } catch (error) {
            console.error(
                "Ошибка сохранения автомобиля:",
                error
            );

            toast.error(
                error.response?.data?.message ||
                "Не удалось сохранить автомобиль"
            );
        } finally {
            setVehicleSaving(false);
        }
    };

    const uploadVehiclePhoto = async (file) => {
        if (!file) return;

        const token =
            localStorage.getItem("authToken");

        if (!token) {
            toast.error("Вы не авторизованы");
            return;
        }

        const formData = new FormData();

        formData.append(
            "vehiclePhoto",
            file
        );

        try {
            setVehiclePhotoUploading(true);

            const res = await axios.post(
                `${apiUrl}/api/auth/vehicle/photo`,
                formData,
                {
                    headers: {
                        Authorization:
                            `Bearer ${token}`,
                        "Content-Type":
                            "multipart/form-data",
                    },
                }
            );

            toast.success(
                "Фото автомобиля загружено"
            );

            const uploadedPhoto =
                res.data?.vehiclePhoto ||
                res.data?.vehicle?.vehiclePhoto ||
                null;

            if (!uploadedPhoto) {
                throw new Error(
                    "Сервер не вернул путь к фотографии"
                );
            }

            setProfile((prev) => ({
                ...prev,

                vehiclePhoto:
                uploadedPhoto,
            }));
        } catch (error) {
            console.error(
                "Ошибка загрузки фото автомобиля:",
                error
            );

            toast.error(
                error.response?.data?.message ||
                "Не удалось загрузить фото автомобиля"
            );
        } finally {
            setVehiclePhotoUploading(false);
        }
    };

    useEffect(() => {
        if (!profile?.id) return;

        setVehicleForm({
            vehicleBrand:
                profile.vehicleBrand || "",
            vehicleModel:
                profile.vehicleModel || "",
            vehicleColor:
                profile.vehicleColor || "",
            vehiclePlate:
                profile.vehiclePlate || "",
            vehicleYear:
                profile.vehicleYear
                    ? String(profile.vehicleYear)
                    : "",
        });
    }, [
        profile?.id,
        profile?.vehicleBrand,
        profile?.vehicleModel,
        profile?.vehicleColor,
        profile?.vehiclePlate,
        profile?.vehicleYear,
    ]);

    useEffect(() => {
        return () => {
            addressAbortRef.current?.abort();
        };
    }, []);

    useEffect(() => {
        axios
            .get(`${apiUrl}/api/category`)
            .then((res) => setCategories(res.data || []))
            .catch(() => setCategories([]));
    }, []);

    useEffect(() => {
        let isMounted = true;

        const initProfile = async () => {
            const token = localStorage.getItem("authToken");

            if (!token) {
                navigate("/login");
                return;
            }

            try {
                const data = await fetchProfileData();

                if (isMounted && data) {
                    setLoading(false);
                }
            } catch (err) {
                console.error("Ошибка:", err.response?.status, err.message);

                if (isMounted) {
                    setError("Не удалось загрузить данные профиля.");
                    setLoading(false);
                    navigate("/login");
                }
            }
        };

        initProfile();

        return () => {
            isMounted = false;
        };

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated, navigate]);

    const savedCategoryIds =
        profile?.preferredCategoryIds;

    useEffect(() => {
        if (activeProfileSheet === "professions") {
            return;
        }

        setCategoryPick(
            Array.isArray(savedCategoryIds)
                ? [...savedCategoryIds]
                : []
        );
    }, [
        savedCategoryIds,
        activeProfileSheet,
    ]);

    useEffect(() => {
        if (!profile) return;

        const resolveLocation = async () => {
            const addr = profile.locationAddress;

            const lat = Number(profile.locationLat);
            const lng = Number(profile.locationLng);
            const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

            if (addr && !looksLikeCoordsString(addr)) {
                setLocationDraft(addr);
                return;
            }

            if (hasCoords) {
                setLocLoading(true);
                setLocError(null);

                try {
                    const resolved = await reverseGeocodeYandex({
                        lat,
                        lng,
                        apiKey: YM_KEY,
                    });

                    if (resolved) {
                        setLocationDraft(resolved);
                    } else {
                        setLocError(
                            "Не удалось распознать адрес. Введите вручную или выберите на карте."
                        );
                    }
                } catch (e) {
                    console.error(e);
                    setLocError(
                        "Не удалось распознать адрес. Введите вручную или выберите на карте."
                    );
                } finally {
                    setLocLoading(false);
                }

                return;
            }

            setLocationDraft(addr || "");
        };

        resolveLocation();
    }, [profile, YM_KEY]);

    useEffect(() => {
        if (profile) {
            loadDebtStatus();
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [profile?.id]);

    useEffect(() => {
        let disposed = false;
        let nativeListener = null;
        let running = false;
        let retryTimer = null;

        const params = new URLSearchParams(
            window.location.search
        );

        const hasPaymentReturn =
            params.has("bindReturn") ||
            params.has("debtReturn") ||
            params.has("premiumReturn");

        const refreshFinance = async () => {
            if (disposed || running) return false;

            running = true;

            try {
                const freshProfile =
                    await fetchProfileData();

                if (!freshProfile || disposed) {
                    return false;
                }

                await loadDebtStatus();

                return !disposed;
            } catch (error) {
                console.warn(
                    "Не удалось обновить финансовые данные:",
                    error.message
                );

                return false;
            } finally {
                running = false;
            }
        };

        let remainingAttempts = 0;

        const retryRefresh = async () => {
            if (
                disposed ||
                remainingAttempts <= 0
            ) {
                return;
            }

            remainingAttempts -= 1;

            const refreshed =
                await refreshFinance();

            if (disposed) return;

            if (refreshed && hasPaymentReturn) {
                const cleanParams =
                    new URLSearchParams(
                        window.location.search
                    );

                [
                    "bindReturn",
                    "bindToken",
                    "debtReturn",
                    "premiumReturn",
                ].forEach(
                    (key) => cleanParams.delete(key)
                );

                const query =
                    cleanParams.toString();

                window.history.replaceState(
                    window.history.state,
                    "",
                    `${window.location.pathname}${
                        query ? `?${query}` : ""
                    }${window.location.hash}`
                );
            }

            if (remainingAttempts > 0) {
                retryTimer = setTimeout(
                    retryRefresh,
                    2000
                );
            }
        };

        const startRefresh = () => {
            if (disposed) return;

            clearTimeout(retryTimer);

            remainingAttempts = 6;

            void retryRefresh();
        };

        const handleVisibility = () => {
            if (!document.hidden) {
                startRefresh();
            }
        };

        window.addEventListener(
            "focus",
            startRefresh
        );

        document.addEventListener(
            "visibilitychange",
            handleVisibility
        );

        if (Capacitor.isNativePlatform()) {
            CapacitorApp.addListener(
                "appStateChange",
                ({ isActive }) => {
                    if (isActive) {
                        startRefresh();
                    }
                }
            ).then((handle) => {
                if (disposed) {
                    void handle.remove();
                } else {
                    nativeListener = handle;
                }
            }).catch((error) => {
                console.warn(
                    "Finance lifecycle listener:",
                    error.message
                );
            });
        }

        if (hasPaymentReturn) {
            startRefresh();
        }

        return () => {
            disposed = true;

            clearTimeout(retryTimer);

            window.removeEventListener(
                "focus",
                startRefresh
            );

            document.removeEventListener(
                "visibilitychange",
                handleVisibility
            );

            nativeListener?.remove();
        };

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (!addressQuery || addressQuery.length < 3) {
            setAddressSuggestions([]);
            return;
        }

        const timer = setTimeout(() => {
            fetchAddressSuggestions(addressQuery);
        }, 500);

        return () => clearTimeout(timer);

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addressQuery]);

    const handleAvatarUpload = async (file) => {
        if (!file) return;

        const token = localStorage.getItem("authToken");

        if (!token) {
            toast.error("Вы не авторизованы");
            return;
        }

        const formData = new FormData();
        formData.append("avatar", file);

        try {
            setAvatarUploading(true);

            const res = await axios.post(
                `${apiUrl}/api/auth/upload-avatar`,
                formData,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        "Content-Type": "multipart/form-data",
                    },
                }
            );

            toast.success("Фото профиля обновлено");

            setProfile((prev) => ({
                ...prev,
                avatar: res.data.avatar,
            }));
        } catch (error) {
            console.error("Ошибка загрузки аватара:", error);
            toast.error(
                error.response?.data?.message ||
                "Не удалось загрузить фото профиля"
            );
        } finally {
            setAvatarUploading(false);
        }
    };

    const savePreferredCategories = async () => {
        const token = localStorage.getItem("authToken");

        if (!token) {
            toast.error("Вы не авторизованы");
            return;
        }

        setCatSaving(true);

        try {
            const res = await axios.post(
                `${apiUrl}/api/auth/categories/me`,
                { categoryIds: categoryPick },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            toast.success("Профессии сохранены");

            setProfile((prev) => ({
                ...prev,
                preferredCategoryIds: res.data.preferredCategoryIds,
            }));
            closeProfileSheet();
        } catch (e) {
            toast.error(e.response?.data?.message || "Не удалось сохранить");
        } finally {
            setCatSaving(false);
        }
    };

    const saveLocation = async ({ address, lat, lng, source }) => {
        const token = localStorage.getItem("authToken");

        if (!token) {
            toast.error("Вы не авторизованы");
            return;
        }

        const cleanAddress = String(address || "").trim();

        if (!cleanAddress) {
            setLocError("Введите адрес");
            toast.error("Введите адрес");
            return;
        }

        setLocLoading(true);
        setLocError(null);

        try {
            let finalAddress = cleanAddress;
            let finalLat = Number(lat);
            let finalLng = Number(lng);
            let finalSource = source || "manual";

            const hasCoords =
                Number.isFinite(finalLat) &&
                Number.isFinite(finalLng) &&
                !(Math.abs(finalLat) < 0.000001 && Math.abs(finalLng) < 0.000001);

            if (!hasCoords) {
                const resolved = await geocodeAddressYandex({
                    address: cleanAddress,
                    apiKey: YM_KEY,
                });

                if (!resolved) {
                    setLocError("Не удалось определить координаты адреса. Выберите адрес из подсказки, GPS или на карте.");
                    toast.error("Не удалось определить координаты адреса");
                    return;
                }

                finalAddress = resolved.address;
                finalLat = resolved.lat;
                finalLng = resolved.lng;
                finalSource = "manual";
            }

            const res = await axios.post(
                `${apiUrl}/api/auth/location/me`,
                {
                    address: finalAddress,
                    lat: finalLat,
                    lng: finalLng,
                    source: finalSource,
                },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            toast.success("Местоположение сохранено");

            setAddressSuggestions([]);
            setAddressQuery("");
            setPickedCoords({
                lat: finalLat,
                lng: finalLng,
            });
            setLocationDraft(finalAddress);

            setProfile((prev) => ({
                ...prev,
                ...res.data.location,
            }));
        } catch (e) {
            console.error(e);
            setLocError(e.response?.data?.message || "Ошибка сохранения");
        } finally {
            setLocLoading(false);
        }
    };

    const detectGps = async () => {
        setLocLoading(true);
        setLocError(null);

        try {
            const pos = await getCurrentLocation({
                timeout: 25000,
                maximumAge: 0,
                enableHighAccuracy: true,
            });

            const lat = pos.latitude;
            const lng = pos.longitude;

            try {
                const addr = await reverseGeocodeYandex({
                    lat,
                    lng,
                    apiKey: YM_KEY,
                });

                if (!addr) {
                    setPickedCoords({
                        lat,
                        lng,
                    });

                    setGpsCandidate(null);
                    setAddressSuggestions([]);
                    setAddressQuery("");
                    openLocationMap();

                    toast.info(
                        "Координаты получены. Уточните точку на карте, чтобы определить адрес."
                    );

                    return;
                }

                setLocationDraft(addr);
                setAddressSuggestions([]);
                setAddressQuery("");
                setGpsCandidate({ lat, lng, address: addr });
                toast.success("Местоположение определено");
            } catch (e) {
                console.error("reverse geocode error:", e);

                setPickedCoords({
                    lat,
                    lng,
                });

                setGpsCandidate(null);
                setAddressSuggestions([]);
                setAddressQuery("");
                openLocationMap();

                toast.info(
                    "Координаты получены. Уточните точку на карте, чтобы определить адрес."
                );
            }
        } catch (e) {
            console.error("Profile GPS error:", e);

            const message = getLocationErrorMessage(e);

            setLocError(message);
            toast.error(message);
        } finally {
            setLocLoading(false);
        }
    };

    const handlePayDebt = async () => {
        if (debtPayRef.current) return;

        debtPayRef.current = true;
        setDebtPayLoading(true);

        try {
            const currentDebt =
                await loadDebtStatus();

            if (currentDebt === null) {
                toast.error(
                    "Не удалось проверить задолженность"
                );

                return;
            }

            if (currentDebt === 0) {
                toast.info("Задолженности нет");
                return;
            }

            const endpoint =
                selectedDebtProvider === "tbank"
                    ? "/tbank-payments/debt/create"
                    : "/payments/debt/create";

            const res =
                await axiosInstance.post(
                    endpoint,
                    {
                        returnPath:
                            "/profile?debtReturn=1",
                    }
                );

            if (!res.data?.success) {
                toast.error(
                    res.data?.error ||
                    "Не удалось создать платёж"
                );

                return;
            }

            if (res.data.noDebt) {
                await loadDebtStatus();

                toast.info(
                    "Задолженности нет"
                );

                return;
            }

            if (res.data.paidBySavedCard) {
                toast.info(
                    "Проверяем подтверждение оплаты..."
                );

                for (
                    let attempt = 0;
                    attempt < 6;
                    attempt++
                ) {
                    if (attempt > 0) {
                        await new Promise(
                            (resolve) =>
                                setTimeout(
                                    resolve,
                                    2000
                                )
                        );
                    }

                    const remainingDebt =
                        await loadDebtStatus();

                    if (remainingDebt === 0) {
                        await fetchProfileData();

                        toast.success(
                            "Задолженность погашена"
                        );

                        return;
                    }
                }

                toast.info(
                    "Подтверждение платежа ещё не получено. Проверьте состояние платежа перед повторной оплатой."
                );

                return;
            }

            if (!res.data.confirmationUrl) {
                toast.error(
                    "Ссылка на оплату не получена"
                );

                return;
            }

            openPaymentPage(
                res.data.confirmationUrl
            );
        } catch (error) {
            console.error(
                "Debt payment error:",
                error.message
            );

            toast.error(
                error.response?.data?.error ||
                "Не удалось оплатить задолженность"
            );
        } finally {
            debtPayRef.current = false;
            setDebtPayLoading(false);
        }
    };

    const goToPremiumStep = (step) => {
        setPremiumDirection(1);
        setPremiumStep(step);
    };

    const goBackPremium = () => {
        setPremiumDirection(-1);

        setPremiumStep((current) => {
            switch (current) {
                case "agreement":
                    return "provider";

                case "provider":
                    return "payment";

                case "payment":
                    return "plans";

                default:
                    return "plans";
            }
        });
    };

    const choosePremiumMode = (mode) => {
        setPremiumMode(mode);
        setPremiumAgreementChecked(false);
        setPremiumProvider("yookassa");

        goToPremiumStep("provider");
    };

    const handleBuyPremium = async ({
                                        duration,
                                        provider,
                                        paymentMode,
                                    }) => {
        if (premiumPayRef.current) return;

        if (!["7d", "30d"].includes(duration)) {
            return;
        }

        if (
            !["yookassa", "tbank"].includes(provider) ||
            ![
                "saved_card",
                "redirect",
                "redirect_bind",
            ].includes(paymentMode)
        ) {
            toast.error("Неверный способ оплаты");
            return;
        }

        if (
            provider === "tbank" &&
            paymentMode !== "redirect"
        ) {
            toast.error(
                "Этот способ оплаты пока недоступен"
            );

            return;
        }

        if (
            paymentMode === "redirect_bind" &&
            !premiumAgreementChecked
        ) {
            toast.error(
                "Подтвердите согласие с условиями"
            );

            return;
        }

        premiumPayRef.current = true;
        setPremiumPayLoading(true);

        try {
            const token =
                localStorage.getItem("authToken");

            if (!token) {
                toast.error("Вы не авторизованы");
                return;
            }

            const endpoint =
                provider === "tbank"
                    ? "/api/tbank-payments/premium/create"
                    : "/api/payments/premium/create";

            const response = await axios.post(
                `${apiUrl}${endpoint}`,
                {
                    duration,
                    paymentMode,
                },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            const payment = response.data;

            if (!payment?.success) {
                toast.error(
                    payment?.error ||
                    "Не удалось создать платёж"
                );

                return;
            }

            if (payment.paidBySavedCard) {
                if (payment.paid) {
                    toast.success(
                        "Premium успешно оплачен"
                    );

                    closeProfileSheet();

                    await fetchProfileData();
                    return;
                }

                toast.info(
                    "Платёж обрабатывается. " +
                    "Не повторяйте оплату до подтверждения."
                );

                closeProfileSheet();

                await fetchProfileData();
                return;
            }

            if (!payment.confirmationUrl) {
                toast.error(
                    "Не получена ссылка на оплату"
                );

                return;
            }

            await openPaymentPage(
                payment.confirmationUrl
            );

            closeProfileSheet();

        } catch (error) {
            console.error(
                "Premium payment error:",
                error
            );

            toast.error(
                error.response?.data?.error ||
                "Не удалось завершить запрос оплаты. " +
                "Проверьте статус платежа перед повторной попыткой."
            );
        } finally {
            premiumPayRef.current = false;
            setPremiumPayLoading(false);
        }
    };

    const handleBindTBankCard = async () => {
        if (cardBindingRef.current) return;

        cardBindingRef.current = true;
        setCardBinding(true);

        try {
            const response =
                await axiosInstance.post(
                    "/payment-cards/tbank/bind/create",
                    {}
                );

            if (
                !response.data?.success ||
                !response.data.confirmationUrl
            ) {
                toast.error(
                    response.data?.error ||
                    "Не удалось получить ссылку для привязки"
                );

                return;
            }

            openPaymentPage(
                response.data.confirmationUrl
            );
        } catch (error) {
            toast.error(
                error.response?.data?.error ||
                "Ошибка привязки карты Т-Банка"
            );
        } finally {
            cardBindingRef.current = false;
            setCardBinding(false);
        }
    };

    const handleAutoProviderChange = async (provider) => {
        if (autoCardSaving) return;

        if (
            provider !== "none" &&
            !savedPaymentCards.some(
                (card) => card.id === provider
            )
        ) {
            toast.error("Сохранённая карта недоступна");
            return;
        }

        try {
            setAutoCardSaving(true);

            const token =
                localStorage.getItem("authToken");

            if (!token) {
                toast.error("Вы не авторизованы");
                return;
            }

            await axios.post(
                `${apiUrl}/api/payment-cards/auto-provider`,
                { provider },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            await fetchProfileData();

            toast.success(
                "Настройка автоматической комиссии сохранена"
            );

            backCardScreen();
        } catch (error) {
            toast.error(
                error.response?.data?.error ||
                "Не удалось сохранить настройку"
            );
        } finally {
            setAutoCardSaving(false);
        }
    };

    const handleBindCard = async () => {
        if (CARD_BIND_SCREENSHOT_MODE) {
            setDemoCardBound(true);

            setDemoCardData({
                cardType: "Visa",
                cardLastFour: "1234",
            });

            toast.success("Демо-карта привязана");
            return;
        }

        if (cardBindingRef.current) return;

        cardBindingRef.current = true;
        setCardBinding(true);

        try {
            const res = await axiosInstance.post(
                "/payments/card/bind/create",
                {}
            );

            if (!res.data?.success) {
                toast.error(
                    res.data?.error ||
                    "Ошибка привязки карты"
                );

                return;
            }

            if (!res.data.confirmationUrl) {
                toast.error(
                    "Ссылка на привязку карты не получена"
                );

                return;
            }

            openPaymentPage(
                res.data.confirmationUrl
            );
        } catch (error) {
            console.error(
                "YooKassa card binding:",
                error.message
            );

            toast.error(
                error.response?.data?.error ||
                "Не удалось начать привязку карты"
            );
        } finally {
            cardBindingRef.current = false;
            setCardBinding(false);
        }
    };

    const handleUnbindSavedCard = async () => {
        if (
            cardUnbindingRef.current ||
            !cardToUnbind
        ) {
            return;
        }

        cardUnbindingRef.current = true;
        setCardUnbinding(true);

        try {
            if (
                CARD_BIND_SCREENSHOT_MODE &&
                unbindCardId === "yookassa"
            ) {
                setDemoCardBound(false);

                toast.success("Карта удалена");

                setUnbindCardId(null);
                backCardScreen();

                return;
            }

            const token =
                localStorage.getItem("authToken");

            if (!token) {
                toast.error("Вы не авторизованы");
                return;
            }

            const endpoint =
                unbindCardId === "tbank"
                    ? "/api/payment-cards/tbank/unbind"
                    : "/api/payments/card/unbind";

            const response = await axios.post(
                `${apiUrl}${endpoint}`,
                {},
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            if (response.data?.success === false) {
                throw new Error(
                    response.data?.error ||
                    "Не удалось отвязать карту"
                );
            }

            await fetchProfileData();

            toast.success(
                "Банковская карта отвязана"
            );

            setUnbindCardId(null);

            backCardScreen();

        } catch (error) {
            toast.error(
                error.response?.data?.error ||
                error.message ||
                "Не удалось отвязать карту"
            );
        } finally {
            cardUnbindingRef.current = false;
            setCardUnbinding(false);
        }
    };

    const handleAgree = async () => {
        if (
            !cardAgreementChecked ||
            cardBindingRef.current
        ) {
            return;
        }

        if (pendingBindProvider === "tbank") {
            await handleBindTBankCard();
        } else {
            await handleBindCard();
        }
    };

    const handleLogout = async () => {
        await logout();

        navigate("/login", {
            replace: true,
        });
    };

    const handleMyComplaints = () => {
        if (profile) {
            navigate(`/complaints/${profile.id}`);
        }
    };

    const openSuggestionModal = () => {
        setSuggestionText("");
        setShowSuggestionModal(true);
    };

    const closeSuggestionModal = () => {
        if (suggestionSending) return;

        setShowSuggestionModal(false);
        setSuggestionText("");
    };

    const submitPlatformSuggestion = async () => {
        const cleanText = String(suggestionText || "").trim();

        if (cleanText.length < 10) {
            toast.info("Опишите предложение немного подробнее");
            return;
        }

        if (cleanText.length > 2000) {
            toast.error("Предложение не должно превышать 2000 символов");
            return;
        }

        try {
            setSuggestionSending(true);

            const platformLabel =
                platform === "ios"
                    ? "iOS"
                    : platform === "android"
                        ? "Android"
                        : "Web";

            const message = [
                "💡 ПРЕДЛОЖЕНИЕ ПО РАЗВИТИЮ CARGOCAMP",
                "",
                cleanText,
                "",
                `Платформа: ${platformLabel}`,
                `Пользователь: ${profile?.username || "Неизвестно"}`,
                `ID пользователя: ${profile?.id || "Неизвестно"}`,
            ].join("\n");

            await axiosInstance.post("/support/messages", {
                text: message,
            });

            toast.success("Спасибо! Предложение отправлено");

            setShowSuggestionModal(false);
            setSuggestionText("");
        } catch (error) {
            console.error("Ошибка отправки предложения:", error);

            toast.error(
                error?.response?.data?.message ||
                "Не удалось отправить предложение"
            );
        } finally {
            setSuggestionSending(false);
        }
    };

    const handleOrderHistory = () => {
        if (profile) {
            navigate(`/orders-history/${profile.id}`);
        }
    };

    useEffect(() => {
        const onPullToRefresh = async (e) => {
            try {
                await Promise.allSettled([
                    fetchProfileData(),
                    loadDebtStatus(),
                    axios
                        .get(`${apiUrl}/api/category`)
                        .then((res) => setCategories(res.data || []))
                        .catch(() => setCategories([])),
                ]);
            } finally {
                e.detail?.done?.();
            }
        };

        window.addEventListener("appPullToRefresh", onPullToRefresh);

        return () => {
            window.removeEventListener("appPullToRefresh", onPullToRefresh);
        };

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const vehicleVerificationStatusText = (() => {
        switch (
            profile?.vehicleVerificationStatus
            ) {
            case "pending":
                return "Ожидает проверки";

            case "verified":
                return "Автомобиль подтверждён";

            case "rejected":
                return "Проверка не пройдена";

            default:
                return "Автомобиль не добавлен";
        }
    })();

    const isVehicleVerified =
        profile?.vehicleVerificationStatus ===
        "verified";

    const showVehicleSummary =
        isVehicleVerified && !vehicleEditing;

    if (loading) {
        return (
            <LoadingState
                fullPage
                title="Загрузка данных профиля..."
            />
        );
    }

    if (error) {
        return (
            <div className="profile-loading">
                <p className="profile-error">{error}</p>
            </div>
        );
    }

    return (
        <div className={`profile-page profile-page--${platform} ${platform === "ios" ? "ios-safe-top ios-safe-bottom" : ""}`}>
            <div className="profile-shell">
                <header className="cc-profile-heading">

                    <h1>Профиль</h1>

                </header>

                {profile && (
                    <div className="cc-profile-account">

                        <div className="cc-profile-account__avatar">

                            {profile.avatar ? (
                                <img
                                    src={`${apiUrl}${profile.avatar}`}
                                    alt="Аватар"
                                />
                            ) : (
                                <span>
                    {profile.username
                        ? profile.username
                            .charAt(0)
                            .toUpperCase()
                        : "U"}
                </span>
                            )}

                            <label
                                className="cc-profile-account__camera"
                                title="Изменить фото профиля"
                            >
                                <Camera
                                    size={17}
                                    aria-hidden="true"
                                />

                                <input
                                    type="file"
                                    accept="image/*"
                                    aria-label="Изменить фото профиля"
                                    disabled={avatarUploading}
                                    onChange={(event) => {
                                        const file =
                                            event.target.files?.[0];

                                        if (file) {
                                            handleAvatarUpload(file);
                                        }

                                        event.target.value = "";
                                    }}
                                />
                            </label>

                        </div>

                        <div className="cc-profile-account__info">

                            <h2>{profile.username}</h2>

                            <div className="cc-profile-account__meta">

                <span>
                    ID: {profile.id}
                </span>

                                <span>
                    Рейтинг: {
                                    renderRating(profile.rating)
                                }
                </span>

                            </div>

                            {avatarUploading && (
                                <span className="cc-profile-note">
                    Загрузка фотографии...
                </span>
                            )}

                        </div>

                    </div>
                )}

                {/* =========================================
    ОПЛАТА И PREMIUM
========================================= */}

                <SectionCard
                    title="Финансы"
                    padded={false}
                    className="cc-profile-group"
                >
                    <SettingsRow
                        icon={<CreditCard />}
                        title="Банковские карты"
                        description="Управление способами оплаты"
                        value={
                            isCardBound || profile?.tbankCardBound
                                ? "Привязаны"
                                : "Не привязаны"
                        }
                        onClick={() => openProfileSheet("cards")}
                    />

                    <SettingsRow
                        icon={<Sparkles />}
                        title="CargoCamp Premium"
                        description={subscriptionLabel}
                        onClick={() => openProfileSheet("premium")}
                    />

                    <SettingsRow
                        icon={<CreditCard />}
                        title="Задолженность"
                        value={`${(debtAmount / 100).toFixed(2)} ₽`}
                        variant={hasDebt ? "danger" : "default"}
                        onClick={() => openProfileSheet("debt")}
                    />
                </SectionCard>

                {hasDebt && (
                    <div
                        ref={debtSectionRef}
                        className="cc-profile-debt"
                    >
                        <div className="cc-profile-debt__title">
                            Задолженность по комиссии
                        </div>

                        <div className="cc-profile-debt__amount">
                            {(debtAmount / 100).toFixed(2)} ₽
                        </div>

                        <PaymentProviderSelect
                            title="Способ погашения"
                            selectedProvider={selectedDebtProvider}
                            onSelect={setSelectedDebtProvider}
                            disabled={loading || debtPayLoading}
                        />

                        <Button
                            variant="danger"
                            fullWidth
                            loading={debtPayLoading}
                            onClick={handlePayDebt}
                        >
                            {debtPayLoading
                                ? "Проверяем оплату..."
                                : "Оплатить задолженность"}
                        </Button>
                    </div>
                )}

                <SectionCard
                    title="Работа и услуги"
                    padded={false}
                    className="cc-profile-group"
                >
                    <SettingsRow
                        icon={<BriefcaseBusiness />}
                        title="Профессии"
                        description="Настройте категории доступных заказов"
                        value={
                            categoryPick.length > 0
                                ? `Выбрано: ${categoryPick.length}`
                                : "Не выбраны"
                        }
                        onClick={() => openProfileSheet("professions")}
                    />

                    <SettingsRow
                        icon={<MapPin />}
                        title="Местоположение"
                        description={
                            profile?.locationAddress ||
                            "Укажите ваш адрес"
                        }
                        onClick={() =>
                            openProfileSheet("location")
                        }
                    />

                    <SettingsRow
                        icon={<CarFront />}
                        title="Автомобиль"
                        description={
                            [
                                profile?.vehicleBrand,
                                profile?.vehicleModel,
                                profile?.vehiclePlate,
                            ]
                                .filter(Boolean)
                                .join(" · ") ||
                            "Добавить автомобиль"
                        }
                        onClick={() =>
                            openProfileSheet("vehicle")
                        }
                    />
                </SectionCard>



                <div className="profile-card glass profile-verification-card">
                    <div className="card-head">
                        <div>
                            <h2 className="card-title">
                                <ShieldCheck size={20} aria-hidden="true" />{" "}Подтверждения и льготы
                            </h2>

                            <p className="card-subtitle">
                                Личность, автомобиль и социальные статусы
                            </p>
                        </div>

                        <button
                            type="button"
                            className="profile-chip"
                            onClick={() =>
                                setShowVerificationModal(true)
                            }
                        >
                            Подробнее
                        </button>
                    </div>

                    <div className="verification-sections">

                        {/* =========================
    ПОДТВЕРЖДЕНИЕ ЛИЧНОСТИ
========================= */}

                        <UserIdentityVerification
                            userId={profile?.id}
                        />

                        <UserBenefitsSection
                            userId={profile?.id}
                            embedded
                        />

                    </div>
                </div>

                <SectionCard
                    title="Помощь и поддержка"
                    padded={false}
                    className="cc-profile-group"
                >

                    <SettingsRow
                        icon={<FaHeadset />}
                        title="Поддержка"
                        description="Помощь и вопросы"
                        onClick={() =>
                            navigate("/support")
                        }
                    />

                    <SettingsRow
                        icon={<FaLightbulb />}
                        title="Предложить идею"
                        description="Помогите улучшить CargoCamp"
                        onClick={openSuggestionModal}
                    />

                    <SettingsRow
                        icon={<FaTrophy />}
                        title="Достижения"
                        value="Скоро"
                        disabled
                        onClick={() => {}}
                    />

                    <div className="cc-profile-support-phone">

        <span>
            Нужна помощь? Позвоните нам
        </span>

                        <SupportPhoneLink showIcon />

                    </div>

                </SectionCard>

                <AccountDeletionSection />

                <div className="profile-actions glass">
                    <button
                        onClick={handleMyComplaints}
                        className="btn btn-ghost"
                    >
                        Отзывы
                    </button>

                    <button
                        onClick={handleOrderHistory}
                        className="btn btn-ghost"
                    >
                        История заказов
                    </button>

                    <button
                        onClick={() => navigate("/info")}
                        className="btn btn-ghost"
                    >
                        Информация и контакты
                    </button>

                    <button
                        onClick={handleLogout}
                        className="btn btn-ghost-danger"
                    >
                        Выйти
                    </button>
                </div>
            </div>

            <BottomSheet
                open={activeProfileSheet === "cards"}
                onClose={closeProfileSheet}
                title={
                    {
                        main: "Банковские карты",
                        bind: "Привязать карту",
                        agreement: "Соглашение",
                        auto: "Автоматическое списание",
                        unbind: "Отвязать карту",
                    }[cardScreen] || "Банковские карты"
                }
                busy={
                    cardBinding ||
                    autoCardSaving ||
                    cardUnbinding
                }
            >
                <SheetScreen
                    screen={cardScreen}
                    direction={cardDirection}
                    busy={
                        cardBinding ||
                        autoCardSaving ||
                        cardUnbinding
                    }
                    onBack={
                        cardScreen !== "main"
                            ? backCardScreen
                            : undefined
                    }
                >
                    <div className="cc-profile-sheet-stack">

                        {cardScreen === "main" && (
                            <>
                                {savedPaymentCards.length === 0 && (
                                    <p className="cc-profile-note">
                                        У вас пока нет сохранённых карт.
                                    </p>
                                )}

                                {savedPaymentCards.map((card) => (
                                    <div
                                        key={card.id}
                                        className="cc-profile-payment-card"
                                    >
                                        <div className="cc-profile-card-mask">
                                            {card.title}
                                        </div>

                                        <Button
                                            variant="outline"
                                            fullWidth
                                            onClick={() => {
                                                setUnbindCardId(card.id);

                                                navigateCardScreen("unbind");
                                            }}
                                        >
                                            Отвязать
                                        </Button>
                                    </div>
                                ))}

                                <Button
                                    fullWidth
                                    onClick={() =>
                                        navigateCardScreen("bind")
                                    }
                                >
                                    + Привязать карту
                                </Button>

                                <div className="cc-profile-payment-card">

                                    <h3 className="cc-profile-section-title">
                                        Автоматическое списание комиссии
                                    </h3>

                                    <p className="cc-profile-note">
                                        Выберите сохранённую карту для
                                        автоматического списания комиссии
                                        за услуги CargoCamp.
                                    </p>

                                    <PaymentCardOption
                                        title={
                                            autoCommissionCard?.title ||
                                            "Не списывать автоматически"
                                        }
                                        selectable={false}
                                        showChevron
                                        onClick={() =>
                                            navigateCardScreen("auto")
                                        }
                                    />

                                </div>
                            </>
                        )}

                        {cardScreen === "bind" && (
                            <>
                                <p className="cc-profile-note">
                                    Выберите способ безопасной
                                    привязки банковской карты.
                                </p>

                                <PaymentCardOption
                                    title="ЮKassa"
                                    description={
                                        isCardBound
                                            ? "Карта уже привязана"
                                            : "Привязать банковскую карту"
                                    }
                                    selectable={false}
                                    showChevron
                                    disabled={isCardBound}
                                    onClick={() => {
                                        if (CARD_BIND_SCREENSHOT_MODE) {
                                            handleBindCard();
                                            backCardScreen();
                                            return;
                                        }

                                        setPendingBindProvider("yookassa");

                                        setCardAgreementChecked(false);
                                        navigateCardScreen("agreement");
                                    }}
                                />

                                <PaymentCardOption
                                    title="Т-Банк"
                                    description={
                                        profile?.tbankCardBound
                                            ? "Карта уже привязана"
                                            : "Привязать банковскую карту"
                                    }
                                    selectable={false}
                                    showChevron
                                    disabled={!!profile?.tbankCardBound}
                                    onClick={() => {
                                        setPendingBindProvider("tbank");

                                        setCardAgreementChecked(false);
                                        navigateCardScreen("agreement");
                                    }}
                                />
                            </>
                        )}

                        {cardScreen === "agreement" && (
                            <>
                                <CardBindingAgreement
                                    checked={cardAgreementChecked}
                                    onCheckedChange={
                                        setCardAgreementChecked
                                    }
                                    disabled={cardBinding}
                                />

                                <Button
                                    fullWidth
                                    loading={cardBinding}
                                    disabled={!cardAgreementChecked}
                                    onClick={handleAgree}
                                >
                                    Подтвердить и привязать карту
                                </Button>
                            </>
                        )}

                        {cardScreen === "unbind" && (
                            <>

                                <div className="cc-profile-payment-card">

                                    <div className="cc-profile-card-mask">
                                        {cardToUnbind?.title ||
                                            "Банковская карта"}
                                    </div>

                                    <p className="cc-profile-note">
                                        После отвязки карта больше не будет
                                        использоваться для быстрых платежей
                                        и автоматической оплаты комиссии.
                                    </p>

                                </div>

                                <Button
                                    variant="danger"
                                    fullWidth
                                    loading={cardUnbinding}
                                    disabled={!cardToUnbind}
                                    onClick={handleUnbindSavedCard}
                                >
                                    Отвязать карту
                                </Button>

                                <Button
                                    variant="secondary"
                                    fullWidth
                                    disabled={cardUnbinding}
                                    onClick={backCardScreen}
                                >
                                    Отмена
                                </Button>

                            </>
                        )}

                        {cardScreen === "auto" && (
                            <>
                                <PaymentCardOption
                                    title="Не списывать автоматически"
                                    selected={
                                        !autoCommissionCard
                                    }
                                    disabled={autoCardSaving}
                                    onClick={() =>
                                        handleAutoProviderChange("none")
                                    }
                                />

                                {savedPaymentCards.map((card) => (
                                    <PaymentCardOption
                                        key={card.id}
                                        title={card.title}
                                        description="Сохранённая карта"
                                        selected={
                                            autoCommissionCard?.id === card.id
                                        }
                                        disabled={autoCardSaving}
                                        onClick={() =>
                                            handleAutoProviderChange(card.id)
                                        }
                                    />
                                ))}

                                {savedPaymentCards.length === 0 && (
                                    <p className="cc-profile-note">
                                        Для автоматической оплаты
                                        сначала привяжите карту.
                                    </p>
                                )}
                            </>
                        )}

                    </div>
                </SheetScreen>
            </BottomSheet>

            <BottomSheet
                open={activeProfileSheet === "premium"}
                onClose={closeProfileSheet}
                title={
                    {
                        plans: "CargoCamp Premium",
                        payment: "Оплата Premium",
                        provider: "Способ оплаты",
                        agreement: "Соглашение",
                    }[premiumStep]
                }
                description={
                    premiumStep === "plans"
                        ? subscriptionLabel
                        : undefined
                }
                busy={premiumPayLoading}
            >
                <SheetScreen
                    screen={premiumStep}
                    direction={premiumDirection}
                    busy={premiumPayLoading}
                    onBack={
                        premiumStep !== "plans"
                            ? goBackPremium
                            : undefined
                    }
                >
                    <div className="cc-profile-sheet-stack">

                        {premiumStep === "plans" && (
                            <>
                                <div className="cc-profile-premium-intro">
                                    <div className="cc-profile-premium-icon">
                                        <Sparkles size={28} />
                                    </div>

                                    <h3>Работайте без комиссии</h3>

                                    <p>
                                        По условиям подписки
                                        CargoCamp Premium.
                                    </p>
                                </div>

                                {[
                                    {
                                        id: "7d",
                                        title: "На 7 дней",
                                        price: "2 500 ₽",
                                    },
                                    {
                                        id: "30d",
                                        title: "На 30 дней",
                                        price: "9 000 ₽",
                                    },
                                ].map((plan) => (
                                    <button
                                        key={plan.id}
                                        type="button"
                                        className="cc-premium-plan-option"
                                        onClick={() => {
                                            setPremiumDuration(plan.id);

                                            setPremiumPaymentMethod(
                                                null
                                            );

                                            goToPremiumStep(
                                                "payment"
                                            );
                                        }}
                                    >
                                        <div>
                                <span>
                                    {plan.title}
                                </span>

                                            <strong>
                                                {plan.price}
                                            </strong>
                                        </div>

                                        <ChevronRight
                                            size={22}
                                            aria-hidden="true"
                                        />
                                    </button>
                                ))}
                            </>
                        )}

                        {premiumStep !== "plans" && (
                            <div className="cc-profile-premium-plan">
                                <div className="cc-profile-premium-plan__duration">
                                    Premium на {
                                    premiumDuration === "7d"
                                        ? "7 дней"
                                        : "30 дней"
                                }
                                </div>

                                <div className="cc-profile-premium-plan__price">
                                    {premiumDuration === "7d"
                                        ? "2 500 ₽"
                                        : "9 000 ₽"}
                                </div>
                            </div>
                        )}

                        {premiumStep === "payment" && (
                            <>
                                {premiumAvailableCards.map(
                                    (card) => (
                                        <PaymentCardOption
                                            key={card.id}
                                            title={
                                                "Оплатить привязанной картой"
                                            }
                                            description={card.title}
                                            selected={
                                                premiumPaymentMethod ===
                                                card.id
                                            }
                                            disabled={
                                                premiumPayLoading
                                            }
                                            onClick={() => {
                                                setPremiumPaymentMethod(
                                                    card.id
                                                );
                                            }}
                                        />
                                    )
                                )}

                                {premiumAvailableCards.length > 0 && (
                                    <Button
                                        fullWidth
                                        loading={premiumPayLoading}
                                        disabled={
                                            !premiumPaymentMethod
                                        }
                                        onClick={() =>
                                            handleBuyPremium({
                                                duration:
                                                premiumDuration,

                                                provider:
                                                premiumPaymentMethod,

                                                paymentMode:
                                                    "saved_card",
                                            })
                                        }
                                    >
                                        Оплатить {
                                        premiumDuration === "7d"
                                            ? "2 500 ₽"
                                            : "9 000 ₽"
                                    }
                                    </Button>
                                )}

                                <Button
                                    fullWidth
                                    variant={
                                        premiumAvailableCards.length
                                            ? "secondary"
                                            : "primary"
                                    }
                                    disabled={premiumPayLoading}
                                    onClick={() =>
                                        choosePremiumMode(
                                            "redirect"
                                        )
                                    }
                                >
                                    {savedPaymentCards.length
                                        ? "Оплатить другой картой"
                                        : "Оплатить без привязки"}
                                </Button>

                                {savedPaymentCards.length === 0 && (
                                    <Button
                                        variant="secondary"
                                        fullWidth
                                        disabled={
                                            premiumPayLoading
                                        }
                                        onClick={() =>
                                            choosePremiumMode(
                                                "redirect_bind"
                                            )
                                        }
                                    >
                                        Оплатить и привязать карту
                                    </Button>
                                )}
                            </>
                        )}

                        {premiumStep === "provider" && (
                            <>
                                <PaymentCardOption
                                    title="ЮKassa"
                                    description="Оплата банковской картой"
                                    selected={
                                        premiumProvider === "yookassa"
                                    }
                                    disabled={premiumPayLoading}
                                    onClick={() =>
                                        setPremiumProvider(
                                            "yookassa"
                                        )
                                    }
                                />

                                <PaymentCardOption
                                    title="Т-Банк"
                                    description={
                                        premiumMode === "redirect_bind"
                                            ? "Оплата с привязкой пока недоступна"
                                            : "Оплата банковской картой"
                                    }
                                    selected={
                                        premiumProvider === "tbank"
                                    }
                                    disabled={
                                        premiumPayLoading ||
                                        premiumMode === "redirect_bind"
                                    }
                                    onClick={() =>
                                        setPremiumProvider(
                                            "tbank"
                                        )
                                    }
                                />

                                <Button
                                    fullWidth
                                    loading={premiumPayLoading}
                                    onClick={() => {
                                        if (
                                            premiumMode ===
                                            "redirect_bind"
                                        ) {
                                            goToPremiumStep(
                                                "agreement"
                                            );

                                            return;
                                        }

                                        handleBuyPremium({
                                            duration:
                                            premiumDuration,

                                            provider:
                                            premiumProvider,

                                            paymentMode:
                                                "redirect",
                                        });
                                    }}
                                >
                                    {premiumMode === "redirect_bind"
                                        ? "Продолжить"
                                        : `Оплатить ${
                                            premiumDuration === "7d"
                                                ? "2 500 ₽"
                                                : "9 000 ₽"
                                        }`}
                                </Button>
                            </>
                        )}

                        {premiumStep === "agreement" && (
                            <>
                                <CardBindingAgreement
                                    checked={
                                        premiumAgreementChecked
                                    }
                                    onCheckedChange={
                                        setPremiumAgreementChecked
                                    }
                                    disabled={
                                        premiumPayLoading
                                    }
                                />

                                <Button
                                    fullWidth
                                    loading={premiumPayLoading}
                                    disabled={
                                        !premiumAgreementChecked
                                    }
                                    onClick={() =>
                                        handleBuyPremium({
                                            duration:
                                            premiumDuration,

                                            provider:
                                            premiumProvider,

                                            paymentMode:
                                                "redirect_bind",
                                        })
                                    }
                                >
                                    Оплатить и привязать карту
                                </Button>
                            </>
                        )}

                    </div>
                </SheetScreen>
            </BottomSheet>

            <BottomSheet
                open={activeProfileSheet === "professions"}
                onClose={closeProfileSheet}
                title="Мои профессии"
                description="По выбранным профессиям будут фильтроваться заказы"
                busy={catSaving}
                footer={
                    <div className="cc-sheet__actions">

                        <Button
                            fullWidth
                            loading={catSaving}
                            onClick={savePreferredCategories}
                        >
                            {catSaving
                                ? "Сохранение..."
                                : "Сохранить"}
                        </Button>

                        <Button
                            variant="secondary"
                            fullWidth
                            disabled={catSaving}
                            onClick={() => setCategoryPick([])}
                        >
                            Сбросить
                        </Button>

                    </div>
                }
            >
                <div className="cc-profile-categories">

                    {sortedCategories.map((category) => {
                        const active =
                            categoryPick.includes(category.id);

                        return (
                            <button
                                key={category.id}
                                type="button"
                                className={[
                                    "cc-profile-category",
                                    active &&
                                    "cc-profile-category--active",
                                ]
                                    .filter(Boolean)
                                    .join(" ")}
                                aria-pressed={active}
                                disabled={catSaving}
                                onClick={() => {
                                    setCategoryPick((prev) =>
                                        prev.includes(category.id)
                                            ? prev.filter(
                                                (id) =>
                                                    id !== category.id
                                            )
                                            : [
                                                ...prev,
                                                category.id,
                                            ]
                                    );
                                }}
                            >
                    <span>
                        {category.name}
                    </span>

                                <span
                                    className="cc-profile-category__check"
                                    aria-hidden="true"
                                >
                        {active && <Check size={16} />}
                    </span>
                            </button>
                        );
                    })}

                    {sortedCategories.length === 0 && (
                        <p className="cc-profile-note">
                            Список профессий пока недоступен.
                        </p>
                    )}

                </div>
            </BottomSheet>

            <BottomSheet
                open={activeProfileSheet === "location"}
                onClose={closeProfileSheet}
                title={
                    locationScreen === "map"
                        ? "Выбрать на карте"
                        : "Местоположение"
                }
                description={
                    locationScreen === "main"
                        ? "Используется для автоподстановки адреса и фильтрации заказов"
                        : undefined
                }
                busy={locLoading}
            >
                <SheetScreen
                    screen={locationScreen}
                    direction={locationDirection}
                    busy={locLoading}
                    onBack={
                        locationScreen === "map"
                            ? backToLocation
                            : undefined
                    }
                >
                    {locationScreen === "main" && (
                        <div className="cc-profile-sheet-stack">

                    <div className="cc-profile-address-field">

                        <TextField
                            aria-label="Адрес"
                            placeholder="Введите район, улицу или адрес"
                            leftIcon={<MapPin size={20} />}
                            value={locationDraft}
                            autoComplete="off"
                            disabled={locLoading}
                            onChange={(event) => {
                                const value =
                                    event.target.value;

                                setLocationDraft(value);
                                setPickedCoords(null);
                                setAddressQuery(value);
                            }}
                        />

                        {addressSuggestions.length > 0 && (
                            <div
                                className="cc-profile-address-suggestions"
                            >
                                {addressSuggestions.map(
                                    (suggestion, index) => (
                                        <button
                                            key={`${suggestion.label}-${index}`}
                                            type="button"
                                            disabled={locLoading}
                                            onClick={() => {
                                                setLocationDraft(
                                                    suggestion.label
                                                );

                                                setPickedCoords({
                                                    lat: suggestion.lat,
                                                    lng: suggestion.lng,
                                                });

                                                setAddressSuggestions([]);
                                                setAddressQuery("");
                                            }}
                                        >
                                            <MapPin
                                                size={18}
                                                aria-hidden="true"
                                            />

                                            <span>
                                    {suggestion.label}
                                </span>
                                        </button>
                                    )
                                )}
                            </div>
                        )}

                    </div>

                    <Button
                        fullWidth
                        loading={locLoading}
                        disabled={!locationDraft.trim()}
                        onClick={() =>
                            saveLocation({
                                address: locationDraft,
                                lat: pickedCoords?.lat ?? null,
                                lng: pickedCoords?.lng ?? null,
                                source: "manual",
                            })
                        }
                    >
                        Сохранить
                    </Button>

                    <div className="cc-profile-location-options">

                        <SettingsRow
                            icon={<Navigation />}
                            title="Определить по GPS"
                            description="Использовать текущее местоположение"
                            disabled={locLoading}
                            onClick={detectGps}
                        />

                        <SettingsRow
                            icon={<Map />}
                            title="Выбрать на карте"
                            description="Указать точку вручную"
                            disabled={locLoading}
                            onClick={openLocationMap}
                        />

                    </div>

                    {gpsCandidate && (
                        <div className="cc-profile-payment-card">

                            <h3 className="cc-profile-section-title">
                                Подтвердите местоположение
                            </h3>

                            <p className="cc-profile-note">
                                {gpsCandidate.address}
                            </p>

                            <Button
                                fullWidth
                                loading={locLoading}
                                onClick={() =>
                                    saveLocation({
                                        address:
                                            locationDraft ||
                                            gpsCandidate.address,

                                        lat: gpsCandidate.lat,
                                        lng: gpsCandidate.lng,
                                        source: "gps",
                                    }).then(() =>
                                        setGpsCandidate(null)
                                    )
                                }
                            >
                                Да, сохранить
                            </Button>

                            <Button
                                variant="secondary"
                                fullWidth
                                disabled={locLoading}
                                onClick={() =>
                                    setGpsCandidate(null)
                                }
                            >
                                Нет, введу вручную
                            </Button>

                        </div>
                    )}

                    {locError && (
                        <div
                            className="cc-ui-error"
                            role="alert"
                        >
                            {locError}
                        </div>
                    )}

                        </div>
                    )}

                    {locationScreen === "map" && (
                        <YandexMapModal
                            embedded
                            isOpen={
                                activeProfileSheet === "location" &&
                                locationScreen === "map"
                            }
                            onClose={backToLocation}
                            initialLat={
                                pickedCoords?.lat ??
                                profile?.locationLat
                            }
                            initialLng={
                                pickedCoords?.lng ??
                                profile?.locationLng
                            }
                            showOrders={false}
                            onPick={(picked) => {
                                setLocationDraft(
                                    picked.address
                                );

                                setPickedCoords({
                                    lat: picked.lat,
                                    lng: picked.lng,
                                });

                                setAddressSuggestions([]);
                                setAddressQuery("");
                                setGpsCandidate(null);
                                setLocError(null);

                                backToLocation();
                            }}
                        />
                    )}
                </SheetScreen>
            </BottomSheet>

            <BottomSheet
                open={activeProfileSheet === "debt"}
                onClose={closeProfileSheet}
                title="Задолженность"
                busy={debtPayLoading}
            >
                {hasDebt ? (
                    <div className="cc-profile-sheet-stack">

                        <div className="cc-profile-debt__title">
                            Задолженность по комиссии
                        </div>

                        <div className="cc-profile-debt__amount">
                            {(debtAmount / 100).toFixed(2)} ₽
                        </div>

                        <PaymentProviderSelect
                            title="Способ погашения"
                            selectedProvider={selectedDebtProvider}
                            onSelect={setSelectedDebtProvider}
                            disabled={debtPayLoading}
                        />

                        <Button
                            variant="danger"
                            fullWidth
                            loading={debtPayLoading}
                            onClick={handlePayDebt}
                        >
                            Оплатить задолженность
                        </Button>

                    </div>
                ) : (
                    <div className="cc-profile-sheet-stack">

                        <div className="cc-profile-debt-free">
                            <ShieldCheck
                                size={40}
                                aria-hidden="true"
                            />

                            <h3>Задолженности нет</h3>

                            <strong>0 ₽</strong>

                            <p>
                                У вас нет неоплаченных комиссий
                                CargoCamp.
                            </p>
                        </div>

                        <Button
                            fullWidth
                            onClick={closeProfileSheet}
                        >
                            Понятно
                        </Button>

                    </div>
                )}
            </BottomSheet>

            <BottomSheet
                open={activeProfileSheet === "vehicle"}
                onClose={closeProfileSheet}
                title={
                    vehicleEditing
                        ? "Сменить автомобиль"
                        : "Автомобиль"
                }
                description={
                    showVehicleSummary
                        ? undefined
                        : "Данные автомобиля для выполнения заказов такси"
                }
                busy={
                    vehicleSaving ||
                    vehiclePhotoUploading
                }
            >
                <SheetScreen
                    screen={
                        showVehicleSummary
                            ? "summary"
                            : "editor"
                    }
                    direction={vehicleDirection}
                    busy={
                        vehicleSaving ||
                        vehiclePhotoUploading
                    }
                    onBack={
                        vehicleEditing
                            ? backToVehicleSummary
                            : undefined
                    }
                >

                    {showVehicleSummary ? (
                        <div className="cc-profile-sheet-stack">

                            <div className="cc-vehicle-summary">

                                {profile?.vehiclePhoto ? (
                                    <img
                                        className="cc-vehicle-summary__photo"
                                        src={buildFileUrl(
                                            profile.vehiclePhoto
                                        )}
                                        alt="Автомобиль"
                                    />
                                ) : (
                                    <div className="cc-vehicle-summary__placeholder">
                                        <CarFront
                                            size={54}
                                            aria-hidden="true"
                                        />
                                    </div>
                                )}

                                <div className="cc-vehicle-summary__body">

                                    <StatusBadge
                                        tone="success"
                                        icon={<Check size={15} />}
                                    >
                                        Автомобиль подтверждён
                                    </StatusBadge>

                                    <h3>
                                        {[
                                            profile?.vehicleBrand,
                                            profile?.vehicleModel,
                                        ]
                                            .filter(Boolean)
                                            .join(" ")}
                                    </h3>

                                    <div className="cc-vehicle-summary__plate">
                                        {profile?.vehiclePlate ||
                                            "Госномер не указан"}
                                    </div>

                                    <div className="cc-vehicle-summary__details">

                                        <div>
                                            <span>Цвет</span>

                                            <strong>
                                                {profile?.vehicleColor ||
                                                    "Не указан"}
                                            </strong>
                                        </div>

                                        <div>
                                            <span>Год выпуска</span>

                                            <strong>
                                                {profile?.vehicleYear ||
                                                    "Не указан"}
                                            </strong>
                                        </div>

                                    </div>

                                </div>

                            </div>

                            <p className="cc-profile-note">
                                Автомобиль подтверждён администратором.
                                Вы можете принимать заказы такси
                                при выполнении остальных условий сервиса.
                            </p>

                            <Button
                                variant="secondary"
                                fullWidth
                                onClick={openVehicleEditor}
                            >
                                Сменить автомобиль
                            </Button>

                        </div>
                    ) : (
                        <div className="cc-profile-sheet-stack">

                    <div className="cc-profile-vehicle-status">

                        <StatusBadge
                            tone={
                                {
                                    verified: "success",
                                    pending: "warning",
                                    rejected: "danger",
                                }[
                                    profile?.vehicleVerificationStatus
                                    ] || "neutral"
                            }
                            icon={<CarFront size={15} />}
                        >
                            {vehicleVerificationStatusText}
                        </StatusBadge>

                        <p className="cc-profile-note">
                            Для курьерских заказов автомобиль
                            не требуется. Для работы в такси
                            необходимо подтверждение автомобиля.
                        </p>

                    </div>

                    {profile?.vehicleVerificationStatus ===
                        "rejected" &&
                        profile?.vehicleVerificationNote && (
                            <div
                                className="cc-ui-error"
                                role="alert"
                            >
                                <strong>
                                    Причина отказа:
                                </strong>{" "}

                                {profile.vehicleVerificationNote}
                            </div>
                        )}

                    {profile?.vehicleVerificationStatus ===
                        "pending" && (
                            <div className="cc-profile-vehicle-notice">

                                Данные автомобиля отправлены
                                администратору. До подтверждения
                                принимать заказы такси нельзя.

                            </div>
                        )}

                    {profile?.vehicleVerificationStatus ===
                        "verified" && (
                            <div className="cc-profile-vehicle-notice">

                                При изменении данных или фотографии
                                автомобиля может потребоваться повторное
                                подтверждение администратором.

                            </div>
                        )}

                    <div className="cc-profile-vehicle-form">

                        <TextField
                            aria-label="Марка автомобиля"
                            placeholder="Марка автомобиля *"
                            value={vehicleForm.vehicleBrand}
                            required
                            maxLength={100}
                            disabled={vehicleSaving}
                            onChange={(event) =>
                                setVehicleForm((prev) => ({
                                    ...prev,

                                    vehicleBrand:
                                    event.target.value,
                                }))
                            }
                        />

                        <TextField
                            aria-label="Модель автомобиля"
                            placeholder="Модель автомобиля *"
                            value={vehicleForm.vehicleModel}
                            required
                            maxLength={100}
                            disabled={vehicleSaving}
                            onChange={(event) =>
                                setVehicleForm((prev) => ({
                                    ...prev,

                                    vehicleModel:
                                    event.target.value,
                                }))
                            }
                        />

                        <TextField
                            aria-label="Цвет автомобиля"
                            placeholder="Цвет автомобиля *"
                            value={vehicleForm.vehicleColor}
                            required
                            maxLength={100}
                            disabled={vehicleSaving}
                            onChange={(event) =>
                                setVehicleForm((prev) => ({
                                    ...prev,

                                    vehicleColor:
                                    event.target.value,
                                }))
                            }
                        />

                        <TextField
                            aria-label="Госномер автомобиля"
                            placeholder="Госномер *"
                            value={vehicleForm.vehiclePlate}
                            required
                            maxLength={30}
                            disabled={vehicleSaving}
                            onChange={(event) =>
                                setVehicleForm((prev) => ({
                                    ...prev,

                                    vehiclePlate:
                                        event.target.value
                                            .toUpperCase(),
                                }))
                            }
                        />

                        <TextField
                            type="number"
                            aria-label="Год выпуска"
                            placeholder="Год выпуска"
                            value={vehicleForm.vehicleYear}
                            min={1950}
                            max={
                                new Date().getFullYear() + 1
                            }
                            disabled={vehicleSaving}
                            onChange={(event) =>
                                setVehicleForm((prev) => ({
                                    ...prev,

                                    vehicleYear:
                                    event.target.value,
                                }))
                            }
                        />

                    </div>

                    <div className="cc-profile-vehicle-photo">

                        <h3 className="cc-profile-section-title">
                            Фото автомобиля
                        </h3>

                        <p className="cc-profile-note">
                            На фотографии должны быть хорошо
                            видны автомобиль и государственный
                            номер.
                        </p>

                        {profile?.vehiclePhoto && (
                            <img
                                src={buildFileUrl(
                                    profile.vehiclePhoto
                                )}
                                alt="Автомобиль"
                                className="cc-profile-vehicle-image"
                            />
                        )}

                        <label className="cc-profile-upload">

                            <Camera
                                size={23}
                                aria-hidden="true"
                            />

                            <span>
                    {vehiclePhotoUploading
                        ? "Загрузка..."
                        : profile?.vehiclePhoto
                            ? "Изменить фото"
                            : "Загрузить фото автомобиля"}
                </span>

                            <input
                                type="file"
                                accept="image/*"
                                aria-label="Фото автомобиля"
                                disabled={
                                    vehicleSaving ||
                                    vehiclePhotoUploading
                                }
                                onChange={(event) => {
                                    const file =
                                        event.target.files?.[0];

                                    if (file) {
                                        uploadVehiclePhoto(file);
                                    }

                                    event.target.value = "";
                                }}
                            />

                        </label>

                    </div>

                    <Button
                        fullWidth
                        loading={vehicleSaving}
                        disabled={vehiclePhotoUploading}
                        onClick={saveVehicle}
                    >
                        {vehicleSaving
                            ? "Сохраняем..."
                            : profile?.vehicleVerificationStatus ===
                            "verified"
                                ? "Сохранить изменения"
                                : "Отправить на проверку"}
                    </Button>

                        </div>
                    )}
                </SheetScreen>
            </BottomSheet>

            {showSuggestionModal && (
                <div
                    className="modal-overlay profile-suggestion-overlay"
                    onClick={closeSuggestionModal}
                >
                    <div
                        className="modal-window profile-suggestion-modal"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            className="profile-suggestion-close"
                            onClick={closeSuggestionModal}
                            disabled={suggestionSending}
                            aria-label="Закрыть"
                        >
                            <X size={18} aria-hidden="true" />
                        </button>

                        <div className="profile-suggestion-head">
                            <div className="profile-suggestion-icon">
                                <FaLightbulb />
                            </div>

                            <div>
                                <h3>Предложить улучшение</h3>

                                <p>
                                    Расскажите, что стоит добавить, исправить
                                    или сделать удобнее.
                                </p>
                            </div>
                        </div>

                        <div className="profile-suggestion-reward">
                            <strong>Бонус за полезную идею</strong>

                            <span>
                    Если предложение поможет развитию платформы,
                    после рассмотрения мы можем подарить вам
                    1 день Premium.
                </span>
                        </div>

                        <label className="profile-suggestion-label">
                            Ваше предложение

                            <textarea
                                className="profile-suggestion-textarea"
                                value={suggestionText}
                                onChange={(e) =>
                                    setSuggestionText(
                                        e.target.value.slice(0, 2000)
                                    )
                                }
                                placeholder={
                                    "Например: добавьте фильтр заказов по времени, " +
                                    "измените работу карты или сделайте новый способ оплаты..."
                                }
                                rows={7}
                                maxLength={2000}
                                disabled={suggestionSending}
                                autoFocus
                            />
                        </label>

                        <div className="profile-suggestion-counter">
                            {suggestionText.length} / 2000
                        </div>

                        <div className="profile-suggestion-note">
                            Предложение поступит в поддержку CargoCamp.
                            Ответ при необходимости появится в чате поддержки.
                        </div>

                        <div className="profile-suggestion-actions">
                            <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={closeSuggestionModal}
                                disabled={suggestionSending}
                            >
                                Отмена
                            </button>

                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={submitPlatformSuggestion}
                                disabled={
                                    suggestionSending ||
                                    suggestionText.trim().length < 10
                                }
                            >
                                <FaPaperPlane />

                                <span>
                        {suggestionSending
                            ? "Отправляем..."
                            : "Отправить идею"}
                    </span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showVerificationModal && (
                <div
                    className="modal-overlay"
                    onClick={() => setShowVerificationModal(false)}
                >
                    <div
                        className="modal-window"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3>О верификации пользователя</h3>

                        <div className="modal-content">
                            <p>
                                <strong>Подтверждение личности</strong> —
                                добровольная проверка документов пользователя.
                                Она нужна для повышения доверия и будущих
                                подтверждённых сделок CargoCamp.
                            </p>

                            <p>
                                <strong>Автомобиль для такси</strong> —
                                отдельная проверка данных автомобиля,
                                необходимая для работы в такси.
                            </p>

                            <p>
                                <strong>Социальные льготы</strong> —
                                подтверждение пенсионного статуса,
                                инвалидности или статуса многодетной семьи.
                                Льготы применяются согласно действующим
                                правилам CargoCamp.
                            </p>

                            <p>
                                Новые документы для подтверждения личности
                                и льгот передаются на ручную проверку
                                через защищённое хранилище.
                            </p>

                            <p>
                                Прохождение этих проверок не обязательно
                                для создания обычных заказов.
                            </p>

                            <button
                                type="button"
                                className="btn btn-ghost"
                                onClick={() =>
                                    setShowVerificationModal(false)
                                }
                            >
                                Закрыть
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProfilePage;