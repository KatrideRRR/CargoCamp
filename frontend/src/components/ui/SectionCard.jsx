import React, { useId } from "react";

import "../../styles/ui.css";

const SectionCard = ({
                         title,
                         description,
                         action,
                         children,
                         className = "",
                         padded = true,
                         ...props
                     }) => {
    const titleId = useId();

    return (
        <section
            {...props}
            className={[
                "cc-section",
                padded && "cc-section--padded",
                className,
            ]
                .filter(Boolean)
                .join(" ")}
            aria-labelledby={
                title
                    ? titleId
                    : props["aria-labelledby"]
            }
        >
            {(title || description || action) && (
                <header className="cc-section__header">
                    <div className="cc-section__heading">
                        {title && (
                            <h2
                                id={titleId}
                                className="cc-section__title"
                            >
                                {title}
                            </h2>
                        )}

                        {description && (
                            <p className="cc-section__description">
                                {description}
                            </p>
                        )}
                    </div>

                    {action && (
                        <div className="cc-section__action">
                            {action}
                        </div>
                    )}
                </header>
            )}

            <div className="cc-section__content">
                {children}
            </div>
        </section>
    );
};

export default SectionCard;