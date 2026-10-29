import React from "react";
import { FaPhoneAlt } from "react-icons/fa";

import {
    SUPPORT_PHONE_DISPLAY,
    SUPPORT_PHONE_HREF,
} from "../utils/supportContact";

import "../styles/SupportPhoneLink.css";

export default function SupportPhoneLink({
                                             className = "",
                                             showIcon = false,
                                         }) {
    return (
        <a
            className={`cc-support-phone-link ${className}`.trim()}
            href={SUPPORT_PHONE_HREF}
            aria-label={`Позвонить в поддержку CargoCamp: ${SUPPORT_PHONE_DISPLAY}`}
        >
            {showIcon && (
                <FaPhoneAlt aria-hidden="true" />
            )}

            <span>{SUPPORT_PHONE_DISPLAY}</span>
        </a>
    );
}