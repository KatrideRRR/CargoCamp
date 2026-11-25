import React, {
    useEffect,
    useRef,
    useState,
} from "react";

import {
    rejectNextExpressOrder,
} from "../utils/expressReservationApi";

function getRemainingSeconds(expiresAt) {
    const timestamp =
        new Date(expiresAt).getTime();

    if (!Number.isFinite(timestamp)) {
        return 0;
    }

    return Math.max(
        0,
        Math.ceil(
            (timestamp - Date.now()) /
            1000
        )
    );
}

export default function ExpressPendingReservation({
                                                      request,
                                                      onChanged,
                                                  }) {
    const [remaining, setRemaining] =
        useState(0);

    const [loading, setLoading] =
        useState(false);

    const [error, setError] =
        useState("");

    const locked = useRef(false);

    useEffect(() => {
        if (!request?.expiresAt) return;

        const update = () => {
            setRemaining(
                getRemainingSeconds(
                    request.expiresAt
                )
            );
        };

        update();

        const interval =
            setInterval(update, 1000);

        return () => {
            clearInterval(interval);
        };
    }, [request?.expiresAt]);

    const withdraw = async () => {
        if (
            locked.current ||
            !request
        ) {
            return;
        }

        locked.current = true;
        setLoading(true);
        setError("");

        try {
            const result =
                await rejectNextExpressOrder(
                    request.orderId,
                    request.id
                );

            if (
                result?.success !== true
            ) {
                throw new Error(
                    "Сервер не подтвердил отзыв предложения"
                );
            }

            onChanged?.();

        } catch (error) {
            setError(
                error.response?.data?.message ||
                error.message ||
                "Не удалось отозвать предложение"
            );
        } finally {
            locked.current = false;
            setLoading(false);
        }
    };

    if (!request) return null;

    const minutes =
        Math.floor(remaining / 60);

    const seconds =
        String(remaining % 60)
            .padStart(2, "0");

    return (
        <section
            className="express-reserved-card"
            aria-label="Предложение следующего заказа"
        >
            <strong>
                Ожидаем ответа заказчика
            </strong>

            <p>
                Экспресс-заказ №{request.orderId}
            </p>

            <p role="status">
                {remaining > 0
                    ? `Осталось ${minutes}:${seconds}`
                    : "Срок предложения истёк"}
            </p>

            <button
                type="button"
                className="btn btn-ghost-danger"
                disabled={loading}
                onClick={withdraw}
            >
                {loading
                    ? "Отзываем..."
                    : "Отозвать предложение"}
            </button>

            {remaining === 0 && (
                <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={onChanged}
                >
                    Обновить состояние
                </button>
            )}

            {error && (
                <p role="alert">
                    {error}
                </p>
            )}
        </section>
    );
}