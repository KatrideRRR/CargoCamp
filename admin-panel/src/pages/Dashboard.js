import React from "react";
import { Link } from "react-router-dom";
import "../styles/Dashboard.css"; // Импорт стилей

function Dashboard() {
    return (
        <div className="dashboard-container">
            <h1>Панель администратора</h1>
            <nav className="dashboard-nav">
                <ul>
                    <li><Link to="/users">Пользователи</Link></li>
                    <li><Link to="/orders">Заказы</Link></li>
                    <li><Link to="/create">Создать заказ</Link></li>
                </ul>
            </nav>
        </div>
    );
}

export default Dashboard;
