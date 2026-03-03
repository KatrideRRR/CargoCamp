import React, { useEffect } from 'react';
import { socket } from "./socketClient";
import ReactDOM from 'react-dom/client';
import { useNavigate } from 'react-router-dom';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import OrdersPage from './pages/OrdersPage';
import CreateOrderPage from './pages/CreateOrderPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ProfilePage from './pages/ProfilePage';
import ActiveOrdersPage from './pages/ActiveOrdersPage';
import BottomMenu from './components/BottomMenu';
import ChatPage from './pages/ChatPage';
import { AuthProvider } from "./utils/authContext";
import { UserProvider } from './utils/userContext';
import { ModalProvider } from './components/modalContext';
import UserReviewsPage from './pages/UserReviewsPage';
import OrderHistoryPage from "./pages/OrderHistoryPage";
import OrderPage from './pages/OrderPage';
import UserOrdersPage from './pages/UserOrdersPage';
import MyOrdersPage from './pages/MyOrdersPage';
import StartPage from './pages/StartPage';
import CreateExpressOrder from "./pages/CreateExpressOrder";
import ServiceInfoPage from './pages/ServiceInfoPage';
import InfoPage from "./pages/InfoPage";
import Modal from "react-modal";

Modal.setAppElement = function (s) {

};
Modal.setAppElement('#root'); // Указываем корневой элемент

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

useEffect(() => {
    const h = (payload) => console.log("🔥 PUSH EVENT RECEIVED:", payload);
    socket.on("push_notification", h);
    return () => socket.off("push_notification", h);
}, []);

function App() {
    const navigate = useNavigate();
    const userId = getUserIdFromToken();

    console.log("[APP RENDER] userId:", userId);

    useEffect(() => {
        if (!userId) return;

        socket.emit("register", userId);
        console.log("✅ WS register:", userId);

    }, [userId]);

    useEffect(() => {
        const handlePush = (payload) => {
            if (!payload) return;
            if (payload.type !== "order_push") return;

            console.log("📩 PUSH RECEIVED:", payload);

            const open = window.confirm(
                `${payload.title}\n${payload.message}\nОткрыть заказ?`
            );

            if (open) {
                navigate(`/order/${payload.orderId}`); // <-- ВАЖНО: у тебя путь /order/:id
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
                        <Routes>
                            <Route path="/" element={<StartPage />} />
                            <Route path="/register" element={<RegisterPage />} />
                            <Route path="/login" element={<LoginPage />} />
                            <Route path="/profile" element={<ProfilePage />}/>
                            <Route path="/orders" element={<OrdersPage />} />
                            <Route path="/active-orders" element={<ActiveOrdersPage />}/>
                            <Route path="/complaints/:userId" element={<UserReviewsPage />} />
                            <Route path="/orders-history/:userId" element={<OrderHistoryPage />} />
                            <Route path="/create-order" element={<CreateOrderPage />} />
                            <Route path="/messages/:orderId" element={<ChatPage/>} />
                            <Route path="/order/:id" element={<OrderPage />} />
                            <Route path="/user-orders/:userId" element={<UserOrdersPage />} />
                            <Route path="/my-orders/:userId" element={<MyOrdersPage />} />
                            <Route path="/express" element={<CreateExpressOrder />} />
                            <Route path="/services" element={<ServiceInfoPage />} />
                            <Route path="/info" element={<InfoPage />} />
                        </Routes>
                        <BottomMenu />
            </UserProvider>
        </AuthProvider>
        </ModalProvider>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <Router>
        <App />
    </Router>
);