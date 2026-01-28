import React, { useMemo, useState } from "react";
import axiosInstance from "../utils/axiosInstance";
import { FaLocationArrow } from "react-icons/fa";

const ExpressRouteButtons = ({ orderId, navMode }) => {
    const [busy, setBusy] = useState(false);

    const title = useMemo(() => {
        if (navMode === "toA") return "Навигация до точки A";
        if (navMode === "AtoB") return "Навигация A→B";
        return "Навигация недоступна";
    }, [navMode]);

    const openUrl = (url) => url && window.open(url, "_blank");

    const getMyGeo = () =>
        new Promise((resolve, reject) => {
            if (!navigator.geolocation) return reject(new Error("GPS недоступен"));
            navigator.geolocation.getCurrentPosition(
                (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                (err) => reject(err),
                { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
            );
        });

    const go = async () => {
        if (busy || navMode === "none") return;

        setBusy(true);
        try {
            if (navMode === "toA") {
                const my = await getMyGeo();
                const r = await axiosInstance.get(`/express/express-orders/${orderId}/route/to-A`, {
                    params: { myLat: my.lat, myLng: my.lng },
                });
                if (!r.data?.success) throw new Error(r.data?.message || "Не удалось получить маршрут");
                openUrl(r.data.url);
                return;
            }

            if (navMode === "AtoB") {
                const r = await axiosInstance.get(`/express/express-orders/${orderId}/route/A-to-B`);
                if (!r.data?.success) throw new Error(r.data?.message || "Не удалось получить маршрут");
                openUrl(r.data.url);
            }
        } catch (e) {
            console.error(e);
            alert(e.response?.data?.message || e.message || "Ошибка навигации");
        } finally {
            setBusy(false);
        }
    };

    return (
        <button
            className="express-btn express-btnNav"
            type="button"
            onClick={go}
            disabled={busy || navMode === "none"}
            aria-label={title}
            title={title}
        >
            <FaLocationArrow />
            <span className="btn-text">Навигация</span>
        </button>
    );
};

export default ExpressRouteButtons;