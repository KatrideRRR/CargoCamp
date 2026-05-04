import React, { Suspense, lazy, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import Modal from "react-modal";
import { useAuth } from "./utils/authContext";

import { socket } from "./socketClient";

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

function SocketBootstrap() {
    const { user } = useAuth();

    useEffect(() => {
        if (!user?.id) {
            return;
        }

        if (!socket.connected) {
            socket.connect();
        }

        const registerUser = () => {
            socket.emit("register", user.id);
            socket.emit("subscribeToNotifications", user.id);
        };

        socket.on("connect", registerUser);
        socket.on("reconnect", registerUser);

        if (socket.connected) {
            registerUser();
        }

        return () => {
            socket.off("connect", registerUser);
            socket.off("reconnect", registerUser);
        };
    }, [user?.id]);

    return null;
}

function App() {
    const navigate = useNavigate();

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

    return (
        <ModalProvider>
            <AuthProvider>
                <SocketBootstrap />
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
                            <Route path="/user-orders/:userId" element={<UserOrdersPage />} />
                            <Route path="/my-orders/:userId" element={<MyOrdersPage />} />
                            <Route path="/express" element={<CreateExpressOrder />} />
                            <Route path="/services" element={<ServiceInfoPage />} />
                            <Route path="/info" element={<InfoPage />} />
                        </Routes>

                        <BottomMenu />
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