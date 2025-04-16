import React, { useEffect, useState } from 'react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import axiosInstance from '../utils/axiosInstance';
import '../styles/OrdersPage.css';
import io from 'socket.io-client';
import Modal from 'react-modal';
import {FaCreditCard, FaMoneyBillWave, FaQuestionCircle, FaUniversity} from "react-icons/fa";

const apiUrl = process.env.REACT_APP_API_URL;
const socket = io(process.env.REACT_APP_SOCKET_URL, {
    transports: ['websocket'],
    withCredentials: true
});

const UserOrdersPage = () => {
    const navigate = useNavigate();
    const { userId: paramUserId } = useParams(); // Получаем ID пользователя из URL
    const [orders, setOrders] = useState([]);
    const [error, setError] = useState(null);
    const [creatorsInfo, setCreatorsInfo] = useState({}); // Данные о создателях заказов
    const [userId, setUserId] = useState(null); // Правильно задаем состояние
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentImages, setCurrentImages] = useState([]);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const paymentMethods = [
        { id: "cash", label: "Наличные", icon: "💵" },
        { id: "guarantee", label: "Гарантия", icon: "🛡️" },
        { id: "installments", label: "Рассрочка", icon: "💳" },
    ];

    useEffect(() => {
        const fetchUserOrders = async () => {
            try {
                const response = await axiosInstance.get(`/orders/creator/${paramUserId}`);
                setOrders(response.data);
                const creatorIds = [...new Set(response.data.map(order => order.creatorId))]; // Уникальные ID создателей
                const creatorsData = {};

                for (const id of creatorIds) {
                    try {
                        const res = await axiosInstance.get(`/auth/${id}`);
                        creatorsData[id] = res.data; // Сохраняем данные
                    } catch (err) {
                        console.error(`Ошибка загрузки данных пользователя ${id}`, err);
                    }
                }

                setCreatorsInfo(creatorsData);
            } catch (err) {
                setError(err.response?.data?.message || 'Ошибка загрузки заказов');
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

        fetchUserOrders();
        fetchUserData();

        if (userId) {
            console.log("🔄 Подключаем WebSocket для пользователя:", paramUserId);

            socket.on('orderRequested', (data) => {
                console.log("🔔 Получен запрос на заказ:", data);
            });
            socket.on('orderUpdated', fetchUserOrders);

            return () => {
                socket.off('orderRequested');
                socket.off('orderUpdated');
            };
        }
    }, [userId, paramUserId]);

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

    if (error) {
        return <div className="error-message">Ошибка: {error}</div>;
    }

    if (!orders.length) {
        return <div className="loading-message">Загрузка...</div>;
    }

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

    return (
        <div className="orders-container">
            <div className="orders-wrapper">
                {orders.length > 0 ? (
                    <ul className="orders-list">
                        {orders.map((order) => {
                            const creator = creatorsInfo[order.creatorId] || {};

                            return (
                                <li className="user-order-card" key={order.id}>
                                    <div className="order-content">
                                        <div className="order-header">
                                            <p className="order-title">
                                                <strong>Заказ номер {order.id}</strong> от заказчика с
                                                ID {order.creatorId}.
                                                Создан {new Date(order.createdAt).toLocaleString()}
                                                <p><strong>ID заказчика:</strong> {order.creatorId || "Неизвестно"} </p>
                                                <p><strong>Имя заказчика:</strong> {creator.username || "Неизвестно"}
                                                </p>
                                                <p><strong>Рейтинг
                                                    заказчика:</strong> {creator.rating ? creator.rating.toFixed(1) : "Нет данных"}
                                                </p>
                                                {/* Кнопка для перехода на страницу жалоб для создателя */}
                                                {creator.username && (
                                                    <Link to={`/complaints/${order.creatorId}`}
                                                          className="complaints-button">
                                                        Жалобы на
                                                        создателя: {creator.complaintsCount || 0}                                       </Link>
                                                )}
                                            </p>
                                            {/* Иконка способа оплаты ниже заголовка */}
                                            <div className="order-payment-icon-container">
                                                <span
                                                    className="payment-icon">{getPaymentIcon(order.paymentType)}</span>
                                                <span
                                                    className="payment-label">{paymentMethods.find(method => method.id === order.paymentType)?.label}</span>
                                            </div>
                                        </div>

                                        <div className="order-left">
                                            <p><strong>Тип заказа:</strong> {order.type}</p>
                                            <p><strong>Описание:</strong> {order.description}</p>
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
                                                                style={{ transform: `translateX(${index * 10}px)` }} // Смещение только вправо
                                                            />
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ) : null}


                                    </div>



                                    {userId !== order.creatorId && !order.executorId && order.status === 'pending' && (
                                        <button className="take-order-button" onClick={() => handleRequestOrder(order.id)}>Запросить выполнение</button>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <p className="no-orders">Нет доступных заказов.</p>
                )}
            </div>

            {/* Модальное окно просмотра изображений */}
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
    );
};
export default UserOrdersPage;
