import React from "react";
import "../styles/paymentProviderSelect.css";

const PROVIDERS = {
    yookassa: {
        label: "ЮKassa",
        subtitle: "Карта, СБП, SberPay",
        icon: "Ю",
        shortLabel: "ЮK",
    },
    tbank: {
        label: "Т-Банк",
        subtitle: "Карта, T-Pay, СБП",
        icon: "T",
        shortLabel: "Т",
    },
};

export default function PaymentProviderSelect({
                                                  title = "Выберите способ оплаты",
                                                  selectedProvider,
                                                  onSelect,
                                                  disabled = false,
                                              }) {
    return (
        <div className="payment-provider-box">
            <div className="payment-provider-title">{title}</div>

            <div className="payment-provider-grid">
                {Object.entries(PROVIDERS).map(([key, provider]) => {
                    const active = selectedProvider === key;

                    return (
                        <button
                            key={key}
                            type="button"
                            className={`payment-provider-card ${active ? "active" : ""}`}
                            onClick={() => onSelect(key)}
                            disabled={disabled}
                        >
                            <span className={`payment-provider-icon payment-provider-icon-${key}`}>
                                {provider.icon}
                            </span>

                            <span className="payment-provider-info">
                                <b>{provider.label}</b>
                                <small>{provider.subtitle}</small>
                            </span>

                            <span className="payment-provider-short">
                                {provider.shortLabel}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}