import React, { useState, useCallback } from "react";
import axiosInstance from "../utils/axiosInstance";
import { FaLocationArrow } from "react-icons/fa";
import { toast } from "react-toastify";

const getMyGeo = () =>
    new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(new Error("GPS недоступен"));
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            (err) => reject(err),
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
        );
    });

function openExternal(url) {
    if (!url) return;

    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isMobile) {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
    }

    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
        alert("Браузер заблокировал новую вкладку. Разрешите всплывающие окна.");
    }
}

const ExpressRouteButtons = ({
                                 orderId,
                                 navMode = "none",
                                 className = "",
                                 buttonClassName = "express-btn express-btnNav",
                             }) => {
    const [busyMode, setBusyMode] = useState(null);

    const go = useCallback(
        async (mode, e) => {
            e?.preventDefault?.();
            e?.stopPropagation?.();

            if (!orderId || busyMode) return;

            setBusyMode(mode);
            try {
                let r;

                if (mode === "toA") {
                    const my = await getMyGeo();
                    r = await axiosInstance.get(
                        `/express/express-orders/${orderId}/route/to-A`,
                        { params: { myLat: my.lat, myLng: my.lng } }
                    );
                } else {
                    r = await axiosInstance.get(`/express/express-orders/${orderId}/route/A-to-B`);
                }

                const url = r.data?.url;
                if (!url) throw new Error("Маршрут не получен");

                openExternal(url);
            } catch (err) {
                console.error(err);
                toast.error(err.response?.data?.message || err.message || "Ошибка навигации");
            } finally {
                setBusyMode(null);
            }
        },
        [orderId, busyMode]
    );

    if (navMode === "none") return null;

    return (
        <div className={className} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {navMode === "toA" && (
                <button
                    type="button"
                    className={buttonClassName}
                    onClick={(e) => go("toA", e)}
                    disabled={busyMode !== null}
                >
                    <FaLocationArrow />
                    <span className="btn-text">До точки A</span>
                </button>
            )}

            {navMode === "AtoB" && (
                <button
                    type="button"
                    className={buttonClassName}
                    onClick={(e) => go("AtoB", e)}
                    disabled={busyMode !== null}
                >
                    <FaLocationArrow />
                    <span className="btn-text">Маршрут A→B</span>
                </button>
            )}
        </div>
    );
};

export default ExpressRouteButtons;