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
                    <p>
                        <strong>1. Назначение платежа:</strong> оплата через интернет-эквайринг применяется только для оплаты
                        цифровых услуг сервиса CargoCamp (комиссия платформы, продвижение, Premium, погашение задолженности).
                        <strong> Оплата работ исполнителей онлайн не принимается.</strong>
                    </p>

                    <p><strong>2. Комиссия сервиса для исполнителя (при оплате наличными между сторонами):</strong></p>
                    <ul>
                        <li>За взятие в работу заказа с типом оплаты «Наличные» — <strong>200 ₽</strong>.</li>
                        <li>Комиссия списывается только после подтверждения пользователем перехода к оплате.</li>
                    </ul>

                    <p><strong>3. Продвижение заказа для заказчика (необязательно):</strong></p>
                    <ul>
                        <li>Выделение / повышение видимости — <strong>50 ₽ / 100 ₽ / 150 ₽</strong> (выбор тарифа перед оплатой).</li>
                    </ul>

                    <p><strong>4. Premium:</strong></p>
                    <ul>
                        <li>Premium на 7 дней — <strong>2500 ₽</strong>.</li>
                        <li>Premium на 30 дней — <strong>9000 ₽</strong>.</li>
                    </ul>

                    <p><strong>5. Возвраты:</strong> возможны, если услуга не была предоставлена по вине сервиса. Обращение: partner@cargocamp.ru.</p>

                    <div className="checkbox-block">
                        <input
                            type="checkbox"
                            id="agreement-checkbox"
                            checked={checked}
                            onChange={() => setChecked(!checked)}
                        />
                        <label htmlFor="agreement-checkbox">
                            Я согласен с условиями списания средств за услуги сервиса CargoCamp
                        </label>
                    </div>

                    <button className="agree-button" disabled={!checked} onClick={handleAgree}>
                        Подтвердить
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AgreementModal;
