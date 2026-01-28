// src/pages/OrdersPage.js
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import axiosInstance from "../utils/axiosInstance";
import Modal from "react-modal";
import io from "socket.io-client";
import { toast } from "react-toastify";

import "../styles/OrdersPage.css";
import SwipeableMap from "../components/SwipeableMap";
import YandexMapModal from "../components/YandexMapModal";
import ExpressRouteButtons from "../components/ExpressRouteButtons";

import { FaMapMarkedAlt, FaSlidersH, FaLocationArrow } from "react-icons/fa";
import { FiAlertTriangle } from "react-icons/fi";
import { FaUniversity, FaMoneyBillWave, FaCreditCard, FaQuestionCircle } from "react-icons/fa";

const apiUrl = process.env.REACT_APP_API_URL;
const socket = io(process.env.REACT_APP_SOCKET_URL, {
    transports: ["websocket"],
    withCredentials: true,
});

const RADIUS_KM = 50;

function looksLikeCoordsString(v) {
    if (!v) return false;
    const s = String(v).trim();
    return s.startsWith("Координаты:") || /^\d{1,3}\.\d+,\s*\d{1,3}\.\d+$/.test(s);
}

async function reverseGeocodeYandex({ lat, lng, apiKey }) {
    if (!apiKey) throw new Error("No Yandex API key");
    const url = `https://geocode-maps.yandex.ru/1.x/?apikey=${apiKey}&geocode=${lng},${lat}&format=json&results=1&kind=house`;
    const r = await fetch(url);
    const data = await r.json();

    const first = data?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
    const text = first?.metaDataProperty?.GeocoderMetaData?.text || first?.name || null;
    return text;
}

function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2) *
        Math.cos(lat2 * (Math.PI / 180));
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

const OrdersPage = () => {
    const navigate = useNavigate();
    const YM_KEY = process.env.REACT_APP_YANDEX_API_KEY;

    // server data
    const [ordersRaw, setOrdersRaw] = useState([]);
    const [expressRaw, setExpressRaw] = useState([]);

    const [creatorsInfo, setCreatorsInfo] = useState({});
    const [categories, setCategories] = useState([]);
    const [subcategories, setSubcategories] = useState([]);
    const [services, setServices] = useState([]);

    // auth/profile
    const [userId, setUserId] = useState(null);
    const [profile, setProfile] = useState(null);

    // location
    const [userLocation, setUserLocation] = useState(null); // {latitude, longitude}
    const [locationDraft, setLocationDraft] = useState("");
    const [locLoading, setLocLoading] = useState(false);
    const [locError, setLocError] = useState(null);
    const [isGeolocationDenied, setIsGeolocationDenied] = useState(false);
    const [showMapPick, setShowMapPick] = useState(false);

    // UI
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [isMapVisible, setIsMapVisible] = useState(false);

    // tabs
    const [activeTab, setActiveTab] = useState("all"); // all | recommended | courier

    // drawer filters
    const [selectedCategory, setSelectedCategory] = useState("");
    const [selectedSubcategory, setSelectedSubcategory] = useState("");
    const [selectedService, setSelectedService] = useState("");
    const [useProfileProfessions, setUseProfileProfessions] = useState(true);

    // modal images
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [currentImages, setCurrentImages] = useState([]);

    const creatorsCacheRef = useRef({});

    const preferredCategoryIds = useMemo(() => {
        const ids = profile?.preferredCategoryIds;
        return Array.isArray(ids) ? ids.map((x) => Number(x)).filter(Number.isFinite) : [];
    }, [profile]);

    const preferredCategories = useMemo(() => {
        if (!preferredCategoryIds.length) return [];
        const map = new Map((categories || []).map((c) => [Number(c.id), c]));
        return preferredCategoryIds
            .map((id) => map.get(Number(id)))
            .filter(Boolean);
    }, [preferredCategoryIds, categories]);

    const openModal = (images) => {
        setCurrentImages(images || []);
        setCurrentImageIndex(0);
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setCurrentImageIndex(0);
        setCurrentImages([]);
    };

    const getPaymentIcon = (type) => {
        switch (type) {
            case "guarantee":
                return <FaUniversity title="Гарантия" />;
            case "cash":
                return <FaMoneyBillWave title="Наличные" />;
            case "installments":
                return <FaCreditCard title="Рассрочка" />;
            default:
                return <FaQuestionCircle title="Неизвестно" />;
        }
    };

    const buildServiceLine = (o) => {
        const parts = [
            o?.category?.name,
            o?.subcategory?.name,
            o?.service?.name,
        ].filter(Boolean);

        return parts.length ? parts.join(" • ") : "Не указано";
    };

    useEffect(() => {
        const p = new URLSearchParams(window.location.search);
        const promoReturn = p.get('promoReturn') === '1';
        const paymentId = p.get('paymentId');

        if (!promoReturn || !paymentId) return;

        (async () => {
            try {
                const res = await axiosInstance.get(`/payments/status?paymentId=${encodeURIComponent(paymentId)}`);
                if (res.data?.status === 'succeeded') {
                    toast.success('Продвижение оплачено ✅');
                } else if (res.data?.status === 'pending') {
                    toast.info('Платёж обрабатывается… обновите страницу через пару секунд');
                } else {
                    toast.error('Платёж не завершён');
                }
            } catch (e) {
                toast.error('Не удалось проверить платёж');
            } finally {
                // чистим URL чтобы не повторялось
                p.delete('promoReturn');
                p.delete('paymentId');
                const newUrl = `${window.location.pathname}${p.toString() ? `?${p.toString()}` : ''}`;
                window.history.replaceState({}, '', newUrl);
            }
        })();
    }, []);

    // ---------- API: fetch base data ----------
    useEffect(() => {
        axios
            .get(`${apiUrl}/api/category`)
            .then((res) => setCategories(res.data || []))
            .catch(() => setCategories([]));
    }, []);

    useEffect(() => {
        const fetchProfile = async () => {
            try {
                const res = await axiosInstance.get("/auth/profile");
                setProfile(res.data);
                setUserId(res.data?.id || null);
                socket.emit("register", res.data?.id);
            } catch (e) {
                console.info("OrdersPage: profile not loaded (maybe not logged in).");
            }
        };
        fetchProfile();
    }, []);

    useEffect(() => {
        const fetchOrders = async () => {
            try {
                const res = await axiosInstance.get("/orders/all");
                setOrdersRaw(res.data || []);
            } catch (e) {
                console.error(e);
                toast.error("Не удалось загрузить заказы");
            }
        };

        fetchOrders();
        socket.on("orderUpdated", fetchOrders);
        return () => socket.off("orderUpdated", fetchOrders);
    }, []);

    // EXPRESS: доступные created + executorId null
    const fetchExpress = useCallback(async () => {
        try {
            const res = await axiosInstance.get("/express/express-orders/available");
            setExpressRaw(res.data?.orders || []);
        } catch (e) {
            console.error("fetchExpress error:", e);
        }
    }, []);

    useEffect(() => {
        fetchExpress();
        socket.on("orderUpdated", fetchExpress);
        return () => socket.off("orderUpdated", fetchExpress);
    }, [fetchExpress]);

    // normalize express -> "order-like"
    const expressAsOrders = useMemo(() => {
        return (expressRaw || []).map((e) => ({
            // IMPORTANT: уникальный ключ, чтобы React не путался
            id: `e-${e.id}`,
            express: true,
            expressId: e.id,
            taxi_courier: true,
            expressType: e.type, // taxi | courier

            createdAt: e.createdAt || e.created_at,

            // geo: берем точку А как координаты заказа (для карты и радиуса)
            coordinates: `${Number(e.fromLat)},${Number(e.fromLng)}`,

            // UI mapping
            address: `${e.fromAddress} → ${e.toAddress}`,
            description: e.description || "",
            proposedSum: Number(e.totalPrice ?? 0),
            paymentType: e.paymentType,

            images: [],
            // чтобы блок "Категория/Подкатегория/Услуга" не был пустым
            category: { name: e.type === "taxi" ? "Такси" : "Курьер" },
            subcategory: e.subcategory ? { name: e.subcategory } : null,
            service: null,

            creatorId: e.creatorId,
            executorId: e.executorId,
            status: "pending", // чтобы кнопка "Запросить выполнение" НЕ показывалась для экспресса (см. ниже)

            is_recommended: false,
            is_highlighted: false,
        }));
    }, [expressRaw]);

    const allRaw = useMemo(() => {
        const a = Array.isArray(ordersRaw) ? ordersRaw : [];
        const b = Array.isArray(expressAsOrders) ? expressAsOrders : [];
        return [...a, ...b];
    }, [ordersRaw, expressAsOrders]);

    // ---------- creators info (ВАЖНО: с учётом express) ----------
    useEffect(() => {
        const ids = [
            ...new Set((allRaw || []).map((o) => o.creatorId).filter(Boolean)),
        ];
        if (!ids.length) return;

        const missing = ids.filter((id) => !creatorsCacheRef.current[id]);
        if (!missing.length) {
            setCreatorsInfo({ ...creatorsCacheRef.current });
            return;
        }

        (async () => {
            try {
                const results = await Promise.allSettled(
                    missing.map((id) => axiosInstance.get(`/auth/${id}`))
                );
                results.forEach((r, idx) => {
                    const id = missing[idx];
                    if (r.status === "fulfilled") creatorsCacheRef.current[id] = r.value.data;
                });
                setCreatorsInfo({ ...creatorsCacheRef.current });
            } catch {}
        })();
    }, [allRaw]);

    // ---------- location: profile -> gps -> manual/map ----------
    useEffect(() => {
        if (!profile) return;

        const lat = Number(profile.locationLat);
        const lng = Number(profile.locationLng);
        const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

        if (hasCoords) {
            setUserLocation({ latitude: lat, longitude: lng });

            const addr = profile.locationAddress;
            if (addr && !looksLikeCoordsString(addr)) {
                setLocationDraft(addr);
                return;
            }

            (async () => {
                setLocLoading(true);
                setLocError(null);
                try {
                    const resolved = await reverseGeocodeYandex({ lat, lng, apiKey: YM_KEY });
                    setLocationDraft(resolved || addr || "");
                } catch {
                    setLocationDraft(addr || "");
                } finally {
                    setLocLoading(false);
                }
            })();

            return;
        }

        if (!navigator.geolocation) {
            setIsGeolocationDenied(true);
            return;
        }

        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                setIsGeolocationDenied(false);
                const latitude = pos.coords.latitude;
                const longitude = pos.coords.longitude;
                setUserLocation({ latitude, longitude });

                try {
                    const addr = await reverseGeocodeYandex({ lat: latitude, lng: longitude, apiKey: YM_KEY });
                    if (addr) setLocationDraft(addr);
                } catch {}
            },
            () => setIsGeolocationDenied(true),
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
        );
    }, [profile, YM_KEY]);

    const pullLocationFromProfile = async () => {
        if (!profile) return toast.info("Профиль ещё не загружен");
        const lat = Number(profile.locationLat);
        const lng = Number(profile.locationLng);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            toast.info("В профиле нет сохранённых координат. Укажи их в Профиле → Местоположение.");
            return;
        }

        setUserLocation({ latitude: lat, longitude: lng });

        const addr = profile.locationAddress;
        if (addr && !looksLikeCoordsString(addr)) {
            setLocationDraft(addr);
            toast.success("Местоположение подтянуто из профиля");
            return;
        }

        try {
            setLocLoading(true);
            const resolved = await reverseGeocodeYandex({ lat, lng, apiKey: YM_KEY });
            if (resolved) setLocationDraft(resolved);
            toast.success("Местоположение подтянуто из профиля");
        } catch {
            toast.success("Местоположение подтянуто из профиля");
        } finally {
            setLocLoading(false);
        }
    };

    const detectGpsNow = () =>
        new Promise((resolve) => {
            if (!navigator.geolocation) {
                toast.error("GPS недоступен в браузере");
                setIsGeolocationDenied(true);
                return resolve(false);
            }

            setLocLoading(true);
            setLocError(null);

            navigator.geolocation.getCurrentPosition(
                async (pos) => {
                    const latitude = pos.coords.latitude;
                    const longitude = pos.coords.longitude;

                    setUserLocation({ latitude, longitude });
                    setIsGeolocationDenied(false);

                    try {
                        const addr = await reverseGeocodeYandex({ lat: latitude, lng: longitude, apiKey: YM_KEY });
                        if (addr) setLocationDraft(addr);
                    } catch {}

                    setLocLoading(false);
                    toast.success("Местоположение обновлено по GPS");
                    resolve(true);
                },
                (err) => {
                    console.error(err);
                    setLocLoading(false);
                    toast.error("Не удалось определить местоположение по GPS");
                    setIsGeolocationDenied(true);
                    resolve(false);
                },
                { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
            );
        });

    const toggleMap = async () => {
        if (!isMapVisible) {
            setIsMapVisible(true);
            await detectGpsNow();
        } else {
            setIsMapVisible(false);
        }
    };

    const saveLocationToProfile = async ({ address, lat, lng, source }) => {
        const token = localStorage.getItem("authToken");
        if (!token) {
            toast.error("Нужно войти, чтобы сохранить местоположение");
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
            setProfile((p) => ({ ...p, ...res.data.location }));
        } catch (e) {
            setLocError(e.response?.data?.message || "Ошибка сохранения");
        } finally {
            setLocLoading(false);
        }
    };

    const geocodeAddress = async (address) => {
        try {
            setLocLoading(true);
            setLocError(null);

            const response = await fetch(
                `https://geocode-maps.yandex.ru/1.x/?apikey=${YM_KEY}&geocode=${encodeURIComponent(address)}&format=json&results=1`
            );
            const data = await response.json();
            const pos = data?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject?.Point?.pos;
            if (!pos) throw new Error("Адрес не найден");

            const [lng, lat] = pos.split(" ").map(Number);
            setUserLocation({ latitude: lat, longitude: lng });

            await saveLocationToProfile({ address, lat, lng, source: "manual" });
            setLocationDraft(address);
        } catch (e) {
            console.error(e);
            setLocError("Не удалось определить координаты по адресу. Попробуйте уточнить или выбрать на карте.");
        } finally {
            setLocLoading(false);
        }
    };

    // ---------- drawer: dependent selects ----------
    const fetchSubcategories = async (categoryId) => {
        if (!categoryId) {
            setSubcategories([]);
            return;
        }
        try {
            const res = await axiosInstance.get(`/category/subcategory/${categoryId}`);
            setSubcategories(res.data || []);
        } catch {
            setSubcategories([]);
        }
    };

    const fetchServices = async (subcategoryId) => {
        if (!subcategoryId) {
            setServices([]);
            return;
        }
        try {
            const res = await axiosInstance.get(`/category/services/${subcategoryId}`);
            setServices(res.data || []);
        } catch {
            setServices([]);
        }
    };

    // ---------- core filtering (tabs + drawer + geo) ----------
    const visibleOrders = useMemo(() => {
        const base = Array.isArray(allRaw) ? allRaw : [];

        // 0) tabs
        const tabFiltered =
            activeTab === "recommended"
                ? base.filter((o) => !!o.is_recommended)
                : activeTab === "courier"
                    ? base.filter((o) => !!o.taxi_courier)
                    : base;

        // 1) preferred professions (НЕ режем taxi_courier)
        const professionFiltered =
            useProfileProfessions && preferredCategoryIds.length > 0
                ? tabFiltered.filter((o) => {
                    if (o.taxi_courier) return true;
                    const catId = Number(o.categoryId ?? o.category?.id);
                    if (!catId) return false;
                    return preferredCategoryIds.includes(catId);
                })
                : tabFiltered;

        // 2) drawer filters (для express — они не подходят, поэтому НЕ фильтруем их этими полями)
        const byCategory = selectedCategory
            ? professionFiltered.filter((o) => {
                if (o.express) return true;
                return Number(o.categoryId ?? o.category?.id) === Number(selectedCategory);
            })
            : professionFiltered;

        const bySubcategory = selectedSubcategory
            ? byCategory.filter((o) => {
                if (o.express) return true;
                return Number(o.subcategoryId ?? o.subcategory?.id) === Number(selectedSubcategory);
            })
            : byCategory;

        const byService = selectedService
            ? bySubcategory.filter((o) => {
                if (o.express) return true;
                return Number(o.serviceId ?? o.service?.id) === Number(selectedService);
            })
            : bySubcategory;

        // 3) geo 50km always
        if (!userLocation?.latitude || !userLocation?.longitude) return [];

        const geoFiltered = byService
            .map((order) => {
                const [lat, lon] = String(order.coordinates || "")
                    .split(",")
                    .map((x) => Number(String(x).trim()));
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

                const distance = getDistanceFromLatLonInKm(
                    Number(userLocation.latitude),
                    Number(userLocation.longitude),
                    lat,
                    lon
                );

                return { ...order, _distance: distance, latitude: lat, longitude: lon };
            })
            .filter((o) => o && o._distance <= RADIUS_KM);

        // 4) sorting: distance ↑ then date ↓
        geoFiltered.sort((a, b) => {
            const ad = Number.isFinite(a._distance) ? a._distance : 1e9;
            const bd = Number.isFinite(b._distance) ? b._distance : 1e9;
            if (ad !== bd) return ad - bd;
            return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        });

        return geoFiltered;
    }, [
        allRaw,
        activeTab,
        preferredCategoryIds,
        selectedCategory,
        selectedSubcategory,
        selectedService,
        userLocation,
    ]);

    const locationStatusText = useMemo(() => {
        if (locLoading) return "Определяем адрес…";
        if (userLocation?.latitude && userLocation?.longitude) return locationDraft || `Радиус ${RADIUS_KM} км`;
        return "Не задано";
    }, [locLoading, userLocation, locationDraft]);

    return (
        <div className="orders-page">
            <div className="orders-shell">
                {/* Top bar */}
                <div className="orders-top glass">
                    <div className="orders-top-left">
                        <div className="orders-title">Все заказы</div>
                        <div className="orders-subtitle">
                            Радиус: <b>{RADIUS_KM} км</b> • {useProfileProfessions && preferredCategoryIds.length ? "по вашим профессиям" : "все категории"} •{" "}
                            Найдено: <b>{visibleOrders.length}</b>
                        </div>

                        <div className="orders-location-row">
                            <div className="orders-location-pill">
                                <FaLocationArrow style={{ marginRight: 8 }} />
                                <span className="orders-location-text">{locationStatusText}</span>
                            </div>

                            <details className="loc-menu">
                                <summary className="loc-summary">
                                    <FaLocationArrow /> Местоположение
                                </summary>

                                <div className="loc-menu-panel">
                                    <button className="btn btn-ghost" onClick={pullLocationFromProfile} disabled={locLoading}>
                                        Из профиля
                                    </button>
                                    <button className="btn btn-ghost" onClick={detectGpsNow} disabled={locLoading}>
                                        GPS
                                    </button>
                                    <button className="btn btn-ghost" onClick={() => setShowMapPick(true)}>
                                        Выбрать на карте
                                    </button>
                                </div>
                            </details>
                        </div>

                        {(isGeolocationDenied || (!profile?.locationLat && !profile?.locationLng)) && (
                            <div className="orders-loc-row">
                                <input
                                    className="loc-input"
                                    value={locationDraft}
                                    onChange={(e) => setLocationDraft(e.target.value)}
                                    placeholder="Введите адрес (например: Крым, Белогорск)"
                                />
                                <button className="btn btn-primary" disabled={locLoading || !locationDraft.trim()} onClick={() => geocodeAddress(locationDraft)}>
                                    Применить
                                </button>
                            </div>
                        )}

                        {locError && <div className="orders-error">{locError}</div>}
                    </div>

                    <div className="orders-top-right">
                        <button className="btn btn-ghost" onClick={toggleMap}>
                            <FaMapMarkedAlt style={{ marginRight: 8 }} />
                            Карта
                        </button>

                        <button className="btn btn-primary" onClick={() => setDrawerOpen(true)}>
                            <FaSlidersH style={{ marginRight: 8 }} />
                            Фильтры
                        </button>
                    </div>
                </div>

                {/* Tabs row */}
                <div className="orders-tabs-row glass">
                    <button className={`tab-pill ${activeTab === "all" ? "active" : ""}`} onClick={() => setActiveTab("all")}>
                        Все
                    </button>

                    <button className={`tab-pill ${activeTab === "recommended" ? "active" : ""}`} onClick={() => setActiveTab("recommended")}>
                        В приоритете
                    </button>

                    <button className={`tab-pill ${activeTab === "courier" ? "active" : ""}`} onClick={() => setActiveTab("courier")}>
                        Курьер / Такси
                    </button>

                    <span className="tabs-hint">
            Во вкладке <b>Все</b> приоритетные не поднимаются, только подсвечиваются
          </span>
                </div>

                {profile && preferredCategoryIds.length > 0 && (
                    <div className="pref-bar glass">
                        <div className="pref-bar__top">
                            <div>
                                <div className="pref-bar__title">Мои профессии (фильтр из профиля)</div>
                                <div className="pref-bar__sub">
                                    Эти категории применяются автоматически. Такси/курьер показываем всегда.
                                </div>
                            </div>

                            <div className="pref-bar__actions">
                                <button className="btn btn-ghost" onClick={() => navigate("/profile")}>
                                    Изменить в профиле
                                </button>

                                <button
                                    className="btn btn-ghost"
                                    onClick={() => {
                                        setSelectedCategory("");
                                        setSelectedSubcategory("");
                                        setSelectedService("");
                                        setSubcategories([]);
                                        setServices([]);
                                        setActiveTab("all");

                                        setUseProfileProfessions(false); // ⭐ вот это делает “сброс” заметным

                                        toast.info("Фильтры сброшены. Профессии из профиля временно отключены.");
                                    }}
                                >
                                    Сбросить фильтры
                                </button>

                                <button
                                    className="btn btn-ghost"
                                    onClick={() => {
                                        setUseProfileProfessions(true);
                                        toast.info("Фильтр по профессиям из профиля включен.");
                                    }}
                                >
                                    Применять профессии
                                </button>

                            </div>
                        </div>

                        <div className="pref-bar__chips">
                            {preferredCategoryIds.map((id) => {
                                const found = preferredCategories.find((c) => Number(c.id) === Number(id));
                                return (
                                    <span key={id} className="pref-chip" title={found?.name || ""}>
            {found?.name || `Категория #${id}`}
          </span>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Map */}
                {isMapVisible && (
                    <div className="orders-map glass">
                        <SwipeableMap orders={visibleOrders} userLocation={userLocation} isOpen={isMapVisible} />
                    </div>
                )}

                {profile && preferredCategoryIds.length === 0 && (
                    <div className="notice glass">
                        <div className="notice-title">Выберите профессии в профиле</div>
                        <div className="notice-sub">
                            Тогда мы будем показывать заказы только по вашим направлениям. Сейчас отображаются все категории (и курьер/такси тоже).
                        </div>
                        <div className="notice-actions">
                            <button className="btn btn-primary" onClick={() => navigate("/profile")}>
                                Перейти в профиль
                            </button>
                        </div>
                    </div>
                )}

                {/* Orders list */}
                <div className="orders-list-wrap">
                    {!userLocation?.latitude || !userLocation?.longitude ? (
                        <div className="empty glass">
                            <div className="empty-title">Нужно местоположение</div>
                            <div className="empty-sub">
                                Чтобы показывать ближайшие заказы в радиусе {RADIUS_KM} км, укажи адрес или выбери точку на карте.
                            </div>
                            <div className="empty-actions">
                                <button className="btn btn-primary" onClick={() => setShowMapPick(true)}>
                                    Выбрать на карте
                                </button>
                            </div>
                        </div>
                    ) : visibleOrders.length > 0 ? (
                        <ul className="orders-list">
                            {visibleOrders.map((order) => {
                                const creator = creatorsInfo[order.creatorId] || {};
                                const isCreator = order.creatorId === userId;
                                const isExpress = !!order.express;

                                const displayId = isExpress ? order.expressId : order.id;

                                const courierBadgeText = isExpress
                                    ? order.expressType === "taxi"
                                        ? "Такси"
                                        : "Курьер"
                                    : "Курьер / Такси";

                                const cardClass = [
                                    "order-card",
                                    "glass",
                                    isCreator ? "creator" : "",
                                    order.is_highlighted ? "highlighted" : "",
                                    order.is_recommended ? "recommended" : "",
                                    order.taxi_courier ? "courier" : "",
                                ]
                                    .filter(Boolean)
                                    .join(" ");

                                return (
                                    <li key={order.id} className={cardClass}>
                                        <div className="order-head">
                                            <div className="order-head-left">
                                                <div className="order-title-row">
                          <span className="order-number">
                            {isExpress ? `Экспресс №${displayId}` : `Заказ №${displayId}`}
                          </span>

                                                    {order.is_recommended && <span className="badge badge-priority">В приоритете</span>}

                                                    {order.taxi_courier && <span className="badge badge-courier">{courierBadgeText}</span>}

                                                    {Number.isFinite(order._distance) && (
                                                        <span className="badge badge-distance">{order._distance.toFixed(1)} км</span>
                                                    )}
                                                </div>

                                                <div className="order-meta">
                          <span className="muted">
                            {creator.username ? `от ${creator.username}` : "от пользователя"} •{" "}
                              {new Date(order.createdAt).toLocaleString()}
                          </span>
                                                </div>
                                            </div>

                                            <div className="order-head-right">
                                                <div className="pay-box">
                                                    <span className="pay-icon">{getPaymentIcon(order.paymentType)}</span>
                                                    <div className="pay-price">
                                                        {Number(order.proposedSum ?? 0).toLocaleString("ru-RU")} ₽
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="order-grid">
                                            <div className="order-col">
                                                <div className="kv">
                                                    <span className="k">Категория / Услуга</span>
                                                    <span className="v v-line">{buildServiceLine(order)}</span>
                                                </div>
                                            </div>

                                            <div className="order-col">
                                                <div className="kv">
                                                    <span className="k">{isExpress ? "Маршрут" : "Адрес"}</span>
                                                    <span className={`v ${isExpress ? "route-line" : ""}`}>{order.address || "—"}</span>
                                                </div>
                                            </div>
                                        </div>

                                        {Array.isArray(order.images) && order.images.length > 0 && (
                                            <div className="thumbs" onClick={() => openModal(order.images)}>
                                                {order.images.slice(0, 4).map((img, idx) => (
                                                    <img key={idx} className="thumb" src={`${apiUrl}${img}`} alt={`img-${idx}`} />
                                                ))}
                                                {order.images.length > 4 && <div className="thumb-more">+{order.images.length - 4}</div>}
                                            </div>
                                        )}

                                        <div className="order-desc">
                                            <span className="k">Описание</span>
                                            <div className="v">{order.description || "—"}</div>
                                        </div>

                                        <div className="order-actions">
                                            <Link
                                                to={`/complaints/${order.creatorId}`}
                                                className="btn btn-ghost-danger btn-inline"
                                                aria-label={`Жалобы (${creator.complaintsCount || 0})`}
                                            >
                                                <FiAlertTriangle style={{ marginRight: 8 }} />
                                                {creator.complaintsCount || 0}
                                            </Link>

                                            {/* Обычные заказы: старое поведение */}
                                            {!isExpress &&
                                                userId !== order.creatorId &&
                                                !order.executorId &&
                                                order.status === "pending" && (
                                                    <button
                                                        className="btn btn-primary"
                                                        onClick={async () => {
                                                            const token = localStorage.getItem("authToken");
                                                            if (!token) {
                                                                toast.info("Войдите, чтобы запросить выполнение");
                                                                navigate("/login");
                                                                return;
                                                            }

                                                            try {
                                                                const statusRes = await axiosInstance.get("/orders/me/status", {
                                                                    headers: { Authorization: `Bearer ${token}` },
                                                                });

                                                                const debt = statusRes.data?.debt || 0;
                                                                if (debt > 0) {
                                                                    toast.error("У вас есть задолженность по комиссии. Сначала погасите её в профиле.");
                                                                    navigate("/profile");
                                                                    return;
                                                                }

                                                                const proposedSum = prompt("Введите сумму, которую вы хотите получить за выполнение:");
                                                                if (!proposedSum) return;

                                                                const comment = prompt("Комментарий к заказчику (необязательно):");

                                                                await axiosInstance.post(
                                                                    `/orders/${order.id}/request`,
                                                                    { proposedSum, comment },
                                                                    { headers: { Authorization: `Bearer ${token}` } }
                                                                );

                                                                toast.success("Запрос отправлен заказчику!");
                                                            } catch (e) {
                                                                console.error(e);
                                                                toast.error(e.response?.data?.message || "Ошибка. Попробуйте позже.");
                                                            }
                                                        }}
                                                    >
                                                        Запросить выполнение
                                                    </button>
                                                )}

                                            {/* Express: (пока) просто открываем экран экспресс-заказа (если у тебя есть роут) */}
                                            {isExpress && (
                                                <>
                                                    <ExpressRouteButtons
                                                        orderId={order.expressId}
                                                        canToA={true}
                                                        canAToB={true}
                                                    />

                                                    <button
                                                        className="btn btn-primary"
                                                        onClick={async () => {
                                                            try {
                                                                await axiosInstance.post(`/express/express-orders/${order.expressId}/accept`);
                                                                toast.success("Заказ принят!");
                                                                await fetchExpress();
                                                                navigate("/active-orders");
                                                            } catch (e) {
                                                                toast.error(e.response?.data?.message || "Ошибка");
                                                            }
                                                        }}
                                                    >
                                                        Принять
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <div className="empty glass">
                            <div className="empty-title">Нет доступных заказов</div>
                            <div className="empty-sub">
                                В радиусе {RADIUS_KM} км и по выбранным условиям сейчас пусто. Попробуй изменить фильтры или место.
                            </div>
                            <div className="empty-actions">
                                <button className="btn btn-ghost" onClick={() => setDrawerOpen(true)}>
                                    Открыть фильтры
                                </button>
                                <button className="btn btn-primary" onClick={() => setShowMapPick(true)}>
                                    Выбрать место
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Drawer */}
                {drawerOpen && (
                    <>
                        <div className="drawer-overlay" onClick={() => setDrawerOpen(false)} />
                        <div className="drawer glass" role="dialog" aria-modal="true">
                            <div className="drawer-head">
                                <div>
                                    <div className="drawer-title">Фильтры</div>
                                    <div className="drawer-sub">Профессии берём из профиля, здесь — уточнение</div>
                                </div>
                                <button className="btn btn-ghost" onClick={() => setDrawerOpen(false)}>
                                    Закрыть
                                </button>
                            </div>

                            <div className="drawer-body">
                                <div className="field">
                                    <label>Категория</label>
                                    <select
                                        value={selectedCategory}
                                        onChange={async (e) => {
                                            const v = e.target.value;
                                            setSelectedCategory(v);
                                            setSelectedSubcategory("");
                                            setSelectedService("");
                                            setServices([]);
                                            await fetchSubcategories(v);
                                        }}
                                    >
                                        <option value="">Все</option>
                                        {categories.map((c) => (
                                            <option key={c.id} value={c.id}>
                                                {c.name}
                                            </option>
                                        ))}
                                    </select>
                                    <div className="hint-text">Фильтры применяются поверх текущей вкладки</div>
                                </div>

                                <div className="field">
                                    <label>Подкатегория</label>
                                    <select
                                        value={selectedSubcategory}
                                        onChange={async (e) => {
                                            const v = e.target.value;
                                            setSelectedSubcategory(v);
                                            setSelectedService("");
                                            await fetchServices(v);
                                        }}
                                        disabled={!selectedCategory}
                                    >
                                        <option value="">Все</option>
                                        {subcategories.map((s) => (
                                            <option key={s.id} value={s.id}>
                                                {s.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="field">
                                    <label>Услуга</label>
                                    <select
                                        value={selectedService}
                                        onChange={(e) => setSelectedService(e.target.value)}
                                        disabled={!selectedSubcategory || services.length === 0}
                                    >
                                        <option value="">Все</option>
                                        {services.map((s) => (
                                            <option key={s.id} value={s.id}>
                                                {s.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="field-inline">
                                    <div className="radius-pill">
                                        Радиус фиксированный: <b>{RADIUS_KM} км</b>
                                    </div>
                                </div>
                            </div>

                            <div className="drawer-foot">
                                <button
                                    className="btn btn-ghost"
                                    onClick={() => {
                                        setSelectedCategory("");
                                        setSelectedSubcategory("");
                                        setSelectedService("");
                                        setSubcategories([]);
                                        setServices([]);
                                    }}
                                >
                                    Сбросить
                                </button>

                                <button className="btn btn-primary" onClick={() => setDrawerOpen(false)}>
                                    Показать ({visibleOrders.length})
                                </button>
                            </div>
                        </div>
                    </>
                )}

                {/* Map picker */}
                <YandexMapModal
                    isOpen={showMapPick}
                    onClose={() => setShowMapPick(false)}
                    initialLat={profile?.locationLat}
                    initialLng={profile?.locationLng}
                    onPick={async (picked) => {
                        setLocationDraft(picked.address);
                        setUserLocation({ latitude: picked.lat, longitude: picked.lng });
                        await saveLocationToProfile({
                            address: picked.address,
                            lat: picked.lat,
                            lng: picked.lng,
                            source: "map",
                        });
                        setShowMapPick(false);
                    }}
                />

                {/* Images modal */}
                <Modal
                    appElement={document.getElementById("root")}
                    isOpen={isModalOpen}
                    onRequestClose={closeModal}
                    contentLabel="Full Image Modal"
                    className="custom-modal"
                    overlayClassName="custom-modal-overlay"
                    parentSelector={() => document.body}
                    style={{
                        overlay: {
                            zIndex: 99999,
                            position: "fixed",
                            inset: 0,
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                            backgroundColor: "rgba(0,0,0,0.6)",
                        },
                        content: {
                            position: "relative",
                            inset: "auto",
                            background: "white",
                            border: "none",
                            borderRadius: "12px",
                            padding: 0,
                            maxWidth: "90vw",
                            maxHeight: "90vh",
                            overflow: "hidden",
                            display: "flex",
                            justifyContent: "center",
                            alignItems: "center",
                        },
                    }}
                >
                    <button className="img-close" onClick={closeModal}>
                        ×
                    </button>

                    <button
                        className="img-nav left"
                        onClick={() =>
                            setCurrentImageIndex((prev) => (prev === 0 ? currentImages.length - 1 : prev - 1))
                        }
                    >
                        ‹
                    </button>

                    <img src={`${apiUrl}${currentImages[currentImageIndex]}`} alt="full" className="img-full" />

                    <button
                        className="img-nav right"
                        onClick={() =>
                            setCurrentImageIndex((prev) => (prev === currentImages.length - 1 ? 0 : prev + 1))
                        }
                    >
                        ›
                    </button>
                </Modal>
            </div>
        </div>
    );
};

export default OrdersPage;