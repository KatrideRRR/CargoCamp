import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import "../styles/AdminExpressOrderDetailsPage.css";

const apiUrl = process.env.REACT_APP_API_URL;

function AdminExpressOrderDetailsPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const token = localStorage.getItem("authToken");

    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!token) {
            setError("Нет токена авторизации");
            setLoading(false);
            return;
        }

        axios
            .get(`${apiUrl}/api/admin/express-orders/${id}`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            .then((response) => {
                setOrder(response.data);
                setLoading(false);
            })
            .catch((err) => {
                console.error("Ошибка загрузки express-заказа:", err);
                setError(err.response?.data?.message || "Ошибка загрузки express-заказа");
                setLoading(false);
            });
    }, [id, token]);

    const getStatusClass = (status) => {
        switch (status) {
            case "created":
                return "status-badge pending";
            case "accepted":
                return "status-badge active";
            case "on_the_way_to_A":
                return "status-badge active";
            case "arrived_at_A":
                return "status-badge active";
            case "in_progress":
                return "status-badge active";
            case "completed":
                return "status-badge completed";
            case "cancelled":
                return "status-badge cancelled";
            default:
                return "status-badge";
        }
    };

    const getTypeLabel = (type) => {
        if (type === "taxi") return "Такси";
        if (type === "courier") return "Курьер";
        return type || "—";
    };

    const getPaymentLabel = (type) => {
        if (type === "cash") return "Наличные";
        if (type === "guarantee") return "Гарантия";
        return type || "—";
    };

    const deleteOrder = async () => {
        alert("Удаление express-заказа пока не подключено");
    };

    if (loading) {
        return (
            <div className="express-details-container">
                <h2>Детали экспресс-заказа</h2>
                <p className="page-message">Загрузка...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="express-details-container">
                <h2>Детали экспресс-заказа</h2>
                <p className="page-message error">{error}</p>
            </div>
        );
    }

    if (!order) {
        return (
            <div className="express-details-container">
                <h2>Детали экспресс-заказа</h2>
                <p className="page-message">Заказ не найден</p>
            </div>
        );
    }

    return (
        <div className="express-details-container">
            <h2>Детали экспресс-заказа #{order.id}</h2>

            <div className="express-card">
                <div className="express-card-header">
                    <h3>Основная информация</h3>

                    <div className="express-card-actions">
                        <button
                            className="back-button"
                            onClick={() => navigate("/orders")}
                        >
                            Назад
                        </button>

                        <button
                            className="delete-button"
                            onClick={deleteOrder}
                        >
                            Удалить
                        </button>
                    </div>
                </div>

                <div className="express-info-grid">
                    <div className="info-item">
                        <span className="info-label">Тип</span>
                        <span className="info-value">{getTypeLabel(order.type)}</span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">Статус</span>
                        <span className="info-value">
                            <span className={getStatusClass(order.status)}>
                                {order.status || "—"}
                            </span>
                        </span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">Дата создания</span>
                        <span className="info-value">
                            {order.createdAt ? new Date(order.createdAt).toLocaleString() : "—"}
                        </span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">Заказчик ID</span>
                        <span className="info-value">{order.creatorId || "—"}</span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">Исполнитель ID</span>
                        <span className="info-value">{order.executorId || "—"}</span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">Подкатегория</span>
                        <span className="info-value">{order.subcategory || "—"}</span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">Цена</span>
                        <span className="info-value">
                            {order.totalPrice !== null && order.totalPrice !== undefined
                                ? `${order.totalPrice} ₽`
                                : "—"}
                        </span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">Тип оплаты</span>
                        <span className="info-value">{getPaymentLabel(order.paymentType)}</span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">Статус сделки</span>
                        <span className="info-value">{order.dealStatus || "—"}</span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">Базовая цена</span>
                        <span className="info-value">
                            {order.basePrice !== null && order.basePrice !== undefined
                                ? `${order.basePrice} ₽`
                                : "—"}
                        </span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">Цена за км</span>
                        <span className="info-value">
                            {order.pricePerKm !== null && order.pricePerKm !== undefined
                                ? `${order.pricePerKm} ₽`
                                : "—"}
                        </span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">Расстояние</span>
                        <span className="info-value">
                            {order.distanceKm !== null && order.distanceKm !== undefined
                                ? `${order.distanceKm} км`
                                : "—"}
                        </span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">Оценка времени</span>
                        <span className="info-value">
                            {order.estimatedTimeMin !== null && order.estimatedTimeMin !== undefined
                                ? `${order.estimatedTimeMin} мин`
                                : "—"}
                        </span>
                    </div>

                    <div className="info-item info-item-full">
                        <span className="info-label">Маршрут</span>
                        <div className="route-box">
                            <div className="route-point">
                                <span className="route-point-label">A</span>
                                <span className="route-point-text">{order.fromAddress || "—"}</span>
                            </div>

                            <div className="route-arrow">→</div>

                            <div className="route-point">
                                <span className="route-point-label">B</span>
                                <span className="route-point-text">{order.toAddress || "—"}</span>
                            </div>
                        </div>
                    </div>

                    <div className="info-item info-item-full">
                        <span className="info-label">Координаты точки A</span>
                        <span className="info-value">
                            {order.fromLat && order.fromLng ? `${order.fromLat}, ${order.fromLng}` : "—"}
                        </span>
                    </div>

                    <div className="info-item info-item-full">
                        <span className="info-label">Координаты точки B</span>
                        <span className="info-value">
                            {order.toLat && order.toLng ? `${order.toLat}, ${order.toLng}` : "—"}
                        </span>
                    </div>

                    <div className="info-item info-item-full">
                        <span className="info-label">Описание</span>
                        <span className="info-value">{order.description || "—"}</span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">Прибыл в A</span>
                        <span className="info-value">
                            {order.arrivedAt ? new Date(order.arrivedAt).toLocaleString() : "—"}
                        </span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">Начал выполнение</span>
                        <span className="info-value">
                            {order.startedAt ? new Date(order.startedAt).toLocaleString() : "—"}
                        </span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">Завершён</span>
                        <span className="info-value">
                            {order.completedAt ? new Date(order.completedAt).toLocaleString() : "—"}
                        </span>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default AdminExpressOrderDetailsPage;