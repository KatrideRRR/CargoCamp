import Modal from "./Modal";

import React, { useState } from 'react';
import '../styles/AgreementModal.css'; // кастомные стили

const AgreementModal = ({ isOpen, onClose, onAgree }) => {
    const [checked, setChecked] = useState(false);

    const handleAgree = () => {
        if (checked) onAgree();
    };

    return (

    <Modal isOpen={isOpen} onClose={onClose} title="Соглашение о списании средств">

            <div className="agreement-content">

                <p><strong>1. Привязка карты:</strong> списывается 1 ₽, который возвращается автоматически.</p>
                <p><strong>2. Комиссия сервиса (списывается со счета исполнителя при одобрении ему закза:</strong></p>
                <ul>
                    <li>Оплата наличными — <strong>200 ₽.</strong></li>
                    <li>Оплата с гарантией — <strong>15%</strong> от суммы заказа</li>
                    <li>Оплата в рассрочку — <strong>25%</strong> от суммы заказа</li>
                </ul>
                <p><strong>3. Заморозка средств:</strong> при заказах с гарантией деньги замораживаются на счету заказчика до окончания выполнения работ.</p>
                <p><strong>4. Рассрочка:</strong> первый платёж, в размере 25% от стоимости выполнения работ списывается у заказчика сразу, далее — по графику банка.</p>
                <p><strong>5. Удаление карты:</strong> доступно в профиле, автосписания после этого невозможны.</p>

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

                <button
                    className="agree-button"
                    disabled={!checked}
                    onClick={handleAgree}
                >
                    Привязать карту
                </button>
            </div>
        </Modal>
    );
};

export default AgreementModal;
