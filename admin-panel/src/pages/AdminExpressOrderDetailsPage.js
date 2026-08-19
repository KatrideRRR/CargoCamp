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
    const [logs, setLogs] = useState([]);
    const [loading, setLoading] = useState(true);
    const [logsLoading, setLogsLoading] = useState(false);
    const [error, setError] = useState("");
    const [logsError, setLogsError] = useState("");
    const [disputes, setDisputes] =
        useState([]);

    const [
        disputesLoading,
        setDisputesLoading,
    ] = useState(false);

    const [
        disputesError,
        setDisputesError,
    ] = useState("");

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

    useEffect(() => {
        if (!token || !id) {
            return;
        }

        setDisputesLoading(true);

        axios
            .get(
                `${apiUrl}/api/admin/disputes`,
                {
                    headers: {
                        Authorization:
                            `Bearer ${token}`,
                    },

                    params: {
                        orderType:
                            "express",

                        orderId:
                        id,
                    },
                }
            )
            .then((res) => {
                setDisputes(
                    Array.isArray(
                        res.data?.disputes
                    )
                        ? res.data.disputes
                        : []
                );

                setDisputesError("");
            })
            .catch((err) => {
                console.error(
                    "Ошибка загрузки споров express-заказа:",
                    err
                );

                setDisputesError(
                    err.response?.data
                        ?.message ||
                    "Ошибка загрузки споров"
                );
            })
            .finally(() => {
                setDisputesLoading(false);
            });

    }, [id, token]);

    useEffect(() => {
        if (!token) return;

        setLogsLoading(true);

        axios
            .get(`${apiUrl}/api/admin/express-orders/${id}/logs`, {
                headers: { Authorization: `Bearer ${token}` },
            })
            .then((res) => {
                setLogs(res.data?.rows || []);
                setLogsError("");
                setLogsLoading(false);
            })
            .catch((err) => {
                console.error("Ошибка загрузки логов express-заказа:", err);
                setLogsError(err.response?.data?.message || "Ошибка загрузки логов");
                setLogsLoading(false);
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

    const getDisputeReasonLabel = (
        reasonCode
    ) => {
        const labels = {
            work_not_done:
                "Работа не выполнена",

            poor_quality:
                "Низкое качество",

            missed_deadline:
                "Нарушены сроки",

            wrong_price:
                "Проблема со стоимостью",

            rude_behavior:
                "Некорректное поведение",

            executor_no_show:
                "Исполнитель не приехал",

            executor_late:
                "Исполнитель сильно опоздал",

            damaged_property:
                "Повреждение имущества или груза",

            service_problem:
                "Проблема с поездкой или доставкой",

            customer_no_show:
                "Заказчик не появился",

            customer_unreachable:
                "Не удаётся связаться с заказчиком",

            wrong_address:
                "Неверный адрес или маршрут",

            order_mismatch:
                "Условия заказа не соответствуют описанию",

            payment_problem:
                "Проблема с оплатой",

            unsafe_situation:
                "Небезопасная ситуация",

            other:
                "Другое",
        };

        return labels[reasonCode] ||
            reasonCode ||
            "—";
    };

    const getDisputeStatusLabel = (
        status
    ) => {
        const labels = {
            open:
                "Открыт",

            in_review:
                "В работе",

            waiting_creator:
                "Ожидается заказчик",

            waiting_executor:
                "Ожидается исполнитель",

            resolved:
                "Решён",

            closed:
                "Закрыт",
        };

        return labels[status] ||
            status ||
            "—";
    };

    const getDisputeRoleLabel = (
        role
    ) => {
        if (role === "creator") {
            return "Заказчик";
        }

        if (role === "executor") {
            return "Исполнитель";
        }

        return role || "—";
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
{order.created_at || order.createdAt
    ? new Date(
        order.created_at || order.createdAt
    ).toLocaleString("ru-RU")
    : "—"}
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

            <div className="express-card">
                <h3>Споры и проблемы</h3>

                {disputesLoading && (
                    <p className="page-message">
                        Загрузка споров...
                    </p>
                )}

                {disputesError && (
                    <p className="page-message error">
                        {disputesError}
                    </p>
                )}

                {!disputesLoading &&
                    !disputesError &&
                    disputes.length === 0 && (
                        <p className="page-message">
                            По этому экспресс-заказу
                            споров нет
                        </p>
                    )}

                {!disputesLoading &&
                    !disputesError &&
                    disputes.map((dispute) => (
                        <div
                            key={dispute.id}
                            className="admin-dispute-box"
                        >
                            <div className="express-info-grid">

                                <div className="info-item">
                        <span className="info-label">
                            Спор
                        </span>

                                    <span className="info-value">
                            #{dispute.id}
                        </span>
                                </div>

                                <div className="info-item">
                        <span className="info-label">
                            Статус
                        </span>

                                    <span className="info-value">
                            {getDisputeStatusLabel(
                                dispute.status
                            )}
                        </span>
                                </div>

                                <div className="info-item">
                        <span className="info-label">
                            Открыл
                        </span>

                                    <span className="info-value">
                            {getDisputeRoleLabel(
                                dispute.openedByRole
                            )}

                                        {dispute.openedById
                                            ? ` #${dispute.openedById}`
                                            : ""}
                        </span>
                                </div>

                                <div className="info-item">
                        <span className="info-label">
                            Дата
                        </span>

                                    <span className="info-value">
                            {dispute.createdAt
                                ? new Date(
                                    dispute.createdAt
                                ).toLocaleString()
                                : "—"}
                        </span>
                                </div>

                                <div className="info-item info-item-full">
                        <span className="info-label">
                            Категория
                        </span>

                                    <span className="info-value">
                            {getDisputeReasonLabel(
                                dispute.reasonCode
                            )}
                        </span>
                                </div>

                                <div className="info-item info-item-full">
                        <span className="info-label">
                            Причина
                        </span>

                                    <span className="info-value">
                            {dispute.reason ||
                                "—"}
                        </span>
                                </div>

                                <div className="info-item info-item-full">
                        <span className="info-label">
                            Описание
                        </span>

                                    <span className="info-value">
                            {dispute.description ||
                                "—"}
                        </span>
                                </div>

                                {dispute.resolution && (
                                    <div className="info-item info-item-full">
                            <span className="info-label">
                                Решение
                            </span>

                                        <span className="info-value">
                                {dispute.resolution}
                            </span>
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
            </div>

            <div className="express-card">
                <h3>История действий</h3>

                {logsLoading && <p className="page-message">Загрузка логов...</p>}
                {logsError && <p className="page-message error">{logsError}</p>}

                {!logsLoading && !logsError && logs.length === 0 && (
                    <p className="page-message">Логов пока нет</p>
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
                                        {l.actorRole}
                                        {l.actorUserId ? ` #${l.actorUserId}` : ""}
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

export default AdminExpressOrderDetailsPage;