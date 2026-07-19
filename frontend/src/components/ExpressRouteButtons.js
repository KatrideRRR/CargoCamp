import React, { useCallback, useState } from "react";
import { FaMapMarkedAlt } from "react-icons/fa";
import { toast } from "react-toastify";
import { openOrderRoute } from "../utils/orderNavigation";

const ExpressRouteButtons = ({
                                 order,
                                 navMode = "none",
                                 className = "",
                                 buttonClassName = "express-secondaryBtn",
                             }) => {
    const [busyMode, setBusyMode] = useState(null);

    const handleNavigation = useCallback(
        async (mode, event) => {
            event?.preventDefault?.();
            event?.stopPropagation?.();

            if (!order || busyMode) {
                return;
            }

            setBusyMode(mode);

            try {
                const target = mode === "AtoB" ? "B" : "A";

                await openOrderRoute(order, {
                    orderType: "express",
                    target,
                    confirmText:
                        target === "A"
                            ? "Открыть маршрут до точки А в Яндекс.Навигаторе?"
                            : "Открыть маршрут до точки Б в Яндекс.Навигаторе?",
                });
            } catch (error) {
                console.error("Express navigation error:", error);

                toast.error(
                    error?.message ||
                    "Не удалось открыть маршрут"
                );
            } finally {
                setBusyMode(null);
            }
        },
        [order, busyMode]
    );

    if (navMode === "none") {
        return null;
    }

    return (
        <div className={`express-nav ${className}`.trim()}>
            {navMode === "toA" && (
                <button
                    type="button"
                    className={buttonClassName}
                    onClick={(event) =>
                        handleNavigation("toA", event)
                    }
                    disabled={busyMode !== null}
                    aria-label="Открыть маршрут до точки А"
                >
                    <FaMapMarkedAlt />

                    <span className="btn-text">
                        {busyMode === "toA"
                            ? "Открываем..."
                            : "До точки А"}
                    </span>
                </button>
            )}

            {navMode === "AtoB" && (
                <button
                    type="button"
                    className={buttonClassName}
                    onClick={(event) =>
                        handleNavigation("AtoB", event)
                    }
                    disabled={busyMode !== null}
                    aria-label="Открыть маршрут до точки Б"
                >
                    <FaMapMarkedAlt />

                    <span className="btn-text">
                        {busyMode === "AtoB"
                            ? "Открываем..."
                            : "До точки Б"}
                    </span>
                </button>
            )}
        </div>
    );
};

export default ExpressRouteButtons;