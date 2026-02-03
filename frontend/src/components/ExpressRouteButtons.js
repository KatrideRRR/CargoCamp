import React, { useState, useCallback, useMemo } from "react";
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

    // 1) Мобилка: пытаемся открыть как "приложение/система решит"
    // target=_blank на мобиле чаще всего открывает приложение, если ссылка поддерживается
    if (isMobile) {
        // iOS Safari иногда игнорирует noopener/noreferrer; оставим просто _blank
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
    }

    // 2) Десктоп: новая вкладка/окно
    const win = window.open(url, "_blank", "noopener,noreferrer");
    if (!win) {
        // если блокировщик попапов
        // НЕ делаем window.location.href (ты этого не хочешь)
        alert("Браузер заблокировал открытие новой вкладки. Разрешите всплывающие окна для сайта.");
    }
}

function safeOpen(url) {
    if (!url) return false;
    // можно просто открыть, но после await иногда блокируется — используем pre-open
    const win = window.open("about:blank", "_blank", "noopener,noreferrer");
    if (!win) {
        return true;
    }
    return true;
}

const ExpressRouteButtons = ({
                                 orderId,
                                 canToA = false,
                                 canAToB = true,
                                 className = "",
                                 buttonClassName = "btn btn-ghost",
                             }) => {
    const [busyMode, setBusyMode] = useState(null); // "toA" | "AtoB" | null

    const go = useCallback(
        async (mode, e) => {
            e?.preventDefault?.();
            e?.stopPropagation?.();

            if (!orderId) return toast.error("Нет ID экспресс-заказа");
            if (busyMode) return;

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
                    // A->B
                    r = await axiosInstance.get(`/express/express-orders/${orderId}/route/A-to-B`);
                }

                const ok = !!r.data?.success;
                const url = r.data?.url;

                if (!url) throw new Error("Маршрут не получен");
                openExternal(url);

                if (!ok || !url) {
                    throw new Error(r.data?.message || "Маршрут не найден");
                }

                safeOpen(url);
            } catch (err) {
                console.error(err);
                toast.error(err.response?.data?.message || err.message || "Ошибка навигации");
            } finally {
                setBusyMode(null);
            }
        },
        [orderId, busyMode]
    );

    const disabledToA = useMemo(() => !canToA || busyMode !== null, [canToA, busyMode]);
    const disabledAtoB = useMemo(() => !canAToB || busyMode !== null, [canAToB, busyMode]);

    return (
        <div className={className} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {canToA && (
                <button
                    type="button"
                    className={buttonClassName}
                    onClick={(e) => go("toA", e)}
                    disabled={disabledToA}
                    title="Навигация до точки A"
                    aria-label="Навигация до точки A"
                >
                    <FaLocationArrow />
                    <span>До A</span>
                </button>
            )}

            {canAToB && (
                <button
                    type="button"
                    className={buttonClassName}
                    onClick={(e) => go("AtoB", e)}
                    disabled={disabledAtoB}
                    title="Навигация A→B"
                    aria-label="Навигация A→B"
                >
                    <FaLocationArrow />
                    <span>A→B</span>
                </button>
            )}
        </div>
    );
};

export default ExpressRouteButtons;