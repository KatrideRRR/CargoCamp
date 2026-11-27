import React from "react";
import { LoaderCircle } from "lucide-react";

import "../../styles/ui.css";

const Button = React.forwardRef(function Button(
    {
        children,
        variant = "primary",
        size = "md",
        fullWidth = false,
        loading = false,
        disabled = false,
        leftIcon,
        rightIcon,
        className = "",
        type = "button",
        ...props
    },
    ref
) {
    const classes = [
        "cc-button",
        `cc-button--${variant}`,
        `cc-button--${size}`,
        fullWidth && "cc-button--full",
        loading && "cc-button--loading",
        className,
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <button
            {...props}
            ref={ref}
            type={type}
            className={classes}
            disabled={disabled || loading}
            aria-busy={loading || undefined}
        >
            {loading ? (
                <LoaderCircle
                    size={20}
                    className="cc-button__spinner"
                    aria-hidden="true"
                />
            ) : leftIcon ? (
                <span
                    className="cc-button__icon"
                    aria-hidden="true"
                >
                    {leftIcon}
                </span>
            ) : null}

            <span className="cc-button__label">
                {children}
            </span>

            {!loading && rightIcon && (
                <span
                    className="cc-button__icon"
                    aria-hidden="true"
                >
                    {rightIcon}
                </span>
            )}
        </button>
    );
});

export default Button;