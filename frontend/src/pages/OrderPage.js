import React, { useEffect, useState } from 'react';
import {useParams, Link, useNavigate} from 'react-router-dom';
import axiosInstance from '../utils/axiosInstance';
import '../styles/OrdersPage.css';
import io from 'socket.io-client';
import Modal from "react-modal";

const apiUrl = process.env.REACT_APP_API_URL;
const socket = io(process.env.REACT_APP_SOCKET_URL, {
    transports: ['websocket'],
    withCredentials: true
});

const OrderPage = () => {
    const navigate = useNavigate();
    const { id } = useParams();
    const [order, setOrder] = useState(null);
    const [creator, setCreator] = useState(null);
    const [error, setError] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);  // Состояние для модального окна
    const [currentImageIndex, setCurrentImageIndex] = useState(0);  // Индекс текущего изображения
    const [currentImages, setCurrentImages] = useState([]);  // Массив изображений для отображения
    const paymentMethods = [
        { id: "cash", label: "Наличные", icon: "💵" },
        { id: "guarantee", label: "Гарантия", icon: "🛡️" },
        { id: "installments", label: "Рассрочка", icon: "💳" },
    ];

    useEffect(() => {
        const fetchOrder = async () => {
            try {
                const response = await axiosInstance.get(`/orders/${id}`);
                setOrder(response.data);
                console.log(response);

                // Загружаем данные о создателе заказа
                const userResponse = await axiosInstance.get(`/auth/${response.data.creatorId}`);
                setCreator(userResponse.data);
            } catch (err) {
                setError(err.response?.data?.message || 'Ошибка загрузки заказа');
            }
        };
        const fetchUserData = async () => {
            try {
                const response = await axiosInstance.get('/auth/profile');
                console.log("👤 Данные пользователя:", response.data);
                setUserId(response.data.id);
                socket.emit('register', response.data.id);
            } catch (err) {
                console.error("❌ Ошибка получения профиля:", err);
            }
        };

        fetchOrder();
        fetchUserData();

        if (userId) {
            console.log("🔄 Подключаем WebSocket для пользователя:", userId);

            socket.on('orderRequested', (data) => {
                console.log("🔔 Получен запрос на заказ:", data);
            });
            socket.on('orderUpdated', fetchOrder);

            return () => {
                socket.off('orderRequested');
                socket.off('orderUpdated');
            };
        }
    }, [userId, id]);

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

    const handleRequestOrder = async (orderId) => {
        const token = localStorage.getItem('authToken');
        if (!token) {
            alert('Вы не авторизованы! Пожалуйста, войдите в систему.');
            navigate('/login');
        }
        try {
            await axiosInstance.post(`/orders/${orderId}/request`);
            alert("Запрос отправлен заказчику!");
        } catch (error) {
            console.error("Ошибка при запросе на выполнение заказа:", error);
        }
    };

    // Функция для получения иконки по способу оплаты
    const getPaymentIcon = (paymentType) => {
        const method = paymentMethods.find(method => method.id === paymentType);
        return method ? method.icon : "";
    };

    if (error) {
        return <div className="error-message">Ошибка: {error}</div>;
    }

    if (!order || !creator) {
        return <div className="loading">Загрузка...</div>;
    }
    const isCreator = order.creatorId === userId;

    return (
        <div className="orders-page">

            <div className="orders-container">
                <div className="orders-wrapper">
                    <ul className="orders-list">
                        <li
                            key={order.id}
                            className={`order-card ${isCreator ? 'creator' : ''} `}
                        >
                            <div className="order-content">
                                <div className="order-header">
                                    <div className="order-info">
                                        <p className="order-title">
                                            <strong>Заказ №{order.id}</strong> от {creator.username || "Неизвестно"}.
                                            Создан {new Date(order.createdAt).toLocaleString()}.
                                        </p>

                                        <p><strong>ID заказчика:</strong> {order.creatorId || "Неизвестно"}</p>
                                        <p><strong>Имя заказчика:</strong> {creator.username || "Неизвестно"}</p>
                                        <p>
                                            <strong>Рейтинг
                                                заказчика:</strong> {creator.rating ? creator.rating.toFixed(1) : "Нет данных"}
                                        </p>
                                        {/* Иконка способа оплаты */}
                                        <div className="payment-info">
                                            <span className="payment-icon">{getPaymentIcon(order.paymentType)}</span>
                                            <span className="payment-label">
                {paymentMethods.find(method => method.id === order.paymentType)?.label}
            </span>
                                        </div>
                                        {/* Кнопка для перехода на страницу жалоб */}
                                        {creator.username && (
                                            <Link to={`/complaints/${order.creatorId}`} className="complaints-button">
                                                Жалобы на создателя: {creator.complaintsCount || 0}
                                            </Link>
                                        )}


                                    </div>
                                </div>


                                <div className="order-left">
                                    <p><strong>Тип заказа:</strong> {order.type}</p>
                                    <p>
                                        <strong>Категория:</strong> {order.category ? order.category.name : 'Не указано'}
                                    </p>
                                    <p>
                                        <strong>Подкатегория:</strong> {order.subcategory ? order.subcategory.name : 'Не указано'}
                                    </p>
                                    <p><strong>Адрес:</strong> {order.address}</p>
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
                            </div>


                            {userId !== order.creatorId && !order.executorId && order.status === 'pending' && (
                                <button className="take-order-button"
                                        onClick={() => handleRequestOrder(order.id)}>Запросить выполнение</button>
                            )}
                        </li>
                    </ul>
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
            </div>
            );
        </div>
    )
};

            export default OrderPage;
