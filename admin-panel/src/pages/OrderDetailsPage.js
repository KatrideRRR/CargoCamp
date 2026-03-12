import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import "../styles/OrderDetailsPage.css";

const apiUrl = process.env.REACT_APP_API_URL;

function OrderDetailsPage() {
    const { id } = useParams();
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [logs, setLogs] = useState([]);
    const [logsLoading, setLogsLoading] = useState(false);
    const [logsError, setLogsError] = useState(null);

    const token = localStorage.getItem("authToken");
    const navigate = useNavigate();

    useEffect(() => {
        if (!token) {
            setError("Нет токена авторизации");
            setLoading(false);
            return;
        }

        axios
            .get(`${apiUrl}/api/admin/orders/${id}`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            .then((response) => {
                setOrder(response.data);
                setLoading(false);
            })
            .catch((err) => {
                console.error("Ошибка загрузки заказа:", err);
                setError(err.response?.data?.message || "Ошибка загрузки заказа");
                setLoading(false);
            });
    }, [id, token]);

    useEffect(() => {
        if (!token) return;

        setLogsLoading(true);
        axios
            .get(`${apiUrl}/api/admin/orders/${id}/logs`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            .then((res) => {
                setLogs(res.data?.rows || []);
                setLogsLoading(false);
            })
            .catch((err) => {
                console.error("Ошибка загрузки логов:", err);
                setLogsError(err.response?.data?.message || "Ошибка загрузки логов");
                setLogsLoading(false);
            });
    }, [id, token]);

    const deleteOrder = async (orderId) => {
        try {
            await axios.delete(`${apiUrl}/api/admin/orders/${orderId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            navigate("/orders");
        } catch (error) {
            console.error("Ошибка удаления заказа", error);
            alert("Не удалось удалить заказ");
        }
    };

    const showMessage = (orderId) => {
        navigate(`/orders/${orderId}/messages`);
    };

    const renderPhotos = (photos, title) => {
        if (!Array.isArray(photos) || photos.length === 0) {
            return (
                <div className="photo-block">
                    <h4>{title}</h4>
                    <p>Фото нет</p>
                </div>
            );
        }

        return (
            <div className="photo-block">
                <h4>{title}</h4>
                <div className="photo-grid">
                    {photos.map((photo, index) => (
                        <a
                            key={index}
                            href={`${apiUrl}${photo}`}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <img
                                src={`${apiUrl}${photo}`}
                                alt={`${title} ${index + 1}`}
                                className="order-photo"
                            />
                        </a>
                    ))}
                </div>
            </div>
        );
    };

    const getDisputeStatusLabel = (status) => {
        switch (status) {
            case "open":
                return "Открыт";
            case "in_review":
                return "На рассмотрении";
            case "waiting_creator":
                return "Ожидает заказчика";
            case "waiting_executor":
                return "Ожидает исполнителя";
            case "resolved":
                return "Решён";
            case "closed":
                return "Закрыт";
            default:
                return status || "—";
        }
    };

    const getReasonCodeLabel = (reasonCode) => {
        switch (reasonCode) {
            case "work_not_done":
                return "Работа не выполнена";
            case "poor_quality":
                return "Низкое качество работы";
            case "missed_deadline":
                return "Нарушены сроки";
            case "wrong_price":
                return "Спор по стоимости";
            case "rude_behavior":
                return "Некорректное поведение";
            case "other":
                return "Другое";
            default:
                return reasonCode || "—";
        }
    };

    if (loading) return <p>Загрузка...</p>;
    if (error) return <p>{error}</p>;
    if (!order) return <p>Заказ не найден</p>;

    const disputes = Array.isArray(order.disputes) ? order.disputes : [];

    return (
        <div className="order-details-container">
            <h2>Детали заказа #{order.id}</h2>

            <div className="order-info">
                <p><strong>Адрес:</strong> {order.address}</p>
                <p><strong>Статус:</strong> {order.status}</p>
                <p><strong>Дата создания:</strong> {order.createdAt ? new Date(order.createdAt).toLocaleString() : "—"}</p>
                <p><strong>ID создателя:</strong> {order.creatorId}</p>
                <p><strong>ID исполнителя:</strong> {order.executorId || "—"}</p>
                <p><strong>Категория:</strong> {order.category ? order.category.name : "Не указано"}</p>
                <p><strong>Подкатегория:</strong> {order.subcategory ? order.subcategory.name : "Не указано"}</p>
                <p><strong>Описание:</strong> {order.description || "—"}</p>
                <p><strong>Цена:</strong> {order.proposedSum ?? "—"}</p>
                <p><strong>Тип оплаты:</strong> {order.paymentType || "—"}</p>
                <p><strong>Статус сделки:</strong> {order.dealStatus || "—"}</p>

                <button className="message-button" onClick={() => showMessage(order.id)}>
                    Открыть чат
                </button>
                <button className="delete-button" onClick={() => deleteOrder(order.id)}>
                    Удалить
                </button>
            </div>

            <div className="order-disputes-section">
                <h3>Споры по заказу</h3>

                {disputes.length === 0 ? (
                    <p>По этому заказу споров нет</p>
                ) : (
                    <div className="disputes-list">
                        {disputes.map((dispute) => (
                            <div key={dispute.id} className="dispute-card">
                                <div className="dispute-card-top">
                                    <div>
                                        <strong>Спор #{dispute.id}</strong>
                                    </div>
                                    <div className={`dispute-admin-badge ${dispute.status}`}>
                                        {getDisputeStatusLabel(dispute.status)}
                                    </div>
                                </div>

                                <p>
                                    <strong>Дата открытия:</strong>{" "}
                                    {dispute.createdAt ? new Date(dispute.createdAt).toLocaleString() : "—"}
                                </p>

                                <p>
                                    <strong>Открыл:</strong>{" "}
                                    {dispute.openedByRole === "creator" ? "Заказчик" : "Исполнитель"} #{dispute.openedById}
                                </p>

                                <p>
                                    <strong>Категория причины:</strong> {getReasonCodeLabel(dispute.reasonCode)}
                                </p>

                                <p>
                                    <strong>Краткая причина:</strong> {dispute.reason || "—"}
                                </p>

                                <p>
                                    <strong>Описание:</strong> {dispute.description || "—"}
                                </p>

                                <p>
                                    <strong>Решение:</strong> {dispute.resolution || "—"}
                                </p>

                                <p>
                                    <strong>Кем решён:</strong> {dispute.resolvedById || "—"}
                                </p>

                                <p>
                                    <strong>Дата решения:</strong>{" "}
                                    {dispute.resolvedAt ? new Date(dispute.resolvedAt).toLocaleString() : "—"}
                                </p>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="order-photos-section">
                <h3>Фото и доказательства</h3>

                {renderPhotos(order.images, "Фото заказчика при создании")}
                {renderPhotos(order.customerBeforePhotos, "Фото заказчика ДО")}
                {renderPhotos(order.customerAfterPhotos, "Фото заказчика ПОСЛЕ")}
                {renderPhotos(order.executorBeforePhotos, "Фото исполнителя ДО")}
                {renderPhotos(order.executorAfterPhotos, "Фото исполнителя ПОСЛЕ")}
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