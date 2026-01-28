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

    const buildServiceLine = (o) => {
        const parts = [
            o?.category?.name,
            o?.subcategory?.name,
            o?.service?.name,
        ].filter(Boolean);

        return parts.length ? parts.join(" • ") : "Не указано";
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
        <div className="orders-page">
            <div className="orders-shell">

                <div className="orders-top glass">
                    <div className="orders-top-left">
                        <div className="orders-title">Заказ №{order.id}</div>
                        <div className="orders-subtitle">
                            от <b>{creator.username || "пользователя"}</b> • {new Date(order.createdAt).toLocaleString()}
                        </div>
                    </div>

                    <div className="orders-top-right">
                        <button className="btn btn-ghost" onClick={() => navigate(-1)}>
                            Назад
                        </button>
                    </div>
                </div>

                <ul className="orders-list">
                    <li
                        key={order.id}
                        className={[
                            "order-card",
                            "glass",
                            order.creatorId === userId ? "creator" : "",
                            order.is_highlighted ? "highlighted" : "",
                            order.is_recommended ? "recommended" : "",
                            order.taxi_courier ? "courier" : "",
                        ].filter(Boolean).join(" ")}
                    >
                        <div className="order-head">
                            <div className="order-head-left">
                                <div className="order-title-row">
                                    <span className="order-number">Заказ №{order.id}</span>
                                    <span className="v">
                  {creator.username || "—"} • рейтинг{" "}
                                        {creator.rating ? creator.rating.toFixed(1) : "нет"}
                </span>
                                    {order.is_recommended && (
                                        <span className="badge badge-priority">В приоритете</span>
                                    )}

                                    {order.taxi_courier && (
                                        <span className="badge badge-courier">Курьер / Такси</span>
                                    )}
                                </div>

                                <div className="order-meta">
                <span className="muted">
                  {creator.username ? `от ${creator.username}` : "от пользователя"} •{" "}
                    {new Date(order.createdAt).toLocaleString()}
                </span>
                                </div>
                            </div>

                            <div className="order-head-right">
                                <div className="pay-box">
                                    <span className="pay-icon">{getPaymentIcon(order.paymentType)}</span>
                                    <div className="pay-right">
                                        <div className="pay-price">
                                            {Number(order.proposedSum ?? 0).toLocaleString("ru-RU")} ₽
                                        </div>
                                        <div className="pay-type">{getPaymentLabel(order.paymentType)}</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="order-grid">
                            <div className="order-col">
                                <div className="kv">
                                    <span className="k">Категория / Услуга</span>
                                    <span className="v v-line">{buildServiceLine(order)}</span>
                                </div>
                            </div>

                            <div className="order-col">
                                <div className="kv">
                                    <span className="k">Адрес</span>
                                    <span className="v">{order.address || "—"}</span>
                                </div>

                            </div>
                        </div>

                        {Array.isArray(order.images) && order.images.length > 0 && (
                            <div className="thumbs" onClick={() => openModal(order.images)}>
                                {order.images.slice(0, 4).map((img, idx) => (
                                    <img
                                        key={idx}
                                        className="thumb"
                                        src={`${apiUrl}${img}`}
                                        alt={`img-${idx}`}
                                    />
                                ))}
                                {order.images.length > 4 && (
                                    <div className="thumb-more">+{order.images.length - 4}</div>
                                )}
                            </div>
                        )}

                        <div className="order-desc">
                            <span className="k">Описание</span>
                            <div className="v">{order.description || "—"}</div>
                        </div>

                        <div className="order-actions">
                            <Link
                                to={`/complaints/${order.creatorId}`}
                                className="btn btn-ghost-danger btn-inline"
                                aria-label={`Жалобы (${creator.complaintsCount || 0})`}
                            >
                                <FiAlertTriangle style={{ marginRight: 8 }} />
                                {creator.complaintsCount || 0}
                            </Link>

                            {userId !== order.creatorId && !order.executorId && order.status === "pending" && (
                                <button className="btn btn-primary" onClick={() => handleRequestOrder(order.id)}>
                                    Запросить выполнение
                                </button>
                            )}
                        </div>
                    </li>
                </ul>

                <Modal
                    appElement={document.getElementById("root")}
                    isOpen={isModalOpen}
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
        </div>
    );
};

export default OrderPage;
