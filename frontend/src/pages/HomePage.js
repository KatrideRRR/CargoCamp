import React, { useEffect, useState } from 'react';
import { YMaps, Map, Placemark } from '@pbe/react-yandex-maps';
import axios from 'axios';
import { io } from 'socket.io-client';
const apiUrl = process.env.REACT_APP_API_URL;

const socket = io(process.env.REACT_APP_SOCKET_URL);

const HomePage = () => {
    const [orders, setOrders] = useState([]); // Список заказов

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

        // Подписываемся на обновления заказов через WebSocket
        socket.on('orderUpdated', () => {
            console.log('Обновление заказов через WebSocket');
            fetchOrders(); // Перезагружаем список заказов
        });

        return () => {
            socket.off('orderUpdated'); // Очищаем подписку при размонтировании
        };
    }, []);

    return (
        <YMaps query={{ apikey: "bf97867b-5ffb-4fc4-9fd5-8997874b300e" }}>
            <div style={{ width: '100%', height: '100vh' }}>
                <Map
                    defaultState={{ center: [44.9572, 34.1108], zoom: 10 }}
                    style={{ width: '100%', height: '100%' }}
                    modules={['geoObject.addon.balloon']} // Подключение модуля для балунов
                >
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
                                    preset: 'islands#dotIcon', // Устанавливаем стиль
                                    iconColor: '#007AFF', // Цвет маркера
                                    openBalloonOnClick: true, // Активируем балуны
                                }}
                            />
                        );
                    })}
                </Map>
            </div>
        </YMaps>
    );
};

export default HomePage;