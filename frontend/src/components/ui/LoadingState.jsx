import React from "react";
import { LoaderCircle } from "lucide-react";

import "../../styles/ui.css";

const LoadingState = ({
                          title = "Загрузка...",
                          description,
                          fullPage = false,
                          className = "",
                      }) => {
    return (
        <div
            className={[
                "cc-loading-state",
                fullPage && "cc-loading-state--page",
                className,
            ]
                .filter(Boolean)
                .join(" ")}
            role="status"
            aria-live="polite"
            aria-atomic="true"
        >
            <LoaderCircle
                size={32}
                className="cc-loading-state__spinner"
                aria-hidden="true"
            />

            <span className="cc-loading-state__title">
                {title}
            </span>

            {description && (
                <span className="cc-loading-state__description">
                    {description}
                </span>
            )}
        </div>
    );
};

export default LoadingState;