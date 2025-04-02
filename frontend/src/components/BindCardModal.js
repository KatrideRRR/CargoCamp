import React from "react";

const BindCardModal = ({ isOpen, onClose, onConfirm, isChecked, setChecked }) => {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h2>Привязка карты</h2>
                <p>
                    Привязывая карту, вы соглашаетесь, что ее данные будут сохранены на нашем ресурсе, а при активации заказа с нее
                    могут списываться средства автоматически.
                </p>
                <label className="checkbox-label">
                    <input type="checkbox" checked={isChecked} onChange={() => setChecked(!isChecked)} />
                    Я согласен с условиями привязки карты
                </label>
                <div className="modal-buttons">
                    <button onClick={onClose} className="cancel-button">Отмена</button>
                    <button onClick={onConfirm} className="confirm-button" disabled={!isChecked}>Добавить карту</button>
                </div>
            </div>
        </div>
    );
};

export default BindCardModal;
