import { useState } from "react";

const CancelOrder = ({ orderId }) => {
    const [isCancelling, setIsCancelling] = useState(false);

    const handleCancelOrder = async () => {
        setIsCancelling(true);

        const response = await fetch("/api/payments/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId })
        });

        const data = await response.json();
        setIsCancelling(false);

        if (data.success) {
            alert("Заказ успешно отменен, деньги возвращены.");
        } else {
            alert("Ошибка при отмене заказа: " + data.message);
        }
    };

    return (
        <button onClick={handleCancelOrder} disabled={isCancelling}>
            {isCancelling ? "Отменяем..." : "Отменить заказ"}
        </button>
    );
};

export default CancelOrder;
