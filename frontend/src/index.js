import React, { Suspense, lazy, useEffect, useMemo } from 'react';
import { socket } from "./socketClient";
import ReactDOM from 'react-dom/client';
import { useNavigate } from 'react-router-dom';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';

import { AuthProvider } from "./utils/authContext";
import { UserProvider } from './utils/userContext';
import { ModalProvider } from './components/modalContext';
import Modal from "react-modal";

// УБРАЛИ глобальный leaflet css отсюда
// import 'leaflet/dist/leaflet.css';

Modal.setAppElement = function () {};
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

function getUserIdFromToken() {
    try {
        const token = localStorage.getItem("authToken");
        if (!token) return null;

        const payloadBase64 = token.split(".")[1];
        const payloadJson = atob(payloadBase64.replace(/-/g, "+").replace(/_/g, "/"));
        const payload = JSON.parse(payloadJson);

        return payload?.id ?? null;
    } catch {
        return null;
    }
}

function App() {
    const navigate = useNavigate();
    const userId = useMemo(() => getUserIdFromToken(), []);

    useEffect(() => {
        if (!socket.connected) {
            socket.connect();
        }

        const handleConnect = () => {
            if (userId) {
                socket.emit("register", userId);
            }
        };

        socket.on("connect", handleConnect);

        if (socket.connected && userId) {
            socket.emit("register", userId);
        }

        return () => {
            socket.off("connect", handleConnect);
        };
    }, [userId]);

    useEffect(() => {
        const handlePush = (payload) => {
            if (!payload || payload.type !== "order_push") return;

            const open = window.confirm(
                `${payload.title}\n${payload.message}\nОткрыть заказ?`
            );

            if (open) {
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
                <UserProvider>
                    <Suspense
                        fallback={
                            <div style={{ padding: 24, textAlign: 'center' }}>
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
                            <Route path="/messages/:orderId" element={<ChatPage />} />
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