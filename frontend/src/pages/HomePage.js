import React, { useEffect, useState } from 'react';
import { YMaps, Map, Placemark } from '@pbe/react-yandex-maps';
import axios from 'axios';
import { io } from 'socket.io-client';
const apiUrl = process.env.REACT_APP_API_URL;

const socket = io(process.env.REACT_APP_SOCKET_URL);

const HomePage = () => {
    const [orders, setOrders] = useState([]); // Список заказов
    const [location, setLocation] = useState(null); // Местоположение пользователя
    const [manualLocation, setManualLocation] = useState({ latitude: '', longitude: '' }); // Введенные вручную координаты
    const [isManualInput, setIsManualInput] = useState(false); // Флаг для отображения формы ввода

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

    // Обработчик изменения координат, введенных вручную
    const handleManualLocationChange = (e) => {
        const { name, value } = e.target;
        setManualLocation((prevLocation) => ({
            ...prevLocation,
            [name]: value,
        }));
    };

    // Обработчик отправки формы
    const handleManualLocationSubmit = () => {
        const { latitude, longitude } = manualLocation;
        if (latitude && longitude) {
            setLocation({
                latitude: parseFloat(latitude),
                longitude: parseFloat(longitude),
            });
            setIsManualInput(false); // Скрываем форму ввода после отправки
        } else {
            alert('Пожалуйста, введите правильные координаты.');
        }
    };

    return (
        <div>
            {/* Форма для ввода координат вручную */}
            {isManualInput && (
                <div>
                    <h3>Введите ваше местоположение вручную:</h3>
                    <input
                        type="text"
                        name="latitude"
                        placeholder="Широта"
                        value={manualLocation.latitude}
                        onChange={handleManualLocationChange}
                    />
                    <input
                        type="text"
                        name="longitude"
                        placeholder="Долгота"
                        value={manualLocation.longitude}
                        onChange={handleManualLocationChange}
                    />
                    <button onClick={handleManualLocationSubmit}>Подтвердить</button>
                </div>
            )}

            <YMaps query={{ apikey: "bf97867b-5ffb-4fc4-9fd5-8997874b300e" }}>
                <div style={{ width: '100%', height: '100vh' }}>
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
