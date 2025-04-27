import React, { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import '../styles/BottomMenu.css';
import io from 'socket.io-client';
import { AuthContext } from "../utils/authContext";
import { ListTodo, Home, ClipboardList, ArrowUpCircle, UserRound } from 'lucide-react';

const socket = io(process.env.REACT_APP_SOCKET_URL, {
    transports: ['websocket'],
    withCredentials: true
});

const BottomMenu = () => {
    const navigate = useNavigate();
    const [hasNewRequests, setHasNewRequests] = useState(false);
    const { user } = useContext(AuthContext);
    const [hasNewMessage, setHasNewMessage] = useState(false);

    useEffect(() => {
        if (!user?.id) return;

        // Подключаемся к WebSocket
        socket.connect();

        // Подписка на уведомления
        console.log('Подписка на уведомления, userId:', user.id);
        socket.emit('subscribeToNotifications', user.id);

        socket.on(`notifications_${user.id}`, (notifications) => {
            console.log("🔔 Уведомления через комнату:", notifications);
            setHasNewMessage(notifications.length > 0);
        });

        // Получение новых уведомлений
        socket.on('new_notification', (notifications) => {
            console.log("Новые уведомления:", notifications);
            setHasNewMessage(notifications.length > 0);  // Проверяем длину массива
        });


        // Подписка на запросы на заказ
        const eventName = `orderRequest:${user.id}`;
        console.log(`🔍 Подписка на WebSocket-событие: ${eventName}`);

        socket.on(eventName, (data) => {
            console.log("🔥 Получено уведомление о заказе:", data);
            setHasNewRequests(true);
        });

        // Очистка при размонтировании
        return () => {
            socket.off(eventName);
            socket.off('new_notification');
        };
    }, [user]);

    const handleMyOrdersClick = () => {
        navigate(`/my-orders/${user.id}`);
        setHasNewRequests(false); // Сбрасываем уведомление
    };

    const handleOpenActive = () => {
        // Отмечаем уведомления как прочитанные
        navigate('/active-orders'); // Навигация на страницу активных заказов
    };

    return (
        <div className="bottom-menu">
            <button className="navbar-item navbar-home" onClick={() => navigate('/')}>
                <Home size={24} className="menu-icon"/>
                <span className="menu-label">Старт</span>
            </button>

            <button className="menu-item menu-left" onClick={() => navigate('/orders')}>
                <ListTodo size={24} className="menu-icon"/>
                <span className="menu-label">Заказы</span>
            </button>

            <button className={`menu-item menu-center ${hasNewRequests ? 'new-request' : ''}`}
                    onClick={handleMyOrdersClick}>
                <ArrowUpCircle size={34} className="menu-icon-center"/>
            </button>

            <button className={`menu-item menu-right ${hasNewMessage ? 'new-message' : ''}`} onClick={handleOpenActive}>
                <ClipboardList size={24} className="menu-icon"/>
                <span className="menu-label">Активные</span>
            </button>

            <button className="navbar-item navbar-profile" onClick={() => navigate('/profile')}>
                <UserRound size={24} className="menu-icon"/>
                <span className="menu-label">Профиль</span>
            </button>
        </div>

    );
};

export default BottomMenu;
