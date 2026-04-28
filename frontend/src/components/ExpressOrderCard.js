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
    FaMapMarkedAlt,
    FaClipboardCheck,
} from "react-icons/fa";
import ExpressRouteButtons from "./ExpressRouteButtons";

function getExpressSteps(type) {
    if (type === "taxi") {
        return [
            { key: "accepted", label: "Принят", icon: <FaClipboardCheck /> },
            { key: "on_the_way_to_A", label: "В пути", icon: <FaCarSide /> },
            { key: "arrived_at_A", label: "На месте", icon: <FaCheck /> },
            { key: "waiting_at_A", label: "Ожидание", icon: <FaHourglassHalf /> },
            { key: "in_progress", label: "Поездка", icon: <FaPlay /> },
            { key: "completed", label: "Завершён", icon: <FaFlagCheckered /> },
        ];
    }

    return [
        { key: "accepted", label: "Принят", icon: <FaClipboardCheck /> },
        { key: "on_the_way_to_A", label: "В пути", icon: <FaCarSide /> },
        { key: "arrived_at_A", label: "На месте", icon: <FaCheck /> },
        { key: "picked_up", label: "Забрал", icon: <FaBoxOpen /> },
        { key: "in_progress", label: "Доставка", icon: <FaPlay /> },
        { key: "completed", label: "Завершён", icon: <FaFlagCheckered /> },
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
                              onCompletedSuccessfully,
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
            order.type === "taxi"
                ? "Подтвердить, что клиент сел в машину?"
                : "Подтвердить, что вы забрали заказ?"
        );

    const complete = () =>
        doAction(
            async () => {
                const res = await axiosInstance.post(`/express/express-orders/${order.id}/complete`);
                if (res.data?.success && res.data?.order) {
                    onCompletedSuccessfully?.(res.data.order);
                }
                return res;
            },
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
                return { label: "Еду к точке A", icon: <FaCarSide />, onClick: onTheWay };
            }
            if (order.status === "on_the_way_to_A") {
                return { label: "Я на месте", icon: <FaCheck />, onClick: arrived };
            }
            if (order.status === "arrived_at_A") {
                return { label: "Начать ожидание", icon: <FaHourglassHalf />, onClick: startWaiting };
            }
            if (order.status === "waiting_at_A") {
                return {
                    label: "Клиент в машине",
                    icon: <FaPlay />,
                    onClick: () =>
                        doAction(
                            () => axiosInstance.post(`/express/express-orders/${order.id}/start`),
                            "Подтвердить, что клиент сел в машину и поездка началась?"
                        ),
                };
            }
            if (order.status === "in_progress") {
                return { label: "Завершить заказ", icon: <FaFlagCheckered />, onClick: complete };
            }
        } else {
            if (order.status === "accepted") {
                return { label: "Еду к точке A", icon: <FaCarSide />, onClick: onTheWay };
            }
            if (order.status === "on_the_way_to_A") {
                return { label: "Я на месте", icon: <FaCheck />, onClick: arrived };
            }
            if (order.status === "arrived_at_A") {
                return { label: "Забрал заказ", icon: <FaBoxOpen />, onClick: pickUp };
            }
            if (order.status === "picked_up") {
                return {
                    label: "Начать доставку",
                    icon: <FaPlay />,
                    onClick: () =>
                        doAction(
                            () => axiosInstance.post(`/express/express-orders/${order.id}/start`),
                            "Подтвердить начало доставки?"
                        ),
                };
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

                <div className="express-stepperOuter">
                    <div className="express-stepperPremium">
                        {steps.map((step, index) => {
                            const state =
                                index < currentStepIndex
                                    ? "done"
                                    : index === currentStepIndex
                                        ? "active"
                                        : "idle";

                            const isLast = index === steps.length - 1;

                            return (
                                <div key={step.key} className={`express-stepPremium ${state}`}>
                                    <div className="express-stepPremiumTop">
                                        <div className="express-stepPremiumCircle">
                                            {step.icon}
                                        </div>

                                        {!isLast && (
                                            <div
                                                className={`express-stepPremiumLine ${
                                                    index < currentStepIndex ? "done" : ""
                                                }`}
                                            />
                                        )}
                                    </div>

                                    <div className="express-stepPremiumLabel">{step.label}</div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="express-statusBar premium-statusBar">
                    {statusText}
                </div>

                <div className="order-details">
                    <div className="express-ab premium-routeBox">
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

                    {nextAction && !["completed", "cancelled"].includes(order.status) && isExecutor && (
                        <div className="express-primaryActionWrap">
                            <button
                                className="express-primaryActionBtn"
                                type="button"
                                disabled={busy}
                                onClick={nextAction.onClick}
                                aria-label={nextAction.label}
                                title={nextAction.label}
                            >
                                {nextAction.icon}
                                <span>{nextAction.label}</span>
                            </button>
                        </div>
                    )}

                    <div className="express-secondaryActions">
                        <button
                            className="express-secondaryBtn"
                            onClick={() => onCallUser?.(order)}
                            type="button"
                        >
                            <FaPhone />
                            <span className="btn-text">Позвонить</span>
                        </button>

                        <button
                            className="express-secondaryBtn"
                            onClick={() => onOpenChat?.(order.id)}
                            type="button"
                        >
                            <FaComments />
                            <span className="btn-text">Чат</span>
                        </button>



                        {isExecutor && navMode !== "none" && (
                            <ExpressRouteButtons
                                orderId={order.id}
                                navMode={navMode}
                                className="express-routeButtonsPremium"
                                buttonClassName="express-secondaryBtn"
                            />
                        )}

                        <button
                            className="express-secondaryBtn express-secondaryBtnWarn"
                            onClick={() => onOpenDispute?.(order)}
                            type="button"
                        >
                            <FaExclamationTriangle />
                            <span className="btn-text">Проблема</span>
                        </button>

                        {canCancel && !["completed", "cancelled"].includes(order.status) && (
                            <button
                                className="express-secondaryBtn express-secondaryBtnDanger"
                                type="button"
                                disabled={busy}
                                onClick={cancel}
                                aria-label="Отменить"
                                title="Отменить"
                            >
                                <FaTimes />
                                <span className="btn-text">Отменить</span>
                            </button>
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