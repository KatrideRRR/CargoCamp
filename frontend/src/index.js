import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import 'leaflet/dist/leaflet.css';
import OrdersPage from './pages/OrdersPage';
import CreateOrderPage from './pages/CreateOrderPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import ProfilePage from './pages/ProfilePage';
import Navbar from './components/Navbar';
import ActiveOrdersPage from './pages/ActiveOrdersPage';
import BottomMenu from './components/BottomMenu';
import ChatPage from './pages/ChatPage';
import { AuthProvider } from "./utils/authContext";
import { UserProvider } from './utils/userContext';
import { ModalProvider } from './components/modalContext';
import UserComplaintsPage from './pages/UserComplaintsPage';
import OrderHistoryPage from "./pages/OrderHistoryPage";
import OrderPage from './pages/OrderPage';
import UserOrdersPage from './pages/UserOrdersPage';
import MyOrdersPage from './pages/MyOrdersPage';
import StartPage from './pages/StartPage';

const App = () => {
    return (
        <Router>
        <ModalProvider>
        <AuthProvider>
            <UserProvider>
                        <Navbar />
                        <Routes>
                            <Route path="/" element={<StartPage />} />
                            <Route path="/register" element={<RegisterPage />} />
                            <Route path="/login" element={<LoginPage />} />
                            <Route path="/profile" element={<ProfilePage />}/>
                            <Route path="/orders" element={<OrdersPage />} />
                            <Route path="/active-orders" element={<ActiveOrdersPage />}/>
                            <Route path="/complaints/:userId" element={<UserComplaintsPage />} />
                            <Route path="/orders-history/:userId" element={<OrderHistoryPage />} />
                            <Route path="/create-order" element={<CreateOrderPage />} />
                            <Route path="/messages/:orderId" element={<ChatPage/>} />
                            <Route path="/order/:id" element={<OrderPage />} />
                            <Route path="/user-orders/:userId" element={<UserOrdersPage />} />
                            <Route path="/my-orders/:userId" element={<MyOrdersPage />} />
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
