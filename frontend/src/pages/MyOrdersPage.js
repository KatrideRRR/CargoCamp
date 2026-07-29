import React, { useState, useEffect, useContext, useMemo } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import axiosInstance from "../utils/axiosInstance";
import { socket } from "../socketClient";
import OrderServiceDetails from "../components/OrderServiceDetails";
import styles from "../styles/MyOrdersPage.module.css";
import { AuthContext } from "../utils/authContext";
import Modal from "react-modal";
import { FaCreditCard, FaMoneyBillWave, FaQuestionCircle, FaUniversity } from "react-icons/fa";
import { Capacitor } from "@capacitor/core";

const apiUrl = process.env.REACT_APP_API_URL;

const getRouteOrAddress = (order) => {
    if (order.kind === "express") {
        const from = order.fromAddress || "—";
        const to = order.toAddress || "—";
        return `${from} → ${to}`;
    }

    return order.address || "—";
};

const getOrderTimestamp = (order) => {
    const rawDate =
        order?.createdAt ??
        order?.created_at ??
        null;

    if (!rawDate) return 0;

    const timestamp = new Date(rawDate).getTime();

    return Number.isFinite(timestamp)
        ? timestamp
        : 0;
};

const formatOrderDate = (value) => {
    if (!value) return "Дата не указана";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
        return "Дата не указана";
    }

    return date.toLocaleString("ru-RU");
};

const normalizeUserStatus = (user) => {
    const status = String(
        user?.userStatus ??
        user?.user_status ??
        ""
    )
        .trim()
        .toLowerCase();

    if (status === "verified") {
        return {
            status: "verified",
            label: "Верифицирован",
        };
    }

    if (status === "pensioner") {
        return {
            status: "pensioner",
            label: "Пенсионер",
        };
    }

    return {
        status: "unverified",
        label: "Не верифицирован",
    };
};

const normalizeBoolean = (value) => {
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
};

const getOrderTiming = (order) => {
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

    if (!rawWorkTime) return null;

    const date = new Date(rawWorkTime);

    if (Number.isNaN(date.getTime())) return null;

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
};

const MyOrdersPage = () => {
    const { userId } = useParams();
    const location = useLocation();
    const { hasNewRequests, setHasNewRequests } = useContext(AuthContext);
    const navigate = useNavigate();

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

    const targetOrderId = useMemo(() => {
        const params = new URLSearchParams(location.search);
        return params.get("orderId");
    }, [location.search]);

    const shouldExpandTarget = useMemo(() => {
        const params = new URLSearchParams(location.search);
        return params.get("expand") === "1";
    }, [location.search]);

    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [isImageModalOpen, setIsImageModalOpen] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [currentImages, setCurrentImages] = useState([]);

    const [deletingOrderId, setDeletingOrderId] = useState(null);
    const [approving, setApproving] = useState(false);

    // UI состояния
    const [expandedDesc, setExpandedDesc] = useState(() => ({})); // orderId -> bool
    const [expandedExec, setExpandedExec] = useState(() => ({})); // orderId -> bool

    const paymentMethods = useMemo(
        () => [
            { id: "cash", label: "Наличные" },
            { id: "guarantee", label: "Гарантия" },
            { id: "installment", label: "Рассрочка" },
        ],
        []
    );

    const getStatusLabel = (status) => {
        switch (status) {
            case "pending_payment":
                return { text: "Ожидает оплаты", tone: "warn" };
            case "pending":
                return { text: "Опубликован", tone: "ok" };
            default:
                return null; // тут других статусов быть не должно
        }
    };

    const getExpressStatusLabel = (status) => {
        switch (status) {
            case "created":
                return { text: "Ожидает исполнителя", tone: "ok" };
            case "accepted":
                return { text: "Исполнитель найден", tone: "ok" };
            case "on_the_way_to_A":
                return { text: "Исполнитель едет к точке A", tone: "ok" };
            case "arrived_at_A":
                return { text: "Исполнитель прибыл в точку A", tone: "ok" };
            case "in_progress":
                return { text: "Выполняется", tone: "ok" };
            case "completed":
                return { text: "Завершён", tone: "ok" };
            case "cancelled":
                return { text: "Отменён", tone: "warn" };
            default:
                return { text: status || "Неизвестно", tone: "warn" };
        }
    };

    const fetchOrders = async () => {
        try {
            setLoading(true);
            setError("");

            const token = localStorage.getItem("authToken");

            const [regularRes, expressRes] = await Promise.allSettled([
                axiosInstance.get(`/orders/creator/${userId}`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
                axiosInstance.get(`/express/express-orders/me?mode=created`, {
                    headers: { Authorization: `Bearer ${token}` },
                }),
            ]);

            let regularOrders = [];
            let expressOrders = [];

            if (regularRes.status === "fulfilled") {
                const ordersData = regularRes.value.data || [];

                const ordersWithExecutors = await Promise.all(
                    ordersData.map(async (order) => {
                        try {
                            const executorsResponse = await axiosInstance.get(
                                `/orders/${order.id}/requested-executors`,
                                { headers: { Authorization: `Bearer ${token}` } }
                            );
                            return {
                                ...order,
                                createdAt: order.createdAt || order.created_at || null,
                                requestedExecutors: Array.isArray(executorsResponse.data)
                                    ? executorsResponse.data
                                    : [],
                                kind: "regular",
                            };
                        } catch (error) {
                            console.error(`Ошибка загрузки исполнителей для заказа ${order.id}:`, error);
                            return {
                                ...order,
                                createdAt: order.createdAt || order.created_at || null,
                                requestedExecutors: [],
                                kind: "regular",
                            };
                        }
                    })
                );

                regularOrders = ordersWithExecutors.filter(
                    (o) => o.status === "pending" || o.status === "pending_payment"
                );
            }

            if (expressRes.status === "fulfilled") {
                const expressData = expressRes.value.data?.orders || [];

                expressOrders = expressData
                    .filter((o) => Number(o.creatorId) === Number(userId))
                    // На странице "Мои заказы" показываем только экспресс-заказы,
                    // которые ещё никто не взял. После accepted они должны быть в active-orders.
                    .filter((o) => o.status === "created" && !o.executorId)
                    .map((o) => ({
                        ...o,
                        kind: "express",
                        createdAt: o.createdAt || o.created_at || null,
                    }));
            }

            const merged = [...regularOrders, ...expressOrders].sort((a, b) => {
                if (targetOrderId) {
                    if (String(a.id) === String(targetOrderId)) return -1;
                    if (String(b.id) === String(targetOrderId)) return 1;
                }

                return getOrderTimestamp(b) - getOrderTimestamp(a);
            });

            setOrders(merged);

            if (targetOrderId && shouldExpandTarget) {
                setExpandedExec((prev) => ({
                    ...prev,
                    [targetOrderId]: true,
                }));

                setExpandedDesc((prev) => ({
                    ...prev,
                    [targetOrderId]: true,
                }));
            }
        } catch (err) {
            console.error("Ошибка при загрузке заказов:", err);
            setError("Ошибка загрузки данных");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const guaranteeReturn = params.get("guaranteeReturn");
        if (guaranteeReturn === "1") {
            (async () => {
                await fetchOrders();
                navigate(location.pathname, { replace: true });
            })();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.search]);

    const approveExecutor = async (orderId, executorId) => {
        if (approving) return;
        setApproving(true);

        try {
            const res = await axiosInstance.post(`/orders/${orderId}/approve`, { executorId });

            /**
             * Если это безопасная сделка / рассрочка и backend вернул ссылку на оплату —
             * сначала отправляем на оплату. Активным заказ станет после оплаты/подтверждения.
             */
            if (res.data?.confirmationUrl) {
                window.location.href = res.data.confirmationUrl;
                return;
            }

            /**
             * Если заказ сразу стал active, например при наличной оплате,
             * переносим заказчика в "Активные заказы" → "Мои заказы выполняют".
             */
            navigate(
                `/active-orders?view=created&orderId=${orderId}&orderType=regular&reason=approved`
            );
        } catch (error) {
            console.error(error);
            alert(error.response?.data?.message || "Не удалось одобрить исполнителя");
        } finally {
            setApproving(false);
        }
    };

    const hideMyOrder = async (order) => {
        if (!order?.id) return;

        if (order.kind === "express") {
            if (order.status !== "created" || order.executorId) {
                alert("Этот экспресс-заказ уже нельзя удалить, потому что он уже принят или выполняется.");
                return;
            }

            const ok = window.confirm(
                "Удалить экспресс-заказ из списка? Он больше не будет отображаться в ваших заказах и в доступных заказах."
            );

            if (!ok) return;

            try {
                setDeletingOrderId(order.id);

                await axiosInstance.patch(`/express/express-orders/${order.id}/hide-by-creator`);

                setOrders((prev) =>
                    prev.filter((o) => !(o.kind === "express" && Number(o.id) === Number(order.id)))
                );
            } catch (e) {
                console.error("Ошибка удаления экспресс-заказа:", e);
                alert(e.response?.data?.message || "Не удалось удалить экспресс-заказ");
            } finally {
                setDeletingOrderId(null);
            }

            return;
        }

        const allowedStatuses = ["pending", "pending_payment"];

        if (!allowedStatuses.includes(order.status)) {
            alert("Этот заказ уже нельзя удалить, потому что он уже не в статусе ожидания.");
            return;
        }

        const ok = window.confirm(
            "Удалить заказ из списка? Он больше не будет отображаться в ваших заказах."
        );

        if (!ok) return;

        try {
            setDeletingOrderId(order.id);

            await axiosInstance.patch(`/orders/${order.id}/hide-by-creator`);

            setOrders((prev) =>
                prev.filter((o) => !(o.kind === "regular" && Number(o.id) === Number(order.id)))
            );
        } catch (e) {
            console.error("Ошибка удаления заказа:", e);
            alert(e.response?.data?.message || "Не удалось удалить заказ");
        } finally {
            setDeletingOrderId(null);
        }
    };

    useEffect(() => {
        fetchOrders();

        const checkAuthUser = async () => {
            try {
                const token = localStorage.getItem("authToken");
                const profileResponse = await axiosInstance.get("/auth/profile", {
                    headers: { Authorization: `Bearer ${token}` },
                });

                if (profileResponse.data.id !== Number(userId)) {
                    navigate("/");
                    return;
                }

                const normalizedUserId = String(profileResponse.data.id);

                socket.emit("register", normalizedUserId);
                socket.emit("subscribeToNotifications", normalizedUserId);
            } catch (err) {
                console.error("Ошибка проверки пользователя:", err);
                navigate("/login");
            }
        };

        const removeAcceptedExpressFromMyOrders = (payload) => {
            const orderId = payload?.orderId;

            if (!orderId) {
                fetchOrders();
                return;
            }

            setOrders((prev) =>
                prev.filter((order) => {
                    if (order.kind !== "express") return true;
                    return Number(order.id) !== Number(orderId);
                })
            );

            fetchOrders();
        };

        checkAuthUser();

        socket.on("orderUpdated", fetchOrders);
        socket.on("activeOrdersUpdated", fetchOrders);

        socket.on("expressOrdersUpdated", fetchOrders);
        socket.on("expressOrderAccepted", removeAcceptedExpressFromMyOrders);
        socket.on("expressOrderStatusChanged", removeAcceptedExpressFromMyOrders);
        socket.on("expressStatusChanged", removeAcceptedExpressFromMyOrders);

        return () => {
            socket.off("orderUpdated", fetchOrders);
            socket.off("activeOrdersUpdated", fetchOrders);

            socket.off("expressOrdersUpdated", fetchOrders);
            socket.off("expressOrderAccepted", removeAcceptedExpressFromMyOrders);
            socket.off("expressOrderStatusChanged", removeAcceptedExpressFromMyOrders);
            socket.off("expressStatusChanged", removeAcceptedExpressFromMyOrders);
        };
    }, [userId, navigate, setHasNewRequests, targetOrderId, shouldExpandTarget]);

    const getPaymentIcon = (type) => {
        switch (type) {
            case "guarantee":
                return <FaUniversity title="Гарантия" />;
            case "cash":
                return <FaMoneyBillWave title="Наличные" />;
            case "installment":
                return <FaCreditCard title="Рассрочка" />;
            default:
                return <FaQuestionCircle title="Неизвестно" />;
        }
    };

    // --- pull to refresh ---
    useEffect(() => {
        const onPullToRefresh = async (e) => {
            try {
                await fetchOrders();
            } finally {
                e.detail?.done?.();
            }
        };

        window.addEventListener("appPullToRefresh", onPullToRefresh);

        return () => {
            window.removeEventListener("appPullToRefresh", onPullToRefresh);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

    const openModal = (images) => {
        setCurrentImages(images || []);
        setCurrentImageIndex(0);
        setIsImageModalOpen(true);
    };

    const closeModal = () => {
        setIsImageModalOpen(false);
        setCurrentImageIndex(0);
        setCurrentImages([]);
    };

    const nextImage = () => {
        setCurrentImageIndex((prevIndex) => (prevIndex + 1) % currentImages.length);
    };

    const prevImage = () => {
        setCurrentImageIndex((prevIndex) => (prevIndex - 1 + currentImages.length) % currentImages.length);
    };

    const toggleDesc = (orderId) => {
        setExpandedDesc((prev) => ({ ...prev, [orderId]: !prev[orderId] }));
    };

    const toggleExec = (orderId) => {
        setExpandedExec((prev) => ({ ...prev, [orderId]: !prev[orderId] }));
    };

    return (
        <div className={`${styles.container} ${platform === "ios" ? styles.iosContainer : ""}`}>
            <div className={styles.ordersWrapper}>
                {/* Top bar */}
                <div className={styles.topBar}>
                    <div className={styles.topLeft}>
                        <div className={styles.pageTitle}>Мои заказы</div>
                        <div className={styles.pageSub}>
                            Всего: <b>{orders.length}</b>
                        </div>
                    </div>

                    <div className={styles.topActions}>
                        <button
                            onClick={() => navigate("/create-order")}
                            className={`${styles.createButton} ${hasNewRequests ? styles.newRequest : ""}`}
                        >
                            Разместить
                        </button>

                        <button
                            onClick={() => navigate("/express")}
                            className={styles.expressButton}
                        >
                            Вызвать такси / курьера
                        </button>
                    </div>
                </div>

                {loading ? (
                    <p className={styles.stateText}>Загрузка…</p>
                ) : error ? (
                    <p className={styles.errorMessage}>{error}</p>
                ) : orders.length > 0 ? (
                    <ul className={styles.ordersList}>
                        {orders.map((order) => {
                            const isExpress = order.kind === "express";
                            const orderTiming = isExpress
                                ? null
                                : getOrderTiming(order);

                            const st = isExpress ? getExpressStatusLabel(order.status) : getStatusLabel(order.status);
                            const paymentLabel =
                                paymentMethods.find((m) => m.id === order.paymentType)?.label || "—";

                            const isDescExpanded = !!expandedDesc[order.id];
                            const isExecExpanded = !!expandedExec[order.id];
                            const hasImages = Array.isArray(order.images) && order.images.length > 0;
                            const hasExecutors =
                                Array.isArray(order.requestedExecutors) && order.requestedExecutors.length > 0;

                            const description =
                                typeof order.description === "string"
                                    ? order.description.trim()
                                    : "";

                            const hasDescription = description.length > 0;

                            return (
                                <li
                                    className={`${styles.orderCard} ${isExpress ? styles.orderCardExpress : ""}`}
                                    key={order.id}
                                >
                                    <div className={styles.orderContent}>
                                        {/* Header row */}
                                        <div className={styles.cardTop}>
                                            <div className={styles.cardTopLeft}>
                                                <div className={styles.orderIdLine}>
<span className={styles.orderId}>
    {isExpress ? `Экспресс №${order.id}` : `Заказ №${order.id}`}
</span>
                                                    <span className={styles.orderDate}>
    {formatOrderDate(order.createdAt)}
</span>
                                                </div>

                                                <div className={styles.titleRow}>
<span className={`${styles.orderType} ${isExpress ? styles.orderTypeExpress : ""}`}>
    {isExpress
        ? order.type === "taxi"
            ? "Экспресс • Такси"
            : "Экспресс • Курьер"
        : order.type || "Обычный заказ"}
</span>                                                </div>

                                                {/* Status pill */}
                                                {st && (
                                                    <div className={styles.subRow}>
<span
    className={`${styles.statusPill} ${styles[`status_${st.tone}`]} ${isExpress ? styles.statusExpress : ""}`}
>                              {st.text}
                            </span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Finance pill */}
                                            <div className={`${styles.financeBadge} ${isExpress ? styles.financeBadgeExpress : ""}`}>
                                                <span className={styles.financeIcon}>{getPaymentIcon(order.paymentType)}</span>
                                                <span className={styles.financePrice}>
    {isExpress ? order.totalPrice : order.proposedSum} ₽
</span>                                                <span className={styles.financeDot}>•</span>
                                                <span className={styles.financeType}>{paymentLabel}</span>
                                            </div>
                                        </div>

                                        {/* Meta */}
                                        <div className={styles.metaGrid}>
                                            {isExpress ? (
                                                <>
                                                    <div className={styles.metaItem}>
                                                        <span className={styles.metaLabel}>Откуда</span>
                                                        <span className={styles.metaValue}>{order.fromAddress || "—"}</span>
                                                    </div>

                                                    <div className={styles.metaItem}>
                                                        <span className={styles.metaLabel}>Куда</span>
                                                        <span className={styles.metaValue}>{order.toAddress || "—"}</span>
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <div className={styles.metaItem}>
                                                        <span className={styles.metaLabel}>Категория</span>
                                                        <span className={styles.metaValue}>{order.category?.name || "—"}</span>
                                                    </div>

                                                    <div className={styles.metaItem}>
                                                        <span className={styles.metaLabel}>Подкатегория</span>
                                                        <span className={styles.metaValue}>{order.subcategory?.name || "—"}</span>
                                                    </div>
                                                </>
                                            )}
                                        </div>

                                        <div className={styles.routeBox}>
    <span className={styles.routeLabel}>
        {isExpress ? "Маршрут" : "Адрес"}
    </span>

                                            <span className={`${styles.routeValue} ${isExpress ? styles.routeValueExpress : ""}`}>
        {getRouteOrAddress(order)}
    </span>
                                        </div>

                                        {orderTiming && (
                                            <div
                                                className={`${styles.orderTimeBox} ${
                                                    orderTiming.type === "asap"
                                                        ? styles.orderTimeAsap
                                                        : styles.orderTimeScheduled
                                                }`}
                                            >
        <span className={styles.orderTimeIcon}>
            {orderTiming.type === "asap" ? "⚡" : "🕒"}
        </span>

                                                <div className={styles.orderTimeContent}>
            <span className={styles.orderTimeLabel}>
                {orderTiming.label}
            </span>

                                                    <span className={styles.orderTimeValue}>
                {orderTiming.value}
            </span>
                                                </div>
                                            </div>
                                        )}

                                        {(
                                            (!isExpress && ["pending", "pending_payment"].includes(order.status)) ||
                                            (isExpress && order.status === "created" && !order.executorId)
                                        ) && (
                                            <div className={styles.orderManageActions}>
                                                <button
                                                    type="button"
                                                    className={styles.deleteOrderBtn}
                                                    onClick={() => hideMyOrder(order)}
                                                    disabled={deletingOrderId === order.id}
                                                >
                                                    {deletingOrderId === order.id ? "Удаляем..." : "Удалить заказ"}
                                                </button>
                                            </div>
                                        )}

                                        {/* Images (compact) */}
                                        {hasImages ? (
                                            <div className={styles.imagesRow}>
                                                <div className={styles.imageStack} onClick={() => openModal(order.images)}>
                                                    {order.images.slice(0, 4).map((image, index) => {
                                                        const imageUrl = `${apiUrl}${image}`;
                                                        return (
                                                            <img
                                                                key={index}
                                                                src={imageUrl}
                                                                alt={`Order pic ${index + 1}`}
                                                                className={styles.thumb}
                                                            />
                                                        );
                                                    })}
                                                    {order.images.length > 4 && (
                                                        <div className={styles.moreThumb}>+{order.images.length - 4}</div>
                                                    )}
                                                </div>
                                            </div>
                                        ) : null}

                                        {/* Description */}
                                        {hasDescription && (
                                            <div className={styles.section}>
                                                <div className={styles.sectionHead}>
                                                    <span className={styles.sectionTitle}>Описание</span>

                                                    {description.length > 120 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleDesc(order.id)}
                                                            className={styles.linkButton}
                                                        >
                                                            {isDescExpanded ? "Свернуть" : "Подробнее"}
                                                        </button>
                                                    )}
                                                </div>

                                                <p
                                                    className={`${styles.descText} ${
                                                        isDescExpanded
                                                            ? styles.descExpanded
                                                            : styles.descCollapsed
                                                    }`}
                                                >
                                                    {description}
                                                </p>
                                            </div>
                                        )}

                                        {!isExpress && (
                                            <OrderServiceDetails
                                                order={order}
                                            />
                                        )}

                                        {/* Pending payment actions */}
                                        {!isExpress ? (
                                            order.status === "pending_payment" ? (
                                                <div className={styles.cardActions}>
                                                    <span className={styles.pillWarn}>Продвижение не оплачено</span>

                                                    <button
                                                        className={styles.primaryBtn}
                                                        onClick={async () => {
                                                            try {
                                                                const res = await axiosInstance.post(
                                                                    "/payments/order/promotion/create",
                                                                    { orderId: order.id }
                                                                );

                                                                if (!res.data?.success) {
                                                                    alert(res.data?.error || "Не удалось оплатить продвижение");
                                                                    return;
                                                                }

                                                                if (res.data.paidBySavedCard) {
                                                                    if (res.data.paid) {
                                                                        alert("Продвижение оплачено с привязанной карты");
                                                                        await fetchOrders();
                                                                        return;
                                                                    }

                                                                    alert("Платёж с привязанной карты обрабатывается. Статус обновится после подтверждения.");
                                                                    setTimeout(fetchOrders, 2000);
                                                                    return;
                                                                }

                                                                const url = res.data?.confirmationUrl;

                                                                if (url) {
                                                                    window.location.href = url;
                                                                    return;
                                                                }

                                                                alert("Не удалось получить ссылку на оплату");
                                                            } catch (e) {
                                                                alert(e.response?.data?.error || "Ошибка при создании оплаты");
                                                            }
                                                        }}
                                                    >
                                                        Оплатить
                                                    </button>
                                                </div>
                                            ) : (
                                                <div className={styles.section}>
                                                    <div className={styles.sectionHead}>
                                                        <span className={styles.sectionTitle}>Запросы исполнителей</span>

                                                        <span className={styles.countPill}>{hasExecutors ? order.requestedExecutors.length : 0}</span>

                                                        <button
                                                            type="button"
                                                            onClick={() => toggleExec(order.id)}
                                                            className={styles.linkButton}
                                                        >
                                                            {isExecExpanded ? "Скрыть" : "Показать"}
                                                        </button>
                                                    </div>

                                                    {isExecExpanded ? (
                                                        hasExecutors ? (
                                                            <div className={styles.execList}>
                                                                {order.requestedExecutors.map((executor) => {
                                                                    const verification = normalizeUserStatus(executor);

                                                                    return (
                                                                        <div key={executor.id} className={styles.execCard}>
                                                                            <div className={styles.execInfo}>
                                                                                <div className={styles.execName}>
                                                                                    {executor.username || `Пользователь ${executor.id}`}{" "}

                                                                                    <span className={styles.execMeta}>
                        •{" "}
                                                                                        {Number(executor.rating) > 0
                                                                                            ? Number(executor.rating).toFixed(1)
                                                                                            : "—"}{" "}
                                                                                        ⭐ • {Number(executor.ratingCount || 0)}
                    </span>
                                                                                </div>

                                                                                <div className={styles.executorStatusRow}>
                    <span
                        className={[
                            styles.verificationBadge,
                            verification.status === "verified"
                                ? styles.verificationBadgeVerified
                                : "",
                            verification.status === "pensioner"
                                ? styles.verificationBadgePensioner
                                : "",
                            verification.status === "unverified"
                                ? styles.verificationBadgeUnverified
                                : "",
                        ]
                            .filter(Boolean)
                            .join(" ")}
                    >
                        {verification.status === "verified" && "✓ "}
                        {verification.status === "pensioner" && "◆ "}
                        {verification.status === "unverified" && "○ "}

                        {verification.label}
                    </span>
                                                                                </div>

                                                                                <div className={styles.execLine}>
                                                                                    <span className={styles.k}>Цена</span>

                                                                                    <span className={styles.v}>
                        {Number(executor.proposedSum) > 0
                            ? `${Number(executor.proposedSum).toLocaleString("ru-RU")} ₽`
                            : "—"}
                    </span>
                                                                                </div>

                                                                                {executor.comment ? (
                                                                                    <div className={styles.execLine}>
                                                                                        <span className={styles.k}>Комментарий</span>

                                                                                        <span className={styles.v}>
                            {executor.comment}
                        </span>
                                                                                    </div>
                                                                                ) : null}
                                                                            </div>

                                                                            <div className={styles.execActions}>
                                                                                <button
                                                                                    onClick={() =>
                                                                                        navigate(`/complaints/${executor.id}`)
                                                                                    }
                                                                                    className={styles.ghostBtnDanger}
                                                                                >
                                                                                    Жалобы
                                                                                </button>

                                                                                <button
                                                                                    disabled={approving}
                                                                                    onClick={() =>
                                                                                        approveExecutor(order.id, executor.id)
                                                                                    }
                                                                                    className={styles.ghostBtn}
                                                                                >
                                                                                    {approving ? "..." : "Одобрить"}
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        ) : (
                                                            <div className={styles.mutedText}>Пока нет запросов</div>
                                                        )
                                                    ) : (
                                                        <div className={styles.mutedText}>
                                                            {hasExecutors ? "Список скрыт" : "Пока нет запросов"}
                                                        </div>
                                                    )}
                                                </div>
                                            )
                                        ) : (
                                            <div className={styles.section}>
                                                <div className={styles.sectionHead}>
                                                    <span className={styles.sectionTitle}>Экспресс-заказ</span>
                                                </div>

                                                <div className={styles.mutedText}>
                                                    {order.executorId
                                                        ? "Исполнитель уже назначен. Следите за статусом заказа."
                                                        : "Ожидаем, пока заказ примет исполнитель."}
                                                </div>
                                            </div>
                                        )}

                                        {/* Images modal */}
                                        <Modal
                                            appElement={document.getElementById("root")}
                                            isOpen={isImageModalOpen}
                                            onRequestClose={closeModal}
                                            contentLabel="Full Image Modal"
                                            className="custom-modal"
                                            overlayClassName="custom-modal-overlay"
                                        >
                                            <div className="custom-modal-content">
                                                <button onClick={closeModal} className="custom-close-button">
                                                    ✖
                                                </button>

                                                <img
                                                    src={`${apiUrl}${currentImages[currentImageIndex]}`}
                                                    alt="Full-size view"
                                                    className="custom-modal-image"
                                                />

                                                <div className="custom-image-navigation">
                                                    <button onClick={prevImage} className="custom-nav-button">
                                                        ◀
                                                    </button>
                                                    <button onClick={nextImage} className="custom-nav-button">
                                                        ▶
                                                    </button>
                                                </div>
                                            </div>
                                        </Modal>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <p className={styles.noOrders}>Пока нет заказов.</p>
                )}
            </div>
        </div>
    );
};

export default MyOrdersPage;