import React, { useContext, useEffect, useMemo, useState } from "react";
import "../styles/BottomMenu.css";
import { AuthContext } from "../utils/authContext";
import { ListTodo, Home, ClipboardList, PackagePlus, UserRound } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { socket } from "../socketClient";
import { Capacitor } from "@capacitor/core";

const BottomMenu = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useContext(AuthContext);
    const [debtCount, setDebtCount] = useState(0);

    const [requestCount, setRequestCount] = useState(0);
    const [messageCount, setMessageCount] = useState(0);

    const platform = useMemo(() => {
        const params = new URLSearchParams(window.location.search);
        const forcedPlatform = params.get("platform");

        if (forcedPlatform === "ios") return "ios";
        if (forcedPlatform === "android") return "android";
        if (forcedPlatform === "web") return "web";

        const currentPlatform = Capacitor.getPlatform();

        if (currentPlatform === "ios") return "ios";
        if (currentPlatform === "android") return "android";

        return "web";
    }, []);

    const shouldHide =
        location.pathname.startsWith("/chat") ||
        location.pathname.startsWith("/messages");

    useEffect(() => {
        if (!user?.id || shouldHide) return;

        const fetchDebt = async () => {
            try {
                const token = localStorage.getItem("authToken");
                if (!token) return;

                const res = await fetch(`${process.env.REACT_APP_API_URL}/api/orders/me/status`, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });

                const data = await res.json();
                const debt = Number(data?.debt || 0);

                setDebtCount(debt > 0 ? 1 : 0);
            } catch (e) {
                console.error("Ошибка проверки долга:", e);
            }
        };

        fetchDebt();

        if (!socket.connected) {
            socket.connect();
        }

        const subscribe = () => {
            socket.emit("register", user.id);
            socket.emit("subscribeToNotifications", user.id);
        };

        subscribe();

        socket.on("connect", subscribe);
        socket.on("reconnect", subscribe);

        const handleNewNotification = (notifications) => {
            if (!Array.isArray(notifications)) return;

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
            socket.off("connect", subscribe);
            socket.off("reconnect", subscribe);
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
        <nav className={`bottom-menu bottom-menu--${platform}`} aria-label="Нижнее меню">
            <div className="bottom-menu__shell">
                <div className="bottom-menu__notch" />

                <button
                    className={`bottom-menu__item ${isActive("/") ? "is-active" : ""}`}
                    onClick={() => navigate("/")}
                    type="button"
                    aria-label="Старт"
                >
                    <Home size={22} className="bottom-menu__icon" />
                    <span className="bottom-menu__label">Старт</span>
                </button>

                <button
                    className={`bottom-menu__item ${isActive("/orders") ? "is-active" : ""}`}
                    onClick={() => navigate("/orders")}
                    type="button"
                    aria-label="Заказы"
                >
                    <ListTodo size={22} className="bottom-menu__icon" />
                    <span className="bottom-menu__label">Заказы</span>
                </button>

                <div className="bottom-menu__spacer" aria-hidden="true" />

                <button
                    className={`bottom-menu__item ${isActive("/active-orders") ? "is-active" : ""}`}
                    onClick={handleOpenActive}
                    type="button"
                    aria-label="В работе"
                >
                <span className="bottom-menu__icon-wrap">
                    <ClipboardList size={22} className="bottom-menu__icon" />
                    {messageCount > 0 && (
                        <span className="bottom-menu__badge">{formatCount(messageCount)}</span>
                    )}
                </span>
                    <span className="bottom-menu__label">В работе</span>
                </button>

                <button
                    className={`bottom-menu__item ${isActive("/profile") ? "is-active" : ""}`}
                    onClick={() => navigate("/profile")}
                    type="button"
                    aria-label="Профиль"
                >
                    <span className="bottom-menu__icon-wrap">
    <UserRound size={22} className="bottom-menu__icon" />
                        {debtCount > 0 && (
                            <span className="bottom-menu__badge">!</span>
                        )}
</span>
                    <span className="bottom-menu__label">Профиль</span>
                </button>
            </div>

            <button
                className={`bottom-menu__center ${isActive("/my-orders") ? "is-active" : ""} ${
                    requestCount > 0 ? "has-notification" : ""
                }`}
                onClick={handleMyOrdersClick}
                type="button"
                aria-label="Мои заказы"
            >
                <span className="bottom-menu__center-shine" />
                <span className="bottom-menu__icon-wrap">
<PackagePlus size={30} className="bottom-menu__center-icon" />
                    {requestCount > 0 && (
                        <span className="bottom-menu__badge">{formatCount(requestCount)}</span>
                    )}
            </span>
            </button>
        </nav>
    );
};

export default BottomMenu;