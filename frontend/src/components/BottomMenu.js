import React, { useContext, useEffect, useState } from "react";
import "../styles/BottomMenu.css";
import { AuthContext } from "../utils/authContext";
import { ListTodo, Home, ClipboardList, ArrowUpCircle, UserRound } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { socket } from "../socketClient";

const BottomMenu = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useContext(AuthContext);

    const [requestCount, setRequestCount] = useState(0);
    const [messageCount, setMessageCount] = useState(0);

    const shouldHide =
        location.pathname.startsWith("/chat") ||
        location.pathname.startsWith("/messages");

    useEffect(() => {
        if (!user?.id || shouldHide) return;

        if (!socket.connected) {
            socket.connect();
        }

        socket.emit("register", user.id);
        socket.emit("subscribeToNotifications", user.id);

        const handleNewNotification = (notifications) => {
            if (!Array.isArray(notifications)) {
                return;
            }

            const unreadMessageNotifications = notifications.filter(
                (item) => item?.type === "new_message"
            );

            setMessageCount(unreadMessageNotifications.length);
        };

        const orderRequestEvent = `orderRequest:${user.id}`;

        const handleOrderRequest = () => {
            setRequestCount((prev) => prev + 1);
        };

        socket.on("new_notification", handleNewNotification);
        socket.on(orderRequestEvent, handleOrderRequest);

        return () => {
            socket.off("new_notification", handleNewNotification);
            socket.off(orderRequestEvent, handleOrderRequest);
        };
    }, [user?.id, shouldHide]);

    const isActive = (path) => {
        return location.pathname === path || location.pathname.startsWith(path + "/");
    };

    const handleMyOrdersClick = () => {
        if (!user?.id) return;
        navigate(`/my-orders/${user.id}`);
        setRequestCount(0);
    };

    const handleOpenActive = () => {
        navigate("/active-orders");
        setMessageCount(0);
    };

    const formatCount = (count) => {
        if (count > 9) return "9+";
        return count;
    };

    if (shouldHide) {
        return null;
    }

    return (
        <div className="bottom-menu">
            <button
                className={`navbar-item navbar-home ${isActive("/") ? "is-active" : ""}`}
                onClick={() => navigate("/")}
                type="button"
            >
                <Home size={24} className="menu-icon" />
                <span className="menu-label">Старт</span>
            </button>

            <button
                className={`menu-item menu-left ${isActive("/orders") ? "is-active" : ""}`}
                onClick={() => navigate("/orders")}
                type="button"
            >
                <ListTodo size={24} className="menu-icon" />
                <span className="menu-label">Заказы</span>
            </button>

            <button
                className={`menu-item menu-center ${
                    isActive("/my-orders") ? "is-active" : ""
                } ${requestCount > 0 ? "new-request" : ""}`}
                onClick={handleMyOrdersClick}
                type="button"
            >
                <div className="icon-wrapper">
                    <ArrowUpCircle size={34} className="menu-icon-center" />
                    {requestCount > 0 && (
                        <span className="notification-badge">{formatCount(requestCount)}</span>
                    )}
                </div>
            </button>

            <button
                className={`menu-item menu-right ${isActive("/active-orders") ? "is-active" : ""}`}
                onClick={handleOpenActive}
                type="button"
            >
                <div className="icon-wrapper">
                    <ClipboardList size={24} className="menu-icon" />
                    {messageCount > 0 && (
                        <span className="notification-badge">{formatCount(messageCount)}</span>
                    )}
                </div>
                <span className="menu-label">Активные</span>
            </button>

            <button
                className={`navbar-item navbar-profile ${isActive("/profile") ? "is-active" : ""}`}
                onClick={() => navigate("/profile")}
                type="button"
            >
                <UserRound size={24} className="menu-icon" />
                <span className="menu-label">Профиль</span>
            </button>
        </div>
    );
};

export default BottomMenu;