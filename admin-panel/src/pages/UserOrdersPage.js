import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import "../styles/UserOrdersPage.css";

const apiUrl = process.env.REACT_APP_API_URL;

function UserOrdersPage() {
    const { userId } = useParams();
    const [orders, setOrders] = useState([]);
    const [filteredOrders, setFilteredOrders] = useState([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const token = localStorage.getItem("authToken");
    const navigate = useNavigate();

    useEffect(() => {
        axios
            .get(`${apiUrl}/api/admin/users/${userId}/orders`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            .then((response) => {
                const data = response.data.orders || [];
                setOrders(data);
                setFilteredOrders(data);
                setLoading(false);
            })
            .catch((error) => {
                console.error("Ошибка загрузки заказов", error);
                setError("Не удалось загрузить заказы");
                setLoading(false);
            });
    }, [userId, token]);

    const handleCreateOrder = () => {
        navigate(`/create-order/${userId}`);
    };

    const handleSearch = (e) => {
        const query = e.target.value.toLowerCase();
        setSearchQuery(query);

        if (query.trim() === "") {
            setFilteredOrders(orders);
            return;
        }

        setFilteredOrders(
            orders.filter((order) => order.id.toString().includes(query))
        );
    };

    const handleOrderDetails = (orderId) => {
        navigate(`/orders/${orderId}`);
    };

    const getStatusClass = (status) => {
        switch (status) {
            case "pending":
                return "status-badge pending";
            case "active":
                return "status-badge active";
            case "completed":
                return "status-badge completed";
            case "cancelled":
                return "status-badge cancelled";
            case "expired":
                return "status-badge expired";
            case "pending_payment":
                return "status-badge pending-payment";
            default:
                return "status-badge";
        }
    };

    if (loading) {
        return (
            <div className="orders-container">
                <h1>Заказы пользователя #{userId}</h1>
                <p className="orders-message">Загрузка...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="orders-container">
                <h1>Заказы пользователя #{userId}</h1>
                <p className="orders-message error">{error}</p>
            </div>
        );
    }

    return (
        <div className="orders-container">
            <h1>Заказы пользователя #{userId}</h1>

            <div className="orders-toolbar">
                <input
                    type="text"
                    className="search-input"
                    placeholder="Поиск по ID заказа"
                    value={searchQuery}
                    onChange={handleSearch}
                />

                <button
                    className="details-button"
                    onClick={handleCreateOrder}
                >
                    Создать заказ
                </button>
            </div>

            {filteredOrders.length === 0 ? (
                <div className="empty-state">
                    <p>У пользователя нет заказов.</p>
                </div>
            ) : (
                <div className="orders-table-wrapper">
                    <table className="orders-table">
                        <thead>
                        <tr>
                            <th>ID заказа</th>
                            <th>Дата создания</th>
                            <th>Статус</th>
                            <th>Действия</th>
                        </tr>
                        </thead>

                        <tbody>
                        {filteredOrders.map((order) => (
                            <tr key={order.id}>
                                <td>{order.id}</td>
                                <td>{new Date(order.createdAt).toLocaleDateString()}</td>
                                <td>
                                        <span className={getStatusClass(order.status)}>
                                            {order.status}
                                        </span>
                                </td>
                                <td>
                                    <button
                                        className="details-button"
                                        onClick={() => handleOrderDetails(order.id)}
                                    >
                                        Подробнее
                                    </button>
                                </td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

export default UserOrdersPage;