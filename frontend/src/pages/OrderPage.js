import React, { useEffect, useState } from 'react';
import {useParams, Link, useNavigate} from 'react-router-dom';
import axiosInstance from '../utils/axiosInstance';
import '../styles/OrdersPage.css';
import io from 'socket.io-client';
import Modal from "react-modal";
import {FaCreditCard, FaMoneyBillWave, FaQuestionCircle, FaUniversity} from "react-icons/fa";
import {FiAlertTriangle} from "react-icons/fi";

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

    if (error) {
        return <div className="error-message">Ошибка: {error}</div>;
    }

    if (!order || !creator) {
        return <div className="loading">Загрузка...</div>;
    }
    const isCreator = order.creatorId === userId;

    return (
        <div className="all-orders">

            <div className="pageContainer">

                <div className="all-orders-page">
                    <div className="orders-wrapper">
                        <ul className="orders-list">
                            <li
                                key={order.id}
                                className={`floatingCard ${isCreator ? 'creator' : ''} ${order.is_highlighted ? 'highlighted-order' : ''}`}
                            >

                                <div className="order-content">
                                    <div className="order-header">
                                        <div className="order-info">
                                            <p className="order-title">
                                                <strong>Заказ
                                                    №{order.id}</strong> от {creator.username || "Неизвестно"}.
                                                Создан {new Date(order.createdAt).toLocaleString()}.
                                                <div className="order-meta">
                                                    <div className="order-payment-icon-container">
                                                        <span className="payment-icon">{getPaymentIcon(order.paymentType)}</span>
                                                        <span className="payment-label">{getPaymentLabel(order.paymentType)}</span>                                                    </div>

                                                    <div className="price-badge">
                                                        {order.proposedSum} ₽
                                                    </div>
                                                </div>
                                            </p>

                                            <p><strong>ID
                                                заказчика:</strong> {order.creatorId || "Неизвестно"}
                                            </p>
                                            <p><strong>Имя
                                                заказчика:</strong> {creator.username || "Неизвестно"}
                                            </p>
                                            <p>
                                                <strong>Рейтинг
                                                    заказчика:</strong> {creator.rating ? creator.rating.toFixed(1) : "Нет данных"}
                                                <Link
                                                    to={`/complaints/${order.creatorId}`}
                                                    className="inline-flex items-center mt-2 px-3 py-1 text-sm font-medium text-red-600 bg-red-100 rounded-md hover:bg-red-200 focus:outline-none focus:ring-2 focus:ring-red-500"
                                                    aria-label={`Жалобы (${creator.complaintsCount || 0})`}
                                                >
                                                    <FiAlertTriangle className="mr-2 h-5 w-5"/>
                                                    {creator.complaintsCount || 0}
                                                </Link>

                                            </p>

                                        </div>
                                    </div>

                                    <div className="order-left">
                                        <p>
                                            <strong>Категория:</strong> {order.category ? order.category.name : 'Не указано'}
                                        </p>
                                        <p>
                                            <strong>Подкатегория:</strong> {order.subcategory ? order.subcategory.name : 'Не указано'}
                                        </p>
                                        <p>
                                            <strong>Услуга:</strong> {order.service ? order.service.name : 'Не указано'}
                                        </p>

                                    </div>


                                    {Array.isArray(order.images) && order.images.length > 0 ? (
                                        <div className="image-stack-container">
                                            <div className="image-stack"
                                                 onClick={() => openModal(order.images)}>
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

                                    <p><strong>Адрес:</strong> {order.address}</p>
                                    <p><strong>Цена:</strong> {order.proposedSum} ₽</p>
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

            </div>
        </div>

    )
};

export default OrderPage;
