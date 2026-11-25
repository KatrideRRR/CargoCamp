import React, {
    useRef,
    useState,
} from "react";

import {
    requestNextExpressOrder,
    getCurrentReservationLocation,
} from "../utils/expressReservationApi";

const ERROR_MESSAGES = {
    SOURCE_ORDER_NOT_FOUND:
        "Текущий заказ не найден.",

    SOURCE_ORDER_NOT_IN_PROGRESS:
        "Следующий заказ можно запросить только во время выполнения поездки.",

    TOO_FAR_FROM_DESTINATION:
        "Следующий заказ доступен в пределах 1 км от точки Б.",

    REGULAR_ORDER_EXISTS:
        "У вас уже есть обычный заказ.",

    RESERVATION_EXISTS:
        "Следующий заказ уже забронирован.",

    RESERVATION_REQUEST_EXISTS:
        "У вас уже есть ожидающее предложение.",

    DEBT_EXISTS:
        "Сначала необходимо погасить задолженность.",

    INVALID_COORDINATES:
        "Не удалось определить ваше местоположение.",

    TAXI_VEHICLE_NOT_VERIFIED:
        "Для принятия заказа такси необходим подтверждённый автомобиль.",
};

export default function ExpressNextOrderButton({
                                                   orderId,
                                                   sourceOrderId,
                                                   disabled = false,
                                                   onRequested,
                                               }) {
    const [loading, setLoading] =
        useState(false);

    const [error, setError] =
        useState("");

    const locked = useRef(false);

    const submit = async () => {
        if (
            locked.current ||
            disabled ||
            !sourceOrderId
        ) {
            return;
        }

        locked.current = true;

        setLoading(true);
        setError("");

        try {
            const location =
                await getCurrentReservationLocation();

            const confirmed =
                window.confirm(
                    "Предложить заказчику принять его заказ после завершения текущей поездки?"
                );

            if (!confirmed) return;

            const result =
                await requestNextExpressOrder({
                    orderId,
                    sourceOrderId,
                    latitude:
                    location.latitude,
                    longitude:
                    location.longitude,
                });

            if (
                result?.success !== true ||
                !result?.requestId
            ) {
                throw new Error(
                    "Предложение не подтверждено сервером"
                );
            }

            onRequested?.({
                id: result.requestId,
                orderId,
                sourceOrderId,
                expiresAt: result.expiresAt,
            });

        } catch (error) {
            const code =
                error.response?.data?.code;

            setError(
                ERROR_MESSAGES[code] ||
                error.response?.data?.message ||
                error.message ||
                "Не удалось запросить следующий заказ"
            );
        } finally {
            locked.current = false;
            setLoading(false);
        }
    };

    return (
        <div className="cc-express-next-action">
            <button
                type="button"
                className="btn btn-primary"
                disabled={
                    disabled ||
                    loading
                }
                onClick={submit}
            >
                {loading
                    ? "Проверяем..."
                    : "Запросить следующим"}
            </button>

            {error && (
                <p role="alert">
                    {error}
                </p>
            )}
        </div>
    );
}