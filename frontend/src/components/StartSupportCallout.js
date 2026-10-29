import React from "react";
import { FaHeadset } from "react-icons/fa";

import SupportPhoneLink from "./SupportPhoneLink";

import "../styles/StartSupportCallout.css";

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

                <SupportPhoneLink
                    className="start-support-callout-phone"
                    showIcon
                />
            </div>

            <p className="start-support-callout-description">
                Не получается создать заказ? Позвоните —
                администратор оформит его за вас.
                Поможем и с другими вопросами.
            </p>
        </section>
    );
}