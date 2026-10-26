import React from "react";

export default function RegularAdvanceTimeField({
                                                    value,
                                                    onChange,
                                                }) {
    return (
        <div className="request-order-field">
            <label htmlFor="regular-available-at">
                Когда сможете приступить
            </label>

            <input
                id="regular-available-at"
                type="datetime-local"
                className="request-order-input"
                value={value}
                onChange={(event) =>
                    onChange(event.target.value)
                }
            />

            <p className="request-order-subtitle">
                Если уже выполняете обычный заказ,
                укажите ориентировочное время освобождения.
                Заказчик увидит его при выборе исполнителя.
            </p>
        </div>
    );
}