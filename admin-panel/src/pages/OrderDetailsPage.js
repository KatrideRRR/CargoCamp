import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";
import "../styles/OrderDetailsPage.css";
import OrderServiceDetails from "../components/OrderServiceDetails";

const apiUrl = process.env.REACT_APP_API_URL;

function OrderDetailsPage() {
    const { id } = useParams();
    const [order, setOrder] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [logs, setLogs] = useState([]);
    const [logsLoading, setLogsLoading] = useState(false);
    const [logsError, setLogsError] = useState(null);
    const [disputeActionLoading, setDisputeActionLoading] = useState({});
    const [resolutionInputs, setResolutionInputs] = useState({});
    const [orderDeleteLoading, setOrderDeleteLoading] = useState(false);
    const [orderRestoreLoading, setOrderRestoreLoading] = useState(false);

    const token = localStorage.getItem("authToken");
    const navigate = useNavigate();

    const getVisibilityStatus = (order) => {
        if (order?.adminDeleted) {
            return {
                text: "Удалён админом",
                className: "visibility-badge admin-deleted",
            };
        }

        if (order?.creatorHidden) {
            return {
                text: "Скрыт пользователем",
                className: "visibility-badge creator-hidden",
            };
        }

        return {
            text: "Видимый",
            className: "visibility-badge visible",
        };
    };

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
        const ok = window.confirm(
            "Пометить заказ как удалённый админом? Он останется в базе и логах, но будет отмечен как удалённый."
        );

        if (!ok) return;

        try {
            setOrderDeleteLoading(true);

            const res = await axios.delete(`${apiUrl}/api/admin/orders/${orderId}`, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (res.data?.order) {
                setOrder(res.data.order);
            }

            await reloadLogs();

            alert("Заказ помечен как удалённый админом");
        } catch (error) {
            console.error("Ошибка удаления заказа", error);
            alert(error.response?.data?.message || "Не удалось удалить заказ");
        } finally {
            setOrderDeleteLoading(false);
        }
    };

    const restoreOrder = async (orderId) => {
        const ok = window.confirm("Восстановить заказ и вернуть его в видимость?");

        if (!ok) return;

        try {
            setOrderRestoreLoading(true);

            const res = await axios.patch(
                `${apiUrl}/api/admin/orders/${orderId}/restore`,
                {},
                {
                    headers: { Authorization: `Bearer ${token}` },
                }
            );

            if (res.data?.order) {
                setOrder(res.data.order);
            }

            await reloadLogs();

            alert("Заказ восстановлен");
        } catch (error) {
            console.error("Ошибка восстановления заказа", error);
            alert(error.response?.data?.message || "Не удалось восстановить заказ");
        } finally {
            setOrderRestoreLoading(false);
        }
    };

    const showMessage = (orderId) => {
        navigate(`/${orderId}/messages`);
    };

    const renderPhotos = (photos, title) => {
        if (!Array.isArray(photos) || photos.length === 0) {
            return (
                <div className="photo-block">
                    <h4>{title}</h4>
                    <p className="empty-text">Фото нет</p>
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
                            className="photo-link"
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

    const updateDisputeInOrder = (updatedDispute) => {
        setOrder((prev) => {
            if (!prev) return prev;

            const prevDisputes = Array.isArray(prev.disputes) ? prev.disputes : [];

            return {
                ...prev,
                disputes: prevDisputes.map((d) =>
                    d.id === updatedDispute.id ? updatedDispute : d
                ),
            };
        });
    };

    const reloadLogs = async () => {
        try {
            setLogsLoading(true);
            const res = await axios.get(`${apiUrl}/api/admin/orders/${id}/logs`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            setLogs(res.data?.rows || []);
            setLogsError(null);
        } catch (err) {
            console.error("Ошибка загрузки логов:", err);
            setLogsError(err.response?.data?.message || "Ошибка загрузки логов");
        } finally {
            setLogsLoading(false);
        }
    };

    const changeDisputeStatus = async (disputeId, newStatus) => {
        try {
            setDisputeActionLoading((prev) => ({ ...prev, [`status_${disputeId}`]: true }));

            const res = await axios.patch(
                `${apiUrl}/api/admin/disputes/${disputeId}/status`,
                { status: newStatus },
                {
                    headers: { Authorization: `Bearer ${token}` },
                }
            );

            if (res.data?.dispute) {
                updateDisputeInOrder(res.data.dispute);
            }

            await reloadLogs();
            alert("Статус спора обновлён");
        } catch (err) {
            console.error("Ошибка изменения статуса спора:", err);
            alert(err.response?.data?.message || "Не удалось изменить статус спора");
        } finally {
            setDisputeActionLoading((prev) => ({ ...prev, [`status_${disputeId}`]: false }));
        }
    };

    const resolveDispute = async (disputeId) => {
        try {
            const resolution = (resolutionInputs[disputeId] || "").trim();

            if (!resolution) {
                alert("Введите решение по спору");
                return;
            }

            setDisputeActionLoading((prev) => ({ ...prev, [`resolve_${disputeId}`]: true }));

            const res = await axios.patch(
                `${apiUrl}/api/admin/disputes/${disputeId}/resolve`,
                { resolution },
                {
                    headers: { Authorization: `Bearer ${token}` },
                }
            );

            if (res.data?.dispute) {
                updateDisputeInOrder(res.data.dispute);
            }

            await reloadLogs();
            alert("Спор решён");
        } catch (err) {
            console.error("Ошибка решения спора:", err);
            alert(err.response?.data?.message || "Не удалось решить спор");
        } finally {
            setDisputeActionLoading((prev) => ({ ...prev, [`resolve_${disputeId}`]: false }));
        }
    };

    const getOrderStatusClass = (status) => {
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
            <div className="order-details-container">
                <h2>Детали заказа</h2>
                <p className="page-message">Загрузка...</p>
            </div>
        );
    }

    if (error) {
        return (
            <div className="order-details-container">
                <h2>Детали заказа</h2>
                <p className="page-message error">{error}</p>
            </div>
        );
    }

    if (!order) {
        return (
            <div className="order-details-container">
                <h2>Детали заказа</h2>
                <p className="page-message">Заказ не найден</p>
            </div>
        );
    }

    const disputes = Array.isArray(order.disputes) ? order.disputes : [];
    const visibilityStatus = getVisibilityStatus(order);

    return (
        <div className="order-details-container">
            <h2>Детали заказа #{order.id}</h2>

            <div className="order-card">
                <div className="order-card-header">
                    <h3>Основная информация</h3>

                    <div className="order-card-actions">
                        <button className="message-button" onClick={() => showMessage(order.id)}>
                            Открыть чат
                        </button>

                        {order.adminDeleted || order.creatorHidden ? (
                            <button
                                className="restore-button"
                                onClick={() => restoreOrder(order.id)}
                                disabled={orderRestoreLoading}
                            >
                                {orderRestoreLoading ? "Восстанавливаем..." : "Восстановить"}
                            </button>
                        ) : (
                            <button
                                className="delete-button"
                                onClick={() => deleteOrder(order.id)}
                                disabled={orderDeleteLoading}
                            >
                                {orderDeleteLoading ? "Удаляем..." : "Удалить"}
                            </button>
                        )}
                    </div>
                </div>

                <div className="order-info-grid">
                    <div className="info-item">
                        <span className="info-label">Адрес</span>
                        <span className="info-value">{order.address || "—"}</span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">Статус</span>
                        <span className="info-value">
                            <span className={getOrderStatusClass(order.status)}>
                                {order.status || "—"}
                            </span>
                        </span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">Видимость</span>
                        <span className="info-value">
        <span className={visibilityStatus.className}>
            {visibilityStatus.text}
        </span>
    </span>
                    </div>

                    {order.creatorHidden && (
                        <div className="info-item">
                            <span className="info-label">Скрыт пользователем</span>
                            <span className="info-value">
            {order.creatorHiddenAt ? new Date(order.creatorHiddenAt).toLocaleString() : "Да"}
        </span>
                        </div>
                    )}

                    {order.adminDeleted && (
                        <>
                            <div className="info-item">
                                <span className="info-label">Удалён админом</span>
                                <span className="info-value">
                {order.adminDeletedAt ? new Date(order.adminDeletedAt).toLocaleString() : "Да"}
            </span>
                            </div>

                            <div className="info-item">
                                <span className="info-label">ID админа</span>
                                <span className="info-value">{order.adminDeletedById || "—"}</span>
                            </div>
                        </>
                    )}

                    <div className="info-item">
                        <span className="info-label">Дата создания</span>
                        <span className="info-value">
                            {order.createdAt ? new Date(order.createdAt).toLocaleString() : "—"}
                        </span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">ID создателя</span>
                        <span className="info-value">{order.creatorId || "—"}</span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">ID исполнителя</span>
                        <span className="info-value">{order.executorId || "—"}</span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">Категория</span>
                        <span className="info-value">{order.category ? order.category.name : "Не указано"}</span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">Подкатегория</span>
                        <span className="info-value">{order.subcategory ? order.subcategory.name : "Не указано"}</span>
                    </div>

                    <div className="info-item">
    <span className="info-label">
        Услуга
    </span>

                        <span className="info-value">
        {order.service?.name || "Не указано"}
    </span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">Цена</span>
                        <span className="info-value">{order.proposedSum ?? "—"}</span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">Тип оплаты</span>
                        <span className="info-value">{order.paymentType || "—"}</span>
                    </div>

                    <div className="info-item">
                        <span className="info-label">Статус сделки</span>
                        <span className="info-value">{order.dealStatus || "—"}</span>
                    </div>

                    <div className="info-item">
    <span className="info-label">
        Режим выполнения
    </span>

                        <span className="info-value">
        {order.isAsap === true
            ? "Как можно скорее"
            : order.workTime
                ? "К указанному времени"
                : "Не указан"}
    </span>
                    </div>

                    <div className="info-item">
    <span className="info-label">
        Время выполнения
    </span>

                        <span className="info-value">
        {order.isAsap === true
            ? "Как можно скорее"
            : order.workTime
                ? new Date(
                    order.workTime
                ).toLocaleString("ru-RU")
                : "—"}
    </span>
                    </div>

                    <div className="info-item info-item-full">
                        <span className="info-label">Описание</span>
                        <span className="info-value">{order.description || "—"}</span>
                    </div>
                </div>
            </div>

            <div className="order-card">
                <div className="order-service-card-head">
                    <div>
                        <h3>Параметры услуги</h3>

                        <p className="order-service-card-subtitle">
                            Данные динамической формы,
                            выбранные заказчиком при создании заказа.
                        </p>
                    </div>

                    {order.subcategory?.code && (
                        <span className="order-service-code">
                {order.subcategory.code}
            </span>
                    )}
                </div>

                <OrderServiceDetails
                    order={order}
                />

                {!order.serviceDetails && (
                    <div className="order-service-empty">
                        У этого заказа нет сохранённых дополнительных
                        параметров. Вероятно, заказ был создан до
                        добавления динамической формы.
                    </div>
                )}
            </div>
            
            <div className="order-card">
                <h3>Споры по заказу</h3>

                {disputes.length === 0 ? (
                    <p className="empty-text">По этому заказу споров нет</p>
                ) : (
                    <div className="disputes-list">
                        {disputes.map((dispute) => (
                            <div key={dispute.id} className="dispute-card">
                                <div className="dispute-card-top">
                                    <div className="dispute-title-wrap">
                                        <strong>Спор по заказу #{order.id}</strong>
                                        <span className="dispute-inner-id">ID спора: {dispute.id}</span>
                                    </div>

                                    <div className={`dispute-admin-badge ${dispute.status}`}>
                                        {getDisputeStatusLabel(dispute.status)}
                                    </div>
                                </div>

                                <div className="dispute-info-grid">
                                    <div className="info-item">
                                        <span className="info-label">Инициатор</span>
                                        <span className="info-value">
                                            <span className={dispute.openedByRole === "creator" ? "initiator-creator" : "initiator-executor"}>
                                                {dispute.openedByRole === "creator" ? "Заказчик" : "Исполнитель"}
                                            </span>
                                        </span>
                                    </div>

                                    <div className="info-item">
                                        <span className="info-label">Открыл</span>
                                        <span className="info-value">
                                            {dispute.openedByRole === "creator" ? "Заказчик" : "Исполнитель"} #{dispute.openedById}
                                        </span>
                                    </div>

                                    <div className="info-item">
                                        <span className="info-label">Дата открытия</span>
                                        <span className="info-value">
                                            {dispute.createdAt ? new Date(dispute.createdAt).toLocaleString() : "—"}
                                        </span>
                                    </div>

                                    <div className="info-item">
                                        <span className="info-label">В работе у администратора</span>
                                        <span className="info-value">{dispute.takenByAdminId || "—"}</span>
                                    </div>

                                    <div className="info-item">
                                        <span className="info-label">Взято в работу</span>
                                        <span className="info-value">
                                     {dispute.takenAt ? new Date(dispute.takenAt).toLocaleString() : "—"}
                                        </span>
                                    </div>

                                    <div className="info-item">
                                        <span className="info-label">Категория причины</span>
                                        <span className="info-value">{getReasonCodeLabel(dispute.reasonCode)}</span>
                                    </div>

                                    <div className="info-item info-item-full">
                                        <span className="info-label">Краткая причина</span>
                                        <span className="info-value">{dispute.reason || "—"}</span>
                                    </div>

                                    <div className="info-item info-item-full">
                                        <span className="info-label">Описание</span>
                                        <span className="info-value">{dispute.description || "—"}</span>
                                    </div>

                                    <div className="info-item info-item-full">
                                        <span className="info-label">Решение</span>
                                        <span className="info-value">{dispute.resolution || "—"}</span>
                                    </div>

                                    <div className="info-item">
                                        <span className="info-label">Кем решён</span>
                                        <span className="info-value">{dispute.resolvedById || "—"}</span>
                                    </div>

                                    <div className="info-item">
                                        <span className="info-label">Дата решения</span>
                                        <span className="info-value">
                                            {dispute.resolvedAt ? new Date(dispute.resolvedAt).toLocaleString() : "—"}
                                        </span>
                                    </div>
                                </div>

                                <div className="dispute-admin-actions">
                                    <h4>Управление спором</h4>

                                    {dispute.status !== "in_review" &&
                                        dispute.status !== "resolved" &&
                                        dispute.status !== "closed" && (
                                            <div className="dispute-status-actions">
                                                <button
                                                    className="dispute-action-button"
                                                    onClick={() => changeDisputeStatus(dispute.id, "in_review")}
                                                    disabled={disputeActionLoading[`status_${dispute.id}`]}
                                                >
                                                    Взять в работу
                                                </button>

                                            </div>
                                        )}

                                    {dispute.status === "in_review" && (
                                        <div className="dispute-resolution-box">
                                            <label className="dispute-resolution-label">
                                                Решение администратора
                                            </label>

                                            <textarea
                                                className="dispute-resolution-textarea"
                                                rows={4}
                                                placeholder="Напишите итоговое решение по спору"
                                                value={resolutionInputs[dispute.id] ?? dispute.resolution ?? ""}
                                                onChange={(e) =>
                                                    setResolutionInputs((prev) => ({
                                                        ...prev,
                                                        [dispute.id]: e.target.value,
                                                    }))
                                                }
                                                disabled={disputeActionLoading[`resolve_${dispute.id}`]}
                                            />

                                            <button
                                                className="dispute-resolve-button"
                                                onClick={() => resolveDispute(dispute.id)}
                                                disabled={disputeActionLoading[`resolve_${dispute.id}`]}
                                            >
                                                {disputeActionLoading[`resolve_${dispute.id}`]
                                                    ? "Сохраняем..."
                                                    : "Решить спор"}
                                            </button>
                                        </div>
                                    )}

                                    {(dispute.status === "resolved" || dispute.status === "closed") && (
                                        <p className="empty-text">Этот спор уже завершён.</p>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="order-card">
                <h3>Фото и доказательства</h3>

                <div className="photos-section-grid">
                    {renderPhotos(order.images, "Фото заказчика при создании")}
                    {renderPhotos(order.customerBeforePhotos, "Фото заказчика ДО")}
                    {renderPhotos(order.customerAfterPhotos, "Фото заказчика ПОСЛЕ")}
                    {renderPhotos(order.executorBeforePhotos, "Фото исполнителя ДО")}
                    {renderPhotos(order.executorAfterPhotos, "Фото исполнителя ПОСЛЕ")}
                </div>
            </div>

            <div className="order-card">
                <h3>История действий</h3>

                {logsLoading && <p className="empty-text">Загрузка логов...</p>}
                {logsError && <p className="page-message error">{logsError}</p>}

                {!logsLoading && !logsError && logs.length === 0 && (
                    <p className="empty-text">Логов пока нет</p>
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

export default OrderDetailsPage;