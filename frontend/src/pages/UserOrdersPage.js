import React, { useEffect, useState } from 'react';
import {Link, useNavigate, useParams} from 'react-router-dom';
import axiosInstance from '../utils/axiosInstance';
import OrderServiceDetails from "../components/OrderServiceDetails";
import '../styles/OrdersPage.css';
import { socket } from "../socketClient";
import Modal from 'react-modal';
import {FaCreditCard, FaMoneyBillWave, FaQuestionCircle, FaUniversity} from "react-icons/fa";
import {FiAlertTriangle} from "react-icons/fi";

const apiUrl = process.env.REACT_APP_API_URL;

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
    const [user, setUser] = useState(null);
    const [
        pageUser,
        setPageUser,
    ] = useState(null);
    const [loading, setLoading] =
        useState(true);

    useEffect(() => {
        const fetchUserOrders = async () => {
            try {
                setLoading(true);
                setError(null);

                const response =
                    await axiosInstance.get(
                        `/orders/creator/${paramUserId}`
                    );

                const loadedOrders =
                    Array.isArray(response.data)
                        ? response.data
                        : [];

                setOrders(loadedOrders);

                const creatorIds = [
                    ...new Set(
                        loadedOrders
                            .map(
                                (order) =>
                                    order.creatorId
                            )
                            .filter(Boolean)
                    ),
                ];

                const creatorResults =
                    await Promise.allSettled(
                        creatorIds.map(
                            async (creatorId) => {
                                const result =
                                    await axiosInstance.get(
                                        `/auth/${creatorId}`
                                    );

                                return {
                                    creatorId,
                                    data:
                                        result.data || {},
                                };
                            }
                        )
                    );

                const creatorsData = {};

                creatorResults.forEach(
                    (result) => {
                        if (
                            result.status ===
                            "fulfilled"
                        ) {
                            creatorsData[
                                result.value.creatorId
                                ] =
                                result.value.data;
                        }
                    }
                );

                setCreatorsInfo(creatorsData);
            } catch (err) {
                console.error(
                    "Ошибка загрузки заказов пользователя:",
                    err
                );

                setOrders([]);

                setError(
                    err.response?.data?.message ||
                    "Ошибка загрузки заказов"
                );
            } finally {
                setLoading(false);
            }
        };

        const fetchUserData = async () => {
            try {
                const response = await axiosInstance.get('/auth/profile');
                setUser(response.data);
                setUserId(response.data.id);
            } catch (err) {
                console.error("❌ Ошибка получения профиля:", err);
            }
        };

        const fetchPageUser = async () => {
            try {
                const response =
                    await axiosInstance.get(
                        `/auth/${paramUserId}`
                    );

                setPageUser(
                    response.data || null
                );
            } catch (error) {
                console.error(
                    "Ошибка получения пользователя страницы:",
                    error
                );

                setPageUser(null);
            }
        };

        fetchUserOrders();
        fetchUserData();
        fetchPageUser();

        if (userId) {

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

    const handleRequestOrder = async (
        orderId
    ) => {
        const token =
            localStorage.getItem(
                "authToken"
            );

        if (!token) {
            alert(
                "Вы не авторизованы! Пожалуйста, войдите в систему."
            );

            navigate("/login");
            return;
        }

        try {
            await axiosInstance.post(
                `/orders/${orderId}/request`
            );

            alert(
                "Запрос отправлен заказчику!"
            );
        } catch (error) {
            console.error(
                "Ошибка при запросе на выполнение заказа:",
                error
            );

            alert(
                error.response?.data?.message ||
                "Не удалось отправить запрос"
            );
        }
    };

    const openModal = (images) => {
        const normalizedImages =
            Array.isArray(images)
                ? images.filter(Boolean)
                : [];

        if (
            normalizedImages.length === 0
        ) {
            return;
        }

        setCurrentImages(
            normalizedImages
        );

        setCurrentImageIndex(0);
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

    if (loading) {
        return (
            <div className="loading-message">
                Загрузка...
            </div>
        );
    }

    if (error) {
        return (
            <div className="error-message">
                Ошибка: {error}
            </div>
        );
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
        <div className="all-orders">

            <div className="pageContainer">

                <div className="all-orders-page">

                    {pageUser && (
                        <h1 className="text-2xl font-bold mb-4">
                            Заказы пользователя{" "}
                            {pageUser.username || "Без имени"}{" "}
                            (ID: {paramUserId})
                        </h1>
                    )}
                    {orders.length > 0 ? (
                        <ul className="orders-list">
                            {orders.map((order) => {
                                const creator = creatorsInfo[order.creatorId] || {};

                                const description =
                                    typeof order.description === "string"
                                        ? order.description.trim()
                                        : "";

                                const hasDescription = description.length > 0;

                                return (
                                    <li
                                        key={order.id}
                                        className={`floatingCard ${order.is_highlighted ? 'highlighted-order' : ''}`}
                                    >
                                        <div className="order-content">
                                            <div className="order-header">
                                                <div className="order-info">
                                                    <div className="order-title">
    <span>
        <strong>
            Заказ №{order.id}
        </strong>{" "}
        от{" "}
        {creator.username ||
            "Неизвестно"}.
        Создан{" "}
        {new Date(
            order.createdAt
        ).toLocaleString()}.
    </span>

                                                        <div className="order-payment-icon-container">
        <span className="payment-icon">
            {getPaymentIcon(
                order.paymentType
            )}
        </span>
                                                        </div>
                                                    </div>

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
                                            {hasDescription && (
                                                <p>
                                                    <strong>Описание:</strong> {description}
                                                </p>
                                            )}

                                            <OrderServiceDetails
                                                order={order}
                                                compact
                                            />

                                        </div>


                                        {Number(userId) !==
                                            Number(order.creatorId) &&
                                            !order.executorId &&
                                            order.status === "pending" && (
                                                <button className="take-order-button"
                                                    onClick={() => handleRequestOrder(order.id)}>Запросить
                                                выполнение</button>
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
                        {currentImages.length > 0 && (
                            <img
                                src={`${apiUrl}${currentImages[currentImageIndex]}`}
                                alt="Full-size view"
                                className="custom-modal-image"
                            />
                        )}

                        {currentImages.length > 1 && (
                            <div className="custom-image-navigation">
                                <button
                                    onClick={prevImage}
                                    className="custom-nav-button"
                                >
                                    ◀
                                </button>

                                <button
                                    onClick={nextImage}
                                    className="custom-nav-button"
                                >
                                    ▶
                                </button>
                            </div>
                        )}

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
};
export default UserOrdersPage;
