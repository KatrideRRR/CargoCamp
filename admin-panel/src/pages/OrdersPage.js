import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "../styles/UserOrdersPage.css";
import OrderServiceDetails from "../components/OrderServiceDetails";

const apiUrl = process.env.REACT_APP_API_URL;

function OrdersPage() {
    const [regularOrders, setRegularOrders] = useState([]);
    const [expressOrders, setExpressOrders] = useState([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [activeTab, setActiveTab] = useState("regular");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const token = localStorage.getItem("authToken");
    const navigate = useNavigate();

    const renderVisibilityBadge = (order) => {
        if (order.adminDeleted) {
            return (
                <span className="admin-order-visibility-badge admin-deleted">
                Удалён админом
            </span>
            );
        }

        if (order.creatorHidden) {
            return (
                <span className="admin-order-visibility-badge creator-hidden">
                Скрыт пользователем
            </span>
            );
        }

        return (
            <span className="admin-order-visibility-badge visible">
            Видимый
        </span>
        );
    };

    useEffect(() => {
        const fetchAll = async () => {
            try {
                const [regularRes, expressRes] = await Promise.all([
                    axios.get(`${apiUrl}/api/admin/orders`, {
                        headers: { Authorization: `Bearer ${token}` },
                    }),
                    axios.get(`${apiUrl}/api/admin/express-orders`, {
                        headers: { Authorization: `Bearer ${token}` },
                    }),
                ]);

                setRegularOrders(Array.isArray(regularRes.data) ? regularRes.data : []);
                setExpressOrders(Array.isArray(expressRes.data) ? expressRes.data : []);
                setLoading(false);
            } catch (error) {
                console.error("Ошибка загрузки заказов", error);
                setError("Не удалось загрузить заказы");
                setLoading(false);
            }
        };

        fetchAll();
    }, [token]);

    const filteredRegularOrders = useMemo(() => {
        if (!searchQuery.trim()) return regularOrders;
        return regularOrders.filter((order) =>
            order.id.toString().includes(searchQuery.toLowerCase())
        );
    }, [regularOrders, searchQuery]);

    const filteredExpressOrders = useMemo(() => {
        if (!searchQuery.trim()) return expressOrders;
        return expressOrders.filter((order) =>
            order.id.toString().includes(searchQuery.toLowerCase())
        );
    }, [expressOrders, searchQuery]);

    const handleSearch = (e) => {
        setSearchQuery(e.target.value);
    };

    const handleOrderDetails = (orderId) => {
        navigate(`/orders/${orderId}`);
    };

    const handleExpressOrderDetails = (orderId) => {
        navigate(`/express-orders/${orderId}`);
    };

    const renderDisputeBadge = (order) => {
        const dispute = order.activeDispute;

        if (!dispute) {
            return <span className="admin-dispute-badge none">Нет спора</span>;
        }

        return (
            <span className={`admin-dispute-badge ${dispute.status || "open"}`}>
                Спор открыт
            </span>
        );
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
            default:
                return "status-badge";
        }
    };

    const getExpressTypeLabel = (type) => {
        if (type === "taxi") return "Такси";
        if (type === "courier") return "Курьер";
        return type || "—";
    };

    if (loading) {
        return (
            <div className="orders-container">
                <h1>Заказы</h1>
                <p className="orders-message">Загрузка...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="orders-container">
                <h1>Заказы</h1>
                <p className="orders-message error">{error}</p>
            </div>
        );
    }

    const currentOrders = activeTab === "regular" ? filteredRegularOrders : filteredExpressOrders;

    return (
        <div className="orders-container">
            <h1>Заказы</h1>

            <div className="orders-tabs">
                <button
                    type="button"
                    className={`orders-tab-button ${activeTab === "regular" ? "active" : ""}`}
                    onClick={() => setActiveTab("regular")}
                >
                    Обычные
                </button>

                <button
                    type="button"
                    className={`orders-tab-button ${activeTab === "express" ? "active" : ""}`}
                    onClick={() => setActiveTab("express")}
                >
                    Экспресс
                </button>
            </div>

            <div className="orders-toolbar">
                <input
                    type="text"
                    className="search-input"
                    placeholder={
                        activeTab === "regular"
                            ? "Поиск по ID обычного заказа"
                            : "Поиск по ID экспресс-заказа"
                    }
                    value={searchQuery}
                    onChange={handleSearch}
                />
            </div>

            {currentOrders.length === 0 ? (
                <div className="empty-state">
                    <p>Нет заказов.</p>
                </div>
            ) : (
                <div className="orders-table-wrapper">
                    {activeTab === "regular" ? (
                        <table className="orders-table">
                            <thead>
                            <tr>
                                <th>ID заказа</th>
                                <th>Услуга</th>
                                <th>Параметры</th>
                                <th>Дата создания</th>
                                <th>Статус заказа</th>
                                <th>Видимость</th>
                                <th>Спор</th>
                                <th>Действия</th>
                            </tr>
                            </thead>

                            <tbody>
                            {filteredRegularOrders.map((order) => (
                                <tr key={order.id}>
                                    <td>{order.id}</td>
                                    <td className="admin-order-service-cell">
                                        <div className="admin-order-service-name">
                                            {order.service?.name ||
                                                order.subcategory?.name ||
                                                "Не указано"}
                                        </div>

                                        <div className="admin-order-service-path">
                                            {[
                                                order.category?.name,
                                                order.subcategory?.name,
                                            ]
                                                .filter(Boolean)
                                                .join(" • ")}
                                        </div>
                                    </td>

                                    <td className="admin-order-details-cell">
                                        {order.serviceDetails ? (
                                            <OrderServiceDetails
                                                order={order}
                                                compact
                                            />
                                        ) : (
                                            <span className="admin-order-no-details">
            Нет параметров
        </span>
                                        )}
                                    </td>
                                    <td>{new Date(order.createdAt).toLocaleDateString()}</td>
                                    <td>
        <span className={getStatusClass(order.status)}>
            {order.status}
        </span>
                                    </td>
                                    <td>{renderVisibilityBadge(order)}</td>
                                    <td>{renderDisputeBadge(order)}</td>
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
                    ) : (
                        <table className="orders-table">
                            <thead>
                            <tr>
                                <th>ID</th>
                                <th>Тип</th>
                                <th>Маршрут</th>
                                <th>Цена</th>
                                <th>Статус</th>
                                <th>Заказчик</th>
                                <th>Исполнитель</th>
                                <th>Дата</th>
                                <th>Действия</th>
                            </tr>
                            </thead>

                            <tbody>
                            {filteredExpressOrders.map((order) => (
                                <tr key={order.id}>
                                    <td>{order.id}</td>
                                    <td>{getExpressTypeLabel(order.type)}</td>
                                    <td className="express-route-cell">
                                        <div>{order.fromAddress || "—"}</div>
                                        <div className="route-arrow">→</div>
                                        <div>{order.toAddress || "—"}</div>
                                    </td>
                                    <td>{order.totalPrice ?? "—"} ₽</td>
                                    <td>
                                            <span className={getStatusClass(order.status)}>
                                                {order.status}
                                            </span>
                                    </td>
                                    <td>{order.creatorId || "—"}</td>
                                    <td>{order.executorId || "—"}</td>
                                    <td>{new Date(order.createdAt).toLocaleDateString()}</td>
                                    <td>
                                        <button
                                            className="details-button"
                                            onClick={() => handleExpressOrderDetails(order.id)}
                                        >
                                            Подробнее
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
}

export default OrdersPage;