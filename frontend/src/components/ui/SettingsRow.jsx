import React from "react";
import { ChevronRight } from "lucide-react";

import "../../styles/ui.css";

const SettingsRow = ({
                         title,
                         description,
                         value,
                         icon,
                         onClick,
                         disabled = false,
                         showChevron = true,
                         variant = "default",
                         className = "",
                         ...props
                     }) => {
    const interactive = typeof onClick === "function";
    const Component = interactive ? "button" : "div";

    return (
        <Component
            {...props}
            {...(
                interactive
                    ? {
                        type: "button",
                        disabled,
                        onClick,
                    }
                    : {}
            )}
            className={[
                "cc-settings-row",
                `cc-settings-row--${variant}`,
                interactive &&
                "cc-settings-row--interactive",
                disabled &&
                "cc-settings-row--disabled",
                className,
            ]
                .filter(Boolean)
                .join(" ")}
        >
            {icon && (
                <span
                    className="cc-settings-row__icon"
                    aria-hidden="true"
                >
                    {icon}
                </span>
            )}

            <span className="cc-settings-row__main">
                <span className="cc-settings-row__title">
                    {title}
                </span>

                {description && (
                    <span className="cc-settings-row__description">
                        {description}
                    </span>
                )}
            </span>

            {value != null && value !== "" && (
                <span className="cc-settings-row__value">
                    {value}
                </span>
            )}

            {interactive && showChevron && (
                <ChevronRight
                    size={18}
                    className="cc-settings-row__chevron"
                    aria-hidden="true"
                />
            )}
        </Component>
    );
};

export default SettingsRow;