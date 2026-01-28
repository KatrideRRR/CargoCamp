import React, { useMemo, useState } from "react";
import axiosInstance from "../utils/axiosInstance";
import { FaCheck, FaTimes, FaCarSide, FaPlay, FaFlagCheckered } from "react-icons/fa";
import ExpressRouteButtons from "./ExpressRouteButtons";

const ExpressOrderCard = ({ order, userId, onReload }) => {
    const [busy, setBusy] = useState(false);
    const [expanded, setExpanded] = useState(false);

    const isExecutor = Number(order.executorId) === Number(userId);
    const isCreator = Number(order.creatorId) === Number(userId);

    const typeText = useMemo(() => (order.type === "taxi" ? "Такси" : "Курьер"), [order.type]);

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

    // 1 главная кнопка "следующий шаг" — только исполнителю
    const nextAction = useMemo(() => {
        if (!isExecutor) return null;

        if (order.status === "accepted") return { label: "Выехал", icon: <FaCarSide />, onClick: onTheWay };
        if (order.status === "on_the_way_to_A") return { label: "Прибыл", icon: <FaCheck />, onClick: arrived };
        if (order.status === "arrived_at_A") return { label: "Старт", icon: <FaPlay />, onClick: start };
        if (order.status === "in_progress") return { label: "Завершить", icon: <FaFlagCheckered />, onClick: complete };

        return null;
    }, [isExecutor, order.status]);

    // навигация только исполнителю
    const navMode = useMemo(() => {
        if (!isExecutor) return "none";
        if (["accepted", "on_the_way_to_A", "arrived_at_A"].includes(order.status)) return "toA";
        if (["in_progress", "completed"].includes(order.status)) return "AtoB";
        return "none";
    }, [isExecutor, order.status]);

    // отмена: исполнителю (до старта A→B) и заказчику (пока не завершено)
    const canCancel =
        (isCreator && ["created", "accepted", "on_the_way_to_A", "arrived_at_A"].includes(order.status)) ||
        (isExecutor && ["accepted", "on_the_way_to_A", "arrived_at_A"].includes(order.status));

    const paymentLabel =
        order.paymentType === "guarantee" ? "Гарантия" : order.paymentType === "cash" ? "Наличные" : "Оплата";
    const paymentIcon = order.paymentType === "guarantee" ? "🏦" : "💵";

    return (
        <li className={`order-card express-card ${order.type === "taxi" ? "express-taxi" : "express-courier"}`}>
            <div className="order-header" onClick={() => setExpanded((p) => !p)}>
                {/* top row: title left, pay right */}
                <div className="express-topRow">
                    <div className="express-left">
                        <div className="express-titleRow">
                            <strong className="express-title">Экспресс #{order.id}</strong>
                            <span className={`express-pill express-pillType ${order.type}`}>{typeText}</span>
                            {/* статус "принят" и роли — убрали */}
                        </div>
                    </div>

                    {/* PAY BOX как в обычных заказах */}
                    <div className="pay-box express-pay" onClick={(e) => e.stopPropagation()}>
                        <span className="pay-icon" title={paymentLabel}>{paymentIcon}</span>
                        <div className="pay-right">
                            <div className="pay-price">{Number(order.totalPrice ?? 0).toLocaleString("ru-RU")} ₽</div>
                            <div className="pay-type">{paymentLabel}</div>
                        </div>
                    </div>
                </div>

                {/* main action row (свернутая карточка) */}
                {nextAction && !["completed", "cancelled"].includes(order.status) && isExecutor && (
                    <div className="express-mainActionRow" onClick={(e) => e.stopPropagation()}>
                        <button
                            className="express-btn express-btnMain"
                            type="button"
                            disabled={busy}
                            onClick={nextAction.onClick}
                            aria-label={nextAction.label}
                            title={nextAction.label}
                        >
                            {nextAction.icon}
                            <span className="btn-text">{nextAction.label}</span>
                        </button>
                    </div>
                )}
            </div>

            {/* expanded */}
            {expanded && (
                <div className="order-details" onClick={(e) => e.stopPropagation()}>
                    {/* красиво A → B */}
                    <div className="express-ab">
                        <div className="express-abItem">
                            <div className="express-abLabel">Пункт A</div>
                            <div className="express-abValue">{order.fromAddress}</div>
                        </div>

                        <div className="express-abArrow">→</div>

                        <div className="express-abItem">
                            <div className="express-abLabel">Пункт B</div>
                            <div className="express-abValue">{order.toAddress}</div>
                        </div>
                    </div>

                    {order.description ? (
                        <p className="express-comment">
                            <strong>Комментарий:</strong> {order.description}
                        </p>
                    ) : null}

                    {/* actions in expanded */}
                    <div className="express-actionsRow">
                        {/* навигация только исполнителю */}
                        {isExecutor ? <ExpressRouteButtons orderId={order.id} navMode={navMode} /> : <div />}

                        {/* отмена для обоих, если можно */}
                        {canCancel && !["completed", "cancelled"].includes(order.status) ? (
                            <button
                                className="express-btn express-btnCancel"
                                type="button"
                                disabled={busy}
                                onClick={cancel}
                                aria-label="Отменить"
                                title="Отменить"
                            >
                                <FaTimes />
                                <span className="btn-text">Отменить</span>
                            </button>
                        ) : (
                            <div />
                        )}
                    </div>

                    <p className="express-meta">
                        <strong>distance:</strong> {order.distanceKm ?? "—"} км • <strong>ETA:</strong> {order.estimatedTimeMin ?? "—"} мин
                    </p>
                </div>
            )}
        </li>
    );
};

export default ExpressOrderCard;