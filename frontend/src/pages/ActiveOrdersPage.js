import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { useNavigate } from "react-router-dom";
import '../styles/ActiveOrdersPage.css';
import { useAuth } from '../utils/authContext';
import io from 'socket.io-client';
import { useMediaQuery } from 'react-responsive';
import { FaPhone, FaComments, FaRoute, FaExclamationTriangle, FaCheck, FaTrash } from 'react-icons/fa';
const apiUrl = process.env.REACT_APP_API_URL;

const socket = io(process.env.REACT_APP_SOCKET_URL); // Подключение к WebSocket

const ActiveOrdersPage = () => {
    const [orders, setOrders] = useState([]);
    const [error, setError] = useState(null);
    const navigate = useNavigate();
    const { user } = useAuth();
    const [showRatingModal, setShowRatingModal] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [rating, setRating] = useState(0);
    const [showComplaintModal, setShowComplaintModal] = useState(false);
    const [selectedOrderId, setSelectedOrderId] = useState(null);
    const [complaintText, setComplaintText] = useState('');
    const isMobile = useMediaQuery({ maxWidth: 768 });

    useEffect(() => {
        const token = localStorage.getItem('authToken');
        if (!token) {
            alert('Вы не авторизованы! Пожалуйста, войдите в систему.');
            navigate('/login');
        }

        const fetchActiveOrders = async () => {
            try {
                const response = await axios.get(`${apiUrl}/api/orders/active-orders`, {
                    headers: { Authorization: `Bearer ${token}` },
                });
                setOrders(response.data);
            } catch (err) {
                console.error('Ошибка при загрузке активных заказов:', err);
                setError('Не удалось загрузить заказы.');
            }
        };

        fetchActiveOrders();

        // Подписываемся на обновления активных заказов
        socket.on('activeOrdersUpdated', fetchActiveOrders);

        return () => {
            socket.off('activeOrdersUpdated', fetchActiveOrders); // Очистка слушателя
        };

    }, [navigate]);

    if (!user) {
        return <p>Загрузка...</p>;
    }

    const handleCompleteOrder = async (orderId) => {
        // Показываем модальное окно для оценки
        const orderToComplete = orders.find(order => order.id === orderId);
        setSelectedOrder(orderToComplete); // Устанавливаем выбранный заказ
        setShowRatingModal(true); // Показываем модальное окно для оценки
    };

    const submitRating = async () => {
        if (!selectedOrder || rating === 0) return;

        try {
            const token = localStorage.getItem('authToken');

            // 1. Отправляем оценку на сервер
            await axios.post(`${apiUrl}/api/auth/rate`, {
                userId: selectedOrder.executorId === user.id
                    ? selectedOrder.creatorId
                    : selectedOrder.executorId,
                rating,
            }, {
                headers: { Authorization: `Bearer ${token}` },
            });

            // 2. Завершаем заказ
            await axios.post(`${apiUrl}/api/orders/complete/${selectedOrder.id}`,
                {}, // Тело запроса пустое
                { headers: { Authorization: `Bearer ${token}` } }
            );

            // 3. Обновляем состояние заказов в интерфейсе
            setOrders((prevOrders) =>
                prevOrders.map((order) =>
                    order.id === selectedOrder.id ? { ...order, completed: true } : order
                )
            );

            // 4. Закрываем модальное окно и сбрасываем состояния
            setShowRatingModal(false);
            setSelectedOrder(null);
            setRating(0);

        } catch (error) {
            console.error("Ошибка при завершении заказа или отправке рейтинга", error);
        }
    };

    const handleComplaint = (orderId) => {
        setSelectedOrderId(orderId);
        setShowComplaintModal(true);
    };

// Модальное окно для жалобы
    const handleSubmitComplaint = async () => {
        if (!complaintText) return;

        const token = localStorage.getItem('authToken');
        if (!token) {
            alert('Вы не авторизованы!');
            return;
        }

        try {
            const response = await axios.post(`${apiUrl}/api/orders/complain`, {
                orderId: selectedOrderId,
                complaintText,
            }, {
                headers: { Authorization: `Bearer ${token}` }, // Убедитесь, что токен передается в заголовке
            });
            console.log(response);
            alert('Жалоба отправлена');
            setShowComplaintModal(false);
            setComplaintText('');
        } catch (error) {
            console.error('Ошибка при отправке жалобы:', error);
        }

    };


    const handleRemoveOrder = (orderId) => {
        setOrders((prevOrders) => prevOrders.filter((order) => order.id !== orderId));
    };

    // Проверка на наличие пользователя перед рендерингом
    if (!user || !user.id) {
        return <p>Загрузка...</p>;
    }

    if (error) {
        return <div className="error-message">{error}</div>;
    }

    return (
        <div className="orders-container">
            <div className="orders-wrapper">
                {orders.length > 0 ? (
                    <ul className="orders-list">
                        {orders.map((order) => {
                            const isCreator = order.creatorId === user.id;
                            const isExecutor = order.executorId === user.id;
                            const isCompletedByUser = Array.isArray(order.completedBy) && order.completedBy.includes(user.id);
                            const isWaitingForOther = Array.isArray(order.completedBy) && order.completedBy.length === 1;

                            return (
                                <li key={order.id} className="order-card">
                                    <div className="order-header">
                                        <p className="order-title">
                                            <strong>Заказ номер {order.id}</strong> от заказчика с
                                            ID {order.creatorId}.
                                            Создан {new Date(order.createdAt).toLocaleString()}
                                        </p>
                                    </div>
                                    <p><strong>Название:</strong> {order.type}</p>
                                    <p>
                                        <strong>Категория:</strong> {order.category ? order.category.name : 'Не указано'}
                                    </p>
                                    <p>
                                        <strong>Подкатегория:</strong> {order.subcategory ? order.subcategory.name : 'Не указано'}
                                    </p>
                                    <p><strong>Описание:</strong> {order.description}</p>
                                    <p><strong>Адрес:</strong> {order.address}</p>
                                    <p><strong>Цена:</strong> {order.proposedSum} ₽</p>
                                    {order.photoUrl && (
                                        <img src={`${apiUrl}${order.photoUrl}`} alt="Фото заказа"
                                             className="order-photo"/>)}

                                    <div className="action-buttons">

                                        <button className="call-button"
                                                onClick={() => window.open(`tel:${order.phone}`)}>
                                            {isMobile ? <FaPhone /> : "Позвонить"}
                                        </button>
                                        <button className="message-button"
                                                onClick={() => navigate(`/messages/${order.id}`)}>
                                            {isMobile ? <FaComments /> : "Сообщение"}
                                        </button>
                                        <button className="route-button">
                                            {isMobile ? <FaRoute /> : "Маршрут"}
                                        </button>
                                        <button className="complain-button"
                                                onClick={() => handleComplaint(order.id)}>
                                            {isMobile ? <FaExclamationTriangle /> : "Пожаловаться"}
                                        </button>


                                        {isCompletedByUser ? (
                                            isWaitingForOther ? (
                                                <>
                                                    <button className="remove-button"
                                                            onClick={() => handleRemoveOrder(order.id)}>
                                                        {isMobile ? <FaTrash /> : "Удалить"}
                                                    </button>
                                                </>
                                            ) : null
                                        ) : (
                                            <button className="complete-button"
                                                    onClick={() => handleCompleteOrder(order.id)}>
                                                {isMobile ? <FaCheck /> : "Завершить"}
                                            </button>
                                        )}



                                    </div>
                                    {showRatingModal && selectedOrder?.id === order.id && (
                                        <div className="modal">
                                            <h2>Оцените участника</h2>
                                            <div className="stars">
                                                {[1, 2, 3, 4, 5].map((star) => (
                                                    <span
                                                        key={star}
                                                        className={star <= rating ? "star selected" : "star"}
                                                        onClick={() => setRating(star)}
                                                    >
                    ★
                </span>
                                                ))}
                                            </div>
                                            <button onClick={submitRating} disabled={rating === 0}>
                                                Завершить заказ
                                            </button>
                                        </div>
                                    )}
                                    {/* Модальное окно для жалобы */}
                                    {showComplaintModal && selectedOrderId === order.id && (
                                        <div className="modal">
                                            <h2>Напишите свою жалобу:</h2>
                                            <textarea
                                                value={complaintText}
                                                onChange={(e) => setComplaintText(e.target.value)}
                                                rows="5"
                                                placeholder="Введите текст жалобы"
                                            />
                                            <button onClick={handleSubmitComplaint}>Отправить жалобу</button>
                                            <button onClick={() => setShowComplaintModal(false)}>Закрыть
                                            </button>
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <p className="no-orders">Нет активных заказов.</p>
                )}
            </div>
        </div>
    );
};

export default ActiveOrdersPage;