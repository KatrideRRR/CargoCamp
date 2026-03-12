import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "../styles/UserOrdersPage.css";

const apiUrl = process.env.REACT_APP_API_URL;

function OrdersPage() {
    const [orders, setOrders] = useState([]);
    const [filteredOrders, setFilteredOrders] = useState([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const token = localStorage.getItem("authToken");
    const navigate = useNavigate();

    useEffect(() => {
        axios
            .get(`${apiUrl}/api/admin/orders`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            .then((response) => {
                const data = Array.isArray(response.data) ? response.data : [];
                setOrders(data);
                setFilteredOrders(data);
                setLoading(false);
            })
            .catch((error) => {
                console.error("Ошибка загрузки заказов", error);
                setError("Не удалось загрузить заказы");
                setLoading(false);
            });
    }, [token]);

    const handleSearch = (e) => {
        const query = e.target.value.toLowerCase();
        setSearchQuery(query);

        if (query.trim() === "") {
            setFilteredOrders(orders);
        } else {
            setFilteredOrders(
                orders.filter((order) => order.id.toString().includes(query))
            );
        }
    };

    const handleOrderDetails = (orderId) => {
        navigate(`/orders/${orderId}`);
    };

    const renderDisputeBadge = (order) => {
        const dispute = order.activeDispute;

        if (!dispute) {
            return <span className="admin-dispute-badge none">Нет</span>;
        }

        return (
            <span className={`admin-dispute-badge ${dispute.status || "open"}`}>
                Спор открыт
            </span>
        );
    };

    if (loading) return <p>Загрузка...</p>;
    if (error) return <p style={{ color: "red" }}>{error}</p>;

    return (
        <div className="orders-container">
            <h1>Все заказы</h1>

            <input
                type="text"
                className="search-input"
                placeholder="Поиск по ID заказа"
                value={searchQuery}
                onChange={handleSearch}
            />

            {filteredOrders.length === 0 ? (
                <p>Нет заказов.</p>
            ) : (
                <table className="orders-table">
                    <thead>
                    <tr>
                        <th>ID заказа</th>
                        <th>Дата создания</th>
                        <th>Статус заказа</th>
                        <th>Спор</th>
                        <th>Действия</th>
                    </tr>
                    </thead>

                    <tbody>
                    {filteredOrders.map((order) => (
                        <tr key={order.id}>
                            <td>{order.id}</td>
                            <td>{new Date(order.createdAt).toLocaleDateString()}</td>
                            <td>{order.status}</td>
                            <td>{renderDisputeBadge(order)}</td>
                            <td>
                                <button onClick={() => handleOrderDetails(order.id)}>
                                    Подробнее
                                </button>
                            </td>
                        </tr>
                    ))}
                    </tbody>
                </table>
            )}
        </div>
    );
}

export default OrdersPage;