import React, { useState } from 'react';

const RequestModal = ({ isOpen, onClose, onSubmit }) => {
    const [proposedSum, setProposedSum] = useState('');
    const [comment, setComment] = useState('');

    const handleSubmit = () => {
        if (!proposedSum) {
            alert("Введите сумму");
            return;
        }
        onSubmit({ proposedSum, comment });
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h3>Запрос на выполнение заказа</h3>
                <input
                    type="number"
                    placeholder="Сумма, ₽"
                    value={proposedSum}
                    onChange={(e) => setProposedSum(e.target.value)}
                />
                <textarea
                    placeholder="Комментарий (необязательно)"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                />
                <div className="modal-buttons">
                    <button onClick={handleSubmit}>Отправить</button>
                    <button onClick={onClose}>Отмена</button>
                </div>
            </div>
        </div>
    );
};

export default RequestModal;
