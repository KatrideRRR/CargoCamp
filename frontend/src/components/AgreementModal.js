import React, { useEffect, useState } from "react";
import "../styles/AgreementModal.css";

const AgreementModal = ({ isOpen, onClose, onAgree }) => {
    const [checked, setChecked] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setChecked(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleAgree = () => {
        if (!checked) return;
        onAgree();
    };

    return (
        <div className="agreement-overlay" onClick={onClose}>
            <div
                className="agreement-modal"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="agreement-head">
                    <h2 className="agreement-title">
                        Соглашение о списании средств
                    </h2>

                    <button
                        type="button"
                        className="agreement-close"
                        onClick={onClose}
                        aria-label="Закрыть"
                    >
                        ×
                    </button>
                </div>

                <div className="agreement-body">
                    <p>
                        <strong>1. Назначение платежа:</strong> оплата через
                        интернет-эквайринг применяется только для оплаты
                        цифровых услуг сервиса CargoCamp: комиссия платформы,
                        продвижение, Premium и погашение задолженности.{" "}
                        <strong>
                            Оплата работ исполнителей онлайн не принимается.
                        </strong>
                    </p>

                    <p>
                        <strong>
                            2. Комиссия сервиса для исполнителя при оплате
                            наличными между сторонами:
                        </strong>
                    </p>

                    <ul>
                        <li>
                            За взятие в работу заказа с типом оплаты «Наличные»
                            — <strong>200 ₽</strong>.
                        </li>
                        <li>
                            Комиссия списывается только после подтверждения
                            пользователем перехода к оплате.
                        </li>
                    </ul>

                    <p>
                        <strong>
                            3. Продвижение заказа для заказчика:
                        </strong>
                    </p>

                    <ul>
                        <li>
                            Выделение или повышение видимости заказа —{" "}
                            <strong>50 ₽ / 100 ₽ / 150 ₽</strong>.
                        </li>
                    </ul>

                    <p>
                        <strong>4. Premium:</strong>
                    </p>

                    <ul>
                        <li>
                            Premium на 7 дней — <strong>2500 ₽</strong>.
                        </li>
                        <li>
                            Premium на 30 дней — <strong>9000 ₽</strong>.
                        </li>
                    </ul>

                    <p>
                        <strong>5. Возвраты:</strong> возможны, если услуга не
                        была предоставлена по вине сервиса. Обращение:{" "}
                        <strong>partner@cargocamp.ru</strong>.
                    </p>
                </div>

                <label className="agreement-check">
                    <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => setChecked(e.target.checked)}
                    />

                    <span>
                        Я согласен с условиями списания средств за услуги
                        сервиса CargoCamp
                    </span>
                </label>

                <button
                    type="button"
                    className="agreement-button"
                    disabled={!checked}
                    onClick={handleAgree}
                >
                    Подтвердить
                </button>
            </div>
        </div>
    );
};

export default AgreementModal;