import React from "react";
import { FaHeadset, FaPhoneAlt } from "react-icons/fa";

import "../styles/StartSupportCallout.css";

const SUPPORT_PHONE = "+79790199979";
const SUPPORT_PHONE_DISPLAY = "+7 (979) 019-99-79";

export default function StartSupportCallout() {
    return (
        <section
            className="start-support-callout"
            aria-label="Телефон поддержки CargoCamp"
        >
            <div className="start-support-callout-top">
                <div className="start-support-callout-label">
                    <FaHeadset aria-hidden="true" />
                    <span>Помощь с заказом</span>
                </div>

                <a
                    className="start-support-callout-phone"
                    href={`tel:${SUPPORT_PHONE}`}
                    aria-label={`Позвонить в поддержку: ${SUPPORT_PHONE_DISPLAY}`}
                >
                    <FaPhoneAlt aria-hidden="true" />
                    <span>{SUPPORT_PHONE_DISPLAY}</span>
                </a>
            </div>

            <p className="start-support-callout-description">
                Не получается создать заказ? Позвоните —
                администратор оформит его за вас.
                Поможем и с другими вопросами.
            </p>
        </section>
    );
}