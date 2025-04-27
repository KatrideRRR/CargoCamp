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
    const { user } = useContext(AuthContext);
    const [requestCount, setRequestCount] = useState(0);
    const [messageCount, setMessageCount] = useState(0);

    useEffect(() => {
        if (!user?.id) return;

        socket.connect();

        console.log('Подписка на уведомления, userId:', user.id);
        socket.emit('subscribeToNotifications', user.id);

        socket.on('new_notification', (message) => {
            console.log("✉️ Новое сообщение:", message);
            setMessageCount(prev => prev + 1);
        });

        const orderRequestEvent = `orderRequest:${user.id}`;
        console.log(`🔍 Подписка на запросы: ${orderRequestEvent}`);

        socket.on(orderRequestEvent, (data) => {
            console.log("🔥 Новый запрос на заказ:", data);
            setRequestCount(prev => prev + 1);
        });

        return () => {
            socket.off('new_notification');
            socket.off(orderRequestEvent);
        };
    }, [user]);

    const handleMyOrdersClick = () => {
        navigate(`/my-orders/${user.id}`);
        setRequestCount(0); // Сбрасываем счетчик запросов
    };

    const handleOpenActive = () => {
        navigate('/active-orders');
        setMessageCount(0); // Сбрасываем счетчик сообщений
    };

    const formatCount = (count) => {
        if (count > 9) return '9+';
        return count;
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

            <button className="menu-item menu-center" onClick={handleMyOrdersClick}>
                <div className="icon-wrapper">
                    <ArrowUpCircle size={34} className="menu-icon-center"/>
                    {requestCount > 0 && (
                        <span className="notification-badge">{formatCount(requestCount)}</span>
                    )}
                </div>
            </button>

            <button className="menu-item menu-right" onClick={handleOpenActive}>
                <div className="icon-wrapper">
                    <ClipboardList size={24} className="menu-icon"/>
                    {messageCount > 0 && (
                        <span className="notification-badge">{formatCount(messageCount)}</span>
                    )}
                </div>
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
