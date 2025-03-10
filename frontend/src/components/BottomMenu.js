import React, { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, List, BellRing } from 'lucide-react';
import '../styles/BottomMenu.css';
import io from 'socket.io-client';
import { AuthContext } from "../utils/authContext";

const socket = io(process.env.REACT_APP_SOCKET_URL);

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

        // Получение новых уведомлений
        socket.on('new_notification', (count) => {
            // Обновить состояние для кнопки "Активные"
            console.log("Новые уведомления:", count);
            setHasNewMessage(count > 0);  // Если уведомлений больше 0, показываем индикатор
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
        socket.emit('markAsRead', { userId: user.id });
        setHasNewMessage(false);  // Сбрасываем индикатор новых сообщений
        navigate('/active-orders'); // Навигация на страницу активных заказов
    };

    return (
        <div className="bottom-menu">
            <button className="menu-item menu-left" onClick={() => navigate('/orders')}>
                <List size={20} className="menu-icon"/>
                Заказы
            </button>

            <button
                className={`menu-item menu-center ${hasNewRequests ? 'new-request' : ''}`}
                onClick={handleMyOrdersClick}
            >
                {hasNewRequests ? (
                    <BellRing size={28} className="menu-icon-alert"/>
                ) : (
                    <List size={28} className="menu-icon-normal"/>
                )}
            </button>

            {/* Ваша кнопка с уведомлением и навигацией */}
            <button
                className={`menu-item menu-right ${hasNewMessage ? 'new-message' : ''}`}
                onClick={handleOpenActive}
            >
                <ClipboardList size={20} className="menu-icon" />
                Активные {hasNewMessage && <span className="dot"></span>}
            </button>


        </div>
    );
};

export default BottomMenu;
