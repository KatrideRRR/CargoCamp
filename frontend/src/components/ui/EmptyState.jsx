import React from "react";
import { Inbox } from "lucide-react";

import Button from "./Button";

import "../../styles/ui.css";

const EmptyState = ({
                        icon,
                        title = "Здесь пока ничего нет",
                        description,
                        actionLabel,
                        onAction,
                        actionLoading = false,
                        className = "",
                    }) => {
    return (
        <div
            className={[
                "cc-empty-state",
                className,
            ]
                .filter(Boolean)
                .join(" ")}
        >
            <div
                className="cc-empty-state__icon"
                aria-hidden="true"
            >
                {icon || <Inbox size={32} />}
            </div>

            <h2 className="cc-empty-state__title">
                {title}
            </h2>

            {description && (
                <p className="cc-empty-state__description">
                    {description}
                </p>
            )}

            {actionLabel &&
                typeof onAction === "function" && (
                    <Button
                        onClick={onAction}
                        loading={actionLoading}
                    >
                        {actionLabel}
                    </Button>
                )}
        </div>
    );
};

export default EmptyState;