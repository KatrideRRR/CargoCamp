import CreateOrderModal from '../components/CreateOrderModal';
import React, { useState, useEffect, useContext, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import axiosInstance from '../utils/axiosInstance';
import io from 'socket.io-client';
import styles from '../styles/MyOrdersPage.module.css';
import { AuthContext } from "../utils/authContext";
import Modal from "react-modal";
import { FaCreditCard, FaMoneyBillWave, FaQuestionCircle, FaUniversity } from "react-icons/fa";

const apiUrl = process.env.REACT_APP_API_URL;
const socket = io(process.env.REACT_APP_SOCKET_URL);

const MyOrdersPage = () => {
    const { userId } = useParams();
    const location = useLocation();
    const { hasNewRequests, setHasNewRequests } = useContext(AuthContext);
    const navigate = useNavigate();

    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

    const [isImageModalOpen, setIsImageModalOpen] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [currentImages, setCurrentImages] = useState([]);

    const [approving, setApproving] = useState(false);

    // UI состояния
    const [expandedDesc, setExpandedDesc] = useState(() => ({}));      // orderId -> bool
    const [expandedExec, setExpandedExec] = useState(() => ({}));      // orderId -> bool

    const paymentMethods = useMemo(() => ([
        { id: "cash", label: "Наличные", icon: "💵" },
        { id: "guarantee", label: "Гарантия", icon: "🛡️" },
        { id: "installment", label: "Рассрочка", icon: "💳" },
    ]), []);

    const fetchOrders = async () => {
        try {
            setLoading(true);
            setError('');

            const token = localStorage.getItem('authToken');
            const response = await axiosInstance.get(`/orders/creator/${userId}`, {
                headers: { Authorization: `Bearer ${token}` }
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
                            requestedExecutors: Array.isArray(executorsResponse.data) ? executorsResponse.data : []
                        };
                    } catch (error) {
                        console.error(`Ошибка загрузки исполнителей для заказа ${order.id}:`, error);
                        return { ...order, requestedExecutors: [] };
                    }
                })
            );

            setOrders(ordersWithExecutors);
        } catch (err) {
            if (err.response && err.response.status === 404) {
                setOrders([]);
            } else {
                console.error('Ошибка при загрузке заказов:', err);
                setError('Ошибка загрузки данных');
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
    }, [location.search]);

    useEffect(() => {
        fetchOrders();

        const checkAuthUser = async () => {
            try {
                const token = localStorage.getItem('authToken');
                const profileResponse = await axiosInstance.get('/auth/profile', {
                    headers: { Authorization: `Bearer ${token}` }
                });

                if (profileResponse.data.id !== Number(userId)) {
                    navigate('/');
                    return;
                }

                // Подписка на запросы
                socket.on(`orderRequest-${userId}`, () => {
                    setHasNewRequests(true);
                    fetchOrders();
                });

            } catch (err) {
                console.error('Ошибка проверки пользователя:', err);
                navigate('/login');
            }
        };

        checkAuthUser();

        const handleOrderRequest = () => {
            fetchOrders();
        };

        socket.on('orderRequest', handleOrderRequest);
        socket.on('orderUpdated', fetchOrders);

        return () => {
            socket.off('orderRequest', handleOrderRequest);
            socket.off('orderUpdated', fetchOrders);
            socket.off(`orderRequest-${userId}`);
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

            alert('Исполнитель одобрен!');
            setOrders((prev) =>
                prev.map((o) =>
                    o.id === orderId
                        ? { ...o, requestedExecutors: o.requestedExecutors.filter((e) => e.id !== executorId) }
                        : o
                )
            );
        } catch (error) {
            console.error(error);
            alert(error.response?.data?.message || 'Не удалось одобрить исполнителя');
        } finally {
            setApproving(false);
        }
    };

    const getPaymentIcon = (type) => {
        switch (type) {
            case 'guarantee':
                return <FaUniversity title="Tinkoff" />;
            case 'cash':
                return <FaMoneyBillWave title="Наличные" />;
            case 'installment':
                return <FaCreditCard title="Карта" />;
            default:
                return <FaQuestionCircle title="Неизвестно" />;
        }
    };

    const openModal = (images) => {
        setCurrentImages(images);
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

                <button
                    onClick={() => navigate('/create-order')}
                    className={`${styles.createButton} ${hasNewRequests ? styles.newRequest : ''}`}
                >
                    Разместить заказ
                </button>

                {loading ? (
                    <p className={styles.stateText}>Загрузка заказов...</p>
                ) : error ? (
                    <p className={styles.errorMessage}>{error}</p>
                ) : orders.length > 0 ? (
                    <ul className={styles.ordersList}>
                        {orders.map((order) => {
                            const paymentLabel = paymentMethods.find(m => m.id === order.paymentType)?.label || "—";
                            const isDescExpanded = !!expandedDesc[order.id];
                            const isExecExpanded = !!expandedExec[order.id];
                            const hasImages = Array.isArray(order.images) && order.images.length > 0;
                            const hasExecutors = Array.isArray(order.requestedExecutors) && order.requestedExecutors.length > 0;

                            return (
                                <li className={styles.orderCard} key={order.id}>
                                    <div className={styles.orderContent}>

                                        {/* ШАПКА */}
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
                                            </div>

                                            <div className={styles.financeBadge}>
  <span className={styles.financeIcon}>
    {getPaymentIcon(order.paymentType)}
  </span>

                                                <span className={styles.financePrice}>
    {order.proposedSum} ₽
  </span>

                                                <span className={styles.financeDot}>•</span>

                                                <span className={styles.financeType}>
    {paymentLabel}
  </span>
                                            </div>
                                        </div>

                                        {/* КОМПАКТНЫЕ ДЕТАЛИ */}
                                        <div className={styles.metaGrid}>
                                            <div className={styles.metaItem}>
                                                <span className={styles.metaLabel}>Категория</span>
                                                <span className={styles.metaValue}>{order.category?.name || 'Не указано'}</span>
                                            </div>

                                            <div className={styles.metaItem}>
                                                <span className={styles.metaLabel}>Подкатегория</span>
                                                <span className={styles.metaValue}>{order.subcategory?.name || 'Не указано'}</span>
                                            </div>
                                        </div>

                                        {/* ИЗОБРАЖЕНИЯ */}
                                        {hasImages ? (
                                            <div className="image-stack-container">
                                                <div className="image-stack" onClick={() => openModal(order.images)}>
                                                    {order.images.map((image, index) => {
                                                        const imageUrl = `${apiUrl}${image}`;
                                                        return (
                                                            <img
                                                                key={index}
                                                                src={imageUrl}
                                                                alt={`Order pic ${index + 1}`}
                                                                className="order-image"
                                                                style={{ transform: `translateX(${index * 10}px)` }}
                                                            />
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ) : null}

                                        {/* ОПИСАНИЕ (Подробнее/Свернуть) */}
                                        <div className={styles.descBlock}>
                                            <div className={styles.descHead}>
                                                <span className={styles.descTitle}>Описание</span>
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

                                        {/* ИСПОЛНИТЕЛИ */}
                                        <div className={styles.execBlock}>
                                            <div className={styles.execHead}>
                                                <span className={styles.execTitle}>Запросы исполнителей</span>
                                                <span className={styles.execCount}>
                          {hasExecutors ? order.requestedExecutors.length : 0}
                        </span>

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
                                                    <div className="executors-list">
                                                        <ul>
                                                            {order.requestedExecutors.map((executor) => (
                                                                <li key={executor.id} className={styles.executorCard}>
                                                                    <div className={styles.executorInfo}>
                                                                        <p className={styles.executorName}>
                                                                            {executor.username} {executor.id}{" "}
                                                                            <span className={styles.executorMeta}>
                                        (Рейтинг: {executor.rating ? executor.rating.toFixed(1) : "—"} ⭐, Оценок: {executor.ratingCount || 0})
                                      </span>
                                                                        </p>

                                                                        <p className={styles.executorLine}>
                                                                            <strong>Цена:</strong> {executor.proposedSum ? `${executor.proposedSum} ₽` : "—"}
                                                                        </p>

                                                                        {executor.comment && (
                                                                            <p className={styles.executorLine}>
                                                                                <strong>Комментарий:</strong> {executor.comment}
                                                                            </p>
                                                                        )}

                                                                        {executor.isVerified && (
                                                                            <span className={styles.verifiedBadge}>✔ Верифицирован</span>
                                                                        )}
                                                                    </div>

                                                                    <div className={styles.buttonsContainer}>
                                                                        <button
                                                                            onClick={() => navigate(`/complaints/${executor.id}`)}
                                                                            className={styles.complaintButton}
                                                                        >
                                                                            Жалобы
                                                                        </button>

                                                                        <button
                                                                            disabled={approving}
                                                                            onClick={() => approveExecutor(order.id, executor.id)}
                                                                            className={styles.approveButton}
                                                                        >
                                                                            {approving ? "Подтверждаем..." : "Одобрить"}
                                                                        </button>
                                                                    </div>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </div>
                                                ) : (
                                                    <p className={styles.stateText}>Нет запросов на выполнение</p>
                                                )
                                            ) : (
                                                <p className={styles.stateTextMuted}>
                                                    {hasExecutors ? "Список скрыт" : "Пока нет запросов"}
                                                </p>
                                            )}
                                        </div>

                                        {/* МОДАЛКА КАРТИНОК */}
                                        <Modal
                                            appElement={document.getElementById('root')}
                                            isOpen={isImageModalOpen}
                                            onRequestClose={closeModal}
                                            contentLabel="Full Image Modal"
                                            className="custom-modal"
                                            overlayClassName="custom-modal-overlay"
                                        >
                                            <div className="custom-modal-content">
                                                <button onClick={closeModal} className="custom-close-button">✖</button>

                                                <img
                                                    src={`${apiUrl}${currentImages[currentImageIndex]}`}
                                                    alt="Full-size view"
                                                    className="custom-modal-image"
                                                />

                                                <div className="custom-image-navigation">
                                                    <button onClick={prevImage} className="custom-nav-button">◀</button>
                                                    <button onClick={nextImage} className="custom-nav-button">▶</button>
                                                </div>
                                            </div>
                                        </Modal>

                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <p className={styles.noOrders}>Вы пока не размещали заказы.</p>
                )}
            </div>

            <CreateOrderModal
                isOpen={isCreateModalOpen}
                onClose={() => setIsCreateModalOpen(false)}
            />
        </div>
    );
};

export default MyOrdersPage;