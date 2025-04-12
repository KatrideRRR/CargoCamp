import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocation } from "react-router-dom";
import '../styles/Navbar.css';

const Navbar = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const getPageTitle = () => {
        switch (location.pathname) {
            case "/orders":
                return "Доступные заказы";
            case "/active-orders":
                return "Активные заказы";
            case "/profile":
                return "Мой Профиль";
            case "/create-order":
                return "Создание заказа";
            case "/login":
                return "Авторизация";
            default:
                return "CargoCamp"; // Значение по умолчанию
        }
    };

    return (
        <nav className="navbar">
            <div className="navbar-left">
                <button
                    className="navbar-item navbar-home"
                    onClick={() => navigate('/')}
                >
                    Старт
                </button>
            </div>
                <div className="navbar-title">{getPageTitle()}</div>
                <div className="navbar-right">
                    <button
                        className="navbar-item navbar-profile"
                        onClick={() => navigate('/profile')}
                    >
                        Профиль
                    </button>
                </div>
        </nav>
);
};

export default Navbar;
