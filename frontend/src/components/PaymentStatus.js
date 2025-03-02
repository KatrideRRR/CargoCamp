import { useState } from "react";

const PaymentStatus = () => {
    const [orderId, setOrderId] = useState("");
    const [status, setStatus] = useState(null);

    const checkStatus = async () => {
        const response = await fetch("/api/payments/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId })
        });

        const data = await response.json();

        if (data.success) {
            setStatus(data.status);
        } else {
            alert("Ошибка при проверке статуса");
        }
    };

    return (
        <div>
            <h2>Проверка статуса платежа</h2>
            <input
                type="text"
                placeholder="Введите ID заказа"
                value={orderId}
                onChange={(e) => setOrderId(e.target.value)}
            />
            <button onClick={checkStatus}>Проверить</button>

            {status && <p>Статус: {status}</p>}
        </div>
    );
};

export default PaymentStatus;
