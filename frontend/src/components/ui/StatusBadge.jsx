import React from "react";

import "../../styles/ui.css";

const SUPPORTED_TONES = new Set([
    "neutral",
    "primary",
    "success",
    "warning",
    "danger",
    "info",
]);

const StatusBadge = ({
                         children,
                         tone = "neutral",
                         icon,
                         dot = false,
                         className = "",
                         ...props
                     }) => {
    const resolvedTone = SUPPORTED_TONES.has(tone)
        ? tone
        : "neutral";

    return (
        <span
            {...props}
            className={[
                "cc-status-badge",
                `cc-status-badge--${resolvedTone}`,
                className,
            ]
                .filter(Boolean)
                .join(" ")}
        >
            {dot && (
                <span
                    className="cc-status-badge__dot"
                    aria-hidden="true"
                />
            )}

            {icon && (
                <span
                    className="cc-status-badge__icon"
                    aria-hidden="true"
                >
                    {icon}
                </span>
            )}

            {children}
        </span>
    );
};

export default StatusBadge;