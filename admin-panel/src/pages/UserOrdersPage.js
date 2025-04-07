import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import "../styles/UserOrdersPage.css"; // Подключаем стили

const apiUrl = process.env.REACT_APP_API_URL;

function UserOrdersPage() {
    const { userId } = useParams(); // Получаем ID пользователя из URL
    const [orders, setOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const token = localStorage.getItem("authToken");
    const [searchQuery, setSearchQuery] = useState("");
    const [filteredOrders, setFilteredOrders] = useState([]);
    const navigate = useNavigate(); // Для перехода на другую страницу

    useEffect(() => {
        axios.get(`${apiUrl}/api/admin/users/${userId}/orders`, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then((response) => {
                setOrders(response.data.orders || []);
                setFilteredOrders(response.data.orders || []);
                setLoading(false);
            })
            .catch((error) => {
                console.error("Ошибка загрузки заказов", error);
                setError("Не удалось загрузить заказы");
                setLoading(false);
            });
    }, [userId, token]);
    console.log("userId:", userId);  // Это для отладки

    const handleCreateOrder = () => {
        console.log("Переход на создание заказа для userId:", userId);  // Это для отладки
        navigate(`/create-order/${userId}`); // Должно быть именно userId как строка
    };

    const handleSearch = (e) => {
        const query = e.target.value.toLowerCase();
        setSearchQuery(query);

        if (query.trim() === "") {
            setFilteredOrders(orders);
        } else {
            setFilteredOrders(orders.filter(order =>
                order.id.toString().includes(query)
            ));
        }
    };

    const handleOrderDetails = (orderId) => {
        navigate(`/orders/${orderId}`); // Переход к деталям заказа
    };

    if (loading) return <p>Загрузка...</p>;
    if (error) return <p style={{ color: "red" }}>{error}</p>;

    return (
        <div className="orders-container">
            <h1>Заказы пользователя (ID: {userId})</h1>

            <input
                type="text"
                className="search-input"
                placeholder="Поиск по ID заказа"
                value={searchQuery}
                onChange={handleSearch}
            />

            <button onClick={handleCreateOrder}>Создать заказ для пользователя</button>

            {filteredOrders.length === 0 ? (
                <p>У пользователя нет заказов.</p>
            ) : (
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
                            <td>{order.status}</td>
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

export default UserOrdersPage;
