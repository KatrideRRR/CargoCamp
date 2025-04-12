import React, { useEffect, useState } from 'react';
import axiosInstance from '../utils/axiosInstance';
import {Link, useNavigate} from 'react-router-dom';
import '../styles/OrdersPage.css';
import io from 'socket.io-client';
import Modal from 'react-modal';
import SwipeableMap from "../components/SwipeableMap.js";

const apiUrl = process.env.REACT_APP_API_URL;
const socket = io(process.env.REACT_APP_SOCKET_URL, {
    transports: ['websocket'],
    withCredentials: true
});

const OrdersPage = () => {
    const [orders, setOrders] = useState([]);
    const [error, setError] = useState(null);
    const [userId, setUserId] = useState(null);
    const [creatorsInfo, setCreatorsInfo] = useState({}); // Данные о создателях заказов
    const [categories, setCategories] = useState([]);
    const [subcategories, setSubcategories] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);  // Состояние для модального окна
    const [currentImageIndex, setCurrentImageIndex] = useState(0);  // Индекс текущего изображения
    const [currentImages, setCurrentImages] = useState([]);  // Массив изображений для отображения
    const [selectedSubcategory, setSelectedSubcategory] = useState('');
    const [filteredOrders, setFilteredOrders] = useState([]);
    const [userLocation, setUserLocation] = useState(null);
    const [manualAddress, setManualAddress] = useState('');
    const [isGeolocationDenied, setIsGeolocationDenied] = useState(false);
    const navigate = useNavigate();
    const [filteredByCategory, setFilteredByCategory] = useState([]); // заказы после фильтра по категории
    const [isMapVisible, setIsMapVisible] = useState(true); // Состояние для контроля видимости карты

    const paymentMethods = [
        { id: "cash", label: "Наличные", icon: "💵" },
        { id: "guarantee", label: "Гарантия", icon: "🛡️" },
        { id: "installments", label: "Рассрочка", icon: "💳" },
    ];
    const toggleMapVisibility = () => {
        setIsMapVisible(prev => !prev); // Переключить состояние карты
    };

    useEffect(() => {
        fetchCategories();
        getUserLocation();
    }, []);

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

    // Получение геолокации пользователя
    const getUserLocation = () => {
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const { latitude, longitude } = position.coords;
                    console.log("📍 Геолокация получена:", latitude, longitude);
                    setUserLocation({ latitude, longitude });
                },
                (error) => {
                    console.warn("⚠ Ошибка геолокации:", error.message);
                    setIsGeolocationDenied(true);
                }
            );
        } else {
            console.warn("⚠ Браузер не поддерживает геолокацию");
            setIsGeolocationDenied(true);
        }
    };

    // Геокодинг адреса через API (пример на Яндекс.Картах)
    const geocodeAddress = async (address) => {
        try {
            const response = await fetch(
                `https://geocode-maps.yandex.ru/1.x/?apikey=ВАШ_API_КЛЮЧ&geocode=${encodeURIComponent(address)}&format=json`
            );
            const data = await response.json();
            const pos = data.response.GeoObjectCollection.featureMember[0]?.GeoObject?.Point?.pos;
            if (!pos) throw new Error("Адрес не найден");

            const [longitude, latitude] = pos.split(" ").map(Number);
            console.log("📍 Координаты введенного адреса:", latitude, longitude);
            setUserLocation({ latitude, longitude });
        } catch (error) {
            console.error("❌ Ошибка геокодинга:", error);
            alert("Не удалось определить координаты по адресу");
        }
    };

    useEffect(() => {
        if (userLocation && filteredByCategory.length > 0) {
            const filtered = filteredByCategory.filter((order) => {
                if (!order.latitude || !order.longitude) return false;
                const distance = getDistanceFromLatLonInKm(
                    userLocation.latitude,
                    userLocation.longitude,
                    order.latitude,
                    order.longitude
                );
                return distance <= 50;
            });
            setFilteredOrders(filtered);
        }
    }, [userLocation, filteredByCategory]);


    // Формула расчета расстояния между координатами (Haversine formula)
    const getDistanceFromLatLonInKm = (lat1, lon1, lat2, lon2) => {
        const R = 6371; // Радиус Земли в км
        const dLat = (lat2 - lat1) * (Math.PI / 180);
        const dLon = (lon2 - lon1) * (Math.PI / 180);
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * (Math.PI / 180)) *
            Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c; // Расстояние в км
    };


    useEffect(() => {
        const fetchOrders = async () => {
            try {
                const response = await axiosInstance.get('/orders/all');
                console.log("📦 Загружены заказы:", response.data);
                setOrders(response.data);

                // Получаем данные о создателях заказов
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

        fetchOrders();
        fetchUserData();

        if (userId) {
            console.log("🔄 Подключаем WebSocket для пользователя:", userId);

            socket.on('orderRequested', (data) => {
                console.log("🔔 Получен запрос на заказ:", data);
            });
            socket.on('orderUpdated', fetchOrders);

            return () => {
                socket.off('orderRequested');
                socket.off('orderUpdated');
            };
        }
    }, [userId]);

    const fetchCategories = async () => {
        try {
            const response = await axiosInstance.get('/category');
            setCategories(response.data);
        } catch (error) {
            console.error('Ошибка загрузки категорий:', error);
        }
    };

    const fetchSubcategories = async (categoryId) => {
        if (!categoryId) {
            setSubcategories([]);
            return;
        }
        try {
            const response = await axiosInstance.get(`/category/subcategory/${categoryId}`);
            setSubcategories(response.data);
        } catch (error) {
            console.error('Ошибка загрузки подкатегорий:', error);
        }
    };


    const handleCategoryChange = async (event) => {
        const categoryId = event.target.value;
        setSelectedCategory(categoryId);
        setSelectedSubcategory('');
        fetchSubcategories(categoryId);
        applyFilters(categoryId, '');
    };

    const handleSubcategoryChange = async (event) => {
        const subcategoryId = event.target.value;
        setSelectedSubcategory(subcategoryId);
        applyFilters(selectedCategory, subcategoryId);
    };



    const applyFilters = async (categoryId, subcategoryId) => {
        try {
            const response = await axiosInstance.get('/orders/all', {
                params: {
                    categoryId: categoryId || undefined,
                    subcategoryId: subcategoryId || undefined
                }
            });

            const categoryFiltered = response.data;
            setOrders(categoryFiltered); // сохраняем оригинал
            setFilteredByCategory(categoryFiltered); // фильтр по категории

            // если геолокация есть — фильтруем сразу
            if (userLocation) {
                const geoFiltered = categoryFiltered.filter(order => {
                    if (!order.latitude || !order.longitude) return false;
                    const distance = getDistanceFromLatLonInKm(
                        userLocation.latitude,
                        userLocation.longitude,
                        order.latitude,
                        order.longitude
                    );
                    return distance <= 50;
                });
                setFilteredOrders(geoFiltered);
            } else {
                setFilteredOrders(categoryFiltered);
            }

        } catch (error) {
            console.error("❌ Ошибка фильтрации заказов:", error);
        }
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

    if (error) {
        return <div className="error-message">Ошибка: {error}</div>;
    }

    return (
        <div className="orders-page">

            <div className="map-containern">
                {isMapVisible && <SwipeableMap orders={filteredOrders} userLocation={userLocation}  />}
                <div className="flex-1 overflow-auto">
                    <button
                        className="toggle-map-button"
                        onClick={toggleMapVisibility}
                    >
                        {/* В зависимости от состояния показываем либо стрелочку вниз, либо вверх */}
                        {isMapVisible ? <span>Скрыть карту</span> : <span>Показать карту</span>}
                    </button>


                    <div className="orders-container">
                        <div className="orders-wrapper">
                            <div className="filters">
                                <label>Категория:</label>
                                <select value={selectedCategory} onChange={handleCategoryChange}>
                                    <option value="">Все категории</option>
                                    {categories.map(category => (
                                        <option key={category.id} value={category.id}>{category.name}</option>
                                    ))}
                                </select>

                                <label>Подкатегория:</label>
                                <select value={selectedSubcategory} onChange={handleSubcategoryChange}
                                        disabled={!selectedCategory}>
                                    <option value="">Все подкатегории</option>
                                    {subcategories.map(subcategory => (
                                        <option key={subcategory.id} value={subcategory.id}>{subcategory.name}</option>
                                    ))}
                                </select>
                                <label>Ваше местоположение:</label>
                                {isGeolocationDenied ? (
                                    <>
                                        <input
                                            type="text"
                                            value={manualAddress}
                                            onChange={(e) => setManualAddress(e.target.value)}
                                            placeholder="Введите ваш адрес"
                                        />
                                        <button onClick={() => geocodeAddress(manualAddress)}>Определить</button>
                                    </>
                                ) : (
                                    <p>Геолокация включена</p>
                                )}

                            </div>


                            {orders.length > 0 ? (
                                <ul className="orders-list">
                                    {orders.map((order) => {
                                        const creator = creatorsInfo[order.creatorId] || {};
                                        const isCreator = order.creatorId === userId;

                                        return (

                                            <li
                                                key={order.id}
                                                className={`order-card ${isCreator ? 'creator' : ''} `}
                                            >
                                                <div className="order-content">
                                                    <div className="order-header">
                                                        <div className="order-info">
                                                            <p className="order-title">
                                                                <strong>Заказ
                                                                    №{order.id}</strong> от {creator.username || "Неизвестно"}.
                                                                Создан {new Date(order.createdAt).toLocaleString()}.
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
                                                            </p>
                                                            {/* Иконка способа оплаты */}
                                                            <div className="payment-info">
                                                        <span
                                                            className="payment-icon">{getPaymentIcon(order.paymentType)}</span>
                                                                <span className="payment-label">
                {paymentMethods.find(method => method.id === order.paymentType)?.label}
                </span>
                                                            </div>
                                                            {/* Кнопка для перехода на страницу жалоб */}
                                                            {creator.username && (
                                                                <Link to={`/complaints/${order.creatorId}`}
                                                                      className="complaints-button">
                                                                    Жалобы на создателя: {creator.complaintsCount || 0}
                                                                </Link>
                                                            )}


                                                        </div>
                                                    </div>

                                                    <div className="order-left">
                                                        <p><strong>Название заказа:</strong> {order.type}</p>
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

                                                    <p><strong>Описание:</strong> {order.description}</p>


                                                </div>


                                                {userId !== order.creatorId && !order.executorId && order.status === 'pending' && (
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
                    </div>
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


            );
        </div>
    )
};

export default OrdersPage;
