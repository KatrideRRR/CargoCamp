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
import { FaUniversity, FaMoneyBillWave, FaCreditCard, FaQuestionCircle } from "react-icons/fa";

const apiUrl = process.env.REACT_APP_API_URL;
const socket = io(process.env.REACT_APP_SOCKET_URL, {
    transports: ['websocket'],
    withCredentials: true
});

const ActiveOrdersPage = () => {
    const [orders, setOrders] = useState([]);
    const [error, setError] = useState(null);
    const navigate = useNavigate();
    const {user} = useAuth();
    const [activeBanner, setActiveBanner] = useState(null); // Храним активный заказ с баннером
    const [routeUrl, setRouteUrl] = useState('');
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
    const [executorsInfo, setExecutorsInfo] = useState({}); // Данные о создателях заказов
    const [removedOrders, setRemovedOrders] = useState(() => {
        const saved = localStorage.getItem("removedOrders");
        return saved ? JSON.parse(saved) : [];
    });
    const [expandedOrders, setExpandedOrders] = useState({});
    const [unreadOrders, setUnreadOrders] = useState({});

    console.log(setRouteUrl);

    useEffect(() => {
        localStorage.setItem("removedOrders", JSON.stringify(removedOrders));
    }, [removedOrders]);


    useEffect(() => {
        const token = localStorage.getItem('authToken');
        if (!token) {
            alert('Вы не авторизованы! Пожалуйста, войдите в систему.');
            navigate('/login');
        }
        if (!user?.id) return;

        console.log("📢 Ререндер компонента! Текущее `unreadOrders`:", unreadOrders);

        // Подключаем WebSocket
        socket.connect();
        console.log("📡 Подписка на уведомления, userId:", user.id);
        socket.emit("subscribeToNotifications", user.id);

        const fetchActiveOrders = async () => {
            try {
                const response = await axios.get(`${apiUrl}/api/orders/active-orders`, {
                    headers: { Authorization: `Bearer ${token}` },
                });

                console.log("📦 Ответ от сервера:", response.data);

                // Проверяем, что `orders` - это массив
                if (!Array.isArray(response.data.orders)) {
                    console.error("❌ Ошибка: `orders` не массив!", response.data);
                    return;
                }

                // Получаем данные создателей заказов
                const creatorIds = [...new Set(response.data.orders.map(order => order.creatorId))];
                const creatorsData = {};
                if (creatorIds.length > 0) {
                    const creatorRequests = creatorIds.map(id =>
                        axiosInstance.get(`/auth/${id}`).then(res => ({ id, data: res.data }))
                    );
                    const creatorResults = await Promise.allSettled(creatorRequests);
                    creatorResults.forEach(result => {
                        if (result.status === 'fulfilled' && result.value) {
                            creatorsData[result.value.id] = result.value.data;
                        }
                    });
                }
                setCreatorsInfo(creatorsData);

                // Получаем данные исполнителей заказов
                const executorIds = [...new Set(response.data.orders.map(order => order.executorId))];
                const executorsData = {};
                if (executorIds.length > 0) {
                    const executorRequests = executorIds.map(id =>
                        axiosInstance.get(`/auth/user/${id}`).then(res => ({ id, data: res.data }))
                    );
                    const executorResults = await Promise.allSettled(executorRequests);
                    executorResults.forEach(result => {
                        if (result.status === 'fulfilled' && result.value) {
                            executorsData[result.value.id] = result.value.data;
                        }
                    });
                }
                setExecutorsInfo(executorsData);

                // Фильтруем удалённые заказы
                const filteredOrders = response.data.orders.filter(order => !removedOrders.includes(order.id));
                setOrders(filteredOrders);
                console.log("📦 Ответ сервера (notifications):", response.data.notifications);
                console.log("📋 `unreadOrders` перед обновлением:", unreadOrders);

                // Обновляем непрочитанные уведомления
                setUnreadOrders(() => {
                    const counts = {};

                    response.data.notifications.forEach((notification) => {
                        if (
                            notification.type === 'new_message' &&
                            notification.userId === user.id &&
                            !notification.isRead
                        ) {
                            const orderId = notification.orderId;
                            counts[orderId] = (counts[orderId] || 0) + 1;
                        }
                    });

                    return counts;
                });

            } catch (err) {
                console.error('Ошибка при загрузке активных заказов:', err);
                setError('Не удалось загрузить заказы.');
            }
        };

        fetchActiveOrders();

        // Подписываемся на обновления
        socket.on('activeOrdersUpdated', fetchActiveOrders);
        socket.on("new_notification", () => {
            fetchActiveOrders(); // перезагружает всё и считает точно
        });


        return () => {
            socket.off('activeOrdersUpdated', fetchActiveOrders);
            socket.off("new_notification");
        };
    }, [navigate, removedOrders, user]);

    if (!user) {
        return <p>Загрузка...</p>;
    }

    const handleOpenChat = (orderId) => {
        console.log(`📨 Открываем чат для заказа ${orderId}`);

        // Отправляем серверу запрос на пометку уведомления прочитанным
        socket.emit("markAsRead", { userId: user.id, orderId });

        // Убираем уведомление только после подтверждения сервера
        socket.on("new_notification", (updatedNotifications) => {
            console.log("🔔 Получены обновленные уведомления:", updatedNotifications);
            setUnreadOrders((prev) => {
                const updated = { ...prev };
                delete updated[orderId]; // Удаляем уведомление у конкретного заказа
                return updated;
            });
        });

        navigate(`/messages/${orderId}`);
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

    const completeOrderRequest = async (orderId) => {
        try {
            const token = localStorage.getItem("authToken");
            if (!token) {
                alert("Вы не авторизованы");
                navigate("/login");
                return;
            }

            await axiosInstance.post(
                `/orders/complete/${orderId}`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );

            // обновляем список (самый надежный вариант)
            // просто повторно дерни fetchActiveOrders через socket событие или вынеси fetchActiveOrders наружу
            // но для простоты — локально меняем completedBy:
            setOrders((prev) =>
                prev.map((o) =>
                    o.id === orderId
                        ? { ...o, completedBy: Array.isArray(o.completedBy) ? [...new Set([...o.completedBy, user.id])] : [user.id] }
                        : o
                )
            );

            alert("Подтверждение завершения отправлено ✅");
        } catch (e) {
            console.error(e);
            alert(e.response?.data?.message || "Ошибка при завершении заказа");
        }
    };

    const handleCompleteOrder = async (orderId) => {
        await completeOrderRequest(orderId);
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

    const handleRemoveOrder = (orderId) => {
        setRemovedOrders((prev) => {
            const updated = [...prev, orderId];
            localStorage.setItem("removedOrders", JSON.stringify(updated)); // Сразу сохраняем
            return updated;
        });

        setOrders((prevOrders) => prevOrders.filter((order) => order.id !== orderId));
    };

    const toggleExpand = (orderId) => {
        setExpandedOrders((prev) => ({
            ...prev,
            [orderId]: !prev[orderId],
        }));
    };

    const handleRouteClick = (order) => {
        if (!order?.coordinates || !order.coordinates.includes(',')) {
            alert('Координаты заказа не найдены');
            return;
        }

        const [orderLat, orderLon] = order.coordinates.split(',').map(coord => parseFloat(coord));

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userLat = position.coords.latitude;
                const userLon = position.coords.longitude;

                const url = `https://yandex.ru/navi/?rtext=${userLat},${userLon}~${orderLat},${orderLon}&rtt=auto`;

                // Показать alert с запросом на переход
                const confirmNavigation = window.confirm("Хотите открыть маршрут в Яндекс.Навигаторе?");

                if (confirmNavigation) {
                    window.open(url, '_blank'); // Открыть маршрут в новой вкладке
                }
            },
            (error) => {
                alert('Не удалось определить местоположение');
                console.error(error);
            }
        );
    };

    if (!user || !user.id) {
        return <p>Загрузка...</p>;
    }

    if (error) {
        return <div className="error-message">{error}</div>;
    }

    return (
        <div className="active-orders">

            <div className="pageContainer">

                <div className="active-orders-page">

                    <div className="active-orders-container">

                        <div className="contentWrapper">
                            {orders.length > 0 ? (
                                <ul className="orders-list">
                                    {orders.map((order) => {
                                        const isCompletedByUser = Array.isArray(order.completedBy) && order.completedBy.includes(user.id);
                                        const isWaitingForOther = Array.isArray(order.completedBy) && order.completedBy.length === 1;
                                        const isExecutor = order.executorId === user.id;
                                        const isCreator = order.creatorId === user.id;
                                        const creator = creatorsInfo[order.creatorId] || {};
                                        const executor = executorsInfo[order.executorId] || {};

                                        return (
                                            <li
                                                key={order.id}
                                                className={`order-card `}
                                            >
                                                <div className="order-header" onClick={() => toggleExpand(order.id)}>

                                                    <div className="order-top">
                                                        <div className="order-title">
                                                            <strong>Заказ номер {order.id}</strong>
                                                            {isCreator ? ". Вы являетесь заказчиком" : ". Вы являетесь исполнителем"}.
                                                        </div>

                                                        <div className="payment-icon-container">
                                                            <span className="payment-icon">{getPaymentIcon(order.paymentType)}</span>
                                                        </div>
                                                    </div>

                                                    <div className="order-subline">
                                                        Создан {new Date(order.createdAt).toLocaleString()}
                                                    </div>

                                                    {isExecutor ?
                                                        <>
                                                        <p><strong>ID
                                                                заказчика:</strong> {order.creatorId || "Неизвестно"}
                                                            </p>
                                                            <p><strong>Имя
                                                                заказчика:</strong> {creator.username || "Неизвестно"}
                                                            </p>
                                                            <p><strong>Рейтинг
                                                                заказчика:</strong> {creator.rating ? creator.rating.toFixed(1) : "Нет данных"}
                                                            </p>
                                                        </> :
                                                        <>
                                                            <p><strong>ID
                                                                исполнителя:</strong> {order.executorId || "Неизвестно"}
                                                            </p>
                                                            <p><strong>Имя
                                                                исполнителя:</strong> {executor?.username || "Неизвестно"}
                                                            </p>
                                                            <p><strong>Рейтинг
                                                                исполнителя:</strong> {executor?.rating ? executor.rating.toFixed(1) : "Нет данных"}
                                                            </p>
                                                        </>

                                                    }


                                                    <div className="active-buttons">
                                                        <button
                                                            className="call-button"
                                                            onClick={async () => {
                                                                const phone = isCreator ? await getUserPhone(order.executorId) : await getUserPhone(order.creatorId);
                                                                window.open(`tel:${phone}`);
                                                            }}
                                                        >
                                                            {isMobile ? <FaPhone/> : "Позвонить"}
                                                        </button>

                                                        <button className="message-button" onClick={() => handleOpenChat(order.id)}>
                                                            <span className="message-button-content">{isMobile ? <FaComments/> : "Сообщение"}</span>

                                                            {typeof unreadOrders[order.id] === 'number' && unreadOrders[order.id] > 0 && (
                                                                <span className="notification-badge-ios">{unreadOrders[order.id] > 99 ? '99+' : unreadOrders[order.id]}</span>
                                                            )}
                                                        </button>


                                                        <button className="route-button" onClick={() => handleRouteClick(order)}>
                                                            {isMobile ? <FaRoute/> : "Маршрут"}
                                                        </button>


                                                        {/* Всплывающее окошко для текущего заказа */}
                                                        {activeBanner === order.id && (
                                                            <div
                                                                className="fixed top-0 left-0 right-0 z-50 bg-black text-white px-4 py-3 shadow-lg flex justify-between items-center">
                                                                <span>Открыть маршрут в Яндекс.Навигаторе?</span>
                                                                <div className="flex gap-3 ml-4">
                                                                    <button
                                                                        onClick={() => window.open(routeUrl, '_blank')} // Открываем маршрут
                                                                        className="bg-green-600 px-3 py-1 rounded text-white"
                                                                    >
                                                                        Да
                                                                    </button>
                                                                    <button
                                                                        onClick={() => setActiveBanner(null)} // Закрываем баннер
                                                                        className="bg-gray-600 px-3 py-1 rounded text-white"
                                                                    >
                                                                        Отмена
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}


                                                        {isCompletedByUser ? (
                                                            isWaitingForOther ? (
                                                                <button
                                                                    className="remove-button"
                                                                    onClick={() => handleRemoveOrder(order.id)}
                                                                >
                                                                    {isMobile ? <FaTrash/> : "Удалить"}
                                                                </button>
                                                            ) : null
                                                        ) : (
                                                            <button
                                                                className="complete-button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleCompleteOrder(order.id);
                                                                }}
                                                            >
                                                                {isMobile ? <FaCheck/> : "Завершить"}
                                                            </button>
                                                        )}
                                                    </div>

                                                </div>


                                                {/* Детали заказа (появляются только при раскрытии) */}
                                                {expandedOrders[order.id] && (
                                                    <div className="order-details">
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

                                                        {Array.isArray(order.images) && order.images.length > 0 && (
                                                            <div className="image-stack-container">
                                                                <div className="image-stack"
                                                                     onClick={() => openModal(order.images)}>
                                                                    {order.images.map((image, index) => (
                                                                        <img
                                                                            key={index}
                                                                            src={`${apiUrl}${image}`}
                                                                            alt={`Order pic ${index + 1}`}
                                                                            className="order-image"
                                                                            style={{transform: `translateX(${index * 10}px)`}} // Смещение вправо
                                                                        />
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        <p><strong>Адрес:</strong> {order.address}</p>
                                                        <p><strong>Цена:</strong> {order.proposedSum} ₽</p>
                                                        <p><strong>Описание:</strong> {order.description}</p>


                                                        {order.contractPath && (
                                                            <div className="mt-2">
                                                                <a
                                                                    href={`http://localhost:5001/${order.contractPath.replace(/\\/g, '/')}`}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-blue-600 underline hover:text-blue-800 transition"
                                                                >
                                                                    Скачать договор (PDF)
                                                                </a>
                                                            </div>
                                                        )}

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

    )

};

export default ActiveOrdersPage;