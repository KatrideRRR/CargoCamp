import React, { useId } from "react";

import "../../styles/ui.css";

const TextField = React.forwardRef(function TextField(
    {
        id,
        label,
        hint,
        error,
        leftIcon,
        rightAction,
        multiline = false,
        rows = 4,
        className = "",
        inputClassName = "",
        ...props
    },
    ref
) {
    const generatedId = useId();
    const fieldId = id || generatedId;
    const hintId = `${fieldId}-hint`;
    const errorId = `${fieldId}-error`;

    const Component = multiline ? "textarea" : "input";

    const describedBy = [
        props["aria-describedby"],
        hint && hintId,
        error && errorId,
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <div
            className={[
                "cc-field",
                error && "cc-field--invalid",
                props.disabled && "cc-field--disabled",
                className,
            ]
                .filter(Boolean)
                .join(" ")}
        >
            {label && (
                <label
                    htmlFor={fieldId}
                    className="cc-field__label"
                >
                    {label}

                    {props.required && (
                        <span
                            className="cc-field__required"
                            aria-hidden="true"
                        >
                            *
                        </span>
                    )}
                </label>
            )}

            <div
                className={[
                    "cc-field__control",
                    multiline && "cc-field__control--multiline",
                ]
                    .filter(Boolean)
                    .join(" ")}
            >
                {leftIcon && (
                    <span
                        className="cc-field__icon"
                        aria-hidden="true"
                    >
                        {leftIcon}
                    </span>
                )}

                <Component
                    {...props}
                    {...(multiline ? { rows } : {})}
                    id={fieldId}
                    ref={ref}
                    className={[
                        "cc-field__input",
                        inputClassName,
                    ]
                        .filter(Boolean)
                        .join(" ")}
                    aria-invalid={
                        error
                            ? true
                            : props["aria-invalid"]
                    }
                    aria-describedby={
                        describedBy || undefined
                    }
                />

                {rightAction && (
                    <div className="cc-field__action">
                        {rightAction}
                    </div>
                )}
            </div>

            {hint && (
                <div
                    id={hintId}
                    className="cc-field__hint"
                >
                    {hint}
                </div>
            )}

            {error && (
                <div
                    id={errorId}
                    className="cc-field__error"
                    role="alert"
                >
                    {error}
                </div>
            )}
        </div>
    );
});

export default TextField;