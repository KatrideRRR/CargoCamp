import React from "react";

import {
    CreditCard,
    Check,
    ChevronRight,
} from "lucide-react";

import "../../styles/ui.css";

const PaymentCardOption = ({
                               title,
                               description,
                               selected = false,
                               disabled = false,
                               showChevron = false,
                               selectable = true,
                               onClick,
                           }) => {
    return (
        <button
            type="button"
            className={[
                "cc-payment-option",
                selected && "cc-payment-option--selected",
            ]
                .filter(Boolean)
                .join(" ")}
            disabled={disabled}
            aria-pressed={
                selectable ? selected : undefined
            }
            onClick={onClick}
        >
            <span
                className="cc-payment-option__icon"
                aria-hidden="true"
            >
                <CreditCard size={24} />
            </span>

            <span className="cc-payment-option__info">
                <strong>{title}</strong>

                {description && (
                    <small>{description}</small>
                )}
            </span>

            {showChevron ? (
                <ChevronRight
                    size={20}
                    aria-hidden="true"
                />
            ) : selectable ? (
                <span
                    className="cc-payment-option__check"
                    aria-hidden="true"
                >
                    {selected && <Check size={16} />}
                </span>
            ) : null}
        </button>
    );
};

export default PaymentCardOption;