import React from "react";

export default function RegularReservedOrderCard({
                                                     order,
                                                     isBusy,
                                                     onOpenChat,
                                                     onCancel,
                                                 }) {
    const availableAt = order.reservationAvailableAt
        ? new Date(order.reservationAvailableAt)
        : null;

    const dateText =
        availableAt &&
        !Number.isNaN(availableAt.getTime())
            ? availableAt.toLocaleString("ru-RU", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
            })
            : "Не указано";

    return (
        <li className="order-card cc-reserved-order">
            <details>
                <summary className="cc-reserved-summary">
                    <span>
                        <strong>Заказ №{order.id}</strong>
                        <small>
                            {isBusy
                                ? "Ожидает освобождения"
                                : "Ожидает начала"}
                        </small>
                    </span>

                    <span className="cc-reserved-expand">
                        Подробнее
                    </span>
                </summary>

                <div className="cc-reserved-content">
                    <p>
                        <strong>Адрес:</strong>{" "}
                        {order.address || "Не указан"}
                    </p>

                    <p>
                        <strong>Цена:</strong>{" "}
                        {(
                            Number(order.finalPriceKopecks || 0) / 100 ||
                            Number(order.proposedSum || 0)
                        ).toLocaleString("ru-RU")} ₽
                    </p>

                    <p>
                        <strong>Ориентировочное время:</strong>{" "}
                        {dateText}
                    </p>

                    <p>
                        {isBusy
                            ? "Исполнитель заканчивает предыдущий заказ."
                            : "Предыдущий заказ завершён. Ожидается активация следующего."}
                    </p>

                    <button
                        type="button"
                        className="cc-reserved-chat"
                        onClick={() => onOpenChat(order.id)}
                    >
                        Открыть чат
                    </button>

                    <button
                        type="button"
                        className="cc-reserved-chat"
                        onClick={onCancel}
                        style={{
                            marginLeft: 8,
                            background: "#64748b",
                        }}
                    >
                        Отменить бронь
                    </button>
                </div>
            </details>
        </li>
    );
}