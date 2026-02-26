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
    const [logs, setLogs] = useState([]);
    const [logsLoading, setLogsLoading] = useState(false);
    const [logsError, setLogsError] = useState(null);

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

    useEffect(() => {
        if (!token) return;

        setLogsLoading(true);
        axios.get(`${apiUrl}/api/admin/orders/${id}/logs`, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then(res => {
                setLogs(res.data?.rows || []);
                setLogsLoading(false);
            })
            .catch(err => {
                setLogsError("Ошибка загрузки логов");
                setLogsLoading(false);
            });
    }, [id, token]);

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

            <div className="order-logs">
                <h3>История действий</h3>

                {logsLoading && <p>Загрузка логов...</p>}
                {logsError && <p>{logsError}</p>}

                {!logsLoading && !logsError && logs.length === 0 && (
                    <p>Логов пока нет</p>
                )}

                {!logsLoading && !logsError && logs.length > 0 && (
                    <ul className="logs-list">
                        {logs.map((l) => (
                            <li key={l.id} className={`log-item ${l.severity || ""}`}>
                                <div className="log-top">
            <span className="log-time">
              {l.ts ? new Date(l.ts).toLocaleString() : ""}
            </span>

                                    <span className="log-type">
              <strong>{l.actionType}</strong>
            </span>

                                    <span className="log-actor">
              {l.actorRole}{l.actorUserId ? ` #${l.actorUserId}` : ""}
            </span>

                                    <span className={`log-status ${l.success ? "ok" : "fail"}`}>
              {l.success ? "OK" : "FAIL"}
            </span>
                                </div>

                                {l.reason && <div className="log-reason">Причина: {l.reason}</div>}

                                {l.meta && (
                                    <details className="log-meta">
                                        <summary>meta</summary>
                                        <pre>{JSON.stringify(l.meta, null, 2)}</pre>
                                    </details>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>

    );
}

export default OrderDetailsPage;
