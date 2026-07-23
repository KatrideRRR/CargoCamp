import React, { Suspense, lazy, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import Modal from "react-modal";
import { useAuth } from "./utils/authContext";
import {
    initPushNotifications,
    consumePendingPushNavigation,
} from "./utils/pushNotifications";
import PullToRefresh from "./components/PullToRefresh";
import { socket, connectSocket } from "./socketClient";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import { runAppVersionMigration } from "./utils/appVersionMigration";

import { AuthProvider } from "./utils/authContext";
import { UserProvider } from './utils/userContext';
import { ModalProvider } from './components/modalContext';

import "./styles/global.css";

Modal.setAppElement('#root');

const OrdersPage = lazy(() => import('./pages/OrdersPage'));
const CreateOrderPage = lazy(() => import('./pages/CreateOrderPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const RegisterPage = lazy(() => import('./pages/RegisterPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const ActiveOrdersPage = lazy(() => import('./pages/ActiveOrdersPage'));
const BottomMenu = lazy(() => import('./components/BottomMenu'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const UserReviewsPage = lazy(() => import('./pages/UserReviewsPage'));
const OrderHistoryPage = lazy(() => import('./pages/OrderHistoryPage'));
const OrderPage = lazy(() => import('./pages/OrderPage'));
const UserOrdersPage = lazy(() => import('./pages/UserOrdersPage'));
const MyOrdersPage = lazy(() => import('./pages/MyOrdersPage'));
const StartPage = lazy(() => import('./pages/StartPage'));
const CreateExpressOrder = lazy(() => import('./pages/CreateExpressOrder'));
const ServiceInfoPage = lazy(() => import('./pages/ServiceInfoPage'));
const InfoPage = lazy(() => import('./pages/InfoPage'));
const SupportChatPage = React.lazy(() => import("./pages/SupportChatPage"));

function SocketBootstrap() {
    const { user } = useAuth();

    useEffect(() => {
        if (!user?.id) return;

        connectSocket(user.id);
    }, [user?.id]);

    return null;
}

function PushBootstrap() {
    const { user } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        const token = localStorage.getItem("authToken");

        if (!token) {
            return;
        }

        /*
          Если пользователь уже есть — инициализируем пуши нормально.
          Если user ещё не успел загрузиться, pending push всё равно можно попробовать обработать,
          потому что userId можно достать из JWT внутри pushNotifications.js.
        */

        if (user?.id) {
            initPushNotifications({ navigate, userId: user.id }).catch((e) => {
                console.error("initPushNotifications error:", e);
            });
        }

        consumePendingPushNavigation(navigate);
    }, [user?.id, navigate]);

    return null;
}

function App() {
    const navigate = useNavigate();
    const shownToastKeysRef = useRef(new Map());

    const getOrderTargetPath = (payload = {}) => {
        const type = payload.type || payload?.data?.type;
        const orderType = payload.orderType || payload?.data?.orderType;
        const orderId =
            payload.orderId ||
            payload.expressOrderId ||
            payload.expressId ||
            payload?.data?.orderId ||
            payload?.data?.expressOrderId ||
            payload?.data?.expressId;

        if (!orderId) return null;

        const isExpress =
            orderType === "express" ||
            type === "express_available_nearby" ||
            type === "express_status_changed" ||
            type === "express_arrived" ||
            type === "express_completed" ||
            type === "express_cancelled" ||
            String(payload.expressType || payload?.data?.expressType || "").length > 0;

        return isExpress ? `/express-order/${orderId}` : `/order/${orderId}`;
    };

    useEffect(() => {
        const handlePush = (payload) => {
            if (!payload) return;

            const type = payload.type || payload?.data?.type;

            const isOrderPush =
                type === "order_push" ||
                type === "express_available_nearby";

            if (!isOrderPush) return;

            const orderType =
                payload.orderType ||
                payload?.data?.orderType ||
                (type === "express_available_nearby" ? "express" : "regular");

            const orderId =
                payload.orderId ||
                payload.expressOrderId ||
                payload.expressId ||
                payload?.data?.orderId ||
                payload?.data?.expressOrderId ||
                payload?.data?.expressId;

            const open = window.confirm(
                `${payload.title || "Уведомление"}\n${payload.message || payload.body || ""}\nОткрыть заказ?`
            );

            if (!open || !orderId) return;

            if (orderType === "express") {
                navigate(`/express-order/${orderId}`);
                return;
            }

            navigate(`/order/${orderId}`);
        };

        socket.on("push_notification", handlePush);

        return () => {
            socket.off("push_notification", handlePush);
        };
    }, [navigate]);

    useEffect(() => {
        const handleExpressNearby = (payload) => {
            const text =
                payload?.body ||
                payload?.message ||
                "Рядом появился новый экспресс-заказ";

            const targetPath = getOrderTargetPath({
                ...payload,
                type: payload?.type || "express_available_nearby",
                orderType: "express",
            });

            const open = window.confirm(
                `${payload?.title || "Новый экспресс-заказ"}\n${text}\nОткрыть заказ?`
            );

            if (open && targetPath) {
                navigate(targetPath);
                return;
            }

            if (open) {
                navigate("/orders");
            }
        };

        socket.on("expressOrderNearby", handleExpressNearby);

        return () => {
            socket.off("expressOrderNearby", handleExpressNearby);
        };
    }, [navigate]);

    const getNotificationId = (n) => {
        return n?.id || n?.data?.notificationId || null;
    };

    const getNotificationCreatedAtMs = (n) => {
        const raw =
            n?.createdAt ||
            n?.created_at ||
            n?.data?.createdAt ||
            n?.data?.created_at;

        if (!raw) return null;

        const ts = new Date(raw).getTime();

        return Number.isFinite(ts) ? ts : null;
    };

    const isFreshNotification = (n, maxAgeMs = 2 * 60 * 1000) => {
        const createdAtMs = getNotificationCreatedAtMs(n);

        // Если даты нет, лучше не показывать toast как "новый",
        // иначе старые события без createdAt будут всплывать бесконечно.
        if (!createdAtMs) return false;

        return Date.now() - createdAtMs <= maxAgeMs;
    };

    const wasToastShown = (notificationId) => {
        if (!notificationId) return false;

        return localStorage.getItem(`toast_shown_notification_${notificationId}`) === "1";
    };

    const markToastShown = (notificationId) => {
        if (!notificationId) return;

        localStorage.setItem(`toast_shown_notification_${notificationId}`, "1");
    };

    useEffect(() => {
        const handleNewNotification = (notifications = []) => {
            const list = Array.isArray(notifications) ? notifications : [notifications];

            if (!list.length) return;

            const freshList = list.filter((n) => {
                if (!n?.id && !n?.data?.notificationId) return false;

                const type = n.type || n?.data?.type;

                // express_available_nearby обрабатывается отдельно
                if (type === "express_available_nearby") return false;

                // express_cancelled у тебя уже обрабатывается в ModalProvider.
                // Здесь обычный верхний toast для него не показываем,
                // иначе и появляется старый баннер "Экспресс-заказ отменён".
                if (type === "express_cancelled") return false;

                // Не показываем уже прочитанные уведомления как новые
                if (n.isRead === true) return false;

                // Не показываем старые уведомления
                if (!isFreshNotification(n)) return false;

                const notificationId = getNotificationId(n);

                if (wasToastShown(notificationId)) return false;

                return true;
            });

            if (!freshList.length) return;

            const latest = freshList[0];
            const notificationId = getNotificationId(latest);

            const latestData = latest.data || {};

            const dedupeKey = [
                latest.type || latestData.type || "unknown",
                latest.orderType || latestData.orderType || "regular",
                latest.orderId || latestData.orderId || latestData.expressOrderId || "",
                latestData.status || latest.status || "",
            ].join(":");

            const now = Date.now();
            const lastShownAt = shownToastKeysRef.current.get(dedupeKey);

            if (lastShownAt && now - lastShownAt < 7000) {
                return;
            }

            shownToastKeysRef.current.set(dedupeKey, now);
            markToastShown(notificationId);

            const title = latest.title || "Новое уведомление";
            const body = latest.body || "";

            const type = latest.type || latestData.type;
            const orderId = latest.orderId || latestData.orderId;
            const orderType = latest.orderType || latestData.orderType || "regular";

            toast.info(`${title}${body ? `: ${body}` : ""}`, {
                autoClose: 6000,
                onClick: () => {
                    if (type === "new_message" && orderId) {
                        navigate(`/messages/${orderType}/${orderId}`);
                        return;
                    }

                    if (type === "order_push" && orderId) {
                        const targetPath = getOrderTargetPath(latest);
                        navigate(targetPath || `/order/${orderId}`);
                        return;
                    }

                    if (
                        [
                            "express_status_changed",
                            "express_arrived",
                            "express_completed",
                            "order_request_approved",
                            "order_started",
                            "order_completion_requested",
                            "order_completion_reminder",
                            "review_needed",
                        ].includes(type)
                    ) {
                        navigate("/active-orders");
                        return;
                    }

                    if (type === "order_request") {
                        const userRaw = localStorage.getItem("user");

                        let currentUserId = null;

                        try {
                            const user = userRaw ? JSON.parse(userRaw) : null;
                            currentUserId = user?.id || null;
                        } catch {}

                        const targetUserId =
                            latestData.creatorId ||
                            latestData.customerId ||
                            latestData.ownerId ||
                            latestData.userId ||
                            latestData.targetUserId ||
                            currentUserId;

                        if (targetUserId) {
                            const params = new URLSearchParams();

                            if (orderId) {
                                params.set("orderId", String(orderId));
                            }

                            params.set("reason", "order_request");
                            params.set("expand", "1");

                            navigate(`/my-orders/${targetUserId}?${params.toString()}`, {
                                replace: true,
                            });

                            return;
                        }

                        navigate("/active-orders?view=created&reason=order_request", {
                            replace: true,
                        });

                        return;
                    }

                    const targetPath = getOrderTargetPath(latest);

                    if (targetPath) {
                        navigate(targetPath);
                        return;
                    }

                    navigate("/profile");
                },
            });
        };

        socket.on("new_notification", handleNewNotification);

        return () => {
            socket.off("new_notification", handleNewNotification);
        };
    }, [navigate]);

    return (
        <AuthProvider>
            <ModalProvider>
                <SocketBootstrap />
                <PushBootstrap />
                <PullToRefresh />
                <UserProvider>
                    <Suspense
                        fallback={
                            <div className="app-loading">
                                Загрузка...
                            </div>
                        }
                    >
                        <Routes>
                            <Route path="/" element={<StartPage />} />
                            <Route path="/register" element={<RegisterPage />} />
                            <Route path="/login" element={<LoginPage />} />
                            <Route path="/profile" element={<ProfilePage />} />
                            <Route path="/orders" element={<OrdersPage />} />
                            <Route path="/active-orders" element={<ActiveOrdersPage />} />
                            <Route path="/complaints/:userId" element={<UserReviewsPage />} />
                            <Route path="/orders-history/:userId" element={<OrderHistoryPage />} />
                            <Route path="/create-order" element={<CreateOrderPage />} />
                            <Route path="/messages/:orderType/:orderId" element={<ChatPage />} />
                            <Route path="/order/:id" element={<OrderPage />} />
                            <Route path="/express-order/:id" element={<OrderPage />} />
                            <Route path="/user-orders/:userId" element={<UserOrdersPage />} />
                            <Route path="/my-orders/:userId" element={<MyOrdersPage />} />
                            <Route path="/express" element={<CreateExpressOrder />} />
                            <Route path="/services" element={<ServiceInfoPage />} />
                            <Route path="/info" element={<InfoPage />} />
                            <Route path="/support" element={<SupportChatPage />} />
                        </Routes>

                        <BottomMenu />

                        <ToastContainer
                            position="top-center"
                            autoClose={5000}
                            newestOnTop
                            closeOnClick
                            pauseOnHover
                        />

                    </Suspense>
                </UserProvider>
            </ModalProvider>
        </AuthProvider>

    );
}

const root = ReactDOM.createRoot(document.getElementById('root'));

runAppVersionMigration();

root.render(
    <Router>
        <App />
    </Router>
);