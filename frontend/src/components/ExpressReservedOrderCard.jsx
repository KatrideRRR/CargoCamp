import React, {
    useRef,
    useState,
} from "react";
import "../styles/ExpressReservedOrderCard.css";
import {
    cancelNextExpressOrder,
} from "../utils/expressReservationApi";

export default function ExpressReservedOrderCard({
                                                     order,
                                                     userId,
                                                     onUpdated,
                                                 }) {
    const [loading, setLoading] =
        useState(false);

    const [error, setError] =
        useState("");

    const actionLock =
        useRef(false);

    const isExecutor =
        Number(order?.executorId) ===
        Number(userId);

    const isCreator =
        Number(order?.creatorId) ===
        Number(userId);

    const cancel = async () => {
        if (actionLock.current) return;

        if (
            !window.confirm(
                "Отменить бронирование следующего заказа?"
            )
        ) {
            return;
        }

        actionLock.current = true;

        setLoading(true);
        setError("");

        try {
            const result =
                await cancelNextExpressOrder(
                    order.id
                );

            if (
                result?.success !== true
            ) {
                throw new Error(
                    "Отмена не подтверждена"
                );
            }

            onUpdated?.(result.order);

        } catch (error) {
            setError(
                error.response?.data?.message ||
                error.message ||
                "Не удалось отменить бронирование"
            );
        } finally {
            actionLock.current = false;

            setLoading(false);
        }
    };

    if (
        !order ||
        order.status !== "reserved" ||
        (!isExecutor && !isCreator)
    ) {
        return null;
    }

    return (
        <article className="express-reserved-card">

            <div className="express-reserved-header">
                <strong>
                    {isExecutor
                        ? "Следующий заказ"
                        : "Заказ забронирован"}
                </strong>

                <span className="express-reserved-badge">
                    Ожидает освобождения
                </span>
            </div>

            <p>
                {order.type === "taxi"
                    ? "Такси"
                    : "Курьерская доставка"}

                {" · №"}{order.id}
            </p>

            <p>
                {isExecutor
                    ? "Следующий заказ активируется после завершения текущего."
                    : "Исполнитель заканчивает предыдущий заказ."}
            </p>

            <div className="express-reserved-route">
                <div>
                    <small>Откуда</small>
                    <p>{order.fromAddress}</p>
                </div>

                <div>
                    <small>Куда</small>
                    <p>{order.toAddress}</p>
                </div>
            </div>

            <strong className="express-reserved-price">
                {order.totalPrice} ₽
            </strong>

            {error && (
                <p role="alert">
                    {error}
                </p>
            )}

            <button
                type="button"
                className="btn btn-ghost-danger"
                disabled={loading}
                onClick={cancel}
            >
                {loading
                    ? "Отменяем..."
                    : "Отменить бронирование"}
            </button>
        </article>
    );
}