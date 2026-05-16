import React from "react";
import { Link } from "react-router-dom";
import "../styles/Dashboard.css";

function Dashboard() {
    return (
        <div className="dashboard-page">
            <div className="dashboard-container">
                <h1 className="dashboard-title">Панель администратора</h1>

                <nav className="dashboard-nav">
                    <ul>
                        <li><Link to="/users">Пользователи</Link></li>
                        <li><Link to="/orders">Заказы</Link></li>
                        <li><Link to="/support">Поддержка</Link></li>
                    </ul>
                </nav>
            </div>
        </div>
    );
}

export default Dashboard;