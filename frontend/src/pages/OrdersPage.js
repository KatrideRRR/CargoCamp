import React, { useEffect, useMemo, useRef, useState, useCallback, useContext } from "react";
import { Capacitor } from "@capacitor/core";
import { Link, useNavigate } from "react-router-dom";
import { getCurrentLocation, getLocationErrorMessage } from "../utils/getCurrentLocation";
import { ModalContext } from "../components/modalContext";
import axios from "axios";
import axiosInstance from "../utils/axiosInstance";
import Modal from "react-modal";
import { toast } from "react-toastify";
import { socket } from "../socketClient";

import "../styles/OrdersPage.css";
import YandexMapModal from "../components/YandexMapModal";
import ExpressRouteButtons from "../components/ExpressRouteButtons";

import { FaMapMarkedAlt, FaSlidersH, FaLocationArrow } from "react-icons/fa";
import { FiAlertTriangle } from "react-icons/fi";
import { FaUniversity, FaMoneyBillWave, FaCreditCard, FaQuestionCircle } from "react-icons/fa";

const apiUrl = process.env.REACT_APP_API_URL;

const RADIUS_KM = 50;
const HIDE_FROM_DRAWER = new Set(["Такси", "Курьер"]);

function normalizeBoolean(value) {
    if (
        value === true ||
        value === 1 ||
        value === "1" ||
        value === "true"
    ) {
        return true;
    }

    if (
        value === false ||
        value === 0 ||
        value === "0" ||
        value === "false"
    ) {
        return false;
    }

    return null;
}

function getOrderTiming(order) {
    const isAsap = normalizeBoolean(
        order?.isAsap ?? order?.is_asap
    );

    if (isAsap === true) {
        return {
            type: "asap",
            label: "Срок выполнения",
            value: "Как можно скорее",
        };
    }

    const rawWorkTime =
        order?.workTime ??
        order?.work_time ??
        null;

    if (!rawWorkTime) {
        return null;
    }

    const date = new Date(rawWorkTime);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return {
        type: "scheduled",
        label: "Выполнить к",
        value: date.toLocaleString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        }),
    };
}

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
    return first?.metaDataProperty?.GeocoderMetaData?.text || first?.name || null;
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

    const [busyState, setBusyState] = useState({
        loading: true,
        hasBusyRegular: false,
        hasBusyTaxi: false,
        hasAnyBusy: false,
    });

    const [ordersRaw, setOrdersRaw] = useState([]);
    const [expressRaw, setExpressRaw] = useState([]);
    const [creatorsInfo, setCreatorsInfo] = useState({});
    const [categories, setCategories] = useState([]);
    const [subcategories, setSubcategories] = useState([]);

    const [userId, setUserId] = useState(null);
    const [profile, setProfile] = useState(null);

    const [userLocation, setUserLocation] = useState(null);
    const [locationDraft, setLocationDraft] = useState("");
    const [locLoading, setLocLoading] = useState(false);
    const [locError, setLocError] = useState(null);
    const [isGeolocationDenied, setIsGeolocationDenied] = useState(false);

    const [showOrdersMap, setShowOrdersMap] = useState(false);
    const [showLocationPicker, setShowLocationPicker] = useState(false);

    const [drawerOpen, setDrawerOpen] = useState(false);

    const [activeTab, setActiveTab] = useState("all");
    const [selectedCategory, setSelectedCategory] = useState("");
    const [selectedSubcategory, setSelectedSubcategory] = useState("");
    const [useProfileProfessions, setUseProfileProfessions] = useState(true);

    const [locationMenuOpen, setLocationMenuOpen] = useState(false);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [currentImages, setCurrentImages] = useState([]);

    const [requestModalOpen, setRequestModalOpen] = useState(false);
    const [requestOrder, setRequestOrder] = useState(null);
    const [requestSum, setRequestSum] = useState("");
    const [requestComment, setRequestComment] = useState("");
    const [requestSubmitting, setRequestSubmitting] = useState(false);

    const { openDebtModal } = useContext(ModalContext);
    const creatorsCacheRef = useRef({});

    const preferredCategoryIds = useMemo(() => {
        const ids = profile?.preferredCategoryIds;
        return Array.isArray(ids) ? ids.map((x) => Number(x)).filter(Number.isFinite) : [];
    }, [profile]);

    const preferredCategories = useMemo(() => {
        if (!preferredCategoryIds.length) return [];
        const map = new Map((categories || []).map((c) => [Number(c.id), c]));
        return preferredCategoryIds.map((id) => map.get(Number(id))).filter(Boolean);
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
        const parts = [o?.category?.name, o?.subcategory?.name, o?.service?.name].filter(Boolean);
        return parts.length ? parts.join(" • ") : "Не указано";
    };

    useEffect(() => {
        const p = new URLSearchParams(window.location.search);
        const promoReturn = p.get("promoReturn") === "1";
        const paymentId = p.get("paymentId");

        if (!promoReturn || !paymentId) return;

        (async () => {
            try {
                const res = await axiosInstance.get(`/payments/status?paymentId=${encodeURIComponent(paymentId)}`);

                if (res.data?.status === "succeeded") {
                    toast.success("Продвижение оплачено ✅");
                } else if (res.data?.status === "pending") {
                    toast.info("Платёж обрабатывается… обновите страницу через пару секунд");
                } else {
                    toast.error("Платёж не завершён");
                }
            } catch {
                toast.error("Не удалось проверить платёж");
            } finally {
                p.delete("promoReturn");
                p.delete("paymentId");
                const newUrl = `${window.location.pathname}${p.toString() ? `?${p.toString()}` : ""}`;
                window.history.replaceState({}, "", newUrl);
            }
        })();
    }, []);

    useEffect(() => {
        axiosInstance
            .get("/category")
            .then((res) => setCategories(res.data || []))
            .catch(() => setCategories([]));
    }, []);

    const fetchProfile = useCallback(async () => {
        try {
            const res = await axiosInstance.get("/auth/profile");
            setProfile(res.data);
            setUserId(res.data?.id || null);
        } catch {
            console.info("OrdersPage: profile not loaded (maybe not logged in).");
        }
    }, []);

    useEffect(() => {
        fetchProfile();
    }, [fetchProfile]);

    const fetchOrders = useCallback(async () => {
        try {
            const res = await axiosInstance.get("/orders/all");
            setOrdersRaw(res.data || []);
        } catch (e) {
            console.error(e);
            toast.error("Не удалось загрузить заказы");
        }
    }, []);

    useEffect(() => {
        fetchOrders();

        socket.on("orderUpdated", fetchOrders);

        return () => {
            socket.off("orderUpdated", fetchOrders);
        };
    }, [fetchOrders]);

    const fetchExpress = useCallback(async () => {
        try {
            const res = await axiosInstance.get("/express/express-orders/available");
            setExpressRaw(res.data?.orders || []);
        } catch (e) {
            console.error("fetchExpress error:", e);
        }
    }, []);

    const fetchBusyState = useCallback(async () => {
        const token = localStorage.getItem("authToken");

        if (!token) {
            setBusyState({
                loading: false,
                hasBusyRegular: false,
                hasBusyTaxi: false,
                hasAnyBusy: false,
            });
            return;
        }

        try {
            const [regularRes, expressRes] = await Promise.allSettled([
                axiosInstance.get("/orders/active-orders", {
                    headers: { Authorization: `Bearer ${token}` },
                }),
                axiosInstance.get("/express/express-orders/me?mode=active", {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            ]);

            let hasBusyRegular = false;
            let hasBusyTaxi = false;

            if (regularRes.status === "fulfilled") {
                const regularOrders = regularRes.value?.data?.orders || [];
                hasBusyRegular = regularOrders.some((o) => {
                    const isExecutor = Number(o.executorId) === Number(userId);
                    const activeStatuses = ["active", "in_progress", "pending_payment"];
                    return isExecutor && activeStatuses.includes(String(o.status));
                });
            }

            if (expressRes.status === "fulfilled") {
                const expressOrders = expressRes.value?.data?.orders || [];
                hasBusyTaxi = expressOrders.some((o) => {
                    const isExecutor = Number(o.executorId) === Number(userId);
                    const isTaxi = String(o.type) === "taxi";
                    const activeStatuses = ["accepted", "on_the_way_to_A", "arrived_at_A", "in_progress"];
                    return isExecutor && isTaxi && activeStatuses.includes(String(o.status));
                });
            }

            setBusyState({
                loading: false,
                hasBusyRegular,
                hasBusyTaxi,
                hasAnyBusy: hasBusyRegular || hasBusyTaxi,
            });
        } catch (e) {
            console.error("fetchBusyState error:", e);
            setBusyState({
                loading: false,
                hasBusyRegular: false,
                hasBusyTaxi: false,
                hasAnyBusy: false,
            });
        }
    }, [userId]);

    const savePendingOrderRequest = ({ orderId, proposedSum, comment }) => {
        sessionStorage.setItem(
            "pendingOrderRequestAfterDebtPayment",
            JSON.stringify({
                orderId,
                proposedSum,
                comment: comment || "",
                createdAt: Date.now(),
            })
        );
    };

    const getPendingOrderRequest = () => {
        try {
            const raw = sessionStorage.getItem("pendingOrderRequestAfterDebtPayment");
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    };

    const clearPendingOrderRequest = () => {
        sessionStorage.removeItem("pendingOrderRequestAfterDebtPayment");
    };

    const submitRegularOrderRequest = useCallback(
        async ({ orderId, proposedSum, comment }) => {
            const token = localStorage.getItem("authToken");
            if (!token) {
                toast.info("Войдите, чтобы запросить выполнение");
                navigate("/login");
                return false;
            }

            await axiosInstance.post(
                `/orders/${orderId}/request`,
                { proposedSum, comment },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            toast.success("Запрос отправлен заказчику!");
            await fetchBusyState();
            return true;
        },
        [fetchBusyState, navigate]
    );

    useEffect(() => {
        if (!userId) {
            setBusyState({
                loading: false,
                hasBusyRegular: false,
                hasBusyTaxi: false,
                hasAnyBusy: false,
            });
            return;
        }

        fetchBusyState();
    }, [userId, fetchBusyState]);

    useEffect(() => {
        if (!userId) return;

        socket.on("orderUpdated", fetchBusyState);
        socket.on("activeOrdersUpdated", fetchBusyState);

        return () => {
            socket.off("orderUpdated", fetchBusyState);
            socket.off("activeOrdersUpdated", fetchBusyState);
        };
    }, [userId, fetchBusyState]);

    const busyHintText = useMemo(() => {
        if (busyState.loading) return "Проверяем активные заказы...";
        if (!busyState.hasAnyBusy) return "";

        if (busyState.hasBusyRegular) {
            return "У вас уже есть активный обычный заказ. Сначала завершите его.";
        }

        if (busyState.hasBusyTaxi) {
            return "У вас уже есть активный заказ такси. Сначала завершите его.";
        }

        return "У вас уже есть активный заказ. Сначала завершите его.";
    }, [busyState]);

    useEffect(() => {
        fetchExpress();
        socket.on("orderUpdated", fetchExpress);
        socket.on("expressOrdersUpdated", fetchExpress);

        return () => {
            socket.off("orderUpdated", fetchExpress);
            socket.off("expressOrdersUpdated", fetchExpress);
        };
    }, [fetchExpress]);

    const expressAsOrders = useMemo(() => {
        return (expressRaw || []).map((e) => ({
            id: `e-${e.id}`,
            express: true,
            expressId: e.id,
            taxi_courier: true,
            expressType: e.type,
            createdAt: e.createdAt || e.created_at,
            coordinates: `${Number(e.fromLat)},${Number(e.fromLng)}`,
            address: `${e.fromAddress} → ${e.toAddress}`,
            description: e.description || "",
            proposedSum: Number(e.totalPrice ?? 0),
            paymentType: e.paymentType,
            images: [],
            category: { name: e.type === "taxi" ? "Такси" : "Курьер" },
            subcategory: e.subcategory ? { name: e.subcategory } : null,
            service: null,
            creatorId: e.creatorId,
            executorId: e.executorId,
            status: "pending",
            is_recommended: false,
            is_highlighted: false,
        }));
    }, [expressRaw]);

    const allRaw = useMemo(() => {
        const a = Array.isArray(ordersRaw) ? ordersRaw : [];
        const b = Array.isArray(expressAsOrders) ? expressAsOrders : [];
        return [...a, ...b];
    }, [ordersRaw, expressAsOrders]);

    useEffect(() => {
        const ids = [...new Set((allRaw || []).map((o) => o.creatorId).filter(Boolean))];
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
                    if (r.status === "fulfilled") {
                        creatorsCacheRef.current[id] = r.value.data;
                    }
                });

                setCreatorsInfo({ ...creatorsCacheRef.current });
            } catch {}
        })();
    }, [allRaw]);

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

        (async () => {
            try {
                setLocLoading(true);
                setLocError(null);

                const pos = await getCurrentLocation({
                    timeout: 25000,
                    maximumAge: 0,
                    enableHighAccuracy: true,
                });

                const latitude = pos.latitude;
                const longitude = pos.longitude;

                setUserLocation({ latitude, longitude });
                setIsGeolocationDenied(false);

                try {
                    const addr = await reverseGeocodeYandex({
                        lat: latitude,
                        lng: longitude,
                        apiKey: YM_KEY,
                    });

                    if (addr) setLocationDraft(addr);
                } catch {}

            } catch (e) {
                console.error("OrdersPage GPS error:", e);
                setIsGeolocationDenied(true);
                setLocError(getLocationErrorMessage(e));
            } finally {
                setLocLoading(false);
            }
        })();
    }, [profile, YM_KEY]);

    const pullLocationFromProfile = async () => {
        setLocationMenuOpen(false);

        if (!profile) {
            toast.info("Профиль ещё не загружен");
            return;
        }

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
        new Promise(async (resolve) => {
            setLocationMenuOpen(false);

            try {
                setLocLoading(true);
                setLocError(null);

                const pos = await getCurrentLocation({
                    timeout: 25000,
                    maximumAge: 0,
                    enableHighAccuracy: true,
                });

                const latitude = pos.latitude;
                const longitude = pos.longitude;

                setUserLocation({ latitude, longitude });
                setIsGeolocationDenied(false);

                try {
                    const addr = await reverseGeocodeYandex({
                        lat: latitude,
                        lng: longitude,
                        apiKey: YM_KEY,
                    });

                    if (addr) setLocationDraft(addr);
                } catch {}

                toast.success("Местоположение обновлено по GPS");
                resolve(true);
            } catch (e) {
                console.error("detectGpsNow error:", e);

                const message = getLocationErrorMessage(e);

                setLocError(message);
                setIsGeolocationDenied(true);
                toast.error(message);

                resolve(false);
            } finally {
                setLocLoading(false);
            }
        });

    const handleOpenOrdersMap = () => {
        setShowOrdersMap(true);

        if (!userLocation?.latitude || !userLocation?.longitude) {
            detectGpsNow().catch(() => {});
        }
    };

    const handleOpenLocationPicker = () => {
        setLocationMenuOpen(false);
        setShowLocationPicker(true);
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

    const visibleOrders = useMemo(() => {
        const base = Array.isArray(allRaw) ? allRaw : [];

        const tabFiltered =
            activeTab === "recommended"
                ? base.filter((o) => !!o.is_recommended)
                : activeTab === "courier"
                    ? base.filter((o) => !!o.taxi_courier)
                    : base;

        const professionFiltered =
            useProfileProfessions && preferredCategoryIds.length > 0
                ? tabFiltered.filter((o) => {
                    if (o.taxi_courier) return true;
                    const catId = Number(o.categoryId ?? o.category?.id);
                    if (!catId) return false;
                    return preferredCategoryIds.includes(catId);
                })
                : tabFiltered;

        const hasDrawerFilters = !!(selectedCategory || selectedSubcategory);
        const hideTaxiCourierInAllWhenFiltered = activeTab === "all" && hasDrawerFilters;

        const baseForDrawer = hideTaxiCourierInAllWhenFiltered
            ? professionFiltered.filter((o) => !o.taxi_courier)
            : professionFiltered;

        const byCategory = selectedCategory
            ? baseForDrawer.filter((o) => {
                if (o.express) return true;
                return Number(o.categoryId ?? o.category?.id) === Number(selectedCategory);
            })
            : baseForDrawer;

        const bySubcategory = selectedSubcategory
            ? byCategory.filter((o) => {
                if (o.express) return true;
                return Number(o.subcategoryId ?? o.subcategory?.id) === Number(selectedSubcategory);
            })
            : byCategory;

        if (!userLocation?.latitude || !userLocation?.longitude) return [];

        const geoFiltered = bySubcategory
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

                return {
                    ...order,
                    _distance: distance,
                    latitude: lat,
                    longitude: lon,
                };
            })
            .filter((o) => o && o._distance <= RADIUS_KM);

        return [...geoFiltered].sort((a, b) => {
            const ad = Number.isFinite(a._distance) ? a._distance : 1e9;
            const bd = Number.isFinite(b._distance) ? b._distance : 1e9;
            if (ad !== bd) return ad - bd;
            const getOrderTimestamp = (order) => {
                const rawDate = order.createdAt || order.created_at;
                const timestamp = rawDate ? new Date(rawDate).getTime() : 0;

                return Number.isFinite(timestamp) ? timestamp : 0;
            };
        });
    }, [
        allRaw,
        activeTab,
        preferredCategoryIds,
        selectedCategory,
        selectedSubcategory,
        userLocation,
        useProfileProfessions,
    ]);

    const locationStatusText = useMemo(() => {
        if (locLoading) return "Определяем адрес…";
        if (userLocation?.latitude && userLocation?.longitude) {
            return locationDraft || `Радиус ${RADIUS_KM} км`;
        }
        return "Не задано";
    }, [locLoading, userLocation, locationDraft]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const debtReturn = params.get("debtReturn") === "1";
        const resumeRequest = params.get("resumeRequest") === "1";

        if (!debtReturn || !resumeRequest) return;

        const pendingRequest = getPendingOrderRequest();
        if (!pendingRequest?.orderId || !pendingRequest?.proposedSum) {
            params.delete("debtReturn");
            params.delete("resumeRequest");
            const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
            window.history.replaceState({}, "", newUrl);
            return;
        }

        let cancelled = false;

        const resume = async () => {
            try {
                for (let attempt = 0; attempt < 10; attempt++) {
                    if (cancelled) return;

                    const profileRes = await axiosInstance.get("/auth/profile");
                    const debt = Number(profileRes.data?.debt || 0);

                    if (debt <= 0) {
                        await submitRegularOrderRequest({
                            orderId: pendingRequest.orderId,
                            proposedSum: pendingRequest.proposedSum,
                            comment: pendingRequest.comment || "",
                        });

                        clearPendingOrderRequest();

                        params.delete("debtReturn");
                        params.delete("resumeRequest");
                        const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
                        window.history.replaceState({}, "", newUrl);
                        return;
                    }

                    await new Promise((resolve) => setTimeout(resolve, 1500));
                }

                toast.info("Оплата ещё обрабатывается. Попробуйте ещё раз через пару секунд.");
            } catch (e) {
                console.error("resume request after debt payment error:", e);
                toast.error("Не удалось автоматически отправить запрос после оплаты");
            }
        };

        resume();

        return () => {
            cancelled = true;
        };
    }, [submitRegularOrderRequest]);

    const openRequestModal = (order) => {
        setRequestOrder(order);
        setRequestSum("");
        setRequestComment("");
        setRequestModalOpen(true);
    };

    const closeRequestModal = () => {
        if (requestSubmitting) return;

        setRequestModalOpen(false);
        setRequestOrder(null);
        setRequestSum("");
        setRequestComment("");
    };

    const handleRequestSumChange = (e) => {
        const onlyDigits = e.target.value.replace(/\D/g, "");
        setRequestSum(onlyDigits);
    };

    const submitRequestFromModal = async () => {
        if (!requestOrder?.id) {
            toast.error("Заказ не выбран");
            return;
        }

        const token = localStorage.getItem("authToken");

        if (!token) {
            toast.info("Войдите, чтобы запросить выполнение");
            navigate("/login");
            return;
        }

        if (busyState.hasAnyBusy) {
            toast.info(busyHintText);
            return;
        }

        const normalizedSum = Number(requestSum);

        if (!Number.isFinite(normalizedSum) || normalizedSum <= 0) {
            toast.error("Введите сумму цифрами");
            return;
        }

        try {
            setRequestSubmitting(true);

            const statusRes = await axiosInstance.get("/orders/me/status", {
                headers: { Authorization: `Bearer ${token}` },
            });

            const debt = Number(statusRes.data?.debt || 0);

            if (debt > 0) {
                savePendingOrderRequest({
                    orderId: requestOrder.id,
                    proposedSum: normalizedSum,
                    comment: requestComment.trim(),
                });

                closeRequestModal();

                openDebtModal({
                    title: "Есть задолженность по комиссии",
                    description:
                        "Чтобы отправить запрос на этот заказ, сначала оплатите задолженность. После оплаты запрос отправится автоматически.",
                    amount: debt,
                    returnPath: "/orders?debtReturn=1&resumeRequest=1",
                });

                return;
            }

            await submitRegularOrderRequest({
                orderId: requestOrder.id,
                proposedSum: normalizedSum,
                comment: requestComment.trim(),
            });

            closeRequestModal();
        } catch (e) {
            console.error(e);
            toast.error(e.response?.data?.message || "Ошибка. Попробуйте позже.");
        } finally {
            setRequestSubmitting(false);
        }
    };

    // --- pull to refresh ---
    useEffect(() => {
        const onPullToRefresh = async (e) => {
            try {
                await Promise.allSettled([
                    fetchProfile(),
                    fetchOrders(),
                    fetchExpress(),
                    fetchBusyState(),
                ]);
            } finally {
                e.detail?.done?.();
            }
        };

        window.addEventListener("appPullToRefresh", onPullToRefresh);

        return () => {
            window.removeEventListener("appPullToRefresh", onPullToRefresh);
        };
    }, [fetchProfile, fetchOrders, fetchExpress, fetchBusyState]);

    return (
        <div className={`orders-page orders-page--${platform}`}>
            <div className="orders-shell">
                <div className="orders-top glass">
                    <div className="orders-top-left">
                        <div className="orders-title">Все заказы</div>

                        <div className="orders-subtitle">
                            Радиус: <b>{RADIUS_KM} км</b> •{" "}
                            {useProfileProfessions && preferredCategoryIds.length
                                ? "по вашим профессиям"
                                : "все категории"}{" "}
                            • Найдено: <b>{visibleOrders.length}</b>
                        </div>

                        <div className="orders-location-row">
                            <div className="orders-location-pill">
                                <FaLocationArrow className="orders-location-main-icon" />
                                <span className="orders-location-text">{locationStatusText}</span>
                            </div>

                            <details
                                className="loc-menu"
                                open={locationMenuOpen}
                                onToggle={(e) => setLocationMenuOpen(Boolean(e.currentTarget.open))}
                            >
                                <summary className="loc-summary" aria-label="Местоположение">
                                    <FaLocationArrow />
                                    <span className="loc-summary-text">Местоположение</span>
                                </summary>

                                <div className="loc-menu-panel">
                                    <button
                                        className="btn btn-ghost"
                                        onClick={pullLocationFromProfile}
                                        disabled={locLoading}
                                    >
                                        Из профиля
                                    </button>

                                    <button
                                        className="btn btn-ghost"
                                        onClick={detectGpsNow}
                                        disabled={locLoading}
                                    >
                                        GPS
                                    </button>

                                    <button
                                        className="btn btn-ghost"
                                        onClick={handleOpenLocationPicker}
                                    >
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
                                    placeholder="Введите адрес"
                                />
                                <button
                                    className="btn btn-primary"
                                    disabled={locLoading || !locationDraft.trim()}
                                    onClick={() => geocodeAddress(locationDraft)}
                                >
                                    Применить
                                </button>
                            </div>
                        )}

                        {locError && <div className="orders-error">{locError}</div>}
                    </div>
                </div>

                <div className="orders-actions-bar glass">
                    <button className="btn btn-ghost" onClick={handleOpenOrdersMap}>
                        <FaMapMarkedAlt />
                        <span>Карта</span>
                    </button>

                    <button className="btn btn-primary" onClick={() => setDrawerOpen(true)}>
                        <FaSlidersH />
                        <span>Фильтры</span>
                    </button>
                </div>

                <div className="orders-tabs-row glass">
                    <button
                        className={`tab-pill ${activeTab === "all" ? "active" : ""}`}
                        onClick={() => setActiveTab("all")}
                    >
                        Все
                    </button>

                    <button
                        className={`tab-pill ${activeTab === "recommended" ? "active" : ""}`}
                        onClick={() => setActiveTab("recommended")}
                    >
                        В приоритете
                    </button>

                    <button
                        className={`tab-pill ${activeTab === "courier" ? "active" : ""}`}
                        onClick={() => setActiveTab("courier")}
                    >
                        Курьер / Такси
                    </button>

                    <span className="tabs-hint">
        Приоритетные подсвечиваются, но не поднимаются выше остальных.
    </span>
                </div>

                {activeTab === "all" && (selectedCategory || selectedSubcategory) && (
                    <div className="hint-text hint-text-panel">
                        Во вкладке «Все» при включённых фильтрах заказы «Курьер/Такси» скрываются.
                    </div>
                )}

                <div className="orders-list-wrap">
                    {!userLocation?.latitude || !userLocation?.longitude ? (
                        <div className="empty glass">
                            <div className="empty-title">Нужно местоположение</div>
                            <div className="empty-sub">
                                Чтобы показывать ближайшие заказы в радиусе {RADIUS_KM} км, укажи адрес или выбери точку на карте.
                            </div>
                            <div className="empty-actions">
                                <button className="btn btn-ghost" onClick={handleOpenLocationPicker}>
                                    Выбрать на карте
                                </button>
                            </div>
                        </div>
                    ) : visibleOrders.length > 0 ? (
                        <ul className="orders-list">
                            {visibleOrders.map((order) => {
                                const creator = creatorsInfo[order.creatorId] || {};
                                const isCreator = Number(order.creatorId) === Number(userId);
                                const isExpress = !!order.express;

                                const orderTiming = isExpress
                                    ? null
                                    : getOrderTiming(order);

                                const description =
                                    typeof order.description === "string"
                                        ? order.description.trim()
                                        : "";

                                const hasDescription = description.length > 0;

                                const canRequestRegular =
                                    !isExpress &&
                                    !isCreator &&
                                    !order.executorId &&
                                    order.status === "pending";

                                const canAcceptExpress =
                                    isExpress &&
                                    !isCreator &&
                                    !order.executorId &&
                                    ["pending", "created"].includes(String(order.status || "pending"));

                                const canTakeOrder = canRequestRegular || canAcceptExpress;

                                const displayId = isExpress ? order.expressId : order.id;

                                const courierBadgeText = isExpress
                                    ? order.expressType === "taxi"
                                        ? "Такси"
                                        : "Курьер"
                                    : "Курьер / Такси";

                                const cardClass = [
                                    "order-card",
                                    "glass",
                                    canTakeOrder ? "can-take" : "",
                                    isCreator ? "my-order" : "",
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

                                                    {isCreator && <span className="badge badge-my-order">Мой заказ</span>}

                                                    {canTakeOrder && <span className="badge badge-can-take">Можно взять</span>}

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
                                                    <span className={`v ${isExpress ? "route-line" : ""}`}>
                                                        {order.address || "—"}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        {Array.isArray(order.images) && order.images.length > 0 && (
                                            <div className="thumbs" onClick={() => openModal(order.images)}>
                                                {order.images.slice(0, 4).map((img, idx) => (
                                                    <img key={idx} className="thumb" src={`${apiUrl}${img}`} alt={`img-${idx}`} />
                                                ))}
                                                {order.images.length > 4 && (
                                                    <div className="thumb-more">+{order.images.length - 4}</div>
                                                )}
                                            </div>
                                        )}

                                        {hasDescription && (
                                            <div className="order-desc">
                                                <span className="k">Описание</span>
                                                <div className="v">{description}</div>
                                            </div>
                                        )}

                                        <div className="order-actions">
                                            <Link
                                                to={`/complaints/${order.creatorId}`}
                                                className="btn btn-ghost-danger btn-inline"
                                                aria-label={`Жалобы (${creator.complaintsCount || 0})`}
                                            >
                                                <FiAlertTriangle style={{ marginRight: 8 }} />
                                                {creator.complaintsCount || 0}
                                            </Link>

                                            <div className="order-main-actions">
                                                <button
                                                    className="btn btn-ghost"
                                                    onClick={() =>
                                                        navigate(isExpress ? `/express-order/${order.expressId}` : `/order/${order.id}`)
                                                    }
                                                >
                                                    Открыть
                                                </button>

                                                {!isExpress && canRequestRegular && (
                                                    <button
                                                        className="btn btn-primary"
                                                        disabled={busyState.loading || busyState.hasAnyBusy}
                                                        title={busyState.hasAnyBusy ? busyHintText : ""}
                                                        onClick={() => {
                                                            const token = localStorage.getItem("authToken");

                                                            if (!token) {
                                                                toast.info("Войдите, чтобы запросить выполнение");
                                                                navigate("/login");
                                                                return;
                                                            }

                                                            if (busyState.hasAnyBusy) {
                                                                toast.info(busyHintText);
                                                                return;
                                                            }

                                                            openRequestModal(order);
                                                        }}
                                                    >
                                                        {busyState.loading ? "Проверка..." : "Запросить выполнение"}
                                                    </button>
                                                )}

                                                {isExpress && (
                                                    <ExpressRouteButtons
                                                        orderId={order.expressId}
                                                        canToA={true}
                                                        canAToB={true}
                                                        className="express-nav"
                                                        buttonClassName="btn btn-ghost express-nav-btn"
                                                    />
                                                )}

                                                {isExpress && canAcceptExpress && (
                                                    <button
                                                        className="btn btn-primary"
                                                        disabled={busyState.loading || busyState.hasAnyBusy}
                                                        title={busyState.hasAnyBusy ? busyHintText : ""}
                                                        onClick={async () => {
                                                            if (busyState.hasAnyBusy) {
                                                                toast.info(busyHintText);
                                                                return;
                                                            }

                                                            const confirmed = window.confirm(
                                                                `Вы уверены, что хотите взять в работу этот экспресс-заказ №${order.expressId}?`
                                                            );

                                                            if (!confirmed) return;

                                                            try {
                                                                await axiosInstance.post(`/express/express-orders/${order.expressId}/accept`);
                                                                toast.success("Заказ принят!");
                                                                await fetchExpress();
                                                                await fetchBusyState();
                                                                navigate("/active-orders");
                                                            } catch (e) {
                                                                toast.error(e.response?.data?.message || "Ошибка");
                                                            }
                                                        }}
                                                    >
                                                        {busyState.loading ? "Проверка..." : "Принять"}
                                                    </button>
                                                )}
                                            </div>

                                            {busyState.hasAnyBusy && canTakeOrder && (
                                                <div className="blocked-order-hint">{busyHintText}</div>
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
                                <button className="btn btn-ghost" onClick={handleOpenLocationPicker}>
                                    Выбрать место
                                </button>
                            </div>
                        </div>
                    )}
                </div>

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

                                {profile && (
                                    <div className="drawer-section drawer-section-professions">
                                        <div className="drawer-section-head">
                                            <div>
                                                <div className="drawer-section-title">
                                                    Профессии из профиля
                                                </div>

                                                <div className="drawer-section-sub">
                                                    {preferredCategoryIds.length > 0
                                                        ? "Показываем заказы по выбранным направлениям. Такси и курьер остаются видимыми."
                                                        : "Выберите направления в профиле, чтобы видеть более подходящие заказы."}
                                                </div>
                                            </div>

                                            {preferredCategoryIds.length > 0 && (
                                                <span className={`drawer-status-pill ${useProfileProfessions ? "active" : ""}`}>
                    {useProfileProfessions ? "Включено" : "Отключено"}
                </span>
                                            )}
                                        </div>

                                        {preferredCategoryIds.length > 0 ? (
                                            <>
                                                <div className="pref-bar__chips drawer-profession-chips">
                                                    {preferredCategoryIds.map((id) => {
                                                        const found = preferredCategories.find(
                                                            (c) => Number(c.id) === Number(id)
                                                        );

                                                        return (
                                                            <span key={id} className="pref-chip" title={found?.name || ""}>
                                {found?.name || `Категория #${id}`}
                            </span>
                                                        );
                                                    })}
                                                </div>

                                                <div className="drawer-profession-actions">
                                                    <button
                                                        className="btn btn-ghost"
                                                        onClick={() => navigate("/profile")}
                                                    >
                                                        Изменить
                                                    </button>

                                                    <button
                                                        className="btn btn-ghost"
                                                        onClick={() => {
                                                            setUseProfileProfessions(false);
                                                            toast.info("Профессии из профиля временно отключены.");
                                                        }}
                                                    >
                                                        Сбросить профессии
                                                    </button>

                                                    <button
                                                        className="btn btn-ghost"
                                                        onClick={() => {
                                                            setSelectedCategory("");
                                                            setSelectedSubcategory("");
                                                            setSubcategories([]);
                                                            setActiveTab("all");
                                                            setUseProfileProfessions(false);
                                                            toast.info("Все фильтры сброшены.");
                                                        }}
                                                    >
                                                        Показать всё
                                                    </button>

                                                    {!useProfileProfessions && (
                                                        <button
                                                            className="btn btn-primary"
                                                            onClick={() => {
                                                                setUseProfileProfessions(true);
                                                                toast.info("Фильтр по профессиям из профиля включен.");
                                                            }}
                                                        >
                                                            Включить профессии
                                                        </button>
                                                    )}
                                                </div>
                                            </>
                                        ) : (
                                            <div className="drawer-profession-empty">
                                                <div className="drawer-profession-empty-text">
                                                    Пока профессии не выбраны. Сейчас отображаются все категории.
                                                </div>

                                                <button
                                                    className="btn btn-primary"
                                                    onClick={() => navigate("/profile")}
                                                >
                                                    Выбрать в профиле
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="field">
                                    <label>Категория</label>
                                    <select
                                        value={selectedCategory}
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            setSelectedCategory(v);
                                            setSelectedSubcategory("");
                                            fetchSubcategories(v);
                                        }}
                                    >
                                        <option value="">Все</option>
                                        {categories
                                            .filter((c) => !HIDE_FROM_DRAWER.has(String(c.name || "").trim()))
                                            .map((c) => (
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
                                        onChange={(e) => setSelectedSubcategory(e.target.value)}
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
                                        setSubcategories([]);
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

                <YandexMapModal
                    isOpen={showOrdersMap}
                    onClose={() => setShowOrdersMap(false)}
                    initialLat={userLocation?.latitude ?? profile?.locationLat}
                    initialLng={userLocation?.longitude ?? profile?.locationLng}
                    orders={visibleOrders}
                    showOrders={true}
                    currentUserId={userId}
                    onPick={(picked) => {
                        setLocationDraft(picked.address);
                        setUserLocation({ latitude: picked.lat, longitude: picked.lng });
                        setShowOrdersMap(false);
                    }}
                />

                <YandexMapModal
                    isOpen={showLocationPicker}
                    onClose={() => {
                        setShowLocationPicker(false);
                        setLocationMenuOpen(false);
                    }}
                    initialLat={userLocation?.latitude ?? profile?.locationLat}
                    initialLng={userLocation?.longitude ?? profile?.locationLng}
                    showOrders={false}
                    orders={[]}
                    onPick={async (picked) => {
                        setLocationDraft(picked.address);
                        setUserLocation({ latitude: picked.lat, longitude: picked.lng });

                        await saveLocationToProfile({
                            address: picked.address,
                            lat: picked.lat,
                            lng: picked.lng,
                            source: "map",
                        });

                        setShowLocationPicker(false);
                        setLocationMenuOpen(false);
                    }}
                />

                <Modal
                    appElement={document.getElementById("root")}
                    isOpen={requestModalOpen}
                    onRequestClose={closeRequestModal}
                    contentLabel="Запросить выполнение"
                    className="request-order-modal"
                    overlayClassName="request-order-overlay"
                    parentSelector={() => document.body}
                >
                    <div className="request-order-content">
                        <button
                            type="button"
                            className="request-order-close"
                            onClick={closeRequestModal}
                            disabled={requestSubmitting}
                            aria-label="Закрыть"
                        >
                            ×
                        </button>

                        <h2 className="request-order-title">Запросить выполнение</h2>

                        <p className="request-order-subtitle">
                            Укажите сумму, за которую готовы выполнить заказ, и при желании добавьте комментарий заказчику.
                        </p>

                        <div className="request-order-field">
                            <label>Ваша сумма, ₽</label>
                            <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={requestSum}
                                onChange={handleRequestSumChange}
                                placeholder="Например: 2500"
                                className="request-order-input"
                                autoFocus
                            />
                        </div>

                        <div className="request-order-field">
                            <label>Комментарий</label>
                            <textarea
                                value={requestComment}
                                onChange={(e) => setRequestComment(e.target.value)}
                                placeholder="Например: могу приехать сегодня после 18:00"
                                className="request-order-textarea"
                                rows={4}
                                maxLength={500}
                            />
                        </div>

                        <div className="request-order-actions">
                            <button
                                type="button"
                                className="request-order-btn ghost"
                                onClick={closeRequestModal}
                                disabled={requestSubmitting}
                            >
                                Отмена
                            </button>

                            <button
                                type="button"
                                className="request-order-btn primary"
                                onClick={submitRequestFromModal}
                                disabled={requestSubmitting || !requestSum}
                            >
                                {requestSubmitting ? "Отправляем..." : "Отправить запрос"}
                            </button>
                        </div>
                    </div>
                </Modal>

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
                    <button className="img-close" onClick={closeModal}>×</button>

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