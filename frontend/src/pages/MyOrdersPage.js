import React, {useState, useEffect, useContext} from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import axiosInstance from '../utils/axiosInstance';
import io from 'socket.io-client';
import styles from '../styles/MyOrdersPage.module.css';
import {AuthContext} from "../utils/authContext";
const apiUrl = process.env.REACT_APP_API_URL;

const socket = io(process.env.REACT_APP_SOCKET_URL);

const MyOrdersPage = () => {
    const { userId } = useParams();
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const { hasNewRequests, setHasNewRequests } = useContext(AuthContext);
    const navigate = useNavigate();

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

    return (
        <div className={styles.container}>
            <div className={styles.ordersWrapper}>
                <Link
                    to="/create-order"
                    className={`${styles.createButton} ${hasNewRequests ? styles.newRequest : ''}`}
                >
                    Разместить заказ
                </Link>

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
                                            <strong>Заказ №{order.id}</strong> .
                                            Создан {new Date(order.createdAt).toLocaleString()}
                                        </p>
                                    </div>

                                    <div className={styles.orderLeft}>
                                        <p><strong>Название заказа:</strong> {order.type}</p>
                                        <p><strong>Категория:</strong> {order.category?.name || 'Не указано'}</p>
                                        <p><strong>Подкатегория:</strong> {order.subcategory?.name || 'Не указано'}</p>
                                        <p><strong>Описание:</strong> {order.description}</p>
                                        <p><strong>Цена:</strong> {order.proposedSum} ₽</p>
                                    </div>

                                    {Array.isArray(order.images) && order.images.length > 0 ? (
                                        order.images.map((image, index) => (
                                            <img key={index} src={`${apiUrl}${image}`} alt={`Order Image ${index + 1}`} className={styles.orderImage} />
                                        ))
                                    ) : (
                                        <p>Изображений нет</p>
                                    )}

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
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className={styles.noOrders}>Нет доступных заказов.</p>
                )}
            </div>
        </div>
    );
};

export default MyOrdersPage;
