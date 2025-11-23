/* global cp */

import React, { useEffect, useState } from 'react';
import axiosInstance from '../utils/axiosInstance';
import {Link, useNavigate} from 'react-router-dom';
import '../styles/OrdersPage.css';
import io from 'socket.io-client';
import Modal from 'react-modal';
import SwipeableMap from "../components/SwipeableMap.js";
import { FaUniversity, FaMoneyBillWave, FaCreditCard, FaQuestionCircle } from "react-icons/fa";
import { useSwipeable } from 'react-swipeable';
import { FiAlertTriangle } from 'react-icons/fi';
import axios from "axios";

const apiUrl = process.env.REACT_APP_API_URL;
const socket = io(process.env.REACT_APP_SOCKET_URL, {
    transports: ['websocket'],
    withCredentials: true
});

const OrdersPage = () => {
    const [orders, setOrders] = useState([]);
    const [error, setError] = useState(null);
    const [userId, setUserId] = useState(null);
    const { user } = useState(null);
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
    const [activeTab, setActiveTab] = useState('all'); // 'all' | 'courier' | 'urgent'
    const [services, setServices] = useState([]);
    const [selectedService, setSelectedService] = useState('');
    const [cardInfo, setCardInfo] = useState({ number: '', exp: '', cvv: '' });

    const createCryptogram = async () => {
        if (!window.cp) throw new Error("CloudPayments не загружен");

        return new Promise((resolve, reject) => {
            const widget = new window.cp.CloudPayments();
            widget.createCardCryptogram(
                {
                    cardNumber: cardInfo?.number, // если есть локальная форма
                    expDate: cardInfo?.exp,
                    cvv: cardInfo?.cvv
                },
                (cryptogram) => resolve(cryptogram),
                (reason) => reject(reason)
            );
        });
    };

    const toggleMapVisibility = () => {
        setIsMapVisible(prev => !prev); // Переключить состояние карты
    };

    const handleTabChange = (tab) => {
        setActiveTab(tab);
        setSelectedCategory('');
        setSelectedSubcategory('');
        applyFilters(undefined, undefined);
    };

    const getVisibleOrders = () => {
        return filteredOrders.filter(order => {
            if (activeTab === 'all') {
                return !order.is_recommended && !order.taxi_courier;
            }
            if (activeTab === 'courier') {
                return order.taxi_courier === true;
            }
            if (activeTab === 'urgent') {
                return order.is_recommended === true;
            }
            return true;
        });
    };

    const fetchServices = async (subcategoryId) => {
        if (!subcategoryId) {
            setServices([]);
            return;
        }

        try {
            const response = await axiosInstance.get(`/category/services/${subcategoryId}`);
            setServices(response.data);
        } catch (error) {
            console.error('Ошибка загрузки услуг:', error);
            setServices([]);
        }
    };

    const swipeHandlers = useSwipeable({
        onSwipedLeft: () => {
            if (activeTab === 'all') setActiveTab('courier');
            else if (activeTab === 'courier') setActiveTab('urgent');
        },
        onSwipedRight: () => {
            if (activeTab === 'urgent') setActiveTab('courier');
            else if (activeTab === 'courier') setActiveTab('all');
        },
    });

    useEffect(() => {
        fetchCategories();
        getUserLocation();
    }, []);

    const calculateCommission = ({paymentType, proposedSum, isRecommended, isPremium}) => {

        if (isPremium) return 0;

        let commission = 0;

        if (paymentType === "cash") {
            commission = 200;
        } else if (paymentType === "guarantee") {
            commission = Math.round(proposedSum * 0.15);
        } else if (paymentType === "installments") {
            commission = Math.round(proposedSum * 0.2);
        }

        if (isRecommended) {
            commission -= 100;
            if (commission < 0) commission = 0;
        }

        return commission;
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

    useEffect(() => {
        const storedCoords = localStorage.getItem("manualCoords");
        if (storedCoords) {
            setUserLocation(JSON.parse(storedCoords));
        }
    }, []);

    const geocodeAddress = async (address) => {
        try {
            const response = await fetch(
                `https://geocode-maps.yandex.ru/1.x/?apikey=bf97867b-5ffb-4fc4-9fd5-8997874b300e&geocode=${encodeURIComponent(address)}&format=json`
            );
            const data = await response.json();
            const pos = data.response.GeoObjectCollection.featureMember[0]?.GeoObject?.Point?.pos;
            if (!pos) throw new Error("Адрес не найден");

            const [longitude, latitude] = pos.split(" ").map(Number);
            console.log("📍 Координаты введенного адреса:", latitude, longitude);
            setUserLocation({ latitude, longitude });
            localStorage.setItem("manualCoords", JSON.stringify({ latitude, longitude }));
            applyFilters(selectedCategory, selectedSubcategory, selectedService); // 🔧 вызов после установки локации
        } catch (error) {
            console.error("❌ Ошибка геокодинга:", error);
            alert("Не удалось определить координаты по адресу");
        }
    };

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
            applyFilters(selectedCategory, selectedSubcategory, selectedService);

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
                if (axios.isAxiosError(err)) {
                    if (err.response?.status === 401) {
                        console.info("ℹ️ Пользователь не авторизован — логин не выполнен.");
                        return; // тихий выход, без ошибки
                    }

                    console.warn("⚠️ Ошибка от сервера:", err.response?.status, err.response?.data);
                } else {
                    console.error("❌ Неизвестная ошибка:", err);
                }
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
        setSelectedService('');
        await fetchServices(subcategoryId);
        applyFilters(selectedCategory, subcategoryId, ''); // сбрасываем фильтрацию по услуге
    };

    useEffect(() => {
        console.log('📦 Услуги:', services);
    }, [services]);

    const applyFilters = async (categoryId, subcategoryId, serviceId = '') => {
        try {
            const response = await axiosInstance.get('/orders/all', {
                params: {
                    categoryId: categoryId || undefined,
                    subcategoryId: subcategoryId || undefined,
                    serviceId: serviceId || undefined
                }
            });

            const allOrders = response.data;
            setOrders(allOrders);
            setFilteredByCategory(allOrders); // для других фильтров
            const categoryFiltered = allOrders; // если никаких фильтров по категориям не применял

            if (!userLocation) {
                console.log("⚠️ userLocation ещё нет — фильтрация без гео");
                setFilteredOrders(categoryFiltered);
                return;
            }

            if (userLocation) {
                console.log("📍 Фильтрация по гео. userLocation:", userLocation);

                const geoFiltered = categoryFiltered
                    .map(order => {
                        const [lat, lon] = order.coordinates?.split(',')?.map(Number) || [];

                        if (!lat || !lon) {
                            console.warn(`❌ Координаты невалидны для заказа #${order.id}`);
                            return null;
                        }

                        const distance = getDistanceFromLatLonInKm(
                            userLocation.latitude,
                            userLocation.longitude,
                            lat,
                            lon
                        );

                        console.log(`✅ Заказ #${order.id} — расстояние: ${distance.toFixed(2)} км`);

                        return {
                            ...order,
                            latitude: lat,
                            longitude: lon,
                            _distance: distance,
                        };
                    })
                    .filter(order => {
                        const valid = order && order._distance <= 50;
                        if (!valid) console.log(`⛔ Исключён заказ #${order?.id} — ${order?._distance?.toFixed(1)} км`);
                        return valid;
                    })
                    .sort((a, b) => a._distance - b._distance);

                console.log("📦 После фильтрации:", geoFiltered.length, "шт.");
                setFilteredOrders(geoFiltered);
            } else {
                console.log("⚠️ userLocation отсутствует, не фильтруем");
                setFilteredOrders(categoryFiltered);
            }

        } catch (error) {
            console.error("❌ Ошибка фильтрации заказов:", error);
        }
    };

    useEffect(() => {
        if (!userLocation) return;
        console.log("🌍 userLocation установлен:", userLocation);
    }, [userLocation]);

    useEffect(() => {
        applyFilters(selectedCategory, selectedSubcategory, selectedService);

        if (orders.length && userLocation) {
            console.log("📡 Вызов applyFilters после получения координат");
            applyFilters(selectedCategory, selectedSubcategory, selectedService);
        }
    }, [userLocation, selectedCategory, selectedSubcategory, selectedService]);

    const handlePayDebt = async () => {
        const token = localStorage.getItem("authToken");
        const user = JSON.parse(localStorage.getItem("user"));

        try {
            let cardCryptogramPacket = null;

            // Если нет сохраненной карты — создаём криптограмму
            if (!cardInfo) {
                cardCryptogramPacket = await createCryptogram();
            }

            const response = await fetch(`${apiUrl}/api/payments/commission/pay-debt`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`
                },
                body: JSON.stringify({
                    userId: user.id,
                    cardCryptogramPacket
                })
            });

            const data = await response.json();

            if (data.success) {
                alert("Задолженность успешно погашена!");
            } else {
                alert(data.error || "Ошибка при оплате долга");
            }
        } catch (err) {
            console.error("Debt pay error:", err);
            alert("Ошибка сервера при оплате долга");
        }
    };

    const handleRequestOrder = async (orderId) => {
        const token = localStorage.getItem('authToken');
        if (!token) {
            alert('Вы не авторизованы! Пожалуйста, войдите в систему.');
            navigate('/login');
            return;
        }

        try {
            // 👇 Запрашиваем статус пользователя
            const statusResponse = await axiosInstance.get('/orders/me/status', {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (statusResponse.data.has_debt) {
                if (window.confirm("У вас есть задолженность по комиссии. Хотите оплатить сейчас?")) {
                    await handlePayDebt();
                }
                return;
            }

            // ✅ Только если нет долга, продолжаем
            const proposedSum = prompt("Введите сумму, которую вы хотите получить за выполнение:");
            if (!proposedSum) {
                alert("Вы не указали сумму!");
                return;
            }

            const comment = prompt("Комментарий к заказчику (необязательно):");

            await axiosInstance.post(`/orders/${orderId}/request`, { proposedSum, comment }, {
                headers: { Authorization: `Bearer ${token}` }
            });

            alert("Запрос отправлен заказчику!");
        } catch (error) {
            console.error("Ошибка при запросе на выполнение заказа:", error);

            if (error.response?.data?.message) {
                alert(error.response.data.message);
            } else {
                alert("Произошла ошибка. Попробуйте позже.");
            }
        }
    };

    if (error) {
        return <div className="error-message">Ошибка: {error}</div>;
    }

    const filteredCategories = categories.filter(cat => {
        const name = cat.name.toLowerCase();
        if (activeTab === 'courier') {
            return name === 'такси' || name === 'курьер';
        } else {
            return name !== 'такси' && name !== 'курьер';
        }
    });

    console.log(userId);
    console.log("🟢 getVisibleOrders:", getVisibleOrders().length);

    return (
        <div className="all-orders">

            <div className="pageContainer">
                <div className="all-orders-page">

                    <div className="map-container1">
                        {isMapVisible && (
                            <div className="map-wrapper">
                                <SwipeableMap orders={getVisibleOrders()} userLocation={userLocation}/>
                            </div>
                        )}
                        <div className="flex-1 overflow-auto">
                            <button
                                className="toggle-map-button"
                                onClick={toggleMapVisibility}
                            >
                                {isMapVisible ? "▲ Скрыть карту" : "▼ Показать карту"}
                            </button>


                            <div {...swipeHandlers} className="contentWrapper">

                                <div className="carousel-tabs-container">
                                    <div
                                        className={`carousel-tab ${activeTab === 'all' ? 'active' : ''}`}
                                        onClick={() => handleTabChange('all')}
                                    >
                                        Основные
                                    </div>
                                    <div
                                        className={`carousel-tab ${activeTab === 'courier' ? 'active' : ''}`}
                                        onClick={() => handleTabChange('courier')}
                                    >
                                        Курьер / Такси
                                    </div>
                                    <div
                                        className={`carousel-tab ${activeTab === 'urgent' ? 'active' : ''}`}
                                        onClick={() => handleTabChange('urgent')}
                                    >
                                        В приоритете
                                    </div>
                                </div>


                                <div className="orders-wrapper">
                                    <div className="filters">
                                        <label>Категория:</label>
                                        <select value={selectedCategory} onChange={handleCategoryChange}>
                                            <option value="">Все категории</option>
                                            {filteredCategories.map(category => (
                                                <option key={category.id} value={category.id}>{category.name}</option>
                                            ))}
                                        </select>

                                        <label>Подкатегория:</label>
                                        <select value={selectedSubcategory} onChange={handleSubcategoryChange}
                                                disabled={!selectedCategory}>
                                            <option value="">Все подкатегории</option>
                                            {subcategories.map(subcategory => (
                                                <option key={subcategory.id}
                                                        value={subcategory.id}>{subcategory.name} - {subcategory.price}</option>
                                            ))}
                                        </select>

                                        <label>Услуга:</label>
                                        <select
                                            value={selectedService}
                                            onChange={(e) => {
                                                setSelectedService(e.target.value);
                                                applyFilters(selectedCategory, selectedSubcategory, e.target.value);
                                            }}
                                            disabled={!selectedSubcategory || services.length === 0}
                                        >
                                            <option value="">Все услуги</option>
                                            {services.map(service => (
                                                <option key={service.id} value={service.id}>
                                                    {service.name} — {service.price} ₽
                                                </option>
                                            ))}
                                        </select>

                                        <div className="location-row">
                                            <label>Ваше местоположение:</label>
                                            {isGeolocationDenied ? (
                                                <>
                                                    <input
                                                        type="text"
                                                        value={manualAddress}
                                                        onChange={(e) => setManualAddress(e.target.value)}
                                                        placeholder="Введите ваш адрес"
                                                    />
                                                    <button onClick={() => geocodeAddress(manualAddress)}>Определить
                                                    </button>
                                                </>
                                            ) : (
                                                <p className="geolocation-status">Геолокация включена</p>
                                            )}
                                        </div>


                                    </div>

                                    {orders.length > 0 ? (
                                        <ul className="orders-list">
                                            {getVisibleOrders().map((order) => {
                                                const creator = creatorsInfo[order.creatorId] || {};
                                                const isCreator = order.creatorId === userId;
                                                const getCommissionText = (order, user) => {
                                                    const isPremium =
                                                        user?.subscription_type === "premium" &&
                                                        new Date(user.subscription_expires_at) > new Date();

                                                    const commission = calculateCommission({
                                                        paymentType: order.paymentType,
                                                        proposedSum: order.proposedSum,
                                                        isRecommended: order.is_recommended,
                                                        isPremium,
                                                    });

                                                    return `Комиссия: ${commission} ₽`;
                                                };



                                                return (

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
                                                                            Создан {new Date(order.createdAt).toLocaleString()}. <div
                                                                            className="order-payment-icon-container">
                                                <span
                                                    className="payment-icon">{getPaymentIcon(order.paymentType)}</span>
                                                                            <span style={{
                                                                                fontSize: "14px",
                                                                                color: "#666"
                                                                            }}>
    {getCommissionText(order, user)}
</span>


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
                                                                                <FiAlertTriangle
                                                                                    className="mr-2 h-5 w-5"/>
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
                                                                        onClick={() => handleRequestOrder(order.id)}>
                                                                    Запросить выполнение
                                                                </button>
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
                        parentSelector={() => document.body}
                        style={{
                            overlay: {
                                zIndex: 99999,
                                position: 'fixed',
                                inset: 0,
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                backgroundColor: 'rgba(0,0,0,0.6)',
                            },
                            content: {
                                position: 'relative',
                                inset: 'auto',
                                background: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                padding: 0,
                                maxWidth: '90vw',
                                maxHeight: '90vh',
                                overflow: 'hidden',
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                            },
                        }}
                    >
                        {/* Кнопка закрытия */}
                        <button
                            onClick={closeModal}
                            style={{
                                position: 'absolute',
                                top: 10,
                                right: 10,
                                background: 'rgba(0,0,0,0.5)',
                                border: 'none',
                                borderRadius: '50%',
                                width: 36,
                                height: 36,
                                cursor: 'pointer',
                                color: '#fff',
                                fontSize: 22,
                                lineHeight: '36px',
                                textAlign: 'center',
                            }}
                        >
                            ×
                        </button>

                        {/* Кнопка "влево" */}
                        <button
                            onClick={() =>
                                setCurrentImageIndex(
                                    (prev) => (prev === 0 ? currentImages.length - 1 : prev - 1)
                                )
                            }
                            style={{
                                position: 'absolute',
                                left: 10,
                                background: 'rgba(0,0,0,0.4)',
                                border: 'none',
                                borderRadius: '50%',
                                width: 40,
                                height: 40,
                                color: '#fff',
                                fontSize: 24,
                                cursor: 'pointer',
                            }}
                        >
                            ‹
                        </button>

                        {/* Изображение */}
                        <img
                            src={`${apiUrl}${currentImages[currentImageIndex]}`}
                            alt="full"
                            style={{
                                width: '100%',
                                height: 'auto',
                                maxHeight: '90vh',
                                objectFit: 'contain',
                                borderRadius: '8px',
                                boxShadow: '0 0 12px rgba(0,0,0,0.4)',
                            }}
                        />

                        {/* Кнопка "вправо" */}
                        <button
                            onClick={() =>
                                setCurrentImageIndex(
                                    (prev) => (prev === currentImages.length - 1 ? 0 : prev + 1)
                                )
                            }
                            style={{
                                position: 'absolute',
                                right: 10,
                                background: 'rgba(0,0,0,0.4)',
                                border: 'none',
                                borderRadius: '50%',
                                width: 40,
                                height: 40,
                                color: '#fff',
                                fontSize: 24,
                                cursor: 'pointer',
                            }}
                        >
                            ›
                        </button>
                    </Modal>



                </div>
            </div>
        </div>

    )
};

export default OrdersPage;
