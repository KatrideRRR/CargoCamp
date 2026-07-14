import React, { useContext, useEffect, useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import "../styles/ActiveOrdersPage.css";
import { useAuth } from "../utils/authContext";
import { socket, connectSocket } from "../socketClient";
import { useMediaQuery } from "react-responsive";
import { FaPhone, FaComments, FaRoute, FaCheck, FaTrash, FaExclamationTriangle, FaPlay } from "react-icons/fa";
import Modal from "react-modal";
import axiosInstance from "../utils/axiosInstance";
import { FaUniversity, FaMoneyBillWave, FaCreditCard, FaQuestionCircle } from "react-icons/fa";
import ExpressOrderCard from "../components/ExpressOrderCard";
import { ModalContext } from "../components/modalContext";

const apiUrl = process.env.REACT_APP_API_URL;

const ActiveOrdersPage = () => {
    const navigate = useNavigate();
    const { user } = useAuth();

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

    const {
        openCompletionSuccessModal,
        openReviewFromCompletion,
    } = useContext(ModalContext);
    const isMobile = useMediaQuery({ maxWidth: 768 });

    const [orders, setOrders] = useState([]);
    const [expressOrders, setExpressOrders] = useState([]);

    const [activeView, setActiveView] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        const view = params.get("view");

        if (view === "created") return "created";
        if (view === "performing") return "performing";

        return "performing";
    });

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const view = params.get("view");

        if (view === "created") {
            setActiveView("created");
        }

        if (view === "performing") {
            setActiveView("performing");
        }
    }, []);

    const [error, setError] = useState(null);

    // модалка картинок обычных заказов
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [currentImages, setCurrentImages] = useState([]);

    // инфо о пользователях (для обычных заказов)
    const [creatorsInfo, setCreatorsInfo] = useState({});
    const [executorsInfo, setExecutorsInfo] = useState({});

    //споры
    const [isDisputeModalOpen, setIsDisputeModalOpen] = useState(false);
    const [selectedOrderForDispute, setSelectedOrderForDispute] = useState(null);
    const [disputeReasonCode, setDisputeReasonCode] = useState("poor_quality");
    const [disputeReason, setDisputeReason] = useState("");
    const [disputeDescription, setDisputeDescription] = useState("");
    const [disputeLoading, setDisputeLoading] = useState(false);
    const [orderDisputes, setOrderDisputes] = useState({});

    // “удаленные” обычные заказы
    const [removedOrders, setRemovedOrders] = useState(() => {
        const saved = localStorage.getItem("removedOrders");
        return saved ? JSON.parse(saved) : [];
    });

    const [photoUploading, setPhotoUploading] = useState({});
    const [startingWork, setStartingWork] = useState({});

    // непрочитанные сообщения (обычные заказы)
    const [unreadOrders, setUnreadOrders] = useState({});

    // сохраняем removedOrders
    useEffect(() => {
        localStorage.setItem("removedOrders", JSON.stringify(removedOrders));
    }, [removedOrders]);

    const token = useMemo(() => localStorage.getItem("authToken"), []);

    // --- helpers ---
    const getPaymentIcon = (type) => {
        switch (type) {
            case "guarantee":
                return <FaUniversity title="Tinkoff" />;
            case "cash":
                return <FaMoneyBillWave title="Наличные" />;
            case "installments":
                return <FaCreditCard title="Карта" />;
            default:
                return <FaQuestionCircle title="Неизвестно" />;
        }
    };

    const normalizePhoneForTel = (rawPhone) => {
        let digits = String(rawPhone || "").replace(/\D/g, "");

        if (!digits) return null;

        // 8 978 003-29-78 -> 79780032978
        if (digits.length === 11 && digits.startsWith("8")) {
            digits = `7${digits.slice(1)}`;
        }

        // 9780032978 -> 79780032978
        if (digits.length === 10) {
            digits = `7${digits}`;
        }

        // Российский номер должен быть 11 цифр и начинаться с 7
        if (digits.length === 11 && digits.startsWith("7")) {
            return `+${digits}`;
        }

        return null;
    };

    const callPhone = (rawPhone) => {
        const phoneForTel = normalizePhoneForTel(rawPhone);

        if (!phoneForTel) {
            alert("Некорректный номер телефона");
            return;
        }

        console.log("CALL RAW PHONE:", rawPhone);
        console.log("CALL NORMALIZED PHONE:", phoneForTel);

        window.location.href = `tel:${encodeURIComponent(phoneForTel)}`;
    };

    const buildCompletionPayload = ({ order, orderType }) => {
        if (!order) return null;

        if (orderType === "express") {
            return {
                orderId: order.id,
                orderType: "express",
                title: `Экспресс-заказ №${order.id} выполнен.`,
                amount: Number(order.totalPrice || 0),
                startedAt: order.startedAt || null,
                completedAt: order.completedAt || null,
                creatorId: order.creatorId,
                executorId: order.executorId,
            };
        }

        return {
            orderId: order.id,
            orderType: "regular",
            title: `Заказ №${order.id} выполнен.`,
            amount: Number(order.proposedSum || 0),
            startedAt: order.workStartedAt || null,
            completedAt: order.completedAt || null,
            creatorId: order.creatorId,
            executorId: order.executorId,
        };
    };

    const disputeReasonOptions = [
        { value: "work_not_done", label: "Работа не выполнена" },
        { value: "poor_quality", label: "Низкое качество работы" },
        { value: "missed_deadline", label: "Нарушены сроки" },
        { value: "wrong_price", label: "Спор по стоимости" },
        { value: "rude_behavior", label: "Некорректное поведение" },
        { value: "other", label: "Другое" },
    ];

    const openDisputeModal = (order) => {
        setSelectedOrderForDispute(order);
        setDisputeReasonCode("poor_quality");
        setDisputeReason("");
        setDisputeDescription("");
        setIsDisputeModalOpen(true);
    };

    const closeDisputeModal = () => {
        setIsDisputeModalOpen(false);
        setSelectedOrderForDispute(null);
        setDisputeReasonCode("poor_quality");
        setDisputeReason("");
        setDisputeDescription("");
        setDisputeLoading(false);
    };

    const fetchOrderDispute = async (orderId) => {
        try {
            const t = localStorage.getItem("authToken");
            if (!t) return null;

            const res = await axios.get(`${apiUrl}/api/disputes/order/${orderId}`, {
                headers: { Authorization: `Bearer ${t}` },
            });

            const dispute = res.data?.dispute || null;

            if (dispute) {
                setOrderDisputes((prev) => ({
                    ...prev,
                    [orderId]: dispute,
                }));
                return dispute;
            }

            return null;
        } catch (e) {
            if (e?.response?.status !== 404) {
                console.error(`Ошибка получения спора по заказу ${orderId}:`, e);
            }
            return null;
        }
    };

    const submitDispute = async () => {
        try {
            const t = localStorage.getItem("authToken");
            if (!t) {
                alert("Вы не авторизованы");
                navigate("/login");
                return;
            }

            if (!selectedOrderForDispute?.id) {
                alert("Заказ не выбран");
                return;
            }

            if (!disputeReason.trim()) {
                alert("Укажите краткую причину спора");
                return;
            }

            setDisputeLoading(true);

            const res = await axios.post(
                `${apiUrl}/api/disputes/open`,
                {
                    orderId: selectedOrderForDispute.id,
                    reasonCode: disputeReasonCode,
                    reason: disputeReason.trim(),
                    description: disputeDescription.trim(),
                },
                {
                    headers: { Authorization: `Bearer ${t}` },
                }
            );

            if (res.data?.dispute) {
                setOrderDisputes((prev) => ({
                    ...prev,
                    [selectedOrderForDispute.id]: res.data.dispute,
                }));
            }

            alert("Спор успешно открыт");
            closeDisputeModal();
        } catch (e) {
            console.error("Ошибка открытия спора:", e);
            alert(e?.response?.data?.message || "Не удалось открыть спор");
        } finally {
            setDisputeLoading(false);
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

    const getPaymentLabel = (type) => {
        switch (type) {
            case "guarantee":
                return "Гарантия";
            case "cash":
                return "Наличные";
            case "installment":
            case "installments":
                return "Рассрочка";
            default:
                return "Неизвестно";
        }
    };

    const openModal = (images) => {
        setCurrentImages(Array.isArray(images) ? images : []);
        setCurrentImageIndex(0);
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setCurrentImageIndex(0);
        setCurrentImages([]);
    };

    const nextImage = () => {
        if (!currentImages.length) return;
        setCurrentImageIndex((prev) => (prev + 1) % currentImages.length);
    };

    const prevImage = () => {
        if (!currentImages.length) return;
        setCurrentImageIndex((prev) => (prev - 1 + currentImages.length) % currentImages.length);
    };

    const makeRemovedOrderKey = (orderId, view = activeView) => {
        return `${user.id}_${view}_${orderId}`;
    };

    const handleRemoveOrder = (orderId) => {
        const key = makeRemovedOrderKey(orderId);

        setRemovedOrders((prev) => {
            const updated = prev.includes(key) ? prev : [...prev, key];
            localStorage.setItem("removedOrders", JSON.stringify(updated));
            return updated;
        });

        setOrders((prev) =>
            prev.filter((o) => makeRemovedOrderKey(o.id) !== key)
        );
    };

    const handleRouteClick = (order) => {
        if (!order?.coordinates || !String(order.coordinates).includes(",")) {
            alert("Координаты заказа не найдены");
            return;
        }

        const [orderLat, orderLon] = String(order.coordinates)
            .split(",")
            .map((coord) => parseFloat(coord));

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userLat = position.coords.latitude;
                const userLon = position.coords.longitude;

                const url = `https://yandex.ru/navi/?rtext=${userLat},${userLon}~${orderLat},${orderLon}&rtt=auto`;
                const confirmNavigation = window.confirm("Хотите открыть маршрут в Яндекс.Навигаторе?");
                if (confirmNavigation) window.open(url, "_blank");
            },
            (err) => {
                alert("Не удалось определить местоположение");
                console.error(err);
            },
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
        );
    };

    const getUserPhone = async (userIdToGet) => {
        try {
            const t = localStorage.getItem("authToken");
            const res = await axios.get(`${apiUrl}/api/auth/user/${userIdToGet}`, {
                headers: { Authorization: `Bearer ${t}` },
            });
            return res.data?.phone;
        } catch (e) {
            console.error("Ошибка при получении телефона:", e);
            return null;
        }
    };

    const uploadOrderPhotos = async (orderId, type, files) => {
        try {
            const t = localStorage.getItem("authToken");
            if (!t) {
                alert("Вы не авторизованы");
                navigate("/login");
                return;
            }

            if (!files || files.length === 0) {
                alert("Выберите хотя бы одно фото");
                return;
            }

            setPhotoUploading((prev) => ({ ...prev, [`${orderId}_${type}`]: true }));

            const formData = new FormData();
            Array.from(files).forEach((file) => {
                formData.append("images", file, file.name);
            });

            const endpointMap = {
                executorBefore: `/orders/${orderId}/executor-before-photos`,
                executorAfter: `/orders/${orderId}/executor-after-photos`,
                customerBefore: `/orders/${orderId}/customer-before-photos`,
                customerAfter: `/orders/${orderId}/customer-after-photos`,
            };

            const endpoint = endpointMap[type];
            if (!endpoint) {
                alert("Неизвестный тип загрузки");
                return;
            }

            await axiosInstance.post(endpoint, formData, {
                headers: {
                    Authorization: `Bearer ${t}`,
                },
            });

            await fetchActiveOrders();
            alert("Фото успешно загружены ✅");
        } catch (e) {
            console.error("Ошибка загрузки фото:", e);
            alert(e.response?.data?.message || "Ошибка при загрузке фото");
        } finally {
            setPhotoUploading((prev) => ({ ...prev, [`${orderId}_${type}`]: false }));
        }
    };

    const startWork = async (orderId) => {
        try {
            const t = localStorage.getItem("authToken");
            if (!t) {
                alert("Вы не авторизованы");
                navigate("/login");
                return;
            }

            setStartingWork((prev) => ({ ...prev, [orderId]: true }));

            await axiosInstance.post(`/orders/${orderId}/start-work`, {}, {
                headers: { Authorization: `Bearer ${t}` },
            });

            await fetchActiveOrders();
            alert("Работа отмечена как начатая ✅");
        } catch (e) {
            console.error("Ошибка начала работы:", e);
            alert(e.response?.data?.message || "Ошибка при начале работы");
        } finally {
            setStartingWork((prev) => ({ ...prev, [orderId]: false }));
        }
    };

    const renderPhotoList = (photos = []) => {
        if (!Array.isArray(photos) || photos.length === 0) {
            return <p className="photo-empty">Фото пока нет</p>;
        }

        return (
            <div className="protocol-photo-grid">
                {photos.map((photo, index) => (
                    <img
                        key={index}
                        src={`${apiUrl}${photo}`}
                        alt={`protocol-${index + 1}`}
                        className="protocol-photo"
                        onClick={(e) => {
                            e.stopPropagation();
                            openModal(photos);
                        }}
                    />
                ))}
            </div>
        );
    };

    const completeOrderRequest = async (orderId) => {
        const ok = window.confirm("Подтвердить завершение заказа?");
        if (!ok) return;

        try {
            const t = localStorage.getItem("authToken");
            if (!t) {
                alert("Вы не авторизованы");
                navigate("/login");
                return;
            }

            const res = await axiosInstance.post(
                `/orders/complete/${orderId}`,
                {},
                { headers: { Authorization: `Bearer ${t}` } }
            );

            const updatedOrder = res.data;

            setOrders((prev) =>
                prev.map((o) => (o.id === orderId ? updatedOrder : o))
            );

            await fetchActiveOrders();

            const creatorId = updatedOrder?.creatorId;
            const executorId = updatedOrder?.executorId;

            if (updatedOrder?.status === "completed") {
                openReviewFromCompletion(
                    updatedOrder?.id || orderId,
                    creatorId,
                    executorId,
                    "regular"
                );
            } else {
                alert("Вы подтвердили завершение. Ожидаем подтверждение второй стороны.");
            }
        } catch (e) {
            console.error(e);
            alert(e.response?.data?.message || "Ошибка при завершении заказа");
        }
    };

    const remindCompleteOrder = async (orderId) => {
        try {
            const t = localStorage.getItem("authToken");

            if (!t) {
                alert("Вы не авторизованы");
                navigate("/login");
                return;
            }

            await axiosInstance.post(
                `/orders/${orderId}/remind-complete`,
                {},
                {
                    headers: {
                        Authorization: `Bearer ${t}`,
                    },
                }
            );

            alert("Напоминание отправлено");
        } catch (e) {
            console.error("Ошибка отправки напоминания:", e);
            alert(e.response?.data?.message || "Не удалось отправить напоминание");
        }
    };

    const handleOpenChat = (orderId, orderType = "regular") => {
        socket.emit("markAsRead", {
            userId: user.id,
            orderId,
            orderType,
        });

        setUnreadOrders((prev) => {
            const updated = { ...prev };
            delete updated[`${orderType}_${orderId}`];
            return updated;
        });

        navigate(`/messages/${orderType}/${orderId}`);
    };

    // --- fetchers ---
    const fetchExpressOrders = async () => {
        try {
            const token = localStorage.getItem("authToken");
            if (!token) return;

            const r = await axios.get(`${apiUrl}/api/express/express-orders/me`, {
                headers: { Authorization: `Bearer ${token}` },
                params: { mode: "active" },
            });

            if (!r.data?.success) {
                console.log("EXPRESS ERROR BODY:", r?.data);
                console.error("express/me not success:", r.data);
                return;
            }

            setExpressOrders(Array.isArray(r.data.orders) ? r.data.orders : []);
        } catch (e) {
            console.error("Ошибка при загрузке express orders:", e?.response?.data || e.message);
        }
    };

    const fetchActiveOrders = async () => {
        try {
            const t = localStorage.getItem("authToken");
            if (!t) return;

            const response = await axios.get(`${apiUrl}/api/orders/active-orders`, {
                headers: { Authorization: `Bearer ${t}` },
            });

            if (!Array.isArray(response.data?.orders)) {
                console.error("❌ Ошибка: `orders` не массив!", response.data);
                return;
            }

            const serverOrders = response.data.orders;

            // creators
            const creatorIds = [...new Set(serverOrders.map((o) => o.creatorId).filter(Boolean))];
            const creatorsData = {};
            if (creatorIds.length > 0) {
                const creatorResults = await Promise.allSettled(
                    creatorIds.map((id) => axiosInstance.get(`/auth/${id}`).then((res) => ({ id, data: res.data })))
                );
                creatorResults.forEach((r) => {
                    if (r.status === "fulfilled" && r.value) creatorsData[r.value.id] = r.value.data;
                });
            }
            setCreatorsInfo(creatorsData);

            // executors
            const executorIds = [...new Set(serverOrders.map((o) => o.executorId).filter(Boolean))];
            const executorsData = {};
            if (executorIds.length > 0) {
                const executorResults = await Promise.allSettled(
                    executorIds.map((id) => axiosInstance.get(`/auth/user/${id}`).then((res) => ({ id, data: res.data })))
                );
                executorResults.forEach((r) => {
                    if (r.status === "fulfilled" && r.value) executorsData[r.value.id] = r.value.data;
                });
            }
            setExecutorsInfo(executorsData);

            // removed filter
            const filteredOrders = serverOrders.filter((o) => {
                const isExecutor = Number(o.executorId) === Number(user.id);
                const isCreator = Number(o.creatorId) === Number(user.id);

                const performingKey = `${user.id}_performing_${o.id}`;
                const createdKey = `${user.id}_created_${o.id}`;

                if (isExecutor && removedOrders.includes(performingKey)) {
                    return false;
                }

                if (isCreator && removedOrders.includes(createdKey)) {
                    return false;
                }

                return true;
            });

            setOrders(filteredOrders);

            // подгрузим данные по спорам
            const disputeEntries = await Promise.allSettled(
                filteredOrders.map(async (order) => {
                    try {
                        const res = await axios.get(`${apiUrl}/api/disputes/order/${order.id}`, {
                            headers: { Authorization: `Bearer ${t}` },
                        });

                        const dispute = res.data?.dispute || null;

                        if (!dispute) return null;

                        return {
                            orderId: order.id,
                            dispute,
                        };
                    } catch (e) {
                        console.error(`Ошибка загрузки спора для заказа ${order.id}:`, e);
                        return null;
                    }
                })
            );

            const disputesMap = {};
            disputeEntries.forEach((entry) => {
                if (entry.status === "fulfilled" && entry.value?.orderId && entry.value?.dispute) {
                    disputesMap[entry.value.orderId] = entry.value.dispute;
                }
            });

            setOrderDisputes(disputesMap);

            // unread counts
            const notifs = Array.isArray(response.data?.notifications) ? response.data.notifications : [];
            const counts = {};
            notifs.forEach((n) => {
                if (n.type === "new_message" && n.userId === user?.id && !n.isRead) {
                    const orderId = n.orderId;
                    counts[orderId] = (counts[orderId] || 0) + 1;
                }
            });
            setUnreadOrders(counts);

            setError(null);
        } catch (err) {
            console.error("Ошибка при загрузке активных заказов:", err);
            setError("Не удалось загрузить заказы.");
        }
    };

    // --- main effect ---
    useEffect(() => {
        if (!token) {
            alert("Вы не авторизованы! Пожалуйста, войдите в систему.");
            navigate("/login");
            return;
        }

        if (!user?.id) return;

        connectSocket(user.id);

        const reloadAll = async () => {
            await Promise.allSettled([
                fetchActiveOrders(),
                fetchExpressOrders(),
            ]);
        };

        const patchExpressOrderFromPayload = (payload) => {
            if (!payload?.orderId || payload.orderType !== "express") return;

            setExpressOrders((prev) =>
                prev.map((item) =>
                    Number(item.id) === Number(payload.orderId)
                        ? {
                            ...item,
                            status: payload.status ?? item.status,
                            executorId: payload.executorId ?? item.executorId,
                            creatorId: payload.creatorId ?? item.creatorId,
                            type: payload.type ?? payload.expressType ?? item.type,
                            updatedAt: new Date().toISOString(),
                        }
                        : item
                )
            );
        };

        const onAnyOrderUpdate = (payload) => {
            patchExpressOrderFromPayload(payload);
            reloadAll();
        };

        const onConnect = () => {
            socket.emit("register", user.id);
            socket.emit("subscribeToNotifications", user.id);
            reloadAll();
        };

        socket.on("connect", onConnect);
        socket.on("reconnect", onConnect);

        socket.on("activeOrdersUpdated", onAnyOrderUpdate);
        socket.on("new_notification", onAnyOrderUpdate);

        socket.on("expressOrdersUpdated", onAnyOrderUpdate);
        socket.on("expressOrderAccepted", onAnyOrderUpdate);
        socket.on("expressOrderStatusChanged", onAnyOrderUpdate);
        socket.on("expressStatusChanged", onAnyOrderUpdate);
        socket.on("expressOrderCompleted", onAnyOrderUpdate);
        socket.on("expressOrderCompletedForExecutor", onAnyOrderUpdate);
        socket.on("expressOrderCancelled", onAnyOrderUpdate);

        reloadAll();

        return () => {
            socket.off("connect", onConnect);
            socket.off("reconnect", onConnect);

            socket.off("activeOrdersUpdated", onAnyOrderUpdate);
            socket.off("new_notification", onAnyOrderUpdate);

            socket.off("expressOrdersUpdated", onAnyOrderUpdate);
            socket.off("expressOrderAccepted", onAnyOrderUpdate);
            socket.off("expressOrderStatusChanged", onAnyOrderUpdate);
            socket.off("expressStatusChanged", onAnyOrderUpdate);
            socket.off("expressOrderCompleted", onAnyOrderUpdate);
            socket.off("expressOrderCompletedForExecutor", onAnyOrderUpdate);
            socket.off("expressOrderCancelled", onAnyOrderUpdate);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigate, user?.id, token]);

    // --- pull to refresh ---
    useEffect(() => {
        const onPullToRefresh = async (e) => {
            try {
                await Promise.allSettled([
                    fetchActiveOrders(),
                    fetchExpressOrders(),
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
    }, [user?.id, removedOrders]);

    if (!user || !user.id) return <p>Загрузка...</p>;
    if (error) return <div className="error-message">{error}</div>;

    const performingOrders = orders.filter((order) => Number(order.executorId) === Number(user.id));
    const createdOrders = orders.filter((order) => Number(order.creatorId) === Number(user.id));

    const performingExpressOrders = expressOrders.filter(
        (order) => Number(order.executorId) === Number(user.id)
    );

    const createdExpressOrders = expressOrders.filter(
        (order) => Number(order.creatorId) === Number(user.id)
    );

    const targetOrderId = new URLSearchParams(window.location.search).get("orderId");

    const sortTargetOrderFirst = (list) => {
        if (!targetOrderId) return list;

        return [...list].sort((a, b) => {
            if (String(a.id) === String(targetOrderId)) return -1;
            if (String(b.id) === String(targetOrderId)) return 1;
            return 0;
        });
    };

    const visibleRegularOrders =
        activeView === "performing"
            ? sortTargetOrderFirst(performingOrders).slice(0, 1)
            : sortTargetOrderFirst(createdOrders);

    const visibleExpressOrders =
        activeView === "performing"
            ? (performingOrders.length > 0 ? [] : performingExpressOrders.slice(0, 1))
            : createdExpressOrders;

    const hasAnyVisible =
        visibleRegularOrders.length > 0 || visibleExpressOrders.length > 0;

    const hasAny = hasAnyVisible;

    return (
        <div className={`active-orders active-orders--${platform}`}>
            <div className="pageContainer">
                <div className="active-orders-page">
                    <div className="active-orders-container">
                        <div className="contentWrapper">

                            <div className="active-orders-topbar">
                                <div className="active-orders-title-wrap">
                                    <div className="active-orders-title">Активные заказы</div>
                                    <div className="active-orders-subtitle">
                                        {activeView === "performing"
                                            ? "Заказы, которые вы сейчас выполняете"
                                            : "Ваши заказы, которые сейчас выполняются"}
                                    </div>
                                </div>

                                <div className="active-orders-switch">
                                    <button
                                        className={`active-switch-btn ${activeView === "performing" ? "active" : ""}`}
                                        onClick={() => setActiveView("performing")}
                                    >
                                        Я выполняю
                                    </button>

                                    <button
                                        className={`active-switch-btn ${activeView === "created" ? "active" : ""}`}
                                        onClick={() => setActiveView("created")}
                                    >
                                        Мои заказы выполняют
                                    </button>
                                </div>
                            </div>

                            {hasAny ? (
                                <ul className="orders-list">
                                    {/* обычные активные заказы */}
                                    {visibleRegularOrders.map((order) => {
                                        const completedBy = Array.isArray(order.completedBy)
                                            ? order.completedBy.map((id) => Number(id)).filter(Number.isFinite)
                                            : [];

                                        const isCompletedByUser = completedBy.includes(Number(user.id));

                                        const isWaitingForOther =
                                            order.status !== "completed" &&
                                            completedBy.length === 1 &&
                                            isCompletedByUser;

                                        const isWaitingForMe =
                                            order.status !== "completed" &&
                                            completedBy.length === 1 &&
                                            !isCompletedByUser;

                                        const isExecutor = order.executorId === user.id;
                                        const isCreator = order.creatorId === user.id;

                                        const creator = creatorsInfo[order.creatorId] || {};
                                        const executor = executorsInfo[order.executorId] || {};

                                        return (
                                            <li key={order.id} className="order-card">
                                                <div className="order-header">
                                                    <div className="order-top">
                                                        <div className="order-title-wrap">
                                                            <div className="order-title">
                                                                <strong>Заказ №{order.id}</strong>
                                                            </div>

                                                            <div className="role-badge-row">
    <span className={`role-badge ${isCreator ? "creator-role" : "executor-role"}`}>
        {isCreator ? "Вы заказчик" : "Вы исполнитель"}
    </span>

                                                                {orderDisputes[order.id] && (
                                                                    <div className={`dispute-status-badge dispute-status-${orderDisputes[order.id].status}`}>
                                                                        Спор: {orderDisputes[order.id].status}
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {isWaitingForOther && (
                                                                <div className="completion-waiting-box">
                                                                    <strong>Вы подтвердили завершение.</strong>
                                                                    <span>
            Заказ завершится полностью, когда вторая сторона тоже подтвердит выполнение.
        </span>
                                                                </div>
                                                            )}

                                                            {isWaitingForMe && (
                                                                <div className="completion-waiting-box completion-waiting-box-warning">
                                                                    <strong>Вторая сторона уже подтвердила завершение.</strong>
                                                                    <span>
            Проверьте результат и нажмите «Подтвердить завершение», если всё в порядке.
        </span>
                                                                </div>
                                                            )}

                                                        </div>

                                                        <div className="pay-box">
                                                            <span className="pay-icon">{getPaymentIcon(order.paymentType)}</span>

                                                            <div className="pay-right">
                                                                <div className="pay-price">
                                                                    {Number(order.proposedSum ?? 0).toLocaleString("ru-RU")} ₽
                                                                </div>
                                                                <div className="pay-type">{getPaymentLabel(order.paymentType)}</div>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="order-subline">Создан {new Date(order.createdAt).toLocaleString()}</div>

                                                    {isExecutor ? (
                                                        <>
                                                            <p>
                                                                <strong>ID заказчика:</strong> {order.creatorId || "Неизвестно"}
                                                            </p>
                                                            <p>
                                                                <strong>Имя заказчика:</strong> {creator.username || "Неизвестно"}
                                                            </p>
                                                            <p>
                                                                <strong>Рейтинг заказчика:</strong>{" "}
                                                                {creator.rating ? creator.rating.toFixed(1) : "Нет данных"}
                                                            </p>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <p>
                                                                <strong>ID исполнителя:</strong> {order.executorId || "Неизвестно"}
                                                            </p>
                                                            <p>
                                                                <strong>Имя исполнителя:</strong> {executor?.username || "Неизвестно"}
                                                            </p>
                                                            <p>
                                                                <strong>Рейтинг исполнителя:</strong>{" "}
                                                                {executor?.rating ? executor.rating.toFixed(1) : "Нет данных"}
                                                            </p>
                                                        </>
                                                    )}

                                                    <div className="active-buttons">
                                                        <button
                                                            className="call-button"
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                const phone = isCreator
                                                                    ? await getUserPhone(order.executorId)
                                                                    : await getUserPhone(order.creatorId);
                                                                if (!phone) return alert("Телефон не найден");
                                                                callPhone(phone);
                                                            }}
                                                        >
                                                            {isMobile ? <FaPhone /> : "Позвонить"}
                                                        </button>

                                                        <button
                                                            className="message-button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleOpenChat(order.id, "regular");
                                                            }}
                                                        >
                                                            <span className="message-button-content">{isMobile ? <FaComments /> : "Сообщение"}</span>

                                                            {typeof unreadOrders[order.id] === "number" && unreadOrders[order.id] > 0 && (
                                                                <span className="notification-badge-ios">
                                  {unreadOrders[order.id] > 99 ? "99+" : unreadOrders[order.id]}
                                </span>
                                                            )}
                                                        </button>

                                                        <button
                                                            className="route-button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleRouteClick(order);
                                                            }}
                                                        >
                                                            {isMobile ? <FaRoute /> : "Маршрут"}
                                                        </button>

                                                        {orderDisputes[order.id] ? (
                                                            <button
                                                                className="dispute-opened-button"
                                                                onClick={async (e) => {
                                                                    e.stopPropagation();
                                                                    const dispute = orderDisputes[order.id] || (await fetchOrderDispute(order.id));
                                                                    if (!dispute) {
                                                                        return alert("Спор не найден");
                                                                    }

                                                                    alert(
                                                                        `Спор уже открыт.\n\nСтатус: ${dispute.status}\nПричина: ${dispute.reason}${
                                                                            dispute.description ? `\nОписание: ${dispute.description}` : ""
                                                                        }`
                                                                    );
                                                                }}
                                                            >
                                                                {isMobile ? <FaExclamationTriangle /> : "Спор открыт"}
                                                            </button>
                                                        ) : (
                                                            <button
                                                                className="dispute-button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    openDisputeModal(order);
                                                                }}
                                                            >
                                                                {isMobile ? <FaExclamationTriangle /> : "Открыть спор"}
                                                            </button>
                                                        )}

                                                        {isWaitingForOther ? (
                                                            <>
                                                                <button
                                                                    className="waiting-complete-button"
                                                                    disabled
                                                                    title="Ожидаем подтверждение второй стороны"
                                                                >
                                                                    {isMobile ? <FaCheck /> : "Ждём подтверждения"}
                                                                </button>

                                                                <button
                                                                    className="remind-complete-button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        remindCompleteOrder(order.id);
                                                                    }}
                                                                >
                                                                    Напомнить
                                                                </button>
                                                            </>
                                                        ) : isExecutor && !order.workStartedAt ? (
                                                            <button
                                                                className="start-main-button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    startWork(order.id);
                                                                }}
                                                                disabled={startingWork[order.id]}
                                                            >
                                                                {startingWork[order.id]
                                                                    ? isMobile ? <FaPlay /> : "Запуск..."
                                                                    : isMobile ? <FaPlay /> : "Начать"}
                                                            </button>
                                                        ) : (
                                                            <button
                                                                className="complete-button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    completeOrderRequest(order.id);
                                                                }}
                                                            >
                                                                {isMobile ? <FaCheck /> : isWaitingForMe ? "Подтвердить завершение" : "Завершить"}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* details */}
                                                    <div className="order-details">
                                                        <div className="order-left">
                                                            <p>
                                                                <strong>Категория / услуга:</strong>{" "}
                                                                <span className="v-line">{buildServiceLine(order)}</span>
                                                            </p>
                                                        </div>

                                                        {Array.isArray(order.images) && order.images.length > 0 && (
                                                            <div className="image-stack-container">
                                                                <div
                                                                    className="image-stack"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        openModal(order.images);
                                                                    }}
                                                                >
                                                                    {order.images.map((image, index) => (
                                                                        <img
                                                                            key={index}
                                                                            src={`${apiUrl}${image}`}
                                                                            alt={`Order pic ${index + 1}`}
                                                                            className="order-image"
                                                                            style={{ transform: `translateX(${index * 10}px)` }}
                                                                        />
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        <p>
                                                            <strong>Адрес:</strong> {order.address}
                                                        </p>
                                                        <p>
                                                            <strong>Описание:</strong> {order.description}
                                                        </p>

                                                        {order.contractPath && (
                                                            <div className="contract-download-row">
                                                                <a
                                                                    href={`${apiUrl}/${String(order.contractPath).replace(/\\/g, "/")}`}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="contract-download-button"
                                                                    onClick={(e) => e.stopPropagation()}
                                                                >
                                                                    <span className="contract-download-icon">📄</span>
                                                                    <span className="contract-download-text">Скачать договор</span>
                                                                    <span className="contract-download-format">PDF</span>
                                                                </a>
                                                            </div>
                                                        )}

                                                        <div className="photo-protocol-section">
                                                            <h4 className="photo-protocol-title">Фото-протокол заказа</h4>

                                                            <div className="photo-protocol-alert">
                                                                Фото ДО и ПОСЛЕ необязательны, но помогают зафиксировать состояние объекта и результат работы.
                                                            </div>

                                                            {isExecutor ? (
                                                                <>
                                                                    <div className="photo-protocol-card">
                                                                        <div className="photo-protocol-head">
                                                                            <strong>Фото ДО начала работы</strong>
                                                                            <span className="photo-protocol-warning">Рекомендуется</span>
                                                                        </div>

                                                                        <p className="photo-protocol-hint">
                                                                            Зафиксируйте состояние объекта до начала работы.
                                                                        </p>

                                                                        {renderPhotoList(order.executorBeforePhotos)}

                                                                        <label className="photo-upload-button" onClick={(e) => e.stopPropagation()}>
                                                                            {photoUploading[`${order.id}_executorBefore`] ? "Загрузка..." : "Загрузить фото ДО"}
                                                                            <input
                                                                                type="file"
                                                                                accept="image/*"
                                                                                multiple
                                                                                hidden
                                                                                onChange={(e) => uploadOrderPhotos(order.id, "executorBefore", e.target.files)}
                                                                            />
                                                                        </label>
                                                                    </div>

                                                                    <div className="photo-protocol-card">
                                                                        <div className="photo-protocol-head">
                                                                            <strong>Фото ПОСЛЕ выполнения работы</strong>
                                                                            <span className="photo-protocol-warning">Рекомендуется</span>
                                                                        </div>

                                                                        <p className="photo-protocol-hint">
                                                                            Зафиксируйте итоговый результат после выполнения.
                                                                        </p>

                                                                        {renderPhotoList(order.executorAfterPhotos)}

                                                                        <label className="photo-upload-button" onClick={(e) => e.stopPropagation()}>
                                                                            {photoUploading[`${order.id}_executorAfter`] ? "Загрузка..." : "Загрузить фото ПОСЛЕ"}
                                                                            <input
                                                                                type="file"
                                                                                accept="image/*"
                                                                                multiple
                                                                                hidden
                                                                                onChange={(e) => uploadOrderPhotos(order.id, "executorAfter", e.target.files)}
                                                                            />
                                                                        </label>
                                                                    </div>
                                                                </>
                                                            ) : null}

                                                            {isCreator ? (
                                                                <>
                                                                    <div className="photo-protocol-card optional">
                                                                        <div className="photo-protocol-head">
                                                                            <strong>Ваши фото ДО</strong>
                                                                            <span className="photo-protocol-optional">Необязательно</span>
                                                                        </div>

                                                                        <p className="photo-protocol-hint">
                                                                            Можно добавить для фиксации состояния до начала работ.
                                                                        </p>

                                                                        {renderPhotoList(order.customerBeforePhotos)}

                                                                        <label className="photo-upload-button" onClick={(e) => e.stopPropagation()}>
                                                                            {photoUploading[`${order.id}_customerBefore`] ? "Загрузка..." : "Добавить фото ДО"}
                                                                            <input
                                                                                type="file"
                                                                                accept="image/*"
                                                                                multiple
                                                                                hidden
                                                                                onChange={(e) => uploadOrderPhotos(order.id, "customerBefore", e.target.files)}
                                                                            />
                                                                        </label>
                                                                    </div>

                                                                    <div className="photo-protocol-card optional">
                                                                        <div className="photo-protocol-head">
                                                                            <strong>Ваши фото ПОСЛЕ</strong>
                                                                            <span className="photo-protocol-optional">Необязательно</span>
                                                                        </div>

                                                                        <p className="photo-protocol-hint">
                                                                            Можно добавить, если хотите зафиксировать итоговый результат.
                                                                        </p>

                                                                        {renderPhotoList(order.customerAfterPhotos)}

                                                                        <label className="photo-upload-button" onClick={(e) => e.stopPropagation()}>
                                                                            {photoUploading[`${order.id}_customerAfter`] ? "Загрузка..." : "Добавить фото ПОСЛЕ"}
                                                                            <input
                                                                                type="file"
                                                                                accept="image/*"
                                                                                multiple
                                                                                hidden
                                                                                onChange={(e) => uploadOrderPhotos(order.id, "customerAfter", e.target.files)}
                                                                            />
                                                                        </label>
                                                                    </div>
                                                                </>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                            </li>
                                        );
                                    })}

                                    {/* express активные заказы */}
                                    {visibleExpressOrders.map((eo) => (
                                        <ExpressOrderCard
                                            key={`express-${eo.id}-${eo.status}-${eo.updatedAt || eo.completedAt || ""}`}
                                            order={eo}
                                            userId={user.id}
                                            onOrderUpdated={(updatedOrder) => {
                                                if (!updatedOrder?.id) return;

                                                setExpressOrders((prev) => {
                                                    const exists = prev.some(
                                                        (item) => Number(item.id) === Number(updatedOrder.id)
                                                    );

                                                    if (!exists) {
                                                        return [updatedOrder, ...prev];
                                                    }

                                                    return prev.map((item) =>
                                                        Number(item.id) === Number(updatedOrder.id)
                                                            ? {
                                                                ...item,
                                                                ...updatedOrder,
                                                                status: updatedOrder.status ?? item.status,
                                                                executorId: updatedOrder.executorId ?? item.executorId,
                                                                creatorId: updatedOrder.creatorId ?? item.creatorId,
                                                                updatedAt: updatedOrder.updatedAt || new Date().toISOString(),
                                                            }
                                                            : item
                                                    );
                                                });
                                            }}
                                            onReload={async () => {
                                                const r = await axiosInstance.get(`/express/express-orders/me`, {
                                                    params: { mode: "active" },
                                                });

                                                if (r.data?.success) {
                                                    setExpressOrders(Array.isArray(r.data.orders) ? r.data.orders : []);
                                                }

                                                return r;
                                            }}
                                            onCompletedSuccessfully={(completedOrder) => {
                                                openCompletionSuccessModal(
                                                    buildCompletionPayload({
                                                        order: completedOrder,
                                                        orderType: "express",
                                                    })
                                                );
                                            }}
                                            onOpenChat={(orderId) => handleOpenChat(orderId, "express")}
                                            onOpenDispute={(order) => openDisputeModal(order)}
                                            onCallUser={async (order) => {
                                                const phone = Number(order.creatorId) === Number(user.id)
                                                    ? await getUserPhone(order.executorId)
                                                    : await getUserPhone(order.creatorId);

                                                if (!phone) {
                                                    alert("Телефон не найден");
                                                    return;
                                                }

                                                callPhone(phone);
                                            }}
                                        />
                                    ))}
                                </ul>
                            ) : (
                                <p className="no-orders">Нет активных заказов.</p>
                            )}
                        </div>
                    </div>

                    <Modal
                        appElement={document.getElementById("root")}
                        isOpen={isDisputeModalOpen}
                        onRequestClose={closeDisputeModal}
                        contentLabel="Открытие спора"
                        className="custom-modal dispute-modal"
                        overlayClassName="custom-modal-overlay"
                    >
                        <div className="custom-modal-content dispute-modal-content">
                            <button onClick={closeDisputeModal} className="custom-close-button">
                                ✖
                            </button>

                            <h2 className="dispute-modal-title">Открыть спор</h2>

                            {selectedOrderForDispute && (
                                <p className="dispute-order-info">
                                    Заказ №{selectedOrderForDispute.id}
                                </p>
                            )}

                            <div className="dispute-form-group">
                                <label>Категория причины</label>
                                <select
                                    value={disputeReasonCode}
                                    onChange={(e) => setDisputeReasonCode(e.target.value)}
                                    className="dispute-input"
                                >
                                    {disputeReasonOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="dispute-form-group">
                                <label>Краткая причина</label>
                                <input
                                    type="text"
                                    value={disputeReason}
                                    onChange={(e) => setDisputeReason(e.target.value)}
                                    className="dispute-input"
                                    placeholder="Например: работа выполнена не полностью"
                                    maxLength={255}
                                />
                            </div>

                            <div className="dispute-form-group">
                                <label>Подробное описание</label>
                                <textarea
                                    value={disputeDescription}
                                    onChange={(e) => setDisputeDescription(e.target.value)}
                                    className="dispute-textarea"
                                    placeholder="Опишите подробно, в чём проблема, что произошло, что именно не устраивает"
                                    rows={6}
                                />
                            </div>

                            <div className="dispute-modal-actions">
                                <button
                                    className="dispute-cancel-button"
                                    onClick={closeDisputeModal}
                                    disabled={disputeLoading}
                                >
                                    Отмена
                                </button>

                                <button
                                    className="dispute-submit-button"
                                    onClick={submitDispute}
                                    disabled={disputeLoading}
                                >
                                    {disputeLoading ? "Открываем..." : "Открыть спор"}
                                </button>
                            </div>
                        </div>
                    </Modal>

                    {/* Images Modal */}
                    <Modal
                        appElement={document.getElementById("root")}
                        isOpen={isModalOpen}
                        onRequestClose={closeModal}
                        contentLabel="Full Image Modal"
                        className="custom-modal"
                        overlayClassName="custom-modal-overlay"
                    >
                        <div className="custom-modal-content">
                            <button onClick={closeModal} className="custom-close-button">
                                ✖
                            </button>

                            {currentImages.length > 0 && (
                                <img
                                    src={`${apiUrl}${currentImages[currentImageIndex]}`}
                                    alt="Full-size view"
                                    className="custom-modal-image"
                                />
                            )}

                            {currentImages.length > 1 && (
                                <div className="custom-image-navigation">
                                    <button onClick={prevImage} className="custom-nav-button">
                                        ◀
                                    </button>
                                    <button onClick={nextImage} className="custom-nav-button">
                                        ▶
                                    </button>
                                </div>
                            )}
                        </div>
                    </Modal>
                </div>
            </div>
        </div>
    );
};

export default ActiveOrdersPage;