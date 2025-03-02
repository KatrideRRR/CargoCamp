import React, { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, List, BellRing, Briefcase } from 'lucide-react';
import '../styles/BottomMenu.css';
import io from 'socket.io-client';
import { AuthContext } from "../utils/authContext";

const socket = io(process.env.REACT_APP_SOCKET_URL);

const BottomMenu = () => {
    const navigate = useNavigate();
    const [hasNewRequests, setHasNewRequests] = useState(false);
    const { user } = useContext(AuthContext);

    useEffect(() => {
        socket.connect();

        if (user?.id) {
            const eventName = `orderRequest:${user.id}`;
            console.log(`🔍 Подписка на WebSocket-событие: ${eventName}`);

            socket.on(eventName, (data) => {
                console.log("🔥 Получено уведомление о заказе:", data);
                setHasNewRequests(true);
            });

            return () => {
                socket.off(eventName);
                console.log(`❌ Отписка от события: ${eventName}`);
            };
        }
    }, [user]);


    const handleMyOrdersClick = () => {
        navigate(`/my-orders/${user.id}`);
        setHasNewRequests(false); // Сбрасываем уведомление
    };

    return (
        <div className="bottom-menu">
            <button className="menu-item menu-left" onClick={() => navigate('/orders')}>
                <List size={20} className="menu-icon" />
                Заказы
            </button>

            <button
                className={`menu-item menu-center ${hasNewRequests ? 'new-request' : ''}`}
                onClick={handleMyOrdersClick}
            >
                {hasNewRequests ? (
                    <BellRing size={28} className="menu-icon-alert" />
                ) : (
                    <Briefcase size={28} className="menu-icon-normal" />
                )}
            </button>

            <button className="menu-item menu-right" onClick={() => navigate('/active-orders')}>
                <ClipboardList size={20} className="menu-icon" />
                Активные
            </button>
        </div>
    );
};

export default BottomMenu;
