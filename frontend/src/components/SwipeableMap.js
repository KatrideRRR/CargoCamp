import React, { useEffect, useState } from 'react';
import { YMaps, Map, Placemark } from '@pbe/react-yandex-maps';
import axios from 'axios';
import { io } from 'socket.io-client';
import { motion } from 'framer-motion';

const apiUrl = process.env.REACT_APP_API_URL;
const socket = io(process.env.REACT_APP_SOCKET_URL, {
    transports: ['websocket'],
    withCredentials: true,
});

const SwipeableMap = () => {
    const [orders, setOrders] = useState([]);
    const [location, setLocation] = useState({ latitude: 44.9572, longitude: 34.1108 });
    const [setManualLocation] = useState({ latitude: '', longitude: '' });
    const [isManualInput, setIsManualInput] = useState(false);
    const [address, setAddress] = useState('');

    // Загрузка заказов
    const fetchOrders = async (filter) => {
        try {
            const response = await axios.get(`${apiUrl}/api/orders/all`, {
                params: { status: 'pending',
                    ...filter, // сюда попадают категории, тип и т.д.
                },
            });
            const ordersWithCoordinates = response.data.filter(order => order.coordinates);
            setOrders(ordersWithCoordinates);
        } catch (error) {
            console.error('Ошибка загрузки заказов:', error);
        }
    };

    // Геокодинг
    const geocodeAddress = async (address) => {
        try {
            const response = await axios.get('https://geocode-maps.yandex.ru/1.x/', {
                params: {
                    geocode: address,
                    format: 'json',
                    apikey: 'bf97867b-5ffb-4fc4-9fd5-8997874b300e',
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
        fetchOrders();

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                setLocation({ latitude, longitude });
            },
            (error) => {
                if (error.code === error.PERMISSION_DENIED) {
                    console.warn('Геолокация отклонена пользователем');
                    setIsManualInput(true);
                } else {
                    console.error('Ошибка геолокации:', error);
                }
            }
        );

        socket.on('orderUpdated', () => {
            console.log('Обновление заказов через WebSocket');
            fetchOrders();
        });

        return () => {
            socket.off('orderUpdated');
        };
    }, []);

    const handleAddressChange = (e) => {
        setAddress(e.target.value);
    };

    const handleAddressSubmit = () => {
        if (address) {
            geocodeAddress(address);
            setIsManualInput(false);
        } else {
            alert('Пожалуйста, введите адрес');
        }
    };

    return (
        <div>
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

            <YMaps query={{ apikey: 'bf97867b-5ffb-4fc4-9fd5-8997874b300e' }}>
                <motion.div
                    style={{ width: '100%', height: '55vh' }}
                    layout
                    initial={{ y: 0 }}
                    animate={{ y: 0 }}
                    exit={{ y: '100%' }}
                    transition={{ type: 'spring', stiffness: 300 }}
                >
                    <Map
                        defaultState={{
                            center: location ? [location.latitude, location.longitude] : [44.9572, 34.1108],
                            zoom: 10,
                        }}
                        style={{ width: '100%', height: '100%' }}
                        modules={['geoObject.addon.balloon']}
                    >
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

                        {orders.map((order, index) => {
                            const coordinates = order.coordinates?.split(',').map(Number);
                            if (!coordinates || coordinates.length !== 2) return null;

                            return (
                                <Placemark
                                    key={index}
                                    geometry={coordinates}
                                    properties={{
                                        hintContent: `Заказ #${order.id}`,
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
                                        preset: 'islands#dotIcon',
                                        iconColor: '#007AFF',
                                        openBalloonOnClick: true,
                                    }}
                                />
                            );
                        })}
                    </Map>
                </motion.div>
            </YMaps>
        </div>
    );
};

export default SwipeableMap;
