import { useState } from "react";

const CardBinding = () => {
    const [cardNumber, setCardNumber] = useState("");
    const [isBinding, setIsBinding] = useState(false);

    const handleBindCard = async () => {
        setIsBinding(true);

        const response = await fetch("/api/payments/bind-card", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cardNumber })
        });

        const data = await response.json();
        setIsBinding(false);

        if (data.success) {
            alert("Карта успешно привязана!");
        } else {
            alert("Ошибка при привязке карты");
        }
    };

    return (
        <div>
            <h2>Привязка карты</h2>
            <input
                type="text"
                placeholder="Номер карты"
                value={cardNumber}
                onChange={(e) => setCardNumber(e.target.value)}
            />
            <button onClick={handleBindCard} disabled={isBinding}>
                {isBinding ? "Привязываем..." : "Привязать карту"}
            </button>
        </div>
    );
};

export default CardBinding;
