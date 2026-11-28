import React, { useEffect, useMemo, useRef, useState, useCallback, useContext } from "react";
import { Capacitor } from "@capacitor/core";
import { Link, useNavigate } from "react-router-dom";
import OrderServiceDetails from "../components/OrderServiceDetails";
import { getOrderServiceDetails } from "../utils/orderServiceDetails";
import { getCurrentLocation, getLocationErrorMessage } from "../utils/getCurrentLocation";
import { ModalContext } from "../components/modalContext";
import axios from "axios";
import axiosInstance from "../utils/axiosInstance";
import { toast } from "react-toastify";
import { socket } from "../socketClient";
import {
    fetchExecutorBusyState,
} from "../utils/executorBusyState";
import TaxiVehicleGateModal from "../components/TaxiVehicleGateModal";
import "../styles/OrdersPage.css";
import "../styles/OrdersPageDark.css";
import AvailableOrderCard
    from "../components/AvailableOrderCard";

import {
    BottomSheet,
    Button,
} from "../components/ui";

import "../styles/OrdersRedesign.css";
import YandexMapModal from "../components/YandexMapModal";
import ExpressRouteButtons from "../components/ExpressRouteButtons";
import RegularAdvanceTimeField from "../components/RegularAdvanceTimeField";
import { FaMapMarkedAlt, FaSlidersH, FaLocationArrow } from "react-icons/fa";
import { FiAlertTriangle } from "react-icons/fi";
import { FaUniversity, FaMoneyBillWave, FaCreditCard, FaQuestionCircle } from "react-icons/fa";
import { Zap, Clock3, ChevronLeft, ChevronRight } from "lucide-react";
import {
    orderHasSocialDiscount,
    getSocialCommissionPreview,
} from "../utils/socialCommissionPreview";
import ExpressNextOrderButton
    from "../components/ExpressNextOrderButton";

import ExpressPendingReservation
    from "../components/ExpressPendingReservation";

import {
    getMyExpressReservation,
} from "../utils/expressReservationApi";

import "../styles/ExpressReservedOrderCard.css";

const apiUrl = process.env.REACT_APP_API_URL;
const publicApi = axios.create({

    baseURL: `${apiUrl}/api`,

});

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

function parseLocationCoordinates(rawLat, rawLng) {
    const isMissing = (value) =>
        value === null ||
        value === undefined ||
        (typeof value === "string" && value.trim() === "");

    if (isMissing(rawLat) || isMissing(rawLng)) {
        return null;
    }

    if (
        !["number", "string"].includes(typeof rawLat) ||
        !["number", "string"].includes(typeof rawLng)
    ) {
        return null;
    }

    const latitude = Number(rawLat);
    const longitude = Number(rawLng);

    if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        Math.abs(latitude) > 90 ||
        Math.abs(longitude) > 180 ||
        (latitude === 0 && longitude === 0)
    ) {
        return null;
    }

    return { latitude, longitude };
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

function getOrderTimestamp(order) {
    const rawDate =
        order?.createdAt ??
        order?.created_at ??
        null;

    if (!rawDate) return 0;

    const timestamp = new Date(rawDate).getTime();

    return Number.isFinite(timestamp)
        ? timestamp
        : 0;
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
    const ordersRequestIdRef = useRef(0);
    const expressRequestIdRef = useRef(0);
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

    const [
        selectedOrderId,
        setSelectedOrderId,
    ] = useState(null);

    const [
        selectedOrderSnapshot,
        setSelectedOrderSnapshot,
    ] = useState(null);

    const requestSubmitRef = useRef(false);

    const openOrderDetails = (order) => {
        setSelectedOrderId(order.id);
        setSelectedOrderSnapshot(order);
    };

    const closeOrderDetails = () => {
        if (requestSubmitRef.current) {
            return;
        }

        setSelectedOrderId(null);
        setSelectedOrderSnapshot(null);
    };

    const [
        pendingExpressReservation,
        setPendingExpressReservation,
    ] = useState(null);

    const [
        expressReservationLoading,
        setExpressReservationLoading,
    ] = useState(false);

    const [
        expressReservationError,
        setExpressReservationError,
    ] = useState("");

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
    const [requestAvailableAt, setRequestAvailableAt] = useState("");
    const [requestSubmitting, setRequestSubmitting] = useState(false);

    const { openDebtModal } = useContext(ModalContext);
    const creatorsCacheRef = useRef({});

    const [
        vehicleGateModal,
        setVehicleGateModal,
    ] = useState(null);

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
                    toast.success("Продвижение оплачено");
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
        publicApi
            .get("/category")
            .then((res) => setCategories(res.data || []))
            .catch((error) => {
                console.error("Categories loading error:", error);
                setCategories([]);
            });
    }, []);

    const fetchProfile = useCallback(async () => {
        const token = localStorage.getItem("authToken");

        if (!token) {
            setProfile(null);
            setUserId(null);
            return;
        }

        try {
            const res = await axiosInstance.get("/auth/profile", {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            setProfile(res.data || null);
            setUserId(res.data?.id || null);
        } catch (error) {
            console.info(
                "OrdersPage: profile not loaded.",
                error.response?.status
            );

            setProfile(null);
            setUserId(null);
        }
    }, []);

    useEffect(() => {
        fetchProfile();
    }, [fetchProfile]);

    const fetchOrders = useCallback(async () => {
        const requestId = ++ordersRequestIdRef.current;

        try {
            const res = await publicApi.get("/orders/all");

            const orders = Array.isArray(res.data)
                ? res.data
                : Array.isArray(res.data?.orders)
                    ? res.data.orders
                    : null;

            if (!orders) {
                throw new Error("INVALID_ORDERS_RESPONSE");
            }

            if (requestId !== ordersRequestIdRef.current) {
                return;
            }

            setOrdersRaw(orders);
        } catch (error) {
            if (requestId !== ordersRequestIdRef.current) {
                return;
            }

            console.error("fetchOrders error:", {
                status: error.response?.status,
                code: error.code,
                message: error.message,
            });

            toast.error(
                "Не удалось загрузить заказы. Попробуйте обновить страницу.",
                { toastId: "orders-loading-error" }
            );
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
        const requestId = ++expressRequestIdRef.current;

        try {
            const res = await publicApi.get(
                "/express/express-orders/available"
            );

            if (!Array.isArray(res.data?.orders)) {
                throw new Error("INVALID_EXPRESS_ORDERS_RESPONSE");
            }

            if (requestId !== expressRequestIdRef.current) {
                return;
            }

            setExpressRaw(res.data.orders);
        } catch (error) {
            if (requestId !== expressRequestIdRef.current) {
                return;
            }

            console.error("fetchExpress error:", {
                status: error.response?.status,
                code: error.code,
                message: error.message,
            });

            toast.error(
                "Не удалось загрузить экспресс-заказы.",
                { toastId: "express-orders-loading-error" }
            );
        }
    }, []);

    const fetchBusyState = useCallback(async () => {
        const token = localStorage.getItem("authToken");

        if (!token || !userId) {
            setBusyState({
                loading: false,
                hasBusyRegular: false,
                hasBusyTaxi: false,
                hasAnyBusy: false,
            });

            return;
        }

        try {
            const result =
                await fetchExecutorBusyState(userId);

            setBusyState({
                loading: false,
                ...result,
            });
        } catch (error) {
            console.error(
                "Не удалось проверить занятость:",
                error
            );

            /*
             * Если проверка не состоялась,
             * действия остаются заблокированными.
             */
            setBusyState({
                loading: true,
                hasBusyRegular: false,
                hasBusyTaxi: false,
                hasAnyBusy: true,
            });
        }
    }, [userId]);

    const refreshExpressReservation =
        useCallback(async () => {
            if (!userId) {
                setPendingExpressReservation(null);
                return;
            }

            setExpressReservationLoading(true);
            setExpressReservationError("");

            try {
                const request =
                    await getMyExpressReservation();

                setPendingExpressReservation(
                    request
                );
            } catch {
                setExpressReservationError(
                    "Не удалось проверить следующее бронирование."
                );
            } finally {
                setExpressReservationLoading(false);
            }
        }, [userId]);

    useEffect(() => {
        if (
            !userId ||
            busyState.loading
        ) {
            return;
        }

        if (!busyState.canRequestNextExpress) {
            setPendingExpressReservation(null);
            setExpressReservationError("");
            return;
        }

        const refresh = () => {
            void refreshExpressReservation();
        };

        const refreshOnChange = () => {
            void fetchBusyState();
            refresh();
        };

        refresh();

        const interval =
            setInterval(refresh, 15000);

        socket.on(
            "expressReservationsUpdated",
            refreshOnChange
        );

        window.addEventListener(
            "focus",
            refreshOnChange
        );

        return () => {
            clearInterval(interval);

            socket.off(
                "expressReservationsUpdated",
                refreshOnChange
            );

            window.removeEventListener(
                "focus",
                refreshOnChange
            );
        };
    }, [
        userId,
        busyState.loading,
        busyState.canRequestNextExpress,
        fetchBusyState,
        refreshExpressReservation,
    ]);

    const savePendingOrderRequest = ({ orderId, proposedSum, comment, availableAt }) => {
        sessionStorage.setItem(
            "pendingOrderRequestAfterDebtPayment",
            JSON.stringify({
                orderId,
                proposedSum,
                comment: comment || "",
                createdAt: Date.now(),
                availableAt: availableAt || null,
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
        async ({ orderId, proposedSum, comment, availableAt }) => {
            const token = localStorage.getItem("authToken");
            if (!token) {
                toast.info("Войдите, чтобы запросить выполнение");
                navigate("/login");
                return false;
            }

            await axiosInstance.post(
                `/orders/${orderId}/request`,
                {
                    proposedSum,
                    comment,
                    availableAt: availableAt
                        ? new Date(availableAt).toISOString()
                        : null,
                },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            toast.success("Запрос отправлен заказчику!");
            await fetchBusyState();
            return true;
        },
        [fetchBusyState, navigate]
    );

    useEffect(() => {
        if (!userId) {
            return undefined;
        }

        const refreshAfterRequest = () => {
            void Promise.allSettled([
                fetchOrders(),
                fetchBusyState(),
            ]);
        };

        window.addEventListener(
            "cargocamp:order-request-sent",
            refreshAfterRequest
        );

        return () => {
            window.removeEventListener(
                "cargocamp:order-request-sent",
                refreshAfterRequest
            );
        };

    }, [
        userId,
        fetchOrders,
        fetchBusyState,
    ]);

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
            return "У вас уже есть активный экспресс-заказ. Сначала завершите его.";
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

            createdAt:
                e.createdAt ||
                e.created_at,

            creatorId: e.creatorId,
            creatorSocialBenefitAtCreation:
                e.creatorSocialBenefitAtCreation ??
                e.creator_social_benefit_at_creation ??
                null,
            executorId: e.executorId,

            status:
                e.status ||
                "pending",

            fromAddress:
                e.fromAddress ||
                e.from_address ||
                "",

            toAddress:
                e.toAddress ||
                e.to_address ||
                "",

            fromLat:
                e.fromLat ??
                e.from_lat ??
                null,

            fromLng:
                e.fromLng ??
                e.from_lng ??
                null,

            toLat:
                e.toLat ??
                e.to_lat ??
                null,

            toLng:
                e.toLng ??
                e.to_lng ??
                null,

            /*
             * Поле coordinates оставляем для фильтрации
             * и отображения заказа на общей карте.
             */
            coordinates:
                e.fromLat != null &&
                e.fromLng != null
                    ? `${e.fromLat},${e.fromLng}`
                    : "",

            address:
                `${e.fromAddress || e.from_address || "Точка А"} → ` +
                `${e.toAddress || e.to_address || "Точка Б"}`,

            description:
                e.description ||
                "",

            proposedSum: Number(
                e.totalPrice ??
                e.total_price ??
                e.price ??
                0
            ),

            paymentType:
                e.paymentType ||
                e.payment_type ||
                "cash",

            images: Array.isArray(e.images)
                ? e.images
                : [],

            category: {
                name:
                    e.type === "taxi"
                        ? "Такси"
                        : "Курьер",
            },

            subcategory: e.subcategory
                ? { name: e.subcategory }
                : null,

            service: null,

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
                    missing.map((id) => publicApi.get(`/auth/${id}`))
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

        const savedCoordinates = parseLocationCoordinates(
            profile.locationLat,
            profile.locationLng
        );

        if (savedCoordinates) {
            const {
                latitude: lat,
                longitude: lng,
            } = savedCoordinates;

            setUserLocation(savedCoordinates);
            setIsGeolocationDenied(false);

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

        const savedCoordinates = parseLocationCoordinates(
            profile.locationLat,
            profile.locationLng
        );

        if (!savedCoordinates) {
            toast.info(
                "В профиле нет сохранённых координат. Укажите местоположение в профиле."
            );
            return;
        }

        const {
            latitude: lat,
            longitude: lng,
        } = savedCoordinates;

        setUserLocation(savedCoordinates);
        setIsGeolocationDenied(false);

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
            return {
                saved: false,
                guest: true,
            };
        }

        setLocLoading(true);
        setLocError(null);

        try {
            const res = await axios.post(
                `${apiUrl}/api/auth/location/me`,
                { address, lat, lng, source },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            toast.success("Местоположение сохранено");
            setProfile((previousProfile) => ({
                ...previousProfile,
                ...res.data.location,
            }));

            return {
                saved: true,
                guest: false,
            };
        } catch (error) {
            const message =
                error.response?.data?.message ||
                "Ошибка сохранения местоположения";

            setLocError(message);

            return {
                saved: false,
                guest: false,
            };
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
            const res = await publicApi.get(
                `/category/subcategory/${categoryId}`
            );

            setSubcategories(
                Array.isArray(res.data)
                    ? res.data
                    : []
            );
        } catch (error) {
            console.error("Subcategories loading error:", error);
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
            const ad = Number.isFinite(a._distance)
                ? a._distance
                : 1e9;

            const bd = Number.isFinite(b._distance)
                ? b._distance
                : 1e9;

            if (ad !== bd) {
                return ad - bd;
            }

            return getOrderTimestamp(b) - getOrderTimestamp(a);
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

    const selectedOrder = useMemo(() => {
        if (selectedOrderId === null) {
            return null;
        }

        return allRaw.find(
            order =>
                String(order.id) ===
                String(selectedOrderId)
        ) || null;

    }, [allRaw, selectedOrderId]);

    const selectedOrderForDisplay = selectedOrder
        ? {
            ...selectedOrderSnapshot,
            ...selectedOrder,
        }
        : selectedOrderSnapshot;

    const selectedOrderUnavailable =
        selectedOrderId !== null &&
        !selectedOrder;

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
                            availableAt: pendingRequest.availableAt || null,
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
        const pricing =
            getOrderServiceDetails(order);

        const suggestedSum =
            pricing.recommendedPrice ??
            Number(order?.proposedSum);

        setRequestOrder(order);

        setRequestSum(
            Number.isFinite(
                Number(suggestedSum)
            ) &&
            Number(suggestedSum) > 0
                ? String(
                    Math.round(
                        Number(suggestedSum)
                    )
                )
                : ""
        );

        setRequestComment("");
        setRequestAvailableAt("");
        setRequestModalOpen(true);
    };

    const closeRequestModal = (force = false) => {
        if (
            force !== true &&
            requestSubmitRef.current
        ) {
            return;
        }

        setRequestModalOpen(false);
        setRequestOrder(null);
        setRequestSum("");
        setRequestComment("");
        setRequestAvailableAt("");
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

        if (busyState.loading) {
            toast.info(
                "Не удалось завершить проверку занятости. " +
                "Обновите страницу и попробуйте снова."
            );

            return;
        }

        if (busyState.hasBusyTaxi) {
            toast.info(busyHintText);
            return;
        }

        if (busyState.hasBusyRegular && !requestAvailableAt) {
            toast.info(
                "Укажите, когда сможете освободиться от текущего заказа."
            );
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
                    availableAt: requestAvailableAt,
                });

                closeRequestModal(true);
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
                availableAt: requestAvailableAt,
            });

            closeRequestModal(true);
        } catch (e) {
            console.error(e);
            toast.error(e.response?.data?.message || "Ошибка. Попробуйте позже.");
        } finally {
            requestSubmitRef.current = false;
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


    const renderOrderDetails = (order) => {

                                const creator = creatorsInfo[order.creatorId] || {};
                                const isCreator = Number(order.creatorId) === Number(userId);
                                const isExpress = !!order.express;

                                const commissionPreview =
                                    getSocialCommissionPreview(order);

                                const isSocialDiscountOrder =
                                    commissionPreview !== null &&
                                    orderHasSocialDiscount(order, creator);

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

                                const canRequestNext =
                                    canAcceptExpress &&
                                    busyState.canRequestNextExpress === true;

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
                                    isExpress ? "express-order-card" : "",
                                ]
                                    .filter(Boolean)
                                    .join(" ");



        return (
                                    <article className={cardClass}>
                                        <div className="order-head">
                                            <div className="order-head-left">
                                                <div className="order-title-row">
                                                    <span className="order-number">
                                                        {isExpress ? `Экспресс №${displayId}` : `Заказ №${displayId}`}
                                                    </span>

                                                    {isCreator && <span className="badge badge-my-order">Мой заказ</span>}

                                                    {canTakeOrder && <span className="badge badge-can-take">Можно взять</span>}


                                                    {isSocialDiscountOrder && (
                                                        <span
                                                            className="badge badge-pensioner-order"
                                                            title={
                                                                `Комиссия исполнителя ` +
                                                                `${commissionPreview.discountedRubles} ₽ ` +
                                                                `вместо ${commissionPreview.baseRubles} ₽`
                                                            }
                                                        >
        Льготный · −50% комиссии
    </span>
                                                    )}


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

                                        {orderTiming && (
                                            <div
                                                className={`order-time-box ${
                                                    orderTiming.type === "asap"
                                                        ? "order-time-box--asap"
                                                        : "order-time-box--scheduled"
                                                }`}
                                            >
        <span className="order-time-icon" aria-hidden="true">
    {orderTiming.type === "asap" ? (
        <Zap size={20} strokeWidth={1.9} />
    ) : (
        <Clock3 size={20} strokeWidth={1.9} />
    )}
</span>

                                                <div className="order-time-content">
            <span className="order-time-label">
                {orderTiming.label}
            </span>

                                                    <span className="order-time-value">
                {orderTiming.value}
            </span>
                                                </div>
                                            </div>
                                        )}

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

                                        {!isExpress && (
                                            <OrderServiceDetails
                                                order={order}
                                                compact
                                            />
                                        )}

                                        <div className="order-actions">
                                            <Link
                                                to={`/complaints/${order.creatorId}`}
                                                className="btn btn-ghost-danger btn-inline complaint-btn"
                                                aria-label={`Жалобы (${creator.complaintsCount || 0})`}
                                            >
                                                <FiAlertTriangle
                                                    className="complaint-btn-icon"
                                                    aria-hidden="true"
                                                />

                                                <span className="complaint-btn-count">
        {creator.complaintsCount || 0}
    </span>
                                            </Link>

                                            <div className="order-main-actions">


                                                {!isExpress && canRequestRegular && (
                                                    <button
                                                        className="btn btn-primary"
                                                        disabled={busyState.loading || busyState.hasBusyTaxi}
                                                        title={busyState.hasAnyBusy ? busyHintText : ""}
                                                        onClick={() => {
                                                            const token = localStorage.getItem("authToken");

                                                            if (!token) {
                                                                toast.info("Войдите, чтобы запросить выполнение");
                                                                navigate("/login");
                                                                return;
                                                            }

                                                            if (busyState.hasBusyTaxi) {
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
                                                        order={order}
                                                        navMode="toA"
                                                        className="express-nav--list"
                                                        buttonClassName="btn btn-ghost express-nav-btn"
                                                    />
                                                )}

                                                {isExpress &&
                                                    canAcceptExpress &&
                                                    !canRequestNext && (
                                                        <button
                                                        className="btn btn-primary"
                                                        disabled={busyState.loading || busyState.hasAnyBusy}
                                                        title={busyState.hasAnyBusy ? busyHintText : ""}
                                                        onClick={async () => {
                                                            const token = localStorage.getItem("authToken");

                                                            if (!token) {
                                                                toast.info("Войдите, чтобы принять заказ");
                                                                navigate("/login");
                                                                return;
                                                            }

                                                            if (busyState.hasAnyBusy) {
                                                                toast.info(busyHintText);
                                                                return;
                                                            }

                                                            const confirmed = window.confirm(
                                                                `Вы уверены, что хотите взять в работу этот экспресс-заказ №${order.expressId}?`
                                                            );

                                                            if (!confirmed) return;

                                                            try {
                                                                await axiosInstance.post(
                                                                    `/express/express-orders/${order.expressId}/accept`,
                                                                    {},
                                                                    {
                                                                        headers: {
                                                                            Authorization: `Bearer ${token}`,
                                                                        },
                                                                    }
                                                                );

                                                                toast.success("Заказ принят!");

                                                                await fetchExpress();
                                                                await fetchBusyState();

                                                                navigate("/active-orders");
                                                            } catch (error) {
                                                                console.error(
                                                                    "Ошибка принятия express-заказа:",
                                                                    error
                                                                );

                                                                const code =
                                                                    error.response?.data?.code;

                                                                if (
                                                                    [
                                                                        "TAXI_VEHICLE_REQUIRED",
                                                                        "TAXI_VEHICLE_PENDING",
                                                                        "TAXI_VEHICLE_REJECTED",
                                                                        "TAXI_VEHICLE_NOT_VERIFIED",
                                                                    ].includes(code)
                                                                ) {
                                                                    setVehicleGateModal({
                                                                        code,

                                                                        message:
                                                                            error.response?.data?.message ||
                                                                            "Для работы в такси необходимо подтвердить автомобиль.",
                                                                    });

                                                                    return;
                                                                }

                                                                toast.error(
                                                                    error.response?.data?.message ||
                                                                    "Не удалось принять заказ"
                                                                );
                                                            }
                                                        }}
                                                    >
                                                        {busyState.loading ? "Проверка..." : "Принять"}
                                                    </button>
                                                )}

                                                {canRequestNext && (
                                                    <ExpressNextOrderButton
                                                        orderId={order.expressId}

                                                        sourceOrderId={
                                                            busyState.currentExpressOrder?.id
                                                        }

                                                        disabled={
                                                            busyState.loading ||
                                                            expressReservationLoading ||
                                                            Boolean(expressReservationError) ||
                                                            Boolean(pendingExpressReservation)
                                                        }

                                                        onRequested={(request) => {
                                                            setPendingExpressReservation(
                                                                request
                                                            );

                                                            toast.success(
                                                                "Предложение отправлено заказчику"
                                                            );
                                                        }}
                                                    />
                                                )}
                                            </div>

                                            {busyState.hasBusyRegular && canRequestRegular && (
                                                <div className="blocked-order-hint">
                                                    Можно отправить предварительный отклик.
                                                    Укажите время освобождения.
                                                </div>
                                            )}

                                            {busyState.hasAnyBusy &&
                                                canAcceptExpress &&
                                                !canRequestNext && (
                                                    <div className="blocked-order-hint">
                                                        {busyHintText}
                                                    </div>
                                                )}

                                            {canRequestNext && (
                                                <div className="blocked-order-hint">
                                                    {pendingExpressReservation
                                                        ? "Ожидаем ответа на предыдущее предложение."
                                                        : "Можно запросить следующий заказ в пределах 1 км от точки Б."}
                                                </div>
                                            )}

                                            {busyState.hasBusyTaxi && canRequestRegular && (
                                                <div className="blocked-order-hint">
                                                    {busyHintText}
                                                </div>
                                            )}
                                        </div>
                                    </article>
);
    };

    return (
        <div className={`orders-page cc-orders-redesign orders-page--${platform}`}>
            <div className="orders-shell">
                <div className="orders-top glass">
                    <div className="orders-top-left">
                        <div className="cc-orders-heading">

                            <div className="orders-title">
                                Все заказы
                            </div>

                            <div className="cc-orders-heading__actions">

                                <button
                                    type="button"
                                    className="cc-orders-icon-button"
                                    aria-label="Карта заказов"
                                    onClick={handleOpenOrdersMap}
                                >
                                    <FaMapMarkedAlt
                                        size={19}
                                        aria-hidden="true"
                                    />
                                </button>

                                <button
                                    type="button"
                                    className="cc-orders-icon-button"
                                    aria-label="Фильтры"
                                    onClick={() =>
                                        setDrawerOpen(true)
                                    }
                                >
                                    <FaSlidersH
                                        size={19}
                                        aria-hidden="true"
                                    />
                                </button>

                            </div>

                        </div>

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

                </div>

                <div
                    className="cc-orders-category-strip"
                    aria-label="Категории заказов"
                >
                    <button
                        type="button"
                        className={
                            "cc-orders-category-chip" +
                            (useProfileProfessions
                                ? " is-active"
                                : "")
                        }
                        aria-pressed={useProfileProfessions}
                        onClick={() => {
                            setUseProfileProfessions(
                                previous => !previous
                            );
                        }}
                    >
                        Мои профессии
                    </button>

                    {categories
                        .filter(category =>
                            !HIDE_FROM_DRAWER.has(
                                String(
                                    category.name || ""
                                ).trim()
                            )
                        )
                        .map(category => {
                            const id =
                                String(category.id);

                            const active =
                                String(selectedCategory) === id;

                            return (
                                <button
                                    key={id}
                                    type="button"
                                    className={
                                        "cc-orders-category-chip" +
                                        (active
                                            ? " is-active"
                                            : "")
                                    }
                                    aria-pressed={active}
                                    onClick={() => {
                                        const next =
                                            active ? "" : id;

                                        setSelectedCategory(next);
                                        setSelectedSubcategory("");
                                        setSubcategories([]);
                                        setActiveTab("all");

                                        if (next) {
                                            fetchSubcategories(next);
                                        }
                                    }}
                                >
                                    {category.name}
                                </button>
                            );
                        })}

                </div>

                {activeTab === "all" && (selectedCategory || selectedSubcategory) && (
                    <div className="hint-text hint-text-panel">
                        Во вкладке «Все» при включённых фильтрах заказы «Курьер/Такси» скрываются.
                    </div>
                )}

                {pendingExpressReservation && (
                    <ExpressPendingReservation
                        request={pendingExpressReservation}
                        onChanged={() => {
                            void refreshExpressReservation();
                            void fetchBusyState();
                        }}
                    />
                )}

                {expressReservationError &&
                    busyState.canRequestNextExpress && (
                        <div role="alert">
                            <p>{expressReservationError}</p>

                            <button
                                type="button"
                                onClick={
                                    refreshExpressReservation
                                }
                            >
                                Повторить
                            </button>
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
                            {visibleOrders.map((order) => (
        <AvailableOrderCard
            key={order.id}
            order={order}
            creator={creatorsInfo[order.creatorId] || {}}
            userId={userId}
            serviceName={buildServiceLine(order)}
            timing={
                order.express
                    ? null
                    : getOrderTiming(order)
            }
            onOpen={openOrderDetails}
        />
    ))}
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

                <BottomSheet
                    open={
                        selectedOrderId !== null &&
                        !requestModalOpen &&
                        !isModalOpen
                    }
                    onClose={closeOrderDetails}
                    title="Подробности заказа"
                    fullHeight
                >
                    <div className="cc-orders-sheet">

                        {selectedOrderUnavailable ? (
                            <>

                                <div
                                    className="cc-ui-error"
                                    role="alert"
                                >
                                    Этот заказ больше недоступен.
                                    Возможно, он уже принят
                                    другим исполнителем или отменён.
                                </div>

                                <Button
                                    fullWidth
                                    onClick={closeOrderDetails}
                                >
                                    Вернуться к заказам
                                </Button>

                            </>
                        ) : selectedOrderForDisplay ? (
                            renderOrderDetails(
                                selectedOrderForDisplay
                            )
                        ) : null}

                    </div>
                </BottomSheet>


        <BottomSheet
            open={drawerOpen}
            onClose={() => setDrawerOpen(false)}
            title="Фильтры"
            description="Профессии и категории"
        >
            <div className="cc-orders-sheet">
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
        </BottomSheet>


        <BottomSheet
            open={showOrdersMap}
            onClose={() => {
                setShowOrdersMap(false);
                setLocationMenuOpen(false);
            }}
            title="Заказы на карте"
            fullHeight
            closeOnSwipe={false}
        >
            <YandexMapModal embedded
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
        </BottomSheet>



        <BottomSheet
            open={showLocationPicker}
            onClose={() => {
                setShowLocationPicker(false);
                setLocationMenuOpen(false);
            }}
            title="Выбрать местоположение"
            fullHeight
            closeOnSwipe={false}
        >
            <YandexMapModal embedded
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
        </BottomSheet>



        <BottomSheet
            open={requestModalOpen}
            onClose={closeRequestModal}
            title="Запросить выполнение"
            busy={requestSubmitting}
        >
            <div className="cc-orders-sheet">
                <div className="request-order-content">
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

                        <RegularAdvanceTimeField
                            value={requestAvailableAt}
                            onChange={setRequestAvailableAt}
                        />

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
            </div>
        </BottomSheet>



        <BottomSheet
            open={isModalOpen}
            onClose={closeModal}
            title="Фотографии"
            fullHeight
        >
            <div className="cc-orders-photo-viewer">

                <button
                    className="img-nav left"
                    type="button"
                    aria-label="Предыдущее изображение"
                    disabled={currentImages.length < 2}
                    onClick={() =>
                        setCurrentImageIndex(prev =>
                            prev === 0
                                ? currentImages.length - 1
                                : prev - 1
                        )
                    }
                >
                    <ChevronLeft size={20} />
                </button>

                {currentImages[currentImageIndex] && (
                    <img
                        src={`${apiUrl}${currentImages[currentImageIndex]}`}
                        alt="Фотография заказа"
                        className="img-full"
                    />
                )}

                <button
                    className="img-nav right"
                    type="button"
                    aria-label="Следующее изображение"
                    disabled={currentImages.length < 2}
                    onClick={() =>
                        setCurrentImageIndex(prev =>
                            prev === currentImages.length - 1
                                ? 0
                                : prev + 1
                        )
                    }
                >
                    <ChevronRight size={20} />
                </button>

            </div>

            <p className="cc-profile-note">
                Фото {currentImageIndex + 1} из {currentImages.length}
            </p>
        </BottomSheet>

            </div>

            <TaxiVehicleGateModal
                data={vehicleGateModal}

                onClose={() =>
                    setVehicleGateModal(null)
                }

                onGoToProfile={() => {
                    setVehicleGateModal(null);

                    navigate(
                        "/profile?section=verification"
                    );
                }}
            />

        </div>
    );
};

export default OrdersPage;