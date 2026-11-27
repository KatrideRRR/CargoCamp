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
import AgreementModal from "../components/AgreementModal";
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

    const openProfileSheet = (sheet) => {
        setActiveProfileSheet(sheet);
    };

    const closeProfileSheet = () => {
        setActiveProfileSheet(null);
    };

    const [showVerificationModal, setShowVerificationModal] = useState(false);
    const [showAgreement, setShowAgreement] = useState(false);
    const [showUnbindConfirm, setShowUnbindConfirm] = useState(false);

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
    const [showMapModal, setShowMapModal] = useState(false);
    const [pickedCoords, setPickedCoords] = useState(null);

    const [addressSuggestions, setAddressSuggestions] = useState([]);
    const [addressQuery, setAddressQuery] = useState("");

    const addressRequestIdRef = useRef(0);
    const addressAbortRef = useRef(null);

    const [avatarUploading, setAvatarUploading] = useState(false);

    const [categories, setCategories] = useState([]);
    const [categoryPick, setCategoryPick] = useState([]);
    const [catSaving, setCatSaving] = useState(false);

    const [selectedPremiumProvider, setSelectedPremiumProvider] = useState("yookassa");
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

    const [vehicleSaving, setVehicleSaving] =
        useState(false);

    const [vehiclePhotoUploading, setVehiclePhotoUploading] =
        useState(false);

    const [vehicleVerificationOpen, setVehicleVerificationOpen] =
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

    useEffect(() => {
        if (!profile) return;

        const ids = Array.isArray(profile.preferredCategoryIds)
            ? profile.preferredCategoryIds
            : [];

        setCategoryPick(ids);
    }, [profile]);

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
                    setShowMapModal(true);

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
                setShowMapModal(true);

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

    const handleBuyPremium = async (duration) => {
        try {
            const token = localStorage.getItem("authToken");

            if (!token) {
                toast.error("Вы не авторизованы");
                return;
            }

            const endpoint =
                selectedPremiumProvider === "tbank"
                    ? "/api/tbank-payments/premium/create"
                    : "/api/payments/premium/create";

            const res = await axios.post(
                `${apiUrl}${endpoint}`,
                { duration },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            if (!res.data?.success) {
                toast.error(res.data?.error || "Ошибка создания платежа");
                return;
            }

            /**
             * ✅ Оплата с привязанной карты.
             */
            if (res.data.paidBySavedCard) {
                if (res.data.paid) {
                    toast.success("Premium оплачен с привязанной карты ");

                    try {
                        const refreshed = await axios.get(`${apiUrl}/api/auth/profile`, {
                            headers: { Authorization: `Bearer ${token}` },
                        });

                        setProfile(refreshed.data);
                        setPaymentMethodId(refreshed.data.yookassaPaymentMethodId || null);
                    } catch (e) {
                        console.error("profile refresh after premium pay error:", e);
                    }

                    return;
                }

                toast.info("Платёж с привязанной карты обрабатывается...");

                setTimeout(async () => {
                    try {
                        const refreshed = await axios.get(`${apiUrl}/api/auth/profile`, {
                            headers: { Authorization: `Bearer ${token}` },
                        });

                        setProfile(refreshed.data);
                        setPaymentMethodId(refreshed.data.yookassaPaymentMethodId || null);

                        if (refreshed.data.subscriptionType === "premium") {
                            toast.success("Premium активирован");
                        } else {
                            toast.info("Платёж ещё обрабатывается");
                        }
                    } catch (e) {
                        console.error("profile refresh after premium processing error:", e);
                    }
                }, 2500);

                return;
            }

            /**
             * ✅ Обычный redirect, если карты нет.
             */
            if (!res.data.confirmationUrl) {
                toast.error("Ссылка на оплату не получена");
                return;
            }

            window.location.href = res.data.confirmationUrl;
        } catch (e) {
            console.error("handleBuyPremium error:", e);
            toast.error(e.response?.data?.error || "Ошибка при оплате Premium");
        }
    };


    const loadedProfileId = profile?.id;



    useEffect(() => {
        if (!loadedProfileId) {
            return;
        }

        const params =
            new URLSearchParams(
                window.location.search
            );

        const targetSection =
            params.get("section");

        /*
         * Если пришли именно из модалки
         * "добавьте автомобиль".
         */
        if (
            targetSection ===
            "verification"
        ) {
            setVehicleVerificationOpen(true);

            const timer =
                setTimeout(() => {
                    document
                        .getElementById(
                            "vehicle-verification-section"
                        )
                        ?.scrollIntoView({
                            behavior: "smooth",
                            block: "center",
                        });

                    /*
                     * Сразу убираем section,
                     * чтобы следующий вход
                     * в профиль был обычным.
                     */
                    params.delete("section");

                    const query =
                        params.toString();

                    window.history.replaceState(
                        {},
                        "",
                        `${window.location.pathname}${
                            query
                                ? `?${query}`
                                : ""
                        }`
                    );
                }, 300);

            return () =>
                clearTimeout(timer);
        }

        /*
         * Обычное открытие профиля:
         * всегда начинаем сверху.
         */
        window.scrollTo({
            top: 0,
            left: 0,
            behavior: "auto",
        });
    }, [loadedProfileId]);

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

    const handleUnbindTBankCard = async () => {
        if (
            !window.confirm(
                "Отвязать карту Т-Банка?"
            )
        ) {
            return;
        }

        try {
            const token =
                localStorage.getItem("authToken");

            await axios.post(
                `${apiUrl}/api/payment-cards/tbank/unbind`,
                {},
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            await fetchProfileData();

            toast.success("Карта Т-Банка отвязана");
        } catch (error) {
            toast.error(
                error.response?.data?.error ||
                "Не удалось отвязать карту"
            );

            await fetchProfileData();
        }
    };

    const handleAutoProviderChange = async (event) => {
        const provider = event.target.value;

        try {
            const token =
                localStorage.getItem("authToken");

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
        } catch (error) {
            toast.error(
                error.response?.data?.error ||
                "Не удалось сохранить настройку"
            );
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

    const handleUnbindCard = async () => {
        if (CARD_BIND_SCREENSHOT_MODE) {
            setDemoCardBound(false);
            setShowUnbindConfirm(false);
            toast.success("Карта удалена");
            return;
        }

        try {
            const token = localStorage.getItem("authToken");

            if (!token) {
                toast.error("Вы не авторизованы");
                return;
            }

            const res = await axios.post(
                `${apiUrl}/api/payments/card/unbind`,
                {},
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            if (res.data?.success) {
                toast.success("Карта успешно удалена");

                setPaymentMethodId(null);

                setProfile((prev) => ({
                    ...prev,
                    yookassaPaymentMethodId: null,
                    cardLastFour: null,
                    cardType: null,
                }));

                setShowUnbindConfirm(false);
            } else {
                toast.error(res.data?.error || "Ошибка при удалении карты");
            }
        } catch (e) {
            console.error("unbind error:", e);
            toast.error("Сервер не отвечает");
        }
    };

    const handleAgree = () => {
        setShowAgreement(false);

        if (pendingBindProvider === "tbank") {
            handleBindTBankCard();
        } else {
            handleBindCard();
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
                <div className="profile-header glass">
                    <div className="profile-header-top">
                        <div>
                            <h1 className="profile-title">Профиль</h1>
                            <p className="profile-subtitle">
                                Управление аккаунтом и оплатой
                            </p>

                            {profile && (
                                <div className="header-mini">
                                    <span className="header-mini-name">
                                        {profile.username}
                                    </span>
                                    <span className="header-mini-pill">
                                        ★ {profile.rating ? Number(profile.rating).toFixed(1) : "—"}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {profile && (
                        <div className="profile-identity">
                            <div className="identity-row">
                                <div className="avatar-block">
                                    {profile.avatar ? (
                                        <img
                                            src={`${apiUrl}${profile.avatar}`}
                                            alt="Аватар"
                                            className="profile-avatar"
                                        />
                                    ) : (
                                        <div className="profile-avatar profile-avatar-placeholder">
                                            {profile.username
                                                ? profile.username.charAt(0).toUpperCase()
                                                : "U"}
                                        </div>
                                    )}

                                    <label className="avatar-upload-btn">
                                        <input
                                            type="file"
                                            accept="image/*"
                                            style={{ display: "none" }}
                                            onChange={(e) =>
                                                handleAvatarUpload(e.target.files?.[0])
                                            }
                                        />
                                        <span>
                                            {avatarUploading
                                                ? "Загрузка..."
                                                : "Фото профиля"}
                                        </span>
                                    </label>
                                </div>

                                <div className="identity-main">
                                    <div className="identity-name">
                                        {profile.username}
                                    </div>

                                    <div className="identity-meta">
                                        <span className="identity-pill">
                                            ID: {profile.id}
                                        </span>

                                        <span className="identity-pill">
                                            Рейтинг: {renderRating(profile.rating)}
                                        </span>
                                    </div>
                                </div>

                                <div className="profile-quick-actions">
                                    <div className="profile-support-call-row">
    <span className="profile-support-call-label">
        Нужна помощь? Позвоните нам
    </span>

                                        <SupportPhoneLink showIcon />
                                    </div>
                                    <button
                                        type="button"
                                        className="profile-quick-action profile-quick-action-support"
                                        onClick={() => navigate("/support")}
                                    >
        <span className="profile-quick-action-icon">
            <FaHeadset />
        </span>

                                        <span className="profile-quick-action-content">
            <strong>Поддержка</strong>
            <small>Помощь и вопросы</small>
        </span>
                                    </button>

                                    <button
                                        type="button"
                                        className="profile-quick-action profile-quick-action-idea"
                                        onClick={openSuggestionModal}
                                    >
        <span className="profile-quick-action-icon">
            <FaLightbulb />
        </span>

                                        <span className="profile-quick-action-content">
            <strong>Предложить идею</strong>
            <small>Помогите улучшить CargoCamp</small>
        </span>
                                    </button>

                                    <button
                                        type="button"
                                        className="profile-quick-action profile-quick-action-disabled"
                                        disabled
                                        aria-disabled="true"
                                        title="Раздел достижений находится в разработке"
                                    >
        <span className="profile-quick-action-icon">
            <FaTrophy />
        </span>

                                        <span className="profile-quick-action-content">
            <strong>Достижения</strong>
            <small>Бонусы и активные навыки</small>
        </span>

                                        <span className="profile-coming-soon">
            Скоро
        </span>
                                    </button>
                                </div>

                            </div>
                        </div>
                    )}
                </div>

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
                        description="ЮKassa и Т-Банк"
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
                        onClick={
                            hasDebt
                                ? () => {
                                    debtSectionRef.current?.scrollIntoView({
                                        behavior: "smooth",
                                        block: "center",
                                    });
                                }
                                : undefined
                        }
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
                </SectionCard>

                <div className="profile-card profile-location-card glass">
                    <div className="card-head">
                        <div>
                            <h2 className="card-title">Местоположение</h2>
                            <p className="card-subtitle">
                                Сохраняется для автоподстановки в заказах и
                                фильтрации
                            </p>
                        </div>
                    </div>

                    <div className="loc-row">
                        <div className="loc-input-wrap">
                            <input
                                className="loc-input"
                                value={locationDraft}
                                onChange={(e) => {
                                    const v = e.target.value;

                                    setLocationDraft(v);
                                    setPickedCoords(null);
                                    setAddressQuery(v);
                                }}
                                placeholder="Введите район / улицу / адрес"
                                autoComplete="off"
                            />

                            {addressSuggestions.length > 0 && (
                                <ul className="loc-suggestions">
                                    {addressSuggestions.map((s, i) => (
                                        <li
                                            key={`${s.label}-${i}`}
                                            onClick={() => {
                                                setLocationDraft(s.label);
                                                setPickedCoords({
                                                    lat: s.lat,
                                                    lng: s.lng,
                                                });
                                                setAddressSuggestions([]);
                                                setAddressQuery("");
                                            }}
                                        >
                                            {s.label}
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>

                        <button
                            className="btn btn-primary"
                            disabled={locLoading}
                            onClick={() =>
                                saveLocation({
                                    address: locationDraft,
                                    lat: pickedCoords?.lat || null,
                                    lng: pickedCoords?.lng || null,
                                    source: "manual",
                                })
                            }
                        >
                            Сохранить
                        </button>
                    </div>

                    <div className="grid-2 profile-mt-10">
                        <button
                            className="btn btn-ghost"
                            disabled={locLoading}
                            onClick={detectGps}
                        >
                            Определить по GPS
                        </button>

                        <button
                            className="btn btn-ghost"
                            onClick={() => setShowMapModal(true)}
                        >
                            Выбрать на карте
                        </button>
                    </div>

                    {gpsCandidate && (
                        <div className="gps-confirm">
                            <div className="gps-title">
                                Мы определили координаты. Верно?
                            </div>

                            <div className="gps-sub">
                                {gpsCandidate.address}
                            </div>

                            <div className="gps-actions">
                                <button
                                    className="btn btn-primary"
                                    onClick={() =>
                                        saveLocation({
                                            address:
                                                locationDraft ||
                                                gpsCandidate.address,
                                            lat: gpsCandidate.lat,
                                            lng: gpsCandidate.lng,
                                            source: "gps",
                                        }).then(() => setGpsCandidate(null))
                                    }
                                >
                                    Да, сохранить
                                </button>

                                <button
                                    className="btn btn-ghost"
                                    onClick={() => setGpsCandidate(null)}
                                >
                                    Нет, введу вручную
                                </button>
                            </div>
                        </div>
                    )}

                    <YandexMapModal
                        isOpen={showMapModal}
                        onClose={() => setShowMapModal(false)}
                        initialLat={profile?.locationLat}
                        initialLng={profile?.locationLng}
                        showOrders={false}
                        onPick={(picked) => {
                            setLocationDraft(picked.address);
                            setAddressSuggestions([]);
                            setAddressQuery("");

                            saveLocation({
                                address: picked.address,
                                lat: picked.lat,
                                lng: picked.lng,
                                source: "map",
                            });

                            setShowMapModal(false);
                        }}
                    />

                    {profile?.locationSource && (
                        <div className="loc-meta">
                            <span className="identity-pill">
                                Источник: {profile.locationSource}
                            </span>
                        </div>
                    )}

                    {locError && <div className="loc-error">{locError}</div>}
                </div>

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
                        {/* =========================
            АВТОМОБИЛЬ
        ========================= */}

                        <div
                            id="vehicle-verification-section"
                            className="verification-panel verification-panel-vehicle"
                        >
                            <button
                                type="button"
                                className="verification-panel-head"
                                onClick={() =>
                                    setVehicleVerificationOpen(
                                        (prev) => !prev
                                    )
                                }
                                aria-expanded={
                                    vehicleVerificationOpen
                                }
                            >
                                <div className="verification-panel-head-main">
                                    <div className="verification-panel-icon verification-panel-icon-car">
                                        <CarFront size={22} aria-hidden="true" />
                                    </div>

                                    <div className="verification-panel-heading">
                                        <div className="verification-panel-title">
                                            Автомобиль для такси
                                        </div>

                                        <div className="verification-panel-subtitle">
                                            {profile?.vehicleBrand ||
                                            profile?.vehicleModel ||
                                            profile?.vehiclePlate ? (
                                                <>
                                                    {[
                                                        profile
                                                            ?.vehicleColor,
                                                        profile
                                                            ?.vehicleBrand,
                                                        profile
                                                            ?.vehicleModel,
                                                    ]
                                                        .filter(Boolean)
                                                        .join(" ")}

                                                    {profile
                                                        ?.vehiclePlate
                                                        ? ` · ${profile.vehiclePlate}`
                                                        : ""}
                                                </>
                                            ) : (
                                                "Добавьте автомобиль, чтобы принимать заказы такси"
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="verification-panel-head-side">
                    <span
                        className={`vehicle-status vehicle-status-${
                            profile?.vehicleVerificationStatus ||
                            "none"
                        }`}
                    >
                        {
                            vehicleVerificationStatusText
                        }
                    </span>

                                    <span
                                        className={`verification-chevron ${
                                            vehicleVerificationOpen
                                                ? "open"
                                                : ""
                                        }`}
                                    >
<ChevronRight size={18} aria-hidden="true" />
                                    </span>
                                </div>
                            </button>

                            {vehicleVerificationOpen && (
                                <div className="verification-panel-content">
                                    <div className="vehicle-verification-intro">
                                        <strong>
                                            Данные автомобиля
                                        </strong>

                                        <span>
                            Для курьерских заказов автомобиль
                            не требуется. Для заказов такси
                            автомобиль должен быть подтверждён
                            администратором.
                        </span>
                                    </div>

                                    {profile?.vehicleVerificationStatus ===
                                        "rejected" &&
                                        profile?.vehicleVerificationNote && (
                                            <div className="vehicle-rejected-note">
                                                <strong>
                                                    Причина отказа:
                                                </strong>{" "}
                                                {
                                                    profile
                                                        .vehicleVerificationNote
                                                }
                                            </div>
                                        )}

                                    {profile?.vehicleVerificationStatus ===
                                        "pending" && (
                                            <div className="vehicle-pending-note">
                                                Данные автомобиля отправлены
                                                администратору. До подтверждения
                                                принимать заказы такси нельзя.
                                            </div>
                                        )}

                                    {profile?.vehicleVerificationStatus ===
                                        "verified" && (
                                            <div className="vehicle-verified-note">
                                                <strong>
                                                    <Check size={16} aria-hidden="true" />{" "}
                                                    Автомобиль подтверждён
                                                </strong>

                                                <span>
                                Вы можете принимать заказы
                                такси. Если изменить данные,
                                потребуется повторная проверка.
                            </span>
                                            </div>
                                        )}

                                    <div className="vehicle-form-grid">
                                        <label className="vehicle-field">
                                            <span>Марка *</span>

                                            <input
                                                type="text"
                                                value={
                                                    vehicleForm.vehicleBrand
                                                }
                                                onChange={(e) =>
                                                    setVehicleForm(
                                                        (prev) => ({
                                                            ...prev,
                                                            vehicleBrand:
                                                            e.target
                                                                .value,
                                                        })
                                                    )
                                                }
                                                placeholder="Toyota"
                                                maxLength={100}
                                            />
                                        </label>

                                        <label className="vehicle-field">
                                            <span>Модель *</span>

                                            <input
                                                type="text"
                                                value={
                                                    vehicleForm.vehicleModel
                                                }
                                                onChange={(e) =>
                                                    setVehicleForm(
                                                        (prev) => ({
                                                            ...prev,
                                                            vehicleModel:
                                                            e.target
                                                                .value,
                                                        })
                                                    )
                                                }
                                                placeholder="Camry"
                                                maxLength={100}
                                            />
                                        </label>

                                        <label className="vehicle-field">
                                            <span>Цвет *</span>

                                            <input
                                                type="text"
                                                value={
                                                    vehicleForm.vehicleColor
                                                }
                                                onChange={(e) =>
                                                    setVehicleForm(
                                                        (prev) => ({
                                                            ...prev,
                                                            vehicleColor:
                                                            e.target
                                                                .value,
                                                        })
                                                    )
                                                }
                                                placeholder="Белый"
                                                maxLength={100}
                                            />
                                        </label>

                                        <label className="vehicle-field">
                                            <span>Госномер *</span>

                                            <input
                                                type="text"
                                                value={
                                                    vehicleForm.vehiclePlate
                                                }
                                                onChange={(e) =>
                                                    setVehicleForm(
                                                        (prev) => ({
                                                            ...prev,
                                                            vehiclePlate:
                                                                e.target.value.toUpperCase(),
                                                        })
                                                    )
                                                }
                                                placeholder="А123ВС82"
                                                maxLength={30}
                                            />
                                        </label>

                                        <label className="vehicle-field">
                            <span>
                                Год выпуска
                            </span>

                                            <input
                                                type="number"
                                                value={
                                                    vehicleForm.vehicleYear
                                                }
                                                onChange={(e) =>
                                                    setVehicleForm(
                                                        (prev) => ({
                                                            ...prev,
                                                            vehicleYear:
                                                            e.target
                                                                .value,
                                                        })
                                                    )
                                                }
                                                placeholder="2020"
                                                min="1950"
                                                max={
                                                    new Date().getFullYear() +
                                                    1
                                                }
                                            />
                                        </label>
                                    </div>

                                    <div className="vehicle-photo-block">
                                        <div className="vehicle-photo-head">
                                            <div>
                                                <strong>
                                                    Фото автомобиля
                                                </strong>

                                                <div className="vehicle-photo-hint">
                                                    Загрузите фотографию,
                                                    на которой хорошо видны
                                                    автомобиль и государственный
                                                    номер.
                                                </div>
                                            </div>
                                        </div>

                                        {profile?.vehiclePhoto && (
                                            <div className="vehicle-photo-preview">
                                                <img
                                                    src={buildFileUrl(
                                                        profile.vehiclePhoto
                                                    )}
                                                    alt="Автомобиль"
                                                />
                                            </div>
                                        )}

                                        <label className="upload-glass vehicle-photo-upload">
                                            <input
                                                type="file"
                                                accept="image/*"
                                                style={{
                                                    display: "none",
                                                }}
                                                disabled={
                                                    vehiclePhotoUploading
                                                }
                                                onChange={(e) => {
                                                    const file =
                                                        e.target.files?.[0];

                                                    uploadVehiclePhoto(
                                                        file
                                                    );

                                                    e.target.value = "";
                                                }}
                                            />

                                            <span>
                                {vehiclePhotoUploading
                                    ? "Загрузка..."
                                    : profile?.vehiclePhoto
                                        ? "Изменить фото"
                                        : "Загрузить фото автомобиля"}
                            </span>
                                        </label>
                                    </div>

                                    <div className="vehicle-verification-actions">
                                        <button
                                            type="button"
                                            className="btn btn-primary"
                                            disabled={
                                                vehicleSaving ||
                                                vehiclePhotoUploading
                                            }
                                            onClick={saveVehicle}
                                        >
                                            {vehicleSaving
                                                ? "Сохраняем..."
                                                : profile?.vehicleVerificationStatus ===
                                                "verified"
                                                    ? "Сохранить изменения"
                                                    : "Отправить на проверку"}
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Социальные льготы */}
                        <UserBenefitsSection
                            userId={profile?.id}
                            embedded
                        />

                    </div>
                </div>

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
                title="Банковские карты"
                description="Управление сохранёнными картами и автоматической оплатой комиссии"
                busy={cardBinding}
            >
                <div className="cc-profile-sheet-stack">

                    <div className="cc-profile-payment-card">

                        <div className="cc-profile-payment-card__head">
                            <div className="cc-profile-payment-icon">
                                <CreditCard size={24} />
                            </div>

                            <div className="cc-profile-payment-card__info">
                                <strong>ЮKassa</strong>

                                <span>
                        {isCardBound
                            ? "Карта привязана"
                            : "Карта не привязана"}
                    </span>
                            </div>
                        </div>

                        {isCardBound ? (
                            <>
                                <div className="cc-profile-card-mask">
                                    {cardTypeView || "Банковская карта"}
                                    {" "}
                                    •••• {cardLastFourView}
                                </div>

                                <Button
                                    variant="outline"
                                    fullWidth
                                    onClick={() => {
                                        closeProfileSheet();
                                        setShowUnbindConfirm(true);
                                    }}
                                >
                                    Отвязать
                                </Button>
                            </>
                        ) : (
                            <Button
                                fullWidth
                                loading={cardBinding}
                                onClick={() => {
                                    if (CARD_BIND_SCREENSHOT_MODE) {
                                        handleBindCard();
                                        return;
                                    }

                                    closeProfileSheet();

                                    setPendingBindProvider("yookassa");

                                    setShowAgreement(true);
                                }}
                            >
                                + Привязать карту
                            </Button>
                        )}

                        {CARD_BIND_SCREENSHOT_MODE && (
                            <p className="cc-profile-note">
                                Демо-режим для скриншотов:
                                операции выполняются без реального
                                запроса в ЮKassa.
                            </p>
                        )}
                    </div>

                    <div className="cc-profile-payment-card">

                        <div className="cc-profile-payment-card__head">
                            <div className="cc-profile-payment-icon cc-profile-payment-icon--tbank">
                                <CreditCard size={24} />
                            </div>

                            <div className="cc-profile-payment-card__info">
                                <strong>Т-Банк</strong>

                                <span>
                        {profile?.tbankCardBound
                            ? "Карта привязана"
                            : "Карта не привязана"}
                    </span>
                            </div>
                        </div>

                        {profile?.tbankCardBound ? (
                            <>
                                <div className="cc-profile-card-mask">
                                    {profile.tbankCardMask ||
                                        "Карта Т-Банка"}
                                </div>

                                <Button
                                    variant="outline"
                                    fullWidth
                                    onClick={handleUnbindTBankCard}
                                >
                                    Отвязать
                                </Button>
                            </>
                        ) : (
                            <Button
                                fullWidth
                                loading={cardBinding}
                                onClick={() => {
                                    closeProfileSheet();

                                    setPendingBindProvider("tbank");

                                    setShowAgreement(true);
                                }}
                            >
                                + Привязать через Т-Банк
                            </Button>
                        )}
                    </div>

                    <div className="cc-profile-payment-card">
                        <h3 className="cc-profile-section-title">
                            Автоматическое списание комиссии
                        </h3>

                        <p className="cc-profile-note">
                            Выберите банк, через который CargoCamp
                            сможет списывать комиссию за выполненные
                            заказы. Другой банк автоматически
                            использоваться не будет.
                        </p>

                        <select
                            className="cc-profile-select"
                            aria-label="Автоматическое списание комиссии"
                            value={
                                profile?.autoCommissionProvider ||
                                "none"
                            }
                            disabled={cardBinding}
                            onChange={handleAutoProviderChange}
                        >
                            <option value="none">
                                Не списывать автоматически
                            </option>

                            <option
                                value="yookassa"
                                disabled={!isCardBound}
                            >
                                ЮKassa
                            </option>

                            <option
                                value="tbank"
                                disabled={!profile?.tbankCardBound}
                            >
                                Т-Банк
                            </option>
                        </select>
                    </div>

                </div>
            </BottomSheet>

            <BottomSheet
                open={activeProfileSheet === "premium"}
                onClose={closeProfileSheet}
                title="CargoCamp Premium"
                description={subscriptionLabel}
            >
                <div className="cc-profile-sheet-stack">

                    <div className="cc-profile-premium-intro">
                        <div className="cc-profile-premium-icon">
                            <Sparkles size={28} />
                        </div>

                        <h3>
                            Работайте без комиссии
                        </h3>

                        <p>
                            Premium для исполнителей —
                            работа без комиссии по условиям подписки.
                        </p>
                    </div>

                    <PaymentProviderSelect
                        title="Способ оплаты Premium"
                        selectedProvider={selectedPremiumProvider}
                        onSelect={setSelectedPremiumProvider}
                        disabled={loading}
                    />

                    <div className="cc-profile-premium-plan">
                        <div>
                            <div className="cc-profile-premium-plan__duration">
                                Premium на 7 дней
                            </div>

                            <div className="cc-profile-premium-plan__price">
                                2 500 ₽
                            </div>
                        </div>

                        <Button
                            fullWidth
                            onClick={() => handleBuyPremium("7d")}
                        >
                            Купить на 7 дней
                        </Button>
                    </div>

                    <div className="cc-profile-premium-plan">
                        <div>
                            <div className="cc-profile-premium-plan__duration">
                                Premium на 30 дней
                            </div>

                            <div className="cc-profile-premium-plan__price">
                                9 000 ₽
                            </div>
                        </div>

                        <Button
                            fullWidth
                            onClick={() => handleBuyPremium("30d")}
                        >
                            Купить на 30 дней
                        </Button>
                    </div>

                </div>
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

            {showAgreement && (
                <AgreementModal
                    isOpen={showAgreement}
                    onClose={() => setShowAgreement(false)}
                    onAgree={handleAgree}
                    onCancel={() => setShowAgreement(false)}
                />
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

            {showUnbindConfirm && (
                <div
                    className="modal-overlay"
                    onClick={() => setShowUnbindConfirm(false)}
                >
                    <div
                        className="modal-window modal-window-compact"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <h3>Удалить карту?</h3>

                        <div className="modal-content">
                            <p>
                                Вы уверены, что хотите отвязать сохранённую
                                карту{" "}
                                <strong>
                                    {cardTypeView} •••• {cardLastFourView}
                                </strong>
                                ?
                            </p>

                            <p className="warning">
                                После удаления карта больше не будет
                                использоваться для быстрых платежей.
                            </p>

                            <div className="modal-actions-row">
                                <button
                                    className="btn btn-ghost"
                                    onClick={() => setShowUnbindConfirm(false)}
                                >
                                    Отмена
                                </button>

                                <button
                                    className="btn btn-danger"
                                    onClick={handleUnbindCard}
                                >
                                    Удалить карту
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProfilePage;