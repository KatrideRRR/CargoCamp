import React, { useMemo, useState } from "react";
import axiosInstance from "../utils/axiosInstance";
import {
    FaCheck,
    FaTimes,
    FaCarSide,
    FaPlay,
    FaFlagCheckered,
    FaBoxOpen,
    FaHourglassHalf,
    FaPhone,
    FaComments,
    FaExclamationTriangle,
} from "react-icons/fa";
import ExpressRouteButtons from "./ExpressRouteButtons";

function getExpressSteps(type) {
    if (type === "taxi") {
        return [
            { key: "accepted", label: "Принят" },
            { key: "on_the_way_to_A", label: "В пути" },
            { key: "arrived_at_A", label: "На месте" },
            { key: "waiting_at_A", label: "Ожидание" },
            { key: "in_progress", label: "В пути" },
            { key: "completed", label: "Завершён" },
        ];
    }

    return [
        { key: "accepted", label: "Принят" },
        { key: "on_the_way_to_A", label: "В пути" },
        { key: "arrived_at_A", label: "На месте" },
        { key: "picked_up", label: "Забрал" },
        { key: "in_progress", label: "Доставка" },
        { key: "completed", label: "Завершён" },
    ];
}

function getExpressCurrentStepIndex(type, status) {
    const taxiMap = {
        accepted: 0,
        on_the_way_to_A: 1,
        arrived_at_A: 2,
        waiting_at_A: 3,
        in_progress: 4,
        completed: 5,
    };

    const courierMap = {
        accepted: 0,
        on_the_way_to_A: 1,
        arrived_at_A: 2,
        picked_up: 3,
        in_progress: 4,
        completed: 5,
    };

    return type === "taxi"
        ? (taxiMap[status] ?? 0)
        : (courierMap[status] ?? 0);
}

function getStatusText(type, status, isCreator) {
    if (type === "taxi") {
        switch (status) {
            case "accepted":
                return isCreator ? "Исполнитель принял заказ" : "Заказ принят";
            case "on_the_way_to_A":
                return isCreator ? "Исполнитель в пути к вам" : "Вы в пути к клиенту";
            case "arrived_at_A":
                return isCreator ? "Исполнитель на месте" : "Вы на месте";
            case "waiting_at_A":
                return isCreator ? "Исполнитель ожидает клиента" : "Ожидание клиента";
            case "in_progress":
                return isCreator ? "Вы в пути" : "Клиент в машине";
            case "completed":
                return "Заказ завершён";
            case "cancelled":
                return "Заказ отменён";
            default:
                return "Статус обновляется";
        }
    }

    switch (status) {
        case "accepted":
            return isCreator ? "Исполнитель принял заказ" : "Заказ принят";
        case "on_the_way_to_A":
            return isCreator ? "Исполнитель едет за заказом" : "Вы едете в точку A";
        case "arrived_at_A":
            return isCreator ? "Исполнитель на месте" : "Вы на месте";
        case "picked_up":
            return isCreator ? "Заказ забран" : "Заказ у вас";
        case "in_progress":
            return isCreator ? "Заказ в пути" : "Вы везёте заказ";
        case "completed":
            return "Заказ завершён";
        case "cancelled":
            return "Заказ отменён";
        default:
            return "Статус обновляется";
    }
}

const ExpressOrderCard = ({
                              order,
                              userId,
                              onReload,
                              onOpenChat,
                              onOpenDispute,
                              onCallUser,
                          }) => {
    const [busy, setBusy] = useState(false);

    const isExecutor = Number(order.executorId) === Number(userId);
    const isCreator = Number(order.creatorId) === Number(userId);

    const typeText = useMemo(
        () => (order.type === "taxi" ? "Такси" : "Курьер"),
        [order.type]
    );

    const paymentLabel =
        order.paymentType === "guarantee"
            ? "Гарантия"
            : order.paymentType === "cash"
                ? "Наличные"
                : "Оплата";

    const paymentIcon = order.paymentType === "guarantee" ? "🏦" : "💵";

    const steps = useMemo(() => getExpressSteps(order.type), [order.type]);
    const currentStepIndex = useMemo(
        () => getExpressCurrentStepIndex(order.type, order.status),
        [order.type, order.status]
    );

    const statusText = useMemo(
        () => getStatusText(order.type, order.status, isCreator),
        [order.type, order.status, isCreator]
    );

    const doAction = async (fn, confirmText = "") => {
        if (busy) return;

        if (confirmText) {
            const ok = window.confirm(confirmText);
            if (!ok) return;
        }

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

    const onTheWay = () =>
        doAction(
            () => axiosInstance.post(`/express/express-orders/${order.id}/on-the-way`),
            "Подтвердить, что вы выехали к точке A?"
        );

    const arrived = () =>
        doAction(
            () => axiosInstance.post(`/express/express-orders/${order.id}/arrived`),
            "Подтвердить, что вы прибыли на место?"
        );

    const startWaiting = () =>
        doAction(
            () => axiosInstance.post(`/express/express-orders/${order.id}/start-waiting`),
            "Подтвердить начало ожидания клиента?"
        );

    const pickUp = () =>
        doAction(
            () => axiosInstance.post(`/express/express-orders/${order.id}/pick-up`),
            "Подтвердить, что вы забрали заказ?"
        );

    const start = () =>
        doAction(
            () => axiosInstance.post(`/express/express-orders/${order.id}/start`),
            order.type === "taxi"
                ? "Подтвердить, что клиент сел в машину и поездка началась?"
                : "Подтвердить начало доставки?"
        );

    const complete = () =>
        doAction(
            () => axiosInstance.post(`/express/express-orders/${order.id}/complete`),
            "Подтвердить завершение заказа?"
        );

    const cancel = () =>
        doAction(
            () => axiosInstance.post(`/express/express-orders/${order.id}/cancel`),
            "Вы уверены, что хотите отменить заказ?"
        );

    const nextAction = useMemo(() => {
        if (!isExecutor) return null;

        if (order.type === "taxi") {
            if (order.status === "accepted") {
                return { label: "Еду к точке", icon: <FaCarSide />, onClick: onTheWay };
            }
            if (order.status === "on_the_way_to_A") {
                return { label: "Я на месте", icon: <FaCheck />, onClick: arrived };
            }
            if (order.status === "arrived_at_A") {
                return { label: "Начать ожидание", icon: <FaHourglassHalf />, onClick: startWaiting };
            }
            if (order.status === "waiting_at_A") {
                return { label: "Клиент сел", icon: <FaPlay />, onClick: start };
            }
            if (order.status === "in_progress") {
                return { label: "Завершить заказ", icon: <FaFlagCheckered />, onClick: complete };
            }
        }

        if (order.type === "courier") {
            if (order.status === "accepted") {
                return { label: "Еду к точке", icon: <FaCarSide />, onClick: onTheWay };
            }
            if (order.status === "on_the_way_to_A") {
                return { label: "Я на месте", icon: <FaCheck />, onClick: arrived };
            }
            if (order.status === "arrived_at_A") {
                return { label: "Забрал заказ", icon: <FaBoxOpen />, onClick: pickUp };
            }
            if (order.status === "picked_up") {
                return { label: "Начать доставку", icon: <FaPlay />, onClick: start };
            }
            if (order.status === "in_progress") {
                return { label: "Завершить заказ", icon: <FaFlagCheckered />, onClick: complete };
            }
        }

        return null;
    }, [isExecutor, order.type, order.status]);

    const navMode = useMemo(() => {
        if (!isExecutor) return "none";

        if (order.type === "taxi") {
            if (["accepted", "on_the_way_to_A", "arrived_at_A", "waiting_at_A"].includes(order.status)) {
                return "toA";
            }

            if (["in_progress", "completed"].includes(order.status)) {
                return "AtoB";
            }
        }

        if (order.type === "courier") {
            if (["accepted", "on_the_way_to_A", "arrived_at_A"].includes(order.status)) {
                return "toA";
            }

            if (["picked_up", "in_progress", "completed"].includes(order.status)) {
                return "AtoB";
            }
        }

        return "none";
    }, [isExecutor, order.type, order.status]);

    const canCancel =
        (isCreator &&
            ["created", "accepted", "on_the_way_to_A", "arrived_at_A", "waiting_at_A"].includes(order.status)) ||
        (isExecutor &&
            ["accepted", "on_the_way_to_A", "arrived_at_A", "waiting_at_A"].includes(order.status));

    return (
        <li className={`order-card express-card ${order.type === "taxi" ? "express-taxi" : "express-courier"}`}>
            <div className="order-header">
                <div className="order-top">
                    <div className="order-title-wrap">
                        <div className="order-title">
                            <strong>Экспресс №{order.id}</strong>
                        </div>

                        <div className="role-badge-row">
                            <span className={`role-badge ${isCreator ? "creator-role" : "executor-role"}`}>
                                {isCreator ? "Вы заказчик" : "Вы исполнитель"}
                            </span>

                            <span className={`express-pill express-pillType ${order.type}`}>
                                {typeText}
                            </span>
                        </div>
                    </div>

                    <div className="pay-box express-pay">
                        <span className="pay-icon" title={paymentLabel}>{paymentIcon}</span>
                        <div className="pay-right">
                            <div className="pay-price">
                                {Number(order.totalPrice ?? 0).toLocaleString("ru-RU")} ₽
                            </div>
                            <div className="pay-type">{paymentLabel}</div>
                        </div>
                    </div>
                </div>

                <div className="order-subline">
                    Создан {new Date(order.created_at || order.createdAt).toLocaleString()}
                </div>

                <div className="express-stepper">
                    {steps.map((step, index) => {
                        const state =
                            index < currentStepIndex
                                ? "done"
                                : index === currentStepIndex
                                    ? "active"
                                    : "idle";

                        return (
                            <div key={step.key} className={`express-step ${state}`}>
                                <div className="express-stepCircle">{index + 1}</div>
                                <div className="express-stepLabel">{step.label}</div>
                            </div>
                        );
                    })}
                </div>

                <div className="express-statusBar">
                    {statusText}
                </div>

                <div className="order-details">
                    <div className="express-ab">
                        <div className="express-abItem">
                            <div className="express-abLabel">Откуда</div>
                            <div className="express-abValue">{order.fromAddress}</div>
                        </div>

                        <div className="express-abArrow">→</div>

                        <div className="express-abItem">
                            <div className="express-abLabel">Куда</div>
                            <div className="express-abValue">{order.toAddress}</div>
                        </div>
                    </div>

                    {order.description ? (
                        <p className="express-comment">
                            <strong>Комментарий:</strong> {order.description}
                        </p>
                    ) : null}

                    <div className="active-buttons express-mainButtons">
                        <button
                            className="call-button"
                            onClick={() => onCallUser?.(order)}
                        >
                            <FaPhone />
                            <span className="btn-text">Позвонить</span>
                        </button>

                        <button
                            className="message-button"
                            onClick={() => onOpenChat?.(order.id)}
                        >
                            <FaComments />
                            <span className="btn-text">Чат</span>
                        </button>

                        <button
                            className="dispute-button"
                            onClick={() => onOpenDispute?.(order)}
                        >
                            <FaExclamationTriangle />
                            <span className="btn-text">Проблема</span>
                        </button>
                    </div>

                    {nextAction && !["completed", "cancelled"].includes(order.status) && isExecutor && (
                        <div className="express-mainActionRow">
                            <button
                                className="express-btn express-btnMain express-btnMainAccent"
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

                    <div className="express-actionsRow">
                        {isExecutor ? (
                            <ExpressRouteButtons orderId={order.id} navMode={navMode} />
                        ) : (
                            <div />
                        )}

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
                        <strong>Расстояние:</strong> {order.distanceKm ?? "—"} км •{" "}
                        <strong>Время:</strong> {order.estimatedTimeMin ?? "—"} мин
                    </p>
                </div>
            </div>
        </li>
    );
};

export default ExpressOrderCard;