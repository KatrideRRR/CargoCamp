import React from "react";
import "../styles/paymentProviderSelect.css";

const PROVIDERS = [
    {
        key: "yookassa",
        label: "ЮKassa",
        subtitle: "Карта, СБП, SberPay",
        icon: "Ю",
        shortLabel: "ЮК",
    },
    {
        key: "tbank",
        label: "Т-Банк",
        subtitle: "Карта, T-Pay, СБП",
        icon: "Т",
        shortLabel: "Т",
    },
];

export default function PaymentProviderSelect({
                                                  title = "Способ оплаты",
                                                  selectedProvider,
                                                  onSelect,
                                                  disabled = false,
                                              }) {
    return (
        <div className="payment-provider-box">
            {title && <div className="payment-provider-title">{title}</div>}

            <div className="payment-provider-grid">
                {PROVIDERS.map((provider) => {
                    const active = selectedProvider === provider.key;

                    return (
                        <button
                            key={provider.key}
                            type="button"
                            className={`payment-provider-card ${active ? "active" : ""}`}
                            onClick={() => onSelect(provider.key)}
                            disabled={disabled || active}
                            aria-pressed={active}
                        >
                            <span className={`payment-provider-icon ${provider.key}`}>
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