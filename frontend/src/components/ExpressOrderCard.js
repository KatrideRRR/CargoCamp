import React, { useMemo, useState } from "react";
import axiosInstance from "../utils/axiosInstance";
import { FaCheck, FaTimes, FaCarSide, FaPlay, FaFlagCheckered } from "react-icons/fa";
import ExpressRouteButtons from "./ExpressRouteButtons";

const statusTitle = {
    created: "Создан",
    accepted: "Принят",
    on_the_way_to_A: "В пути к A",
    arrived_at_A: "Прибыл в A",
    in_progress: "В пути A→B",
    completed: "Завершён",
    cancelled: "Отменён",
};

const pill = (s) => statusTitle[s] || s;

const ExpressOrderCard = ({ order, userId, onReload }) => {
    const [busy, setBusy] = useState(false);
    const [expanded, setExpanded] = useState(false);

    const isExecutor = Number(order.executorId) === Number(userId);
    const isCreator = Number(order.creatorId) === Number(userId);

    const role = isExecutor ? "executor" : "creator";

    const canToA = isExecutor && ["accepted", "on_the_way_to_A", "arrived_at_A"].includes(order.status);
    const canAToB = ["arrived_at_A", "in_progress", "completed"].includes(order.status);

    const typeBadge = useMemo(() => {
        return order.type === "taxi" ? "🚕 Такси" : "📦 Курьер";
    }, [order.type]);

    const doAction = async (fn) => {
        if (busy) return;
        setBusy(true);
        try {
            await fn();
            await onReload?.();
        } catch (e) {
            console.error(e);
            alert(e.response?.data?.message || "Ошибка действия");
        } finally {
            setBusy(false);
        }
    };

    const onTheWay = () => doAction(() => axiosInstance.post(`/express/express-orders/${order.id}/on-the-way`));
    const arrived = () => doAction(() => axiosInstance.post(`/express/express-orders/${order.id}/arrived`));
    const start = () => doAction(() => axiosInstance.post(`/express/express-orders/${order.id}/start`));
    const complete = () => doAction(() => axiosInstance.post(`/express/express-orders/${order.id}/complete`));
    const cancel = () => doAction(() => axiosInstance.post(`/express/express-orders/${order.id}/cancel`));

    const showExecutorButtons = isExecutor && !["completed", "cancelled"].includes(order.status);
    const showCreatorCancel =
        isCreator && ["created", "accepted", "on_the_way_to_A", "arrived_at_A"].includes(order.status);

    return (
        <li className="order-card express-card">
            <div className="order-header" onClick={() => setExpanded((p) => !p)}>
                <div className="order-top">
                    <div className="order-title">
                        <strong>Экспресс-заказ #{order.id}</strong>{" "}
                        <span className="express-badges">
              <span className={`express-pill express-pillType ${order.type}`}>{typeBadge}</span>
              <span className={`express-pill express-pillStatus ${order.status}`}>{pill(order.status)}</span>
              <span className="express-pill express-pillRole">{role === "executor" ? "Вы исполнитель" : "Вы заказчик"}</span>
            </span>
                    </div>

                    <div className="payment-icon-container">
                        <span className="payment-icon">{order.paymentType === "guarantee" ? "🏦" : "💵"}</span>
                    </div>
                </div>

                <div className="order-subline">
                    Создан {order.createdAt ? new Date(order.createdAt).toLocaleString() : "—"} • Цена:{" "}
                    <b>{Number(order.totalPrice) || 0} ₽</b>
                </div>

                <div className="express-pointsMini">
                    <div className="express-point">
                        <div className="express-pointLabel">A</div>
                        <div className="express-pointText">{order.fromAddress}</div>
                    </div>
                    <div className="express-point">
                        <div className="express-pointLabel">B</div>
                        <div className="express-pointText">{order.toAddress}</div>
                    </div>
                </div>

                {/* Маршруты */}
                <ExpressRouteButtons orderId={order.id} canToA={canToA} canAToB={canAToB} />

                {/* Действия статусов (только для express) */}
                <div className="express-actions-row">
                    {showExecutorButtons && (
                        <>
                            {order.status === "accepted" && (
                                <button className="express-btn express-btnPrimary" type="button" disabled={busy} onClick={onTheWay}>
                                    <FaCarSide /> Выехал
                                </button>
                            )}

                            {["accepted", "on_the_way_to_A"].includes(order.status) && (
                                <button className="express-btn express-btnPrimary" type="button" disabled={busy} onClick={arrived}>
                                    <FaCheck /> Прибыл в A
                                </button>
                            )}

                            {order.status === "arrived_at_A" && (
                                <button className="express-btn express-btnPrimary" type="button" disabled={busy} onClick={start}>
                                    <FaPlay /> Начать A→B
                                </button>
                            )}

                            {order.status === "in_progress" && (
                                <button className="express-btn express-btnPrimary" type="button" disabled={busy} onClick={complete}>
                                    <FaFlagCheckered /> Завершить
                                </button>
                            )}

                            {["accepted", "on_the_way_to_A", "arrived_at_A"].includes(order.status) && (
                                <button className="express-btn express-btnDanger" type="button" disabled={busy} onClick={cancel}>
                                    <FaTimes /> Отменить
                                </button>
                            )}
                        </>
                    )}

                    {showCreatorCancel && (
                        <button className="express-btn express-btnDanger" type="button" disabled={busy} onClick={cancel}>
                            <FaTimes /> Отменить
                        </button>
                    )}
                </div>
            </div>

            {expanded && (
                <div className="order-details">
                    <p><strong>Точка A:</strong> {order.fromAddress}</p>
                    <p><strong>Точка B:</strong> {order.toAddress}</p>
                    {order.description ? <p><strong>Комментарий:</strong> {order.description}</p> : null}
                    <p><strong>Оплата:</strong> {order.paymentType === "guarantee" ? "Гарантия" : "Наличные"}</p>
                    <p><strong>distanceKm:</strong> {order.distanceKm ?? "—"} • <strong>ETA:</strong> {order.estimatedTimeMin ?? "—"} мин</p>
                </div>
            )}
        </li>
    );
};

export default ExpressOrderCard;