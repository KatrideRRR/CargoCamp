import CreateOrderModal from '../components/CreateOrderModal';
import React, {useState, useEffect, useContext} from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axiosInstance from '../utils/axiosInstance';
import io from 'socket.io-client';
import styles from '../styles/MyOrdersPage.module.css';
import {AuthContext} from "../utils/authContext";
import Modal from "react-modal";
import {FaCreditCard, FaMoneyBillWave, FaQuestionCircle, FaUniversity} from "react-icons/fa";
const apiUrl = process.env.REACT_APP_API_URL;

const socket = io(process.env.REACT_APP_SOCKET_URL);

const MyOrdersPage = () => {
    const { userId } = useParams();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const { hasNewRequests, setHasNewRequests } = useContext(AuthContext);
    const navigate = useNavigate();
    const [isModalOpen, setIsModalOpen] = useState(false);  // Состояние для модального окна
    const [currentImageIndex, setCurrentImageIndex] = useState(0);  // Индекс текущего изображения
    const [currentImages, setCurrentImages] = useState([]);  // Массив изображений для отображения
    const paymentMethods = [
        { id: "cash", label: "Наличные", icon: "💵" },
        { id: "guarantee", label: "Гарантия", icon: "🛡️" },
        { id: "installments", label: "Рассрочка", icon: "💳" },
    ];

    useEffect(() => {
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
                            return { ...order, requestedExecutors: Array.isArray(executorsResponse.data) ? executorsResponse.data : [] };
                        } catch (error) {
                            console.error(`Ошибка загрузки исполнителей для заказа ${order.id}:`, error);
                            return { ...order, requestedExecutors: [] };
                        }
                    })
                );

                setOrders(ordersWithExecutors);

            } catch (err) {
                if (err.response && err.response.status === 404) {
                    setOrders([]); // Просто ставим пустой массив, чтобы не было ошибки
                } else {
                    console.error('Ошибка при загрузке заказов:', err);
                    setError('Ошибка загрузки данных');
                }
            } finally {
                setLoading(false);
            }
        };



        const checkAuthUser = async () => {
            try {
                const token = localStorage.getItem('authToken');
                const profileResponse = await axiosInstance.get('/auth/profile', {
                    headers: { Authorization: `Bearer ${token}` }
                });

                if (profileResponse.data.id !== Number(userId)) {
                    navigate('/');
                } else {
                    fetchOrders();
                }

                // Подписка на событие получения запроса от исполнителя
                socket.on(`orderRequest-${userId}`, (data) => {
                    setHasNewRequests(true); // Подсвечиваем кнопку
                    fetchOrders(); // Обновляем список заказов
                });

            } catch (err) {
                console.error('Ошибка проверки пользователя:', err);
                navigate('/login');
            }
        };

        checkAuthUser();

        const handleOrderRequest = () => {
            console.log('🔔 Получен запрос на заказ, обновляем список');
            fetchOrders();
        };

        socket.on('orderRequest', handleOrderRequest);
        socket.on('orderUpdated', fetchOrders);

        return () => {
            socket.off('orderRequest', handleOrderRequest);
            socket.off('orderUpdated', fetchOrders);
        };
    }, [userId, navigate, setHasNewRequests]);

    const approveExecutor = async (orderId, executorId) => {
        try {
            await axiosInstance.post(`/orders/${orderId}/approve`, { executorId });
            alert('Исполнитель одобрен!');
            setOrders((prevOrders) =>
                prevOrders.map((order) =>
                    order.id === orderId
                        ? { ...order, requestedExecutors: order.requestedExecutors.filter((e) => e.id !== executorId) }
                        : order
                )
            );

        } catch (error) {
            console.error('Ошибка при одобрении исполнителя:', error);
            alert('Не удалось одобрить исполнителя');
        }
    };

    const getPaymentIcon = (type) => {
        switch (type) {
            case 'guarantee':
                return <FaUniversity title="Tinkoff" />;
            case 'cash':
                return <FaMoneyBillWave title="Наличные" />;
            case 'installments':
                return <FaCreditCard title="Карта" />;
            default:
                return <FaQuestionCircle title="Неизвестно" />;
        }
    };

    const openModal = (images) => {
        setCurrentImages(images);
        setCurrentImageIndex(0);  // Начать с первого изображения
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setCurrentImageIndex(0);  // Сброс индекса при закрытии
        setCurrentImages([]);
    };

    const nextImage = () => {
        setCurrentImageIndex((prevIndex) => (prevIndex + 1) % currentImages.length);  // Переход к следующему изображению
    };

    const prevImage = () => {
        setCurrentImageIndex((prevIndex) => (prevIndex - 1 + currentImages.length) % currentImages.length);  // Переход к предыдущему изображению
    };

    return (
        <div className={styles.container}>
            <div className={styles.ordersWrapper}>
                <button
                    onClick={() => setIsModalOpen(true)}
                    className={`${styles.createButton} ${hasNewRequests ? styles.newRequest : ''}`}
                >
                    Разместить заказ
                </button>


                {loading ? (
                    <p>Загрузка заказов...</p>
                ) : error ? (
                    <p className={styles.errorMessage}>{error}</p>
                ) : orders.length > 0 ? (
                    <ul className={styles.ordersList}>
                        {orders.map((order) => (
                            <li className={styles.orderCard} key={order.id}>
                                <div className={styles.orderContent}>
                                    <div className={styles.orderHeader}>
                                        <p className={styles.orderTitle}>
                                            <strong>Заказ №{order.id}</strong>.
                                            Создан {new Date(order.createdAt).toLocaleString()}
                                        </p>
                                        <div className={styles.paymentInfo}>
                                            <span className="payment-icon">{getPaymentIcon(order.paymentType)}</span>
                                            <span className="payment-label">
            {paymentMethods.find(method => method.id === order.paymentType)?.label}
        </span>
                                        </div>
                                    </div>


                                    <div className={styles.orderLeft}>
                                        <p><strong>Название заказа:</strong> {order.type}</p>
                                        <p><strong>Категория:</strong> {order.category?.name || 'Не указано'}</p>
                                        <p><strong>Подкатегория:</strong> {order.subcategory?.name || 'Не указано'}</p>
                                        <p><strong>Цена:</strong> {order.proposedSum} ₽</p>

                                    </div>

                                    {Array.isArray(order.images) && order.images.length > 0 ? (
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
                                                            style={{transform: `translateX(${index * 10}px)`}} // Смещение только вправо
                                                        />
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ) : null}

                                    <p><strong>Описание:</strong> {order.description}</p>

                                    {Array.isArray(order.requestedExecutors) && order.requestedExecutors.length > 0 ? (
                                        <div className="executors-list">
                                            <strong>Исполнители, запросившие заказ:</strong>
                                            <ul>
                                                {order.requestedExecutors.map((executor) => (
                                                    <li key={executor.id} className={styles.executorCard}>
                                                        <div className={styles.executorInfo}>
                                                            <p className={styles.executorName}>
                                                                {executor.username} {executor.id} (Рейтинг: {executor.rating ? executor.rating.toFixed(1) : "—"} ⭐,
                                                                Оценок: {executor.ratingCount || 0})
                                                            </p>
                                                            <p>Цена: {executor.proposedSum ? `${executor.proposedSum} ₽` : "—"}</p>
                                                            {executor.comment && <p>Комментарий: {executor.comment}</p>}

                                                            {executor.isVerified && (
                                                                <span
                                                                    className={styles.verifiedBadge}>✔ Верифицирован</span>
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
                                                                onClick={() => approveExecutor(order.id, executor.id)}
                                                                className={styles.approveButton}
                                                            >
                                                                Одобрить
                                                            </button>
                                                        </div>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    ) : (
                                        <p>Нет запросов на выполнение</p>
                                    )}

                                    <Modal
                                        appElement={document.getElementById('root')}
                                        isOpen={isModalOpen}
                                        onRequestClose={closeModal}
                                        contentLabel="Full Image Modal"
                                        className="custom-modal"
                                        overlayClassName="custom-modal-overlay"
                                    >
                                        <div className="custom-modal-content">
                                            {/* Кнопка закрытия */}
                                            <button onClick={closeModal} className="custom-close-button">✖</button>

                                            {/* Изображение */}
                                            <img
                                                src={`${apiUrl}${currentImages[currentImageIndex]}`}
                                                alt="Full-size view"
                                                className="custom-modal-image"
                                            />

                                            {/* Кнопки переключения */}
                                            <div className="custom-image-navigation">
                                                <button onClick={prevImage} className="custom-nav-button">◀</button>
                                                <button onClick={nextImage} className="custom-nav-button">▶</button>
                                            </div>
                                        </div>
                                    </Modal>
                                </div>

                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className={styles.noOrders}>Вы пока не размещали заказы.</p>
                )}
            </div>
            <CreateOrderModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
            />

        </div>
    );
};

export default MyOrdersPage;
