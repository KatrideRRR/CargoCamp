import React from 'react';
import ReactDOM from 'react-dom/client';
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
import ExpressOrderPage from "./pages/ExpressOrderPage";
import ServiceInfoPage from './pages/ServiceInfoPage';
import InfoPage from "./pages/InfoPage";
import Modal from "react-modal";

Modal.setAppElement = function (s) {

};
Modal.setAppElement('#root'); // Указываем корневой элемент

const App = () => {
    return (
        <Router>
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
                            <Route path="/express" element={<ExpressOrderPage />} />
                            <Route path="/services" element={<ServiceInfoPage />} />
                            <Route path="/info" element={<InfoPage />} />
                        </Routes>
                        <BottomMenu />
            </UserProvider>
        </AuthProvider>
        </ModalProvider>
        </Router>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
