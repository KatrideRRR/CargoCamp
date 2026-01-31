import { toast } from "react-toastify";
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../utils/authContext";
import axios from "axios";
import "../styles/ProfilePage.css";
import AgreementModal from "../components/AgreementModal";
import YandexMapModal from "../components/YandexMapModal";

const apiUrl = process.env.REACT_APP_API_URL;

function looksLikeCoordsString(v) {
    if (!v) return false;
    const s = String(v).trim();
    return s.startsWith("Координаты:") || /^\d{1,3}\.\d+,\s*\d{1,3}\.\d+$/.test(s);
}

// reverse geocode через Yandex Geocoder: geocode=lng,lat
async function reverseGeocodeYandex({ lat, lng, apiKey }) {
    if (!apiKey) throw new Error("No Yandex API key");

    const url = `https://geocode-maps.yandex.ru/1.x/?apikey=${apiKey}&geocode=${lng},${lat}&format=json&results=1&kind=house`;
    const r = await fetch(url);
    const data = await r.json();

    const first = data?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
    const text =
        first?.metaDataProperty?.GeocoderMetaData?.text ||
        first?.name ||
        null;

    return text;
}

const ProfilePage = () => {
    const [showVerificationModal, setShowVerificationModal] = useState(false);
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [paymentMethodId, setPaymentMethodId] = useState(null);
    const [showAgreement, setShowAgreement] = useState(false);
    const [hasDebt, setHasDebt] = useState(false);
    const [debtAmount, setDebtAmount] = useState(0);
    const [locationDraft, setLocationDraft] = useState("");
    const [locLoading, setLocLoading] = useState(false);
    const [locError, setLocError] = useState(null);
    const [gpsCandidate, setGpsCandidate] = useState(null); // {lat,lng,address}
    const [showMapModal, setShowMapModal] = useState(false);
    const [addressSuggestions, setAddressSuggestions] = useState([]);
    const [pickedCoords, setPickedCoords] = useState(null); // {lat, lng}

    const [categories, setCategories] = useState([]);
    const [categoryPick, setCategoryPick] = useState([]); // массив id
    const [catSaving, setCatSaving] = useState(false);

    const navigate = useNavigate();
    const { logout, isAuthenticated } = useAuth();

    const YM_KEY = process.env.REACT_APP_YANDEX_API_KEY;

    const [headerCollapsed, setHeaderCollapsed] = useState(false);

    useEffect(() => {
        let ticking = false;

        const onScroll = () => {
            if (ticking) return;
            ticking = true;

            requestAnimationFrame(() => {
                const y = window.scrollY;

                // ГИСТЕРЕЗИС:
                // - сворачиваем после 80px
                // - разворачиваем только если вернулись ниже 40px
                setHeaderCollapsed((prev) => {
                    if (!prev && y > 80) return true;
                    if (prev && y < 40) return false;
                    return prev;
                });

                ticking = false;
            });
        };

        onScroll();
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    const getRemainingDays = (expiresAt) => {
        if (!expiresAt) return 0;
        const now = new Date();
        const expiration = new Date(expiresAt);
        const diff = expiration - now;
        return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    };

    const fetchAddressSuggestions = async (query) => {
        if (!query || query.length < 3) {
            setAddressSuggestions([]);
            return;
        }

        try {
            const r = await fetch(
                `https://geocode-maps.yandex.ru/1.x/?apikey=${YM_KEY}&geocode=${encodeURIComponent(
                    query
                )}&format=json&results=6`
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

    useEffect(() => {
        axios.get(`${apiUrl}/api/category`)
            .then(res => setCategories(res.data || []))
            .catch(() => setCategories([]));
    }, []);

    useEffect(() => {
        let isMounted = true;

        const fetchProfileData = async () => {
            const token = localStorage.getItem("authToken");
            if (!token) {
                navigate("/login");
                return;
            }

            try {
                const response = await axios.get(`${apiUrl}/api/auth/profile`, {
                    headers: { Authorization: `Bearer ${token}` },
                });

                if (isMounted) {
                    setProfile(response.data);
                    setPaymentMethodId(response.data.yookassaPaymentMethodId || null);
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

        fetchProfileData();
        return () => {
            isMounted = false;
        };
    }, [isAuthenticated, navigate]);

    useEffect(() => {
        if (!profile) return;
        const ids = Array.isArray(profile.preferredCategoryIds) ? profile.preferredCategoryIds : [];
        setCategoryPick(ids);
    }, [profile]);

    const savePreferredCategories = async () => {
        const token = localStorage.getItem("authToken");
        if (!token) return toast.error("Вы не авторизованы");

        setCatSaving(true);
        try {
            const res = await axios.post(
                `${apiUrl}/api/auth/categories/me`,
                { categoryIds: categoryPick },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            toast.success("Профессии сохранены");
            setProfile(p => ({ ...p, preferredCategoryIds: res.data.preferredCategoryIds }));
        } catch (e) {
            toast.error(e.response?.data?.message || "Не удалось сохранить");
        } finally {
            setCatSaving(false);
        }
    };

    useEffect(() => {
        const openAt = 80;   // свернуть после 80px
        const closeAt = 40;  // развернуть обратно только если <40px

        const onScroll = () => {
            const y = window.scrollY;
            setHeaderCollapsed(prev => {
                if (!prev && y > openAt) return true;
                if (prev && y < closeAt) return false;
                return prev;
            });
        };

        onScroll();
        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    useEffect(() => {
        if (!profile) return;

        (async () => {
            const addr = profile.locationAddress;

            const lat = Number(profile.locationLat);
            const lng = Number(profile.locationLng);
            const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

            // 1) если адрес нормальный — ставим его
            if (addr && !looksLikeCoordsString(addr)) {
                setLocationDraft(addr);
                return;
            }

            // 2) если адреса нет/он "Координаты...", но есть координаты — reverse -> адрес
            if (hasCoords) {
                setLocLoading(true);
                setLocError(null);
                try {
                    const resolved = await reverseGeocodeYandex({ lat, lng, apiKey: YM_KEY });
                    if (resolved) setLocationDraft(resolved);
                    else setLocError("Не удалось распознать адрес. Введите вручную или выберите на карте.");
                } catch (e) {
                    console.error(e);
                    setLocError("Не удалось распознать адрес. Введите вручную или выберите на карте.");
                } finally {
                    setLocLoading(false);
                }
                return;
            }

            // 3) вообще ничего нет
            setLocationDraft(addr || "");
        })();
    }, [profile, YM_KEY]);

    useEffect(() => {
        if (profile) {
            loadDebtStatus();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [profile]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (
            params.get("bindReturn") === "1" ||
            params.get("debtReturn") === "1" ||
            params.get("premiumReturn") === "1"
        ) {
            setTimeout(() => window.location.reload(), 1500);
        }
    }, []);

    const saveLocation = async ({ address, lat, lng, source }) => {
        const token = localStorage.getItem("authToken");
        setLocLoading(true);
        setLocError(null);
        try {
            const res = await axios.post(
                `${apiUrl}/api/auth/location/me`,
                { address, lat, lng, source },
                { headers: { Authorization: `Bearer ${token}` } }
            );
            toast.success("Местоположение сохранено");
            setProfile((p) => ({ ...p, ...res.data.location }));
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
                    const addr = await reverseGeocodeYandex({ lat, lng, apiKey: YM_KEY });

                    if (!addr) {
                        setLocError("Не удалось распознать адрес по GPS. Введите адрес вручную или выберите на карте.");
                        setLocLoading(false);
                        return;
                    }

                    // ✅ показываем пользователю сразу адрес
                    setLocationDraft(addr);

                    // ✅ кандидат для подтверждения уже с адресом (без координат в тексте)
                    setGpsCandidate({ lat, lng, address: addr });
                } catch (e) {
                    console.error("reverse geocode error:", e);
                    setLocError("Не удалось распознать адрес по GPS. Введите адрес вручную или выберите на карте.");
                } finally {
                    setLocLoading(false);
                }
            },
            (err) => {
                console.error(err);
                setLocError("Не удалось определить местоположение по GPS. Введите адрес вручную или выберите на карте.");
                setLocLoading(false);
            },
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
        );
    };

    const loadDebtStatus = async () => {
        const token = localStorage.getItem("authToken");

        try {
            const response = await axios.get(`${apiUrl}/api/orders/me/status`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            setDebtAmount(response.data.debt || 0);
            setHasDebt((response.data.debt || 0) > 0);
        } catch (e) {
            console.error("Ошибка проверки долга:", e);
        }
    };

    const handlePayDebt = async () => {
        try {
            const token = localStorage.getItem("authToken");
            if (!token) return toast.error("Вы не авторизованы");
            if (!debtAmount || debtAmount <= 0) return toast.info("Долгов нет");

            const res = await axios.post(
                `${apiUrl}/api/payments/debt/create`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );

            if (!res.data?.success) return toast.error(res.data?.error || "Ошибка создания платежа");
            if (res.data.noDebt) return toast.info("Долгов нет");

            window.location.href = res.data.confirmationUrl;
        } catch (e) {
            console.error("handlePayDebt error:", e);
            toast.error("Ошибка при оплате задолженности");
        }
    };

    const handleBuyPremium = async (duration) => {
        try {
            const token = localStorage.getItem("authToken");
            if (!token) return toast.error("Вы не авторизованы");

            const res = await axios.post(
                `${apiUrl}/api/payments/premium/create`,
                { duration },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            if (!res.data?.success) return toast.error(res.data?.error || "Ошибка создания платежа");

            window.location.href = res.data.confirmationUrl;
        } catch (e) {
            console.error(e);
            toast.error("Ошибка при оплате Premium");
        }
    };

    const handleBindCard = async () => {
        try {
            const token = localStorage.getItem("authToken");
            if (!token) return toast.error("Вы не авторизованы");

            const res = await axios.post(
                `${apiUrl}/api/payments/card/bind/create`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );

            if (!res.data?.success) return toast.error(res.data?.error || "Ошибка привязки карты");

            window.location.href = res.data.confirmationUrl;
        } catch (e) {
            console.error("bind card error:", e);
            toast.error("Ошибка привязки карты");
        }
    };

    const handleUnbindCard = async () => {
        try {
            const token = localStorage.getItem("authToken");
            if (!token) return toast.error("Вы не авторизованы");

            const res = await axios.post(
                `${apiUrl}/api/payments/card/unbind`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );

            if (res.data?.success) {
                toast.success("Карта успешно удалена");
                window.location.reload();
            } else {
                toast.error(res.data?.error || "Ошибка при удалении карты");
            }
        } catch (e) {
            console.error("unbind error:", e);
            toast.error("Сервер не отвечает");
        }
    };

    const handleLogout = () => {
        logout();
        navigate("/login");
    };

    const handleMyComplaints = () => {
        if (profile) navigate(`/complaints/${profile.id}`);
    };

    const handleOrderHistory = () => {
        if (profile) navigate(`/orders-history/${profile.id}`);
    };

    const renderStars = (rating) => {
        const maxStars = 5;
        const fullStar = "★";
        const emptyStar = "☆";
        return fullStar.repeat(Math.round(rating)) + emptyStar.repeat(maxStars - Math.round(rating));
    };

    const handleAgree = () => {
        setShowAgreement(false);
        handleBindCard();
    };

    const fetchProfileData = async () => {
        const token = localStorage.getItem("authToken");
        const response = await axios.get(`${apiUrl}/api/auth/profile`, {
            headers: { Authorization: `Bearer ${token}` },
        });
        setProfile(response.data);
        setPaymentMethodId(response.data.yookassaPaymentMethodId || null);
    };

    const handleAutoUpload = async (files) => {
        const token = localStorage.getItem("authToken");
        if (!files.length) return;

        const formData = new FormData();
        for (let file of files) formData.append("documents", file);

        try {
            await axios.post(`${apiUrl}/api/auth/upload-documents`, formData, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "multipart/form-data",
                },
            });

            toast.success("Документы успешно загружены");

            // ✅ сразу подтянем изменения
            await fetchProfileData();
        } catch (error) {
            console.error("Ошибка загрузки документов:", error);
            toast.error("Ошибка загрузки документов");
        }
    };

    const verificationText = useMemo(() => {
        if (!profile) return "";
        if (profile.userStatus === "pensioner") return "Пенсионер";
        if (profile.userStatus === "verified") return "Пройдена";
        return "Не пройдена";
    }, [profile]);

    if (loading) return <div className="profile-loading">Загрузка данных профиля...</div>;
    if (error)
        return (
            <div className="profile-loading">
                <p className="profile-error">{error}</p>
            </div>
        );

    return (
        <div className="profile-page">
            <div className="profile-shell">
                <div className={`profile-header glass ${headerCollapsed ? "is-collapsed" : ""}`}>

                    <div className="profile-header-top">
                        <div>
                            <h1 className="profile-title">Профиль</h1>
                            <p className="profile-subtitle">Управление аккаунтом и оплатой</p>

                            {profile && (
                                <div className="header-mini">
                                    <span className="header-mini-name">{profile.username}</span>
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
                                <div className="identity-main">
                                    <div className="identity-name">{profile.username}</div>
                                    <div className="identity-meta">
                                        <span className="identity-pill">ID: {profile.id}</span>
                                        <span className="identity-pill">
                      Рейтинг: {profile.rating ? renderStars(profile.rating) : "Нет"}
                    </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Платежи */}
                <div className="profile-card glass">
                    <div className="card-head">
                        <div>
                            <h2 className="card-title">Платежи</h2>
                            <p className="card-subtitle">Карта, комиссия и задолженность</p>
                        </div>
                    </div>

                    {paymentMethodId ? (
                        <div className="card-row">
                            <div className="card-row-text">
                                <div className="card-strong">Карта привязана</div>
                                <div className="card-muted">
                                    {profile?.cardType} •••• {profile?.cardLastFour}
                                </div>
                            </div>
                            <button className="btn btn-ghost-danger" onClick={handleUnbindCard}>
                                Удалить
                            </button>
                        </div>
                    ) : (
                        <button className="btn btn-primary" onClick={handleBindCard}>
                            Привязать карту
                        </button>
                    )}

                    {hasDebt && (
                        <div className="alert alert-danger">
                            <div>
                                <div className="alert-title">Задолженность по комиссии</div>
                                <div className="alert-text">{(debtAmount / 100).toFixed(2)} ₽</div>
                            </div>
                            <button className="btn btn-danger" onClick={handlePayDebt}>
                                Оплатить
                            </button>
                        </div>
                    )}
                </div>

                {/* Premium */}
                <div className="profile-card glass">
                    <div className="card-head">
                        <div>
                            <h2 className="card-title">Premium</h2>
                            <p className="card-subtitle">{subscriptionLabel}</p>
                        </div>
                    </div>

                    <div className="grid-2">
                        <button className="btn btn-primary" onClick={() => handleBuyPremium("7d")}>
                            Купить (7 дней)
                        </button>
                        <button className="btn btn-primary" onClick={() => handleBuyPremium("30d")}>
                            Купить (30 дней)
                        </button>
                    </div>
                </div>

                {/* Верификация */}
                <div className="profile-card glass">
                    <div className="card-head">
                        <div>
                            <h2 className="card-title">Верификация</h2>
                            <p className={`card-subtitle status-${profile?.userStatus || "unknown"}`}>
                                {verificationText}
                            </p>
                        </div>

                        <button className="profile-chip" onClick={() => setShowVerificationModal(true)}>
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

                    {Array.isArray(profile?.documentPhotos) && profile.documentPhotos.length > 0 ? (
                        <div className="docs-block">
                            <div className="docs-head">
                                <div className="docs-title">Загруженные документы</div>
                                <div className="docs-count">{profile.documentPhotos.length} шт.</div>
                            </div>

                            <div className="docs-grid">
                                {profile.documentPhotos.map((p, idx) => {
                                    const isPdf = String(p).toLowerCase().endsWith(".pdf");
                                    const url = p.startsWith("http") ? p : `${apiUrl}${p}`;

                                    return (
                                        <a
                                            key={idx}
                                            className="doc-tile"
                                            href={url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            title="Открыть"
                                        >
                                            {isPdf ? (
                                                <div className="doc-pdf">
                                                    <div className="doc-pdf-badge">PDF</div>
                                                    <div className="doc-name">Документ {idx + 1}</div>
                                                </div>
                                            ) : (
                                                <>
                                                    <img className="doc-img" src={url} alt={`doc-${idx}`} />
                                                    <div className="doc-name">Фото {idx + 1}</div>
                                                </>
                                            )}
                                        </a>
                                    );
                                })}
                            </div>
                        </div>
                    ) : (
                        <div className="docs-empty">Документы ещё не загружены</div>
                    )}

                </div>

                <div className="profile-card glass">
                    <div className="card-head">
                        <div>
                            <h2 className="card-title">Профессии</h2>
                            <p className="card-subtitle">По ним будут фильтроваться заказы</p>
                        </div>
                    </div>

                    <div className="cat-grid">
                        {[...categories]
                            .sort((a, b) => {
                                const ap = (a.id === 12 || a.id === 13) ? 0 : 1;
                                const bp = (b.id === 12 || b.id === 13) ? 0 : 1;
                                if (ap !== bp) return ap - bp;
                                return String(a.name).localeCompare(String(b.name), "ru");
                            })
                            .map((c) => {
                                const active = categoryPick.includes(c.id);

                                return (
                                    <button
                                        key={c.id}
                                        type="button"
                                        className={`cat-pill ${active ? "active" : ""}`}
                                        onClick={() => {
                                            setCategoryPick((prev) =>
                                                prev.includes(c.id) ? prev.filter((x) => x !== c.id) : [...prev, c.id]
                                            );
                                        }}
                                    >
                                        {c.name}
                                    </button>
                                );
                            })}
                    </div>

                    <div className="grid-2" style={{ marginTop: 12 }}>
                        <button className="btn btn-primary" disabled={catSaving} onClick={savePreferredCategories}>
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
                                Сохраняется для автоподстановки в заказах и фильтрации
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
                                    fetchAddressSuggestions(v);
                                }}
                                placeholder="Введите район / улицу / адрес"
                                autoComplete="off"
                            />

                            {addressSuggestions.length > 0 && (
                                <ul className="loc-suggestions">
                                    {addressSuggestions.map((s, i) => (
                                        <li
                                            key={i}
                                            onClick={() => {
                                                setLocationDraft(s.label);
                                                setPickedCoords({ lat: s.lat, lng: s.lng });
                                                setAddressSuggestions([]);
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

                    <div className="grid-2" style={{ marginTop: 10 }}>
                        <button className="btn btn-ghost" disabled={locLoading} onClick={detectGps}>
                            Определить по GPS
                        </button>

                        <button className="btn btn-ghost" onClick={() => setShowMapModal(true)}>
                            Выбрать на карте
                        </button>
                    </div>

                    {/* ✅ Подтверждение GPS */}
                    {gpsCandidate && (
                        <div className="gps-confirm">
                            <div className="gps-title">Мы определили координаты. Верно?</div>
                            <div className="gps-sub">
                                {gpsCandidate.address}
                            </div>
                            <div className="gps-actions">
                                <button
                                    className="btn btn-primary"
                                    onClick={() =>
                                        saveLocation({
                                            address: locationDraft || gpsCandidate.address,
                                            lat: gpsCandidate.lat,
                                            lng: gpsCandidate.lng,
                                            source: "gps",
                                        }).then(() => setGpsCandidate(null))
                                    }
                                >
                                    Да, сохранить
                                </button>

                                <button className="btn btn-ghost" onClick={() => setGpsCandidate(null)}>
                                    Нет, введу вручную
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ✅ Модалка карты */}
                    <YandexMapModal
                        isOpen={showMapModal}
                        onClose={() => setShowMapModal(false)}
                        initialLat={profile?.locationLat}
                        initialLng={profile?.locationLng}
                        onPick={(picked) => {
                            // picked: {lat,lng,address}
                            setLocationDraft(picked.address);
                            saveLocation({ address: picked.address, lat: picked.lat, lng: picked.lng, source: "map" });
                            setShowMapModal(false);
                        }}
                    />

                    {profile?.locationSource && (
                        <div className="loc-meta">
                            <span className="identity-pill">Источник: {profile.locationSource}</span>
                        </div>
                    )}

                    {locError && <div className="loc-error">{locError}</div>}
                </div>

                {/* Действия */}
                <div className="profile-actions glass">
                    <button onClick={handleMyComplaints} className="btn btn-ghost">
                        Отзывы
                    </button>
                    <button onClick={handleOrderHistory} className="btn btn-ghost">
                        История заказов
                    </button>
                    <button onClick={() => navigate("/info")} className="btn btn-ghost">
                        Информация и контакты
                    </button>
                    <button onClick={handleLogout} className="btn btn-ghost-danger">
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
                <div className="modal-overlay" onClick={() => setShowVerificationModal(false)}>
                    <div className="modal-window" onClick={(e) => e.stopPropagation()}>
                        <h3>О верификации пользователя</h3>
                        <div className="modal-content">
                            <p>
                                Верификация необходима для повышения доверия к вам как к пользователю платформы. Мы просим
                                загрузить скан паспорта или другого документа, удостоверяющего личность, чтобы подтвердить,
                                что вы — реальный человек.
                            </p>
                            <p>
                                <strong>Для пенсионеров:</strong> если вы подтвердите пенсионный статус, исполнители будут
                                видеть отметку и получать <strong>скидку на комиссию</strong>.
                            </p>
                            <p>🔒 Все документы обрабатываются вручную и хранятся в зашифрованном виде.</p>
                            <p className="warning">
                                ⚠️ Попытка загрузки поддельных документов приведет к ограничению или блокировке аккаунта.
                            </p>

                            <button className="btn btn-ghost" onClick={() => setShowVerificationModal(false)}>
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