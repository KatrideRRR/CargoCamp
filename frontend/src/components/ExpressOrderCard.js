import React, { useEffect, useMemo, useRef, useState } from "react";
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
    FaClipboardCheck,
} from "react-icons/fa";

import {
    getExpressNavigationTarget,
    openOrderRoute,
} from "../utils/orderNavigation";

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
        ? taxiMap[status] ?? 0
        : courierMap[status] ?? 0;
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
                              onOrderUpdated,
                          }) => {
    const [busy, setBusy] = useState(false);
    const [localOrder, setLocalOrder] = useState(order);
    const actionLockRef = useRef(false);

    useEffect(() => {
        if (!order?.id) return;
        setLocalOrder(order);
    }, [
        order?.id,
        order?.status,
        order?.executorId,
        order?.creatorId,
        order?.updatedAt,
        order?.completedAt,
        order?.startedAt,
        order?.arrivedAt,
        order?.waitingStartedAt,
        order?.pickedUpAt,
    ]);

    const currentOrder = localOrder || order;

    const isExecutor = Number(currentOrder.executorId) === Number(userId);
    const isCreator = Number(currentOrder.creatorId) === Number(userId);

    const typeText = useMemo(
        () => (currentOrder.type === "taxi" ? "Такси" : "Курьер"),
        [currentOrder.type]
    );

    const paymentLabel =
        currentOrder.paymentType === "guarantee"
            ? "Гарантия"
            : currentOrder.paymentType === "cash"
                ? "Наличные"
                : "Оплата";

    const paymentIcon = currentOrder.paymentType === "guarantee" ? "🏦" : "💵";

    const steps = useMemo(
        () => getExpressSteps(currentOrder.type),
        [currentOrder.type]
    );

    const currentStepIndex = useMemo(
        () => getExpressCurrentStepIndex(currentOrder.type, currentOrder.status),
        [currentOrder.type, currentOrder.status]
    );

    const statusText = useMemo(
        () => getStatusText(currentOrder.type, currentOrder.status, isCreator),
        [currentOrder.type, currentOrder.status, isCreator]
    );

    const doAction = async (fn, confirmText = "") => {
        if (busy || actionLockRef.current) return;

        actionLockRef.current = true;

        if (confirmText) {
            const ok = window.confirm(confirmText);

            if (!ok) {
                actionLockRef.current = false;
                return;
            }
        }

        setBusy(true);

        try {
            const res = await fn();

            if (res?.data?.success && res.data.order) {
                const updatedOrder = res.data.order;

                setLocalOrder(updatedOrder);
                onOrderUpdated?.(updatedOrder);
            }

            try {
                const fresh = await onReload?.();

                if (fresh?.data?.success && Array.isArray(fresh.data.orders)) {
                    const found = fresh.data.orders.find(
                        (x) => Number(x.id) === Number(currentOrder.id)
                    );

                    if (found) {
                        setLocalOrder(found);
                        onOrderUpdated?.(found);
                    }
                }
            } catch (reloadError) {
                console.warn("Express reload failed:", reloadError);
            }

            return res;
        } catch (e) {
            console.error(e);

            if (e.response?.status === 409) {
                alert(
                    e.response?.data?.message ||
                    "Статус заказа уже изменился. Обновляем данные."
                );

                try {
                    const fresh = await onReload?.();

                    if (fresh?.data?.success && Array.isArray(fresh.data.orders)) {
                        const found = fresh.data.orders.find(
                            (x) => Number(x.id) === Number(currentOrder.id)
                        );

                        if (found) {
                            setLocalOrder(found);
                            onOrderUpdated?.(found);
                        }
                    }
                } catch {}

                return;
            }

            alert(e.response?.data?.message || "Ошибка действия");
        } finally {
            setBusy(false);
            actionLockRef.current = false;
        }
    };

    const handleExpressRoute = async () => {
        const target =
            getExpressNavigationTarget(currentOrder);

        try {
            await openOrderRoute(currentOrder, {
                orderType: "express",
                target,
                confirmText:
                    target === "A"
                        ? "Открыть маршрут к точке A?"
                        : "Открыть маршрут к точке B?",
            });
        } catch (error) {
            console.error(
                "Ошибка маршрута экспресс-заказа:",
                error
            );

            alert("Не удалось открыть маршрут");
        }
    };

    const onTheWay = () =>
        doAction(
            () => axiosInstance.post(`/express/express-orders/${currentOrder.id}/on-the-way`),
            "Подтвердить, что вы выехали к точке A?"
        );

    const arrived = () =>
        doAction(
            () => axiosInstance.post(`/express/express-orders/${currentOrder.id}/arrived`),
            "Подтвердить, что вы прибыли на место?"
        );

    const startWaiting = () =>
        doAction(
            () => axiosInstance.post(`/express/express-orders/${currentOrder.id}/start-waiting`),
            "Подтвердить начало ожидания клиента?"
        );

    const pickUp = () =>
        doAction(
            () => axiosInstance.post(`/express/express-orders/${currentOrder.id}/pick-up`),
            currentOrder.type === "taxi"
                ? "Подтвердить, что клиент сел в машину?"
                : "Подтвердить, что вы забрали заказ?"
        );

    const complete = () =>
        doAction(
            async () => {
                const res = await axiosInstance.post(`/express/express-orders/${currentOrder.id}/complete`);

                if (res.data?.success && res.data?.order) {
                    onCompletedSuccessfully?.(res.data.order);
                }

                return res;
            },
            "Подтвердить завершение заказа?"
        );

    const cancel = () =>
        doAction(
            () => axiosInstance.post(`/express/express-orders/${currentOrder.id}/cancel`),
            "Вы уверены, что хотите отменить заказ?"
        );

    const nextAction = useMemo(() => {
        if (!isExecutor) return null;

        if (currentOrder.type === "taxi") {
            if (currentOrder.status === "accepted") {
                return { label: "Еду к точке A", icon: <FaCarSide />, onClick: onTheWay };
            }

            if (currentOrder.status === "on_the_way_to_A") {
                return { label: "Я на месте", icon: <FaCheck />, onClick: arrived };
            }

            if (currentOrder.status === "arrived_at_A") {
                return { label: "Начать ожидание", icon: <FaHourglassHalf />, onClick: startWaiting };
            }

            if (currentOrder.status === "waiting_at_A") {
                return {
                    label: "Клиент в машине",
                    icon: <FaPlay />,
                    onClick: () =>
                        doAction(
                            () => axiosInstance.post(`/express/express-orders/${currentOrder.id}/start`),
                            "Подтвердить, что клиент сел в машину и поездка началась?"
                        ),
                };
            }

            if (currentOrder.status === "in_progress") {
                return { label: "Завершить заказ", icon: <FaFlagCheckered />, onClick: complete };
            }
        }

        if (currentOrder.type === "courier") {
            if (currentOrder.status === "accepted") {
                return { label: "Еду к точке A", icon: <FaCarSide />, onClick: onTheWay };
            }

            if (currentOrder.status === "on_the_way_to_A") {
                return { label: "Я на месте", icon: <FaCheck />, onClick: arrived };
            }

            if (currentOrder.status === "arrived_at_A") {
                return { label: "Забрал заказ", icon: <FaBoxOpen />, onClick: pickUp };
            }

            if (currentOrder.status === "picked_up") {
                return {
                    label: "Начать доставку",
                    icon: <FaPlay />,
                    onClick: () =>
                        doAction(
                            () => axiosInstance.post(`/express/express-orders/${currentOrder.id}/start`),
                            "Подтвердить начало доставки?"
                        ),
                };
            }

            if (currentOrder.status === "in_progress") {
                return { label: "Завершить заказ", icon: <FaFlagCheckered />, onClick: complete };
            }
        }

        return null;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        isExecutor,
        currentOrder.id,
        currentOrder.type,
        currentOrder.status,
        busy,
    ]);

    const navMode = useMemo(() => {
        if (!isExecutor) return "none";

        if (currentOrder.type === "taxi") {
            if (["accepted", "on_the_way_to_A", "arrived_at_A", "waiting_at_A"].includes(currentOrder.status)) {
                return "toA";
            }

            if (["in_progress", "completed"].includes(currentOrder.status)) {
                return "AtoB";
            }
        }

        if (currentOrder.type === "courier") {
            if (["accepted", "on_the_way_to_A", "arrived_at_A"].includes(currentOrder.status)) {
                return "toA";
            }

            if (["picked_up", "in_progress", "completed"].includes(currentOrder.status)) {
                return "AtoB";
            }
        }

        return "none";
    }, [isExecutor, currentOrder.type, currentOrder.status]);

    const canCancel =
        (isCreator &&
            ["created", "accepted", "on_the_way_to_A", "arrived_at_A", "waiting_at_A"].includes(currentOrder.status)) ||
        (isExecutor &&
            ["accepted", "on_the_way_to_A", "arrived_at_A", "waiting_at_A"].includes(currentOrder.status));

    const description =
        typeof currentOrder.description === "string"
            ? currentOrder.description.trim()
            : "";

    const hasDescription = description.length > 0;

    return (
        <li className={`order-card express-card ${currentOrder.type === "taxi" ? "express-taxi" : "express-courier"}`}>
            <div className="order-header">
                <div className="order-top">
                    <div className="order-title-wrap">
                        <div className="order-title">
                            <strong>Экспресс №{currentOrder.id}</strong>
                        </div>

                        <div className="role-badge-row">
                            <span className={`role-badge ${isCreator ? "creator-role" : "executor-role"}`}>
                                {isCreator ? "Вы заказчик" : "Вы исполнитель"}
                            </span>

                            <span className={`express-pill express-pillType ${currentOrder.type}`}>
                                {typeText}
                            </span>
                        </div>
                    </div>

                    <div className="pay-box express-pay">
                        <span className="pay-icon" title={paymentLabel}>
                            {paymentIcon}
                        </span>

                        <div className="pay-right">
                            <div className="pay-price">
                                {Number(currentOrder.totalPrice ?? 0).toLocaleString("ru-RU")} ₽
                            </div>

                            <div className="pay-type">{paymentLabel}</div>
                        </div>
                    </div>
                </div>

                <div className="order-subline">
                    Создан {new Date(currentOrder.created_at || currentOrder.createdAt).toLocaleString()}
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

                                    <div className="express-stepPremiumLabel">
                                        {step.label}
                                    </div>
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
                            <div className="express-abValue">
                                {currentOrder.fromAddress}
                            </div>
                        </div>

                        <div className="express-abArrow">→</div>

                        <div className="express-abItem">
                            <div className="express-abLabel">Куда</div>
                            <div className="express-abValue">
                                {currentOrder.toAddress}
                            </div>
                        </div>
                    </div>

                    {hasDescription && (
                        <p className="express-comment">
                            <strong>Комментарий:</strong> {description}
                        </p>
                    )}

                    {nextAction && !["completed", "cancelled"].includes(currentOrder.status) && isExecutor && (
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
                                <span>{busy ? "Обновляем..." : nextAction.label}</span>
                            </button>
                        </div>
                    )}

                    <div className="express-secondaryActions">
                        <button
                            className="express-secondaryBtn"
                            onClick={() => onCallUser?.(currentOrder)}
                            type="button"
                        >
                            <FaPhone />
                            <span className="btn-text">Позвонить</span>
                        </button>

                        <button
                            className="express-secondaryBtn"
                            onClick={() => onOpenChat?.(currentOrder.id)}
                            type="button"
                        >
                            <FaComments />
                            <span className="btn-text">Чат</span>
                        </button>

                        {isExecutor && navMode !== "none" && (
                            <button
                                type="button"
                                className="express-secondaryBtn"
                                onClick={handleExpressRoute}
                                aria-label={
                                    navMode === "toA"
                                        ? "Маршрут к A"
                                        : "Маршрут к B"
                                }
                                title={
                                    navMode === "toA"
                                        ? "Маршрут к A"
                                        : "Маршрут к B"
                                }
                            >
                                <FaCarSide />

                                <span className="btn-text">
            {navMode === "toA"
                ? "Маршрут к A"
                : "Маршрут к B"}
        </span>
                            </button>
                        )}

                        <button
                            className="express-secondaryBtn express-secondaryBtnWarn"
                            onClick={() => onOpenDispute?.(currentOrder)}
                            type="button"
                        >
                            <FaExclamationTriangle />
                            <span className="btn-text">Проблема</span>
                        </button>

                        {canCancel && !["completed", "cancelled"].includes(currentOrder.status) && (
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
                        <strong>Расстояние:</strong> {currentOrder.distanceKm ?? "—"} км •{" "}
                        <strong>Время:</strong> {currentOrder.estimatedTimeMin ?? "—"} мин
                    </p>
                </div>
            </div>
        </li>
    );
};

export default ExpressOrderCard;