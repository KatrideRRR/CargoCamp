import React, { Suspense, lazy, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import Modal from "react-modal";
import { useAuth } from "./utils/authContext";
import { initPushNotifications } from "./utils/pushNotifications";
import PullToRefresh from "./components/PullToRefresh";
import { socket, connectSocket } from "./socketClient";
import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

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

function App() {
    const navigate = useNavigate();

    useEffect(() => {
        initPushNotifications({ navigate }).catch((e) => {
            console.error("initPushNotifications error:", e);
        });
    }, [navigate]);

    useEffect(() => {
        const handlePush = (payload) => {
            if (!payload || payload.type !== "order_push") return;

            const open = window.confirm(
                `${payload.title || "Уведомление"}\n${payload.message || ""}\nОткрыть заказ?`
            );

            if (open && payload.orderId) {
                navigate(`/order/${payload.orderId}`);
            }
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

            const open = window.confirm(`${payload?.title || "Новый экспресс-заказ"}\n${text}\nОткрыть список заказов?`);

            if (open) {
                navigate("/orders");
            }
        };

        socket.on("expressOrderNearby", handleExpressNearby);

        return () => {
            socket.off("expressOrderNearby", handleExpressNearby);
        };
    }, [navigate]);

    useEffect(() => {
        let lastShownNotificationId = null;

        const handleNewNotification = (notifications = []) => {
            if (!Array.isArray(notifications) || notifications.length === 0) return;

            const latest = notifications[0];

            if (!latest?.id) return;
            if (latest.id === lastShownNotificationId) return;

            if (latest.type === "express_available_nearby") {
                return;
            }

            lastShownNotificationId = latest.id;

            const title = latest.title || "Новое уведомление";
            const body = latest.body || "";

            const type = latest.type;
            const orderId = latest.orderId;
            const orderType = latest.orderType || "regular";

            toast.info(`${title}${body ? `: ${body}` : ""}`, {
                autoClose: 6000,
                onClick: () => {
                    if (type === "new_message" && orderId) {
                        navigate(`/messages/${orderType}/${orderId}`);
                        return;
                    }

                    if (type === "express_available_nearby") {
                        navigate("/orders");
                        return;
                    }

                    if (
                        [
                            "express_status_changed",
                            "express_arrived",
                            "express_completed",
                            "express_cancelled",
                            "order_request_approved",
                            "order_started",
                            "order_completion_requested",
                            "review_needed",
                        ].includes(type)
                    ) {
                        navigate("/active-orders");
                        return;
                    }

                    if (type === "order_request") {
                        const userRaw = localStorage.getItem("user");
                        try {
                            const user = userRaw ? JSON.parse(userRaw) : null;
                            if (user?.id) {
                                navigate(`/my-orders/${user.id}`);
                                return;
                            }
                        } catch {}

                        navigate("/profile");
                        return;
                    }

                    if (orderType === "regular" && orderId) {
                        navigate(`/order/${orderId}`);
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
        <ModalProvider>
            <AuthProvider>
                <SocketBootstrap />
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
            </AuthProvider>
        </ModalProvider>
    );
}

const root = ReactDOM.createRoot(document.getElementById('root'));

root.render(
    <Router>
        <App />
    </Router>
);