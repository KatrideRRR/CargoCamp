import React, { useEffect, useState } from 'react';
import { YMaps, Map, Placemark } from '@pbe/react-yandex-maps';
import axios from 'axios';
import { io } from 'socket.io-client';
import '../styles/HomePage.css';

const apiUrl = process.env.REACT_APP_API_URL;
const socket = io(process.env.REACT_APP_SOCKET_URL, {
    transports: ['websocket'],
    withCredentials: true
});

const HomePage = () => {
    const [orders, setOrders] = useState([]); // Список заказов
    const [location, setLocation] = useState(null); // Местоположение пользователя
    const [ setManualLocation] = useState({ latitude: '', longitude: '' }); // Введенные вручную координаты
    const [isManualInput, setIsManualInput] = useState(false); // Флаг для отображения формы ввода
    const [address, setAddress] = useState(''); // Введённый адрес

    // Функция загрузки заказов
    const fetchOrders = async () => {
        try {
            const response = await axios.get(`${apiUrl}/api/orders/all`, {
                params: { status: 'pending' },
            });
            const ordersWithCoordinates = response.data.filter(order => order.coordinates);
            setOrders(ordersWithCoordinates);
        } catch (error) {
            console.error('Ошибка загрузки заказов:', error);
        }
    };

    // Функция геокодирования (получение координат по адресу)
    const geocodeAddress = async (address) => {
        try {
            const response = await axios.get('https://geocode-maps.yandex.ru/1.x/', {
                params: {
                    geocode: address,
                    format: 'json',
                    apikey: 'bf97867b-5ffb-4fc4-9fd5-8997874b300e', // Вставьте свой API ключ от Яндекс
                },
            });

            const geoObject = response.data.response.GeoObjectCollection.featureMember[0];
            if (geoObject) {
                const coordinates = geoObject.GeoObject.Point.pos.split(' ');
                const latitude = parseFloat(coordinates[1]);
                const longitude = parseFloat(coordinates[0]);
                setManualLocation({ latitude, longitude });
                setLocation({ latitude, longitude });
            } else {
                alert('Не удалось найти местоположение по этому адресу');
            }
        } catch (error) {
            console.error('Ошибка геокодирования:', error);
        }
    };

    useEffect(() => {
        fetchOrders(); // Загружаем заказы при старте

        // Запрос геолокации
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                setLocation({ latitude, longitude });
            },
            (error) => {
                if (error.code === error.PERMISSION_DENIED) {
                    console.error('Пользователь отклонил доступ к геолокации.');
                    setIsManualInput(true); // Показываем форму для ввода местоположения вручную
                } else {
                    console.error('Ошибка получения геолокации', error);
                }
            }
        );

        // Подписка на обновления заказов через WebSocket
        socket.on('orderUpdated', () => {
            console.log('Обновление заказов через WebSocket');
            fetchOrders(); // Перезагружаем список заказов
        });

        return () => {
            socket.off('orderUpdated'); // Очищаем подписку при размонтировании
        };
    }, []);

    // Обработчик изменения введённого адреса
    const handleAddressChange = (e) => {
        setAddress(e.target.value);
    };

    // Обработчик отправки формы с адресом
    const handleAddressSubmit = () => {
        if (address) {
            geocodeAddress(address); // Запускаем геокодирование по введённому адресу
            setIsManualInput(false); // Скрываем форму после отправки
        } else {
            alert('Пожалуйста, введите адрес');
        }
    };


    return (
        <div>
            {/* Форма для ввода адреса вручную */}
            {isManualInput && (
                <div className="address-container">
                    <h3 className="address-title">Введите ваш адрес:</h3>
                    <input
                        className="address-input"
                        type="text"
                        placeholder="Введите адрес"
                        value={address}
                        onChange={handleAddressChange}
                    />
                    <button className="address-button" onClick={handleAddressSubmit}>
                        Найти местоположение
                    </button>
                </div>

            )}


            <YMaps query={{apikey: "bf97867b-5ffb-4fc4-9fd5-8997874b300e"}}>
                <div style={{width: '100%', height: '100vh'}}>
                    <Map
                        defaultState={{
                            center: location ? [location.latitude, location.longitude] : [44.9572, 34.1108], // Центр карты по местоположению
                            zoom: 10,
                        }}
                        style={{ width: '100%', height: '100%' }}
                        modules={['geoObject.addon.balloon']} // Подключение модуля для балунов
                    >
                        {/* Маркер на карте */}
                        {location && (
                            <Placemark
                                geometry={[location.latitude, location.longitude]}
                                properties={{
                                    hintContent: 'Ваше местоположение',
                                    balloonContent: 'Вы находитесь здесь',
                                }}
                                options={{
                                    preset: 'islands#redCircleIcon',
                                    iconColor: 'rgba(0,100,251,0.85)',
                                }}
                            />
                        )}

                        {/* Отображение заказов на карте */}
                        {orders.map((order, index) => {
                            const coordinates = order.coordinates?.split(',').map(Number); // Проверка координат
                            if (!coordinates || coordinates.length !== 2) return null;

                            return (
                                <Placemark
                                    key={index}
                                    geometry={coordinates} // Устанавливаем координаты
                                    properties={{
                                        hintContent: `Заказ #${order.id}`, // Подсказка
                                        balloonContent: `
                      <div style="font-size: 14px;">
                                            <p><strong>Тип заказа:</strong> ${order.type || 'Не указан'}</p>
                                            <p><strong>Сумма:</strong> ${order.proposedSum || 'Не указана'} ₽</p>
                                            <button 
                                                onclick="window.location.href='/order/${order.id}'" 
                                                style="background-color: #007AFF; color: white; border: none; padding: 5px 10px; cursor: pointer; margin-top: 5px;"
                                            >
                                                Перейти
                                            </button>

                                        </div>
                    `,
                                    }}
                                    options={{
                                        preset: 'islands#dotIcon', // Стиль маркера
                                        iconColor: '#007AFF', // Цвет маркера
                                        openBalloonOnClick: true, // Активируем балуны
                                    }}
                                />
                            );
                        })}
                    </Map>
                </div>
            </YMaps>
        </div>
    );
};

export default HomePage;
