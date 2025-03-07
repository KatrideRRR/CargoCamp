import React, {useEffect, useState} from 'react';
import axios from 'axios';
import {useNavigate} from "react-router-dom";
import '../styles/ActiveOrdersPage.css';
import {useAuth} from '../utils/authContext';
import io from 'socket.io-client';
import {useMediaQuery} from 'react-responsive';
import {FaPhone, FaComments, FaRoute, FaExclamationTriangle, FaCheck, FaTrash} from 'react-icons/fa';
import Modal from "react-modal";
import axiosInstance from "../utils/axiosInstance";

const apiUrl = process.env.REACT_APP_API_URL;

const socket = io(process.env.REACT_APP_SOCKET_URL); // Подключение к WebSocket

const ActiveOrdersPage = () => {
    const [orders, setOrders] = useState([]);
    const [error, setError] = useState(null);
    const navigate = useNavigate();
    const {user} = useAuth();
    const [showRatingModal, setShowRatingModal] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [rating, setRating] = useState(0);
    const [showComplaintModal, setShowComplaintModal] = useState(false);
    const [selectedOrderId, setSelectedOrderId] = useState(null);
    const [complaintText, setComplaintText] = useState('');
    const isMobile = useMediaQuery({maxWidth: 768});
    const [isModalOpen, setIsModalOpen] = useState(false);  // Состояние для модального окна
    const [currentImageIndex, setCurrentImageIndex] = useState(0);  // Индекс текущего изображения
    const [currentImages, setCurrentImages] = useState([]);  // Массив изображений для отображения
    const [creatorsInfo, setCreatorsInfo] = useState({}); // Данные о создателях заказов
    const paymentMethods = [
        { id: "cash", label: "Наличные", icon: "💵" },
        { id: "guarantee", label: "Гарантия", icon: "🛡️" },
        { id: "installments", label: "Рассрочка", icon: "💳" },
    ];

    useEffect(() => {
        const token = localStorage.getItem('authToken');
        if (!token) {
            alert('Вы не авторизованы! Пожалуйста, войдите в систему.');
            navigate('/login');
        }


        const fetchActiveOrders = async () => {
            try {
                const response = await axios.get(`${apiUrl}/api/orders/active-orders`, {
                    headers: {Authorization: `Bearer ${token}`},
                });
                // Получаем уникальные ID создателей
                const creatorIds = [...new Set(orders.map(order => order.creatorId))];

                if (creatorIds.length > 0) {
                    const creatorsData = {};
                    const requests = creatorIds.map(id =>
                        axiosInstance.get(`/auth/${id}`)
                            .then(res => ({ id, data: res.data }))
                            .catch(err => {
                                console.error(`Ошибка загрузки данных пользователя ${id}`, err);
                                return null;
                            })
                    );

                    const results = await Promise.allSettled(requests);

                    results.forEach(result => {
                        if (result.status === 'fulfilled' && result.value) {
                            creatorsData[result.value.id] = result.value.data;
                        }
                    });

                    setCreatorsInfo(creatorsData);
                }

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

    }, [navigate, orders]);

    if (!user) {
        return <p>Загрузка...</p>;
    }

    // Функция для получения иконки по способу оплаты
    const getPaymentIcon = (paymentType) => {
        const method = paymentMethods.find(method => method.id === paymentType);
        return method ? method.icon : "";
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
                headers: {Authorization: `Bearer ${token}`},
            });

            // 2. Завершаем заказ
            await axios.post(`${apiUrl}/api/orders/complete/${selectedOrder.id}`,
                {}, // Тело запроса пустое
                {headers: {Authorization: `Bearer ${token}`}}
            );

            // 3. Обновляем состояние заказов в интерфейсе
            setOrders((prevOrders) =>
                prevOrders.map((order) =>
                    order.id === selectedOrder.id ? {...order, completed: true} : order
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

    const getUserPhone = async (userId) => {
        const token = localStorage.getItem('authToken');
        return axios.get(`${apiUrl}/api/auth/user/${userId}`, {
            headers: {Authorization: `Bearer ${token}`},
        })
            .then(response => {
                console.log(response);
                return response.data.phone;
            })
            .catch(error => {
                console.error('Ошибка при получении телефона:', error);
            });
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
            await axios.post(`${apiUrl}/api/orders/complain`, {
                orderId: selectedOrderId,
                complaintText,
            }, {
                headers: {Authorization: `Bearer ${token}`}, // Убедитесь, что токен передается в заголовке
            });
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
                            const isCompletedByUser = Array.isArray(order.completedBy) && order.completedBy.includes(user.id);
                            const isWaitingForOther = Array.isArray(order.completedBy) && order.completedBy.length === 1;
                            const isExecutor = order.executorId === user.id;
                            const isCreator = order.creatorId === user.id;
                            const creator = creatorsInfo[order.creatorId] || {};

                            return (
                                <li
                                    key={order.id}
                                    className={`order-card ${isCreator ? 'creator' : ''} ${isExecutor ? 'executor' : ''}`}
                                >
                                    <div className="order-header">
                                        <p className="order-title">
                                            <strong>Заказ номер {order.id}</strong>
                                            {isCreator ? '. Вы являетесь заказчиком' : ` от заказчика с ID ${order.creatorId}`}.
                                            Создан {new Date(order.createdAt).toLocaleString()}
                                        </p>

                                        <p><strong>Имя создателя:</strong> {creator.username || "Неизвестно"}
                                        </p>
                                        <p><strong>Рейтинг
                                            создателя:</strong> {creator.rating ? creator.rating.toFixed(1) : "Нет данных"}
                                        </p>

                                        <p>
                                            {isExecutor ? (
                                                <strong>Вы являетесь исполнителем</strong>
                                            ) : (
                                                <>
                                                    <strong>ID Исполнителя:</strong> {order.executorId}
                                                </>
                                            )}
                                        </p>

                                        {/* Иконка способа оплаты ниже заголовка */}
                                        <div className="payment-icon-container">
                                                <span
                                                    className="payment-icon">{getPaymentIcon(order.paymentType)}</span>
                                            <span
                                                className="payment-label">{paymentMethods.find(method => method.id === order.paymentType)?.label}</span>
                                        </div>
                                    </div>
                                    <p><strong>Название:</strong> {order.type}</p>
                                    <p>
                                        <strong>Категория:</strong> {order.category ? order.category.name : 'Не указано'}
                                    </p>
                                    <p>
                                    <strong>Подкатегория:</strong> {order.subcategory ? order.subcategory.name : 'Не указано'}
                                    </p>
                                    <p><strong>Адрес:</strong> {order.address}</p>
                                    <p><strong>Цена:</strong> {order.proposedSum} ₽</p>
                                    {Array.isArray(order.images) && order.images.length > 0 ? (
                                        order.images.map((image, index) => {
                                            const imageUrl = `${apiUrl}${image}`;
                                            return (
                                                <img
                                                    key={index}
                                                    src={imageUrl}
                                                    alt={`Order pic ${index + 1}`}
                                                    className="order-image"
                                                    onClick={() => openModal(order.images)} // Открываем модальное окно при клике
                                                />
                                            );
                                        })
                                    ) : (
                                        '')}
                                    <p><strong>Описание:</strong> {order.description}</p>

                                    <div className="action-buttons">
                                        <button
                                            className="call-button"
                                            onClick={async () => {
                                                const phone = isCreator ? await getUserPhone(order.executorId) : await getUserPhone(order.creatorId);
                                                window.open(`tel:${phone}`);
                                            }}
                                        >
                                            {isMobile ? <FaPhone /> : "Позвонить"}
                                        </button>
                                        <button className="message-button" onClick={() => navigate(`/messages/${order.id}`)}>
                                            {isMobile ? <FaComments /> : "Сообщение"}
                                        </button>
                                        <button className="route-button">
                                            {isMobile ? <FaRoute /> : "Маршрут"}
                                        </button>
                                        <button className="complain-button" onClick={() => handleComplaint(order.id)}>
                                            {isMobile ? <FaExclamationTriangle /> : "Пожаловаться"}
                                        </button>

                                        {isCompletedByUser ? (
                                            isWaitingForOther ? (
                                                <button
                                                    className="remove-button"
                                                    onClick={() => handleRemoveOrder(order.id)}
                                                >
                                                    {isMobile ? <FaTrash /> : "Удалить"}
                                                </button>
                                            ) : null
                                        ) : (
                                            <button
                                                className="complete-button"
                                                onClick={() => handleCompleteOrder(order.id)}
                                            >
                                                {isMobile ? <FaCheck /> : "Завершить"}
                                            </button>
                                        )}
                                    </div>
                                </li>
                            );

                        })}
                    </ul>
                ) : (
                    <p className="no-orders">Нет активных заказов.</p>
                )}
            </div>

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

            {/* Модальное окно для оценки */}
            {showRatingModal && (
                <div className="modal-overlay" onClick={() => setShowRatingModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Оцените участника</h2>
                        <div className="stars">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <span key={star} className={star <= rating ? "star selected" : "star"}
                                      onClick={() => setRating(star)}>★</span>
                            ))}
                        </div>
                        <button onClick={submitRating} disabled={rating === 0}>Завершить заказ</button>
                    </div>
                </div>
            )}

            {/* Модальное окно для жалобы */}
            {showComplaintModal && (
                <div className="modal-overlay" onClick={() => setShowComplaintModal(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Напишите жалобу:</h2>
                        <textarea value={complaintText} onChange={(e) => setComplaintText(e.target.value)}
                                  rows="5" placeholder="Введите текст жалобы" />
                        <button onClick={handleSubmitComplaint}>Отправить</button>
                    </div>
                </div>
            )}

        </div>
    );
};

export default ActiveOrdersPage;