import { toast } from "react-toastify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../utils/authContext";
import axios from "axios";

import "../styles/ProfilePage.css";

import AgreementModal from "../components/AgreementModal";
import YandexMapModal from "../components/YandexMapModal";
import PaymentProviderSelect from "../components/PaymentProviderSelect";

const apiUrl = process.env.REACT_APP_API_URL;

// Включать только если нужны демо-скрины привязки карты без реальной ЮKassa
const CARD_BIND_SCREENSHOT_MODE = false;

function looksLikeCoordsString(v) {
    if (!v) return false;

    const s = String(v).trim();

    return (
        s.startsWith("Координаты:") ||
        /^\d{1,3}\.\d+,\s*\d{1,3}\.\d+$/.test(s)
    );
}

async function reverseGeocodeYandex({ lat, lng, apiKey }) {
    if (!apiKey) throw new Error("No Yandex API key");

    const url = `https://geocode-maps.yandex.ru/1.x/?apikey=${apiKey}&geocode=${lng},${lat}&format=json&results=1&kind=house`;

    const r = await fetch(url);
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
    const { logout, isAuthenticated } = useAuth();

    const YM_KEY = process.env.REACT_APP_YANDEX_API_KEY;

    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [showVerificationModal, setShowVerificationModal] = useState(false);
    const [showAgreement, setShowAgreement] = useState(false);
    const [showUnbindConfirm, setShowUnbindConfirm] = useState(false);

    const [paymentMethodId, setPaymentMethodId] = useState(null);

    const [hasDebt, setHasDebt] = useState(false);
    const [debtAmount, setDebtAmount] = useState(0);

    const [locationDraft, setLocationDraft] = useState("");
    const [locLoading, setLocLoading] = useState(false);
    const [locError, setLocError] = useState(null);
    const [gpsCandidate, setGpsCandidate] = useState(null);
    const [showMapModal, setShowMapModal] = useState(false);
    const [pickedCoords, setPickedCoords] = useState(null);

    const [addressSuggestions, setAddressSuggestions] = useState([]);
    const [addressQuery, setAddressQuery] = useState("");

    const [avatarUploading, setAvatarUploading] = useState(false);

    const [categories, setCategories] = useState([]);
    const [categoryPick, setCategoryPick] = useState([]);
    const [catSaving, setCatSaving] = useState(false);

    const [selectedPremiumProvider, setSelectedPremiumProvider] = useState("yookassa");
    const [selectedDebtProvider, setSelectedDebtProvider] = useState("yookassa");

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

    const verificationText = useMemo(() => {
        if (!profile) return "";

        if (profile.userStatus === "pensioner") return "Пенсионер";
        if (profile.userStatus === "verified") return "Пройдена";

        return "Не пройдена";
    }, [profile]);

    const sortedCategories = useMemo(() => {
        return [...categories].sort((a, b) => {
            const ap = a.id === 12 || a.id === 13 ? 0 : 1;
            const bp = b.id === 12 || b.id === 13 ? 0 : 1;

            if (ap !== bp) return ap - bp;

            return String(a.name).localeCompare(String(b.name), "ru");
        });
    }, [categories]);

    const visibleDocuments = Array.isArray(profile?.documentPhotos)
        ? profile.documentPhotos.slice(0, 6)
        : [];

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

        const response = await axios.get(`${apiUrl}/api/auth/profile`, {
            headers: { Authorization: `Bearer ${token}` },
        });

        setProfile(response.data);
        setPaymentMethodId(response.data.yookassaPaymentMethodId || null);

        return response.data;
    };

    const loadDebtStatus = async () => {
        const token = localStorage.getItem("authToken");

        if (!token) return;

        try {
            const response = await axios.get(`${apiUrl}/api/orders/me/status`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            const debt = response.data.debt || 0;

            setDebtAmount(debt);
            setHasDebt(debt > 0);
        } catch (e) {
            console.error("Ошибка проверки долга:", e);
        }
    };

    const fetchAddressSuggestions = async (query) => {
        if (!query || query.length < 3) {
            setAddressSuggestions([]);
            return;
        }

        if (!YM_KEY) {
            setAddressSuggestions([]);
            return;
        }

        try {
            const r = await fetch(
                `https://geocode-maps.yandex.ru/1.x/?apikey=${YM_KEY}&geocode=${encodeURIComponent(query)}&format=json&results=6`
            );

            const data = await r.json();

            const items =
                data?.response?.GeoObjectCollection?.featureMember?.map((f) => {
                    const geo = f.GeoObject;
                    const pos = geo.Point.pos.split(" ").map(Number);

                    return {
                        label: geo.metaDataProperty.GeocoderMetaData.text,
                        lat: pos[1],
                        lng: pos[0],
                    };
                }) || [];

            setAddressSuggestions(items);
        } catch (e) {
            console.error("address suggest error", e);
            setAddressSuggestions([]);
        }
    };

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
        const params = new URLSearchParams(window.location.search);

        const shouldRefresh =
            params.get("bindReturn") === "1" ||
            params.get("debtReturn") === "1" ||
            params.get("premiumReturn") === "1";

        if (!shouldRefresh) return;

        const timer = setTimeout(async () => {
            try {
                await fetchProfileData();
                await loadDebtStatus();

                window.history.replaceState({}, "", window.location.pathname);
            } catch (e) {
                console.error("refresh after payment return error:", e);
                window.location.reload();
            }
        }, 1800);

        return () => clearTimeout(timer);

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

    const handleAutoUpload = async (files) => {
        const token = localStorage.getItem("authToken");

        if (!token) {
            toast.error("Вы не авторизованы");
            return;
        }

        if (!files || !files.length) return;

        const formData = new FormData();

        for (let file of files) {
            formData.append("documents", file);
        }

        try {
            await axios.post(`${apiUrl}/api/auth/upload-documents`, formData, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "multipart/form-data",
                },
            });

            toast.success("Документы успешно загружены");
            await fetchProfileData();
        } catch (error) {
            console.error("Ошибка загрузки документов:", error);
            toast.error("Ошибка загрузки документов");
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

        setLocLoading(true);
        setLocError(null);

        try {
            const res = await axios.post(
                `${apiUrl}/api/auth/location/me`,
                { address, lat, lng, source },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            toast.success("Местоположение сохранено");

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

    const detectGps = () => {
        if (!navigator.geolocation) {
            toast.error("GPS недоступен в браузере");
            return;
        }

        setLocLoading(true);
        setLocError(null);

        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;

                try {
                    const addr = await reverseGeocodeYandex({
                        lat,
                        lng,
                        apiKey: YM_KEY,
                    });

                    if (!addr) {
                        setLocError(
                            "Не удалось распознать адрес по GPS. Введите адрес вручную или выберите на карте."
                        );
                        setLocLoading(false);
                        return;
                    }

                    setLocationDraft(addr);
                    setGpsCandidate({ lat, lng, address: addr });
                } catch (e) {
                    console.error("reverse geocode error:", e);
                    setLocError(
                        "Не удалось распознать адрес по GPS. Введите адрес вручную или выберите на карте."
                    );
                } finally {
                    setLocLoading(false);
                }
            },
            (err) => {
                console.error(err);
                setLocError(
                    "Не удалось определить местоположение по GPS. Введите адрес вручную или выберите на карте."
                );
                setLocLoading(false);
            },
            {
                enableHighAccuracy: true,
                timeout: 12000,
                maximumAge: 0,
            }
        );
    };

    const handlePayDebt = async () => {
        try {
            const token = localStorage.getItem("authToken");

            if (!token) {
                toast.error("Вы не авторизованы");
                return;
            }

            if (!debtAmount || debtAmount <= 0) {
                toast.info("Долгов нет");
                return;
            }

            const endpoint =
                selectedDebtProvider === "tbank"
                    ? "/api/tbank-payments/debt/create"
                    : "/api/payments/debt/create";

            const res = await axios.post(
                `${apiUrl}${endpoint}`,
                {
                    returnPath: "/profile?debtReturn=1",
                },
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

            if (res.data.noDebt) {
                toast.info("Долгов нет");
                return;
            }

            if (res.data.paidBySavedCard) {
                toast.info("Пробуем списать с привязанной карты...");

                setTimeout(async () => {
                    await loadDebtStatus();

                    try {
                        const refreshed = await axios.get(
                            `${apiUrl}/api/auth/profile`,
                            {
                                headers: { Authorization: `Bearer ${token}` },
                            }
                        );

                        setProfile(refreshed.data);
                        setPaymentMethodId(
                            refreshed.data.yookassaPaymentMethodId || null
                        );
                    } catch (e) {
                        console.error("profile refresh after debt pay error:", e);
                    }
                }, 2500);

                return;
            }

            if (!res.data.confirmationUrl) {
                toast.error("Ссылка на оплату не получена");
                return;
            }

            window.location.href = res.data.confirmationUrl;
        } catch (e) {
            console.error("handlePayDebt error:", e);
            toast.error(
                e.response?.data?.error || "Ошибка при оплате задолженности"
            );
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

        try {
            const token = localStorage.getItem("authToken");

            if (!token) {
                toast.error("Вы не авторизованы");
                return;
            }

            const res = await axios.post(
                `${apiUrl}/api/payments/card/bind/create`,
                {},
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            if (!res.data?.success) {
                toast.error(res.data?.error || "Ошибка привязки карты");
                return;
            }

            if (!res.data.confirmationUrl) {
                toast.error("Ссылка на привязку карты не получена");
                return;
            }

            window.location.href = res.data.confirmationUrl;
        } catch (e) {
            console.error("bind card error:", e);
            toast.error(e.response?.data?.error || "Ошибка привязки карты");
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
        handleBindCard();
    };

    const handleLogout = () => {
        logout();
        navigate("/login");
    };

    const handleMyComplaints = () => {
        if (profile) {
            navigate(`/complaints/${profile.id}`);
        }
    };

    const handleOrderHistory = () => {
        if (profile) {
            navigate(`/orders-history/${profile.id}`);
        }
    };

    if (loading) {
        return (
            <div className="profile-loading">
                Загрузка данных профиля...
            </div>
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
        <div className="profile-page">
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
                            </div>
                        </div>
                    )}
                </div>

                <div className="profile-card glass">
                    <div className="card-head">
                        <div>
                            <h2 className="card-title">Платежи</h2>
                            <p className="card-subtitle">
                                Карта, комиссия и задолженность
                            </p>
                        </div>
                    </div>

                    {isCardBound ? (
                        <div className="card-row">
                            <div className="card-row-text">
                                <div className="card-strong">Карта привязана</div>
                                <div className="card-muted">
                                    {cardTypeView} •••• {cardLastFourView}
                                </div>
                            </div>

                            <button
                                className="btn btn-ghost-danger"
                                onClick={() => setShowUnbindConfirm(true)}
                            >
                                Удалить
                            </button>
                        </div>
                    ) : (
                        <button
                            className="btn btn-primary"
                            onClick={
                                CARD_BIND_SCREENSHOT_MODE
                                    ? handleBindCard
                                    : () => setShowAgreement(true)
                            }
                        >
                            Привязать карту
                        </button>
                    )}

                    {CARD_BIND_SCREENSHOT_MODE && (
                        <div className="card-demo-note">
                            Демо-режим для скриншотов: интерфейс
                            привязки/отвязки показывается без реального запроса
                            в ЮKassa.
                        </div>
                    )}

                    {hasDebt && (
                        <div className="alert alert-danger">
                            <div>
                                <div className="alert-title">
                                    Задолженность по комиссии
                                </div>
                                <div className="alert-text">
                                    {(debtAmount / 100).toFixed(2)} ₽
                                </div>
                            </div>

                            <div className="debt-provider-wrap">
                                <PaymentProviderSelect
                                    selectedProvider={selectedDebtProvider}
                                    onSelect={setSelectedDebtProvider}
                                    disabled={loading}
                                />
                            </div>

                            <button
                                className="btn btn-danger"
                                onClick={handlePayDebt}
                            >
                                Оплатить
                            </button>
                        </div>
                    )}
                </div>

                <div className="profile-card glass">
                    <div className="card-head">
                        <div>
                            <h2 className="card-title">Premium</h2>
                            <p className="card-subtitle">{subscriptionLabel}</p>
                        </div>
                    </div>

                    <div className="premium-provider-block">
                        <PaymentProviderSelect
                            selectedProvider={selectedPremiumProvider}
                            onSelect={setSelectedPremiumProvider}
                            disabled={loading}
                        />
                    </div>

                    <div className="grid-2">
                        <button
                            className="btn btn-primary"
                            onClick={() => handleBuyPremium("7d")}
                        >
                            Купить на 7 дней
                        </button>

                        <button
                            className="btn btn-primary"
                            onClick={() => handleBuyPremium("30d")}
                        >
                            Купить на 30 дней
                        </button>
                    </div>
                </div>

                <div className="profile-card glass">
                    <div className="card-head">
                        <div>
                            <h2 className="card-title">Верификация</h2>
                            <p
                                className={`card-subtitle status-${
                                    profile?.userStatus || "unknown"
                                }`}
                            >
                                {verificationText}
                            </p>
                        </div>

                        <button
                            className="profile-chip"
                            onClick={() => setShowVerificationModal(true)}
                        >
                            Подробнее
                        </button>
                    </div>

                    <label className="upload-glass">
                        <input
                            type="file"
                            multiple
                            accept="image/*,.pdf"
                            onChange={(e) => handleAutoUpload(e.target.files)}
                            style={{ display: "none" }}
                        />
                        <span>Загрузить документы</span>
                    </label>

                    {Array.isArray(profile?.documentPhotos) &&
                    profile.documentPhotos.length > 0 ? (
                        <div className="docs-block">
                            <div className="docs-head">
                                <div className="docs-title">
                                    Загруженные документы
                                </div>

                                <div className="docs-count">
                                    {profile.documentPhotos.length} шт.
                                </div>
                            </div>

                            <div className="docs-grid">
                                {visibleDocuments.map((p, idx) => {
                                    const isPdf = String(p)
                                        .toLowerCase()
                                        .endsWith(".pdf");

                                    const url = p.startsWith("http")
                                        ? p
                                        : `${apiUrl}${p}`;

                                    return (
                                        <a
                                            key={`${p}-${idx}`}
                                            className="doc-tile"
                                            href={url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            title="Открыть"
                                        >
                                            {isPdf ? (
                                                <div className="doc-pdf">
                                                    <div className="doc-pdf-badge">
                                                        PDF
                                                    </div>
                                                    <div className="doc-name">
                                                        Документ {idx + 1}
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    <img
                                                        className="doc-img"
                                                        src={url}
                                                        alt={`Документ ${idx + 1}`}
                                                        loading="lazy"
                                                    />
                                                    <div className="doc-name">
                                                        Фото {idx + 1}
                                                    </div>
                                                </>
                                            )}
                                        </a>
                                    );
                                })}
                            </div>

                            {profile.documentPhotos.length >
                                visibleDocuments.length && (
                                    <div className="docs-empty">
                                        Показаны первые {visibleDocuments.length} из{" "}
                                        {profile.documentPhotos.length}
                                    </div>
                                )}
                        </div>
                    ) : (
                        <div className="docs-empty">
                            Документы ещё не загружены
                        </div>
                    )}
                </div>

                <div className="profile-card glass">
                    <div className="card-head">
                        <div>
                            <h2 className="card-title">Профессии</h2>
                            <p className="card-subtitle">
                                По ним будут фильтроваться заказы
                            </p>
                        </div>
                    </div>

                    <div className="cat-grid">
                        {sortedCategories.map((c) => {
                            const active = categoryPick.includes(c.id);

                            return (
                                <button
                                    key={c.id}
                                    type="button"
                                    className={`cat-pill ${active ? "active" : ""}`}
                                    onClick={() => {
                                        setCategoryPick((prev) =>
                                            prev.includes(c.id)
                                                ? prev.filter((x) => x !== c.id)
                                                : [...prev, c.id]
                                        );
                                    }}
                                >
                                    {c.name}
                                </button>
                            );
                        })}
                    </div>

                    <div className="grid-2 profile-mt-12">
                        <button
                            className="btn btn-primary"
                            disabled={catSaving}
                            onClick={savePreferredCategories}
                        >
                            {catSaving ? "Сохранение..." : "Сохранить"}
                        </button>

                        <button
                            className="btn btn-ghost"
                            type="button"
                            onClick={() => setCategoryPick([])}
                            disabled={catSaving}
                        >
                            Сбросить
                        </button>
                    </div>
                </div>

                <div className="profile-card glass">
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
                        orders={[]}
                        onPick={(picked) => {
                            setLocationDraft(picked.address);

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
                                Верификация необходима для повышения доверия к
                                вам как к пользователю платформы. Мы просим
                                загрузить скан паспорта или другого документа,
                                удостоверяющего личность, чтобы подтвердить,
                                что вы — реальный человек.
                            </p>

                            <p>
                                <strong>Для пенсионеров:</strong> если вы
                                подтвердите пенсионный статус, исполнители будут
                                видеть отметку и получать{" "}
                                <strong>скидку на комиссию</strong>.
                            </p>

                            <p>
                                🔒 Все документы обрабатываются вручную и
                                хранятся в зашифрованном виде.
                            </p>

                            <p className="warning">
                                ⚠️ Попытка загрузки поддельных документов
                                приведет к ограничению или блокировке аккаунта.
                            </p>

                            <button
                                className="btn btn-ghost"
                                onClick={() => setShowVerificationModal(false)}
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