import React, {
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import "../styles/BottomMenu.css";
import { AuthContext } from "../utils/authContext";
import { ListTodo, Home, ClipboardList, PackagePlus, UserRound } from "lucide-react";
import { useNavigate, useLocation } from "react-router-dom";
import { socket } from "../socketClient";
import { Capacitor } from "@capacitor/core";
import axiosInstance from "../utils/axiosInstance";

const BottomMenu = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { user } = useContext(AuthContext);
    const [debtCount, setDebtCount] = useState(0);

    const [requestCount, setRequestCount] = useState(0);
    const [messageCount, setMessageCount] = useState(0);

    /*
 * Храним ID непрочитанных сообщений.
 * Это защищает счётчик от повторной
 * доставки одного уведомления.
 */
    const unreadMessageIdsRef = useRef(new Set());
    const unreadRequestIdsRef = useRef(new Set());

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
        unreadMessageIdsRef.current = new Set();
        unreadRequestIdsRef.current = new Set();

        setMessageCount(0);
        setRequestCount(0);
        setDebtCount(0);

        if (!user?.id) return;

        const fetchDebt = async () => {
            try {
                const token = localStorage.getItem("authToken");
                if (!token) return;

                const res = await fetch(`${process.env.REACT_APP_API_URL}/api/orders/me/status`, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                });

                if (!res.ok) {
                    throw new Error(
                        `Debt request failed: ${res.status}`
                    );
                }

                const data = await res.json();
                const rawDebt = data?.debt;
                const debt = Number(rawDebt);

                if (
                    rawDebt == null ||
                    rawDebt === "" ||
                    !Number.isSafeInteger(debt) ||
                    debt < 0
                ) {
                    throw new Error(
                        "Некорректная сумма задолженности"
                    );
                }

                setDebtCount(debt > 0 ? 1 : 0);
            } catch (e) {
                console.error("Ошибка проверки долга:", e);
            }
        };

        fetchDebt();

        const handleDebtRefresh = () => {
            void fetchDebt();
        };

        const handleVisibility = () => {
            if (!document.hidden) {
                void fetchDebt();
            }
        };

        window.addEventListener(
            "focus",
            handleDebtRefresh
        );

        window.addEventListener(
            "cargocamp:debt-updated",
            handleDebtRefresh
        );

        document.addEventListener(
            "visibilitychange",
            handleVisibility
        );

        socket.on(
            "activeOrdersUpdated",
            handleDebtRefresh
        );

        const subscribe = () => {
            socket.emit("register", user.id);
            socket.emit("subscribeToNotifications", user.id);
        };

        const getNotificationId = (item) => {
            const id =
                item?.id ??
                item?.notificationId ??
                item?.data?.notificationId;

            return id == null ? null : String(id);
        };

        const applyNotification = (item) => {
            const id = getNotificationId(item);

            if (!id) return;

            const isRead =
                item.isRead === true ||
                item.isRead === 1 ||
                item.isRead === "1";

            if (item.type === "new_message") {
                if (isRead) {
                    unreadMessageIdsRef.current.delete(id);
                } else {
                    unreadMessageIdsRef.current.add(id);
                }
            }

            if (
                item.type === "order_request" &&
                item.title !== "Бронирование отменено"
            ) {
                if (isRead) {
                    unreadRequestIdsRef.current.delete(id);
                } else {
                    unreadRequestIdsRef.current.add(id);
                }
            }
        };

        const handleNewNotification = (payload) => {
            if (Array.isArray(payload)) {
                unreadMessageIdsRef.current = new Set();
                unreadRequestIdsRef.current = new Set();

                payload.forEach(applyNotification);
            } else if (payload) {
                applyNotification(payload);
            }

            setMessageCount(
                unreadMessageIdsRef.current.size
            );

            setRequestCount(
                unreadRequestIdsRef.current.size
            );
        };

        socket.on(
            "new_notification",
            handleNewNotification
        );

        socket.on("connect", subscribe);

        subscribe();

        return () => {
            window.removeEventListener(
                "focus",
                handleDebtRefresh
            );

            window.removeEventListener(
                "cargocamp:debt-updated",
                handleDebtRefresh
            );

            document.removeEventListener(
                "visibilitychange",
                handleVisibility
            );

            socket.off(
                "activeOrdersUpdated",
                handleDebtRefresh
            );

            socket.off(
                "connect",
                subscribe
            );

            socket.off(
                "new_notification",
                handleNewNotification
            );
        };
    }, [user?.id]);

    useEffect(() => {
        if (!user?.id) return;

        const myOrdersPath =
            `/my-orders/${user.id}`;

        if (
            location.pathname !== myOrdersPath &&
            !location.pathname.startsWith(
                `${myOrdersPath}/`
            )
        ) {
            return;
        }

        if (requestCount === 0) return;

        const markRequestsAsRead = async () => {
            try {
                await axiosInstance.post(
                    "/orders/notifications/read-requests"
                );
            } catch (error) {
                console.error(
                    "Ошибка прочтения откликов:",
                    error.response?.status ||
                    error.message
                );
            }
        };

        void markRequestsAsRead();
    }, [
        user?.id,
        location.pathname,
        requestCount,
    ]);

    const isActive = (path) => {
        return location.pathname === path || location.pathname.startsWith(path + "/");
    };

    const handleMyOrdersClick = () => {
        if (!user?.id) return;

        navigate(`/my-orders/${user.id}`);
    };

    const handleOpenActive = () => {
        if (!user?.id) return;

        navigate("/active-orders");
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
                    onClick={() =>
                        navigate(
                            debtCount > 0
                                ? "/profile?section=debt"
                                : "/profile"
                        )
                    }
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