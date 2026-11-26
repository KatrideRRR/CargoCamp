import React, {
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";

import {
    getExpressReservationRequests,
    approveNextExpressOrder,
    rejectNextExpressOrder,
} from "../utils/expressReservationApi";

export default function ExpressReservationRequests({
                                                       orderId,
                                                       onUpdated,
                                                   }) {
    const [requests, setRequests] =
        useState([]);

    const [loading, setLoading] =
        useState(true);

    const [error, setError] =
        useState("");

    const [processingId, setProcessingId] =
        useState(null);

    const [now, setNow] =
        useState(Date.now());

    const mounted = useRef(false);
    const locked = useRef(false);

    const loadSequence = useRef(0);

    const load = useCallback(async () => {
        const sequence =
            ++loadSequence.current;

        try {
            const data =
                await getExpressReservationRequests(
                    orderId
                );

            if (
                mounted.current &&
                sequence === loadSequence.current
            ) {
                setRequests(data);
                setError("");
            }

        } catch (error) {
            if (
                mounted.current &&
                sequence === loadSequence.current
            ) {
                setError(
                    error.response?.data?.message ||
                    "Не удалось загрузить предложения"
                );
            }

        } finally {
            if (
                mounted.current &&
                sequence === loadSequence.current
            ) {
                setLoading(false);
            }
        }
    }, [orderId]);

    useEffect(() => {
        mounted.current = true;

        void load();

        const refresh = () => {
            if (!locked.current) {
                void load();
            }
        };

        const poll =
            setInterval(refresh, 10000);

        const timer =
            setInterval(
                () => setNow(Date.now()),
                1000
            );

        window.addEventListener(
            "focus",
            refresh
        );

        return () => {
            mounted.current = false;

            loadSequence.current += 1;

            clearInterval(poll);
            clearInterval(timer);

            window.removeEventListener(
                "focus",
                refresh
            );
        };
    }, [load]);

    const act = async (
        request,
        approve
    ) => {
        if (locked.current) return;

        if (approve) {
            const confirmed =
                window.confirm(
                    "Вы согласны подождать завершения предыдущего заказа исполнителя?"
                );

            if (!confirmed) return;
        }

        locked.current = true;
        setProcessingId(request.id);
        setError("");

        try {
            const result =
                approve
                    ? await approveNextExpressOrder(
                        orderId,
                        request.id
                    )
                    : await rejectNextExpressOrder(
                        orderId,
                        request.id
                    );

            if (
                result?.success !== true
            ) {
                throw new Error(
                    "Операция не подтверждена"
                );
            }

            if (!mounted.current) return;

            setRequests((previous) =>
                previous.filter(
                    (item) =>
                        item.id !== request.id
                )
            );

            if (approve) {
                onUpdated?.(result.order);
            } else {
                await load();
            }

        } catch (error) {
            if (!mounted.current) return;

            if (
                [404, 409].includes(
                    error.response?.status
                )
            ) {
                await load();
            }

            setError(
                error.response?.data?.message ||
                error.message ||
                "Не удалось обработать предложение"
            );

        } finally {
            locked.current = false;

            if (mounted.current) {
                setProcessingId(null);
            }
        }
    };

    const activeRequests =
        requests.filter((request) => {
            const expires =
                new Date(
                    request.expiresAt
                ).getTime();

            return (
                Number.isFinite(expires) &&
                expires > now
            );
        });

    if (
        loading ||
        (
            activeRequests.length === 0 &&
            !error
        )
    ) {
        return null;
    }

    return (
        <section className="cc-express-requests">

            {activeRequests.length > 0 && (
                <h4>
                    Предложения исполнителей
                    {" · "}
                    {activeRequests.length}
                </h4>
            )}

            {error && (
                <div role="alert">
                    <p>{error}</p>

                    <button
                        type="button"
                        disabled={
                            processingId !== null
                        }
                        onClick={load}
                    >
                        Обновить
                    </button>
                </div>
            )}

            {activeRequests.map((request) => {
                const executor =
                    request.executor || {};

                const remaining =
                    Math.max(
                        0,
                        Math.ceil(
                            (
                                new Date(
                                    request.expiresAt
                                ).getTime() - now
                            ) / 1000
                        )
                    );

                const rating =
                    Number(executor.rating || 0);

                return (
                    <article
                        className="express-reserved-card"
                        key={request.id}
                    >
                        <strong>
                            {executor.username ||
                                `Исполнитель №${executor.id}`}
                        </strong>

                        {rating > 0 && (
                            <p>
                                Рейтинг:
                                {" "}
                                {rating.toFixed(1)}
                                {" / 5"}
                            </p>
                        )}

                        {executor.vehicleBrand && (
                            <p>
                                {[
                                    executor.vehicleBrand,
                                    executor.vehicleModel,
                                    executor.vehicleColor,
                                ].filter(Boolean)
                                    .join(" ")}
                            </p>
                        )}

                        <p>
                            Исполнитель завершает
                            предыдущий заказ и
                            предлагает принять ваш
                            после освобождения.
                        </p>

                        <small>
                            До окончания предложения:
                            {" "}
                            {remaining} сек.
                        </small>

                        <button
                            type="button"
                            className="btn btn-primary"
                            disabled={
                                processingId !== null
                            }
                            onClick={() =>
                                act(request, true)
                            }
                        >
                            Согласиться подождать
                        </button>

                        <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={
                                processingId !== null
                            }
                            onClick={() =>
                                act(request, false)
                            }
                        >
                            Отклонить
                        </button>
                    </article>
                );
            })}
        </section>
    );
}