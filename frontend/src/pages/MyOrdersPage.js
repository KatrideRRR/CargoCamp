import CreateOrderModal from "../components/CreateOrderModal";
import React, { useState, useEffect, useContext, useMemo } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import axiosInstance from "../utils/axiosInstance";
import { socket } from "../socketClient";
import styles from "../styles/MyOrdersPage.module.css";
import { AuthContext } from "../utils/authContext";
import Modal from "react-modal";
import { FaCreditCard, FaMoneyBillWave, FaQuestionCircle, FaUniversity } from "react-icons/fa";

const apiUrl = process.env.REACT_APP_API_URL;

const MyOrdersPage = () => {
    const { userId } = useParams();
    const location = useLocation();
    const { hasNewRequests, setHasNewRequests } = useContext(AuthContext);
    const navigate = useNavigate();

    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    const [isImageModalOpen, setIsImageModalOpen] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [currentImages, setCurrentImages] = useState([]);

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

    const fetchOrders = async () => {
        try {
            setLoading(true);
            setError("");

            const token = localStorage.getItem("authToken");
            const response = await axiosInstance.get(`/orders/creator/${userId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            const ordersData = response.data || [];

            const ordersWithExecutors = await Promise.all(
                ordersData.map(async (order) => {
                    try {
                        const executorsResponse = await axiosInstance.get(
                            `/orders/${order.id}/requested-executors`,
                            { headers: { Authorization: `Bearer ${token}` } }
                        );
                        return {
                            ...order,
                            requestedExecutors: Array.isArray(executorsResponse.data)
                                ? executorsResponse.data
                                : [],
                        };
                    } catch (error) {
                        console.error(`Ошибка загрузки исполнителей для заказа ${order.id}:`, error);
                        return { ...order, requestedExecutors: [] };
                    }
                })
            );

            // ✅ только pending / pending_payment
            setOrders(
                ordersWithExecutors.filter(
                    (o) => o.status === "pending" || o.status === "pending_payment"
                )
            );
        } catch (err) {
            if (err.response && err.response.status === 404) {
                setOrders([]);
            } else {
                console.error("Ошибка при загрузке заказов:", err);
                setError("Ошибка загрузки данных");
            }
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

            } catch (err) {
                console.error("Ошибка проверки пользователя:", err);
                navigate("/login");
            }
        };

        checkAuthUser();

        socket.on("orderUpdated", fetchOrders);

        return () => {
            socket.off("orderUpdated", fetchOrders);
        };
    }, [userId, navigate, setHasNewRequests]);

    const approveExecutor = async (orderId, executorId) => {
        if (approving) return;
        setApproving(true);

        try {
            const res = await axiosInstance.post(`/orders/${orderId}/approve`, { executorId });

            if (res.data?.confirmationUrl) {
                window.location.href = res.data.confirmationUrl;
                return;
            }

            alert("Исполнитель одобрен!");
            setOrders((prev) =>
                prev.map((o) =>
                    o.id === orderId
                        ? {
                            ...o,
                            requestedExecutors: o.requestedExecutors.filter((e) => e.id !== executorId),
                        }
                        : o
                )
            );
        } catch (error) {
            console.error(error);
            alert(error.response?.data?.message || "Не удалось одобрить исполнителя");
        } finally {
            setApproving(false);
        }
    };

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
        <div className={styles.container}>
            <div className={styles.ordersWrapper}>
                {/* Top bar */}
                <div className={styles.topBar}>
                    <div className={styles.topLeft}>
                        <div className={styles.pageTitle}>Мои заказы</div>
                        <div className={styles.pageSub}>
                            Всего: <b>{orders.length}</b>
                        </div>
                    </div>

                    <button
                        onClick={() => navigate("/create-order")}
                        className={`${styles.createButton} ${hasNewRequests ? styles.newRequest : ""}`}
                    >
                        Разместить
                    </button>
                </div>

                {loading ? (
                    <p className={styles.stateText}>Загрузка…</p>
                ) : error ? (
                    <p className={styles.errorMessage}>{error}</p>
                ) : orders.length > 0 ? (
                    <ul className={styles.ordersList}>
                        {orders.map((order) => {
                            const st = getStatusLabel(order.status);
                            const paymentLabel =
                                paymentMethods.find((m) => m.id === order.paymentType)?.label || "—";

                            const isDescExpanded = !!expandedDesc[order.id];
                            const isExecExpanded = !!expandedExec[order.id];
                            const hasImages = Array.isArray(order.images) && order.images.length > 0;
                            const hasExecutors =
                                Array.isArray(order.requestedExecutors) && order.requestedExecutors.length > 0;

                            return (
                                <li className={styles.orderCard} key={order.id}>
                                    <div className={styles.orderContent}>
                                        {/* Header row */}
                                        <div className={styles.cardTop}>
                                            <div className={styles.cardTopLeft}>
                                                <div className={styles.orderIdLine}>
                                                    <span className={styles.orderId}>Заказ №{order.id}</span>
                                                    <span className={styles.orderDate}>
                            {new Date(order.createdAt).toLocaleString()}
                          </span>
                                                </div>

                                                <div className={styles.titleRow}>
                                                    <span className={styles.orderType}>{order.type}</span>
                                                </div>

                                                {/* Status pill */}
                                                {st && (
                                                    <div className={styles.subRow}>
                            <span className={`${styles.statusPill} ${styles[`status_${st.tone}`]}`}>
                              {st.text}
                            </span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Finance pill */}
                                            <div className={styles.financeBadge}>
                                                <span className={styles.financeIcon}>{getPaymentIcon(order.paymentType)}</span>
                                                <span className={styles.financePrice}>{order.proposedSum} ₽</span>
                                                <span className={styles.financeDot}>•</span>
                                                <span className={styles.financeType}>{paymentLabel}</span>
                                            </div>
                                        </div>

                                        {/* Meta */}
                                        <div className={styles.metaGrid}>
                                            <div className={styles.metaItem}>
                                                <span className={styles.metaLabel}>Категория</span>
                                                <span className={styles.metaValue}>{order.category?.name || "—"}</span>
                                            </div>

                                            <div className={styles.metaItem}>
                                                <span className={styles.metaLabel}>Подкатегория</span>
                                                <span className={styles.metaValue}>{order.subcategory?.name || "—"}</span>
                                            </div>
                                        </div>

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
                                        <div className={styles.section}>
                                            <div className={styles.sectionHead}>
                                                <span className={styles.sectionTitle}>Описание</span>

                                                {order.description && order.description.length > 120 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleDesc(order.id)}
                                                        className={styles.linkButton}
                                                    >
                                                        {isDescExpanded ? "Свернуть" : "Подробнее"}
                                                    </button>
                                                )}
                                            </div>

                                            <p className={`${styles.descText} ${isDescExpanded ? styles.descExpanded : styles.descCollapsed}`}>
                                                {order.description || "—"}
                                            </p>
                                        </div>

                                        {/* Pending payment actions */}
                                        {order.status === "pending_payment" ? (
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
                                                            const url = res.data?.confirmationUrl;
                                                            if (url) window.location.href = url;
                                                            else alert("Не удалось получить ссылку на оплату");
                                                        } catch (e) {
                                                            alert(e.response?.data?.error || "Ошибка при создании оплаты");
                                                        }
                                                    }}
                                                >
                                                    Оплатить
                                                </button>
                                            </div>
                                        ) : (
                                            /* Executors accordion (only for pending) */
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
                                                            {order.requestedExecutors.map((executor) => (
                                                                <div key={executor.id} className={styles.execCard}>
                                                                    <div className={styles.execInfo}>
                                                                        <div className={styles.execName}>
                                                                            {executor.username}{" "}
                                                                            <span className={styles.execMeta}>
                                        • {executor.rating ? executor.rating.toFixed(1) : "—"} ⭐ • {executor.ratingCount || 0}
                                      </span>
                                                                        </div>

                                                                        <div className={styles.execLine}>
                                                                            <span className={styles.k}>Цена</span>
                                                                            <span className={styles.v}>
                                        {executor.proposedSum ? `${executor.proposedSum} ₽` : "—"}
                                      </span>
                                                                        </div>

                                                                        {executor.comment ? (
                                                                            <div className={styles.execLine}>
                                                                                <span className={styles.k}>Комментарий</span>
                                                                                <span className={styles.v}>{executor.comment}</span>
                                                                            </div>
                                                                        ) : null}

                                                                        {executor.isVerified && <span className={styles.verifiedBadge}>✔ Верифицирован</span>}
                                                                    </div>

                                                                    <div className={styles.execActions}>
                                                                        <button
                                                                            onClick={() => navigate(`/complaints/${executor.id}`)}
                                                                            className={styles.ghostBtnDanger}
                                                                        >
                                                                            Жалобы
                                                                        </button>

                                                                        <button
                                                                            disabled={approving}
                                                                            onClick={() => approveExecutor(order.id, executor.id)}
                                                                            className={styles.ghostBtn}
                                                                        >
                                                                            {approving ? "..." : "Одобрить"}
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            ))}
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

            <CreateOrderModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />
        </div>
    );
};

export default MyOrdersPage;