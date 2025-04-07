import React, { useEffect, useState } from "react";
import {useNavigate, useParams} from "react-router-dom";
import axios from "axios";
import '../styles/OrderDetailsPage.css';

const apiUrl = process.env.REACT_APP_API_URL;

function OrderDetailsPage() {
    const { id } = useParams();
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [orders, setOrders] = useState([]);
    const [filteredOrders, setFilteredOrders] = useState([]);
    const token = localStorage.getItem("authToken");
    const navigate = useNavigate();

    useEffect(() => {
        axios.get(`${apiUrl}/api/admin/orders/${id}`)
            .then(response => {
                setOrder(response.data);
                setLoading(false);
            })
            .catch(err => {
                setError("Ошибка загрузки заказа");
                setLoading(false);
            });
    }, [id]);

    const deleteOrder = async (id) => {
        try {
            await axios.delete(`${apiUrl}/api/admin/orders/${id}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setOrders(orders.filter(order => order.id !== id));
            setFilteredOrders(filteredOrders.filter(order => order.id !== id));
            navigate("/orders");
        } catch (error) {
            console.error("Ошибка удаления заказа", error);
            alert("Не удалось удалить заказ");
        }
    };

    const showMessage = async (id) => {
        navigate(`/${id}/messages`);
    }

    if (loading) return <p>Загрузка...</p>;
    if (error) return <p>{error}</p>;
    if (!order) return <p>Заказ не найден</p>;

    return (
        <div className="order-details-container">
            <h2>Детали заказа #{order.id}</h2>
            <div className="order-info">
                <p><strong>Адрес:</strong> {order.address}</p>
                <p><strong>Статус:</strong> {order.status}</p>
                <p><strong>Дата создания:</strong> {new Date(order.createdAt).toLocaleString()}</p>
                <p><strong>Id создателя:</strong> {order.creatorId}</p>
                <p>
                    <strong>Категория:</strong> {order.category ? order.category.name : 'Не указано'}
                </p>
                <p>
                    <strong>Подкатегория:</strong> {order.subcategory ? order.subcategory.name : 'Не указано'}
                </p>
                <p><strong>Описание:</strong> {order.description}</p>
                <p><strong>Цена:</strong> {order.proposedSum}</p>
                <p><strong>Id исполнителя:</strong> {order.executorId}</p>
                <button className="message-button" onClick={() => showMessage(order.id)}>
                    Открыть чат
                </button>
                <button className="delete-button" onClick={() => deleteOrder(order.id)}>
                    Удалить
                </button>
            </div>
        </div>

    );
}

export default OrderDetailsPage;
