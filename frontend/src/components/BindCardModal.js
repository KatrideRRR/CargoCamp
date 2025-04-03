import React, { useState } from "react";
import axios from "axios";
const apiUrl = process.env.REACT_APP_API_URL;

const BindCardModal = ({ isOpen, onClose, onSuccess }) => {
    const [cardNumber, setCardNumber] = useState("");
    const [expiry, setExpiry] = useState("");
    const [cvv, setCvv] = useState("");
    const [isChecked, setChecked] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    if (!isOpen) return null;

    const handleSubmit = async () => {
        if (!isChecked || !cardNumber || !expiry || !cvv) {
            setError("Заполните все поля и согласитесь с условиями.");
            return;
        }

        setLoading(true);
        setError("");

        const token = localStorage.getItem('authToken');

        try {
            const response = await axios.post(`${apiUrl}/api/payment/bind-card`, { cardNumber, expiry, cvv }, { withCredentials: true,
                headers: { Authorization: `Bearer ${token}` },
            });

            console.log(response.data); // Логируем ответ от сервера
            if (response.data.success) {
                onSuccess();
                onClose();
            } else {
                setError(response.data.message || "Ошибка привязки карты");
            }
        } catch (err) {
            console.error("Ошибка:", err);
            setError(err.response?.data?.message || "Ошибка привязки карты");
        } finally {
            setLoading(false);
        }
    };


    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h2>Привязка карты</h2>
                <p>Привязывая карту, вы соглашаетесь, что ее данные будут сохранены и использоваться для автоматических списаний.</p>

                <input
                    type="text"
                    placeholder="Номер карты"
                    value={cardNumber}
                    onChange={(e) => setCardNumber(e.target.value)}
                    maxLength="16"
                />
                <input
                    type="text"
                    placeholder="MM/YY"
                    value={expiry}
                    onChange={(e) => setExpiry(e.target.value)}
                    maxLength="5"
                />
                <input
                    type="password"
                    placeholder="CVV"
                    value={cvv}
                    onChange={(e) => setCvv(e.target.value)}
                    maxLength="3"
                />

                <label className="checkbox-label">
                    <input type="checkbox" checked={isChecked} onChange={() => setChecked(!isChecked)} />
                    Я согласен с условиями привязки карты
                </label>

                {error && <p className="error-text">{error}</p>}

                <div className="modal-buttons">
                    <button onClick={onClose} className="cancel-button" disabled={loading}>Отмена</button>
                    <button onClick={handleSubmit} className="confirm-button" disabled={!isChecked || loading}>
                        {loading ? "Обработка..." : "Добавить карту"}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BindCardModal;
