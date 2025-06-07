import React, { useState } from 'react';
import '../styles/AgreementModal.css';

const AgreementModal = ({ isOpen, onClose, onAgree }) => {
    const [checked, setChecked] = useState(false);

    const handleAgree = () => {
        if (checked) onAgree();
    };

    if (!isOpen) return null;

    return (
        <div className="modal-overlay">
            <div className="modal-wrapper">
                <button className="modal-close" onClick={onClose}>&times;</button>
                <h2 className="modal-title">Соглашение о списании средств</h2>
                <div className="modal-body">
                    <p><strong>1. Привязка карты:</strong> при привязке с вашей карты будет списано 1 ₽, который автоматически возвращается. Эта операция используется для проверки платёжных данных.</p>

                    <p><strong>2. Комиссии сервиса:</strong> с исполнителя списывается комиссия при одобрении заказа:</p>
                    <ul>
                        <li>При оплате наличными — <strong>200 ₽.</strong></li>
                        <li>Через платформу с гарантией — <strong>15%</strong> от суммы заказа.</li>
                        <li>В рассрочку — <strong>25%</strong> от суммы заказа.</li>
                    </ul>

                    <p><strong>3. Заморозка средств:</strong> если вы используете оплату с гарантией, средства заказчика резервируются до завершения работ.</p>

                    <p><strong>4. Рассрочка:</strong> с заказчика списывается <strong>25%</strong> сразу, остальное — по графику банка-партнёра.</p>

                    <p><strong>5. Удаление карты:</strong> возможно в профиле. После удаления автосписания невозможны.</p>

                    <p><strong>6. Согласие на автосписания:</strong> вы разрешаете автоматические списания только после подтверждения (одобрения заказа и т.п.).</p>

                    <p><strong>7. Публичная оферта:</strong> условия регулируются пользовательским соглашением и соглашением на списание средств.</p>

                    <div className="checkbox-block">
                        <input
                            type="checkbox"
                            id="agreement-checkbox"
                            checked={checked}
                            onChange={() => setChecked(!checked)}
                        />
                        <label htmlFor="agreement-checkbox">
                            Я согласен с условиями Соглашения о списании средств
                        </label>
                    </div>

                    <button className="agree-button" disabled={!checked} onClick={handleAgree}>
                        Привязать карту
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AgreementModal;
