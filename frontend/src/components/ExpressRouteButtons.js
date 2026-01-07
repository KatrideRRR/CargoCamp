import React, { useState } from "react";
import axiosInstance from "../utils/axiosInstance";
import { FaRoute, FaLocationArrow } from "react-icons/fa";

const ExpressRouteButtons = ({ orderId, canToA, canAToB }) => {
    const [busy, setBusy] = useState(false);

    const openUrl = (url) => {
        if (!url) return;
        window.open(url, "_blank");
    };

    const getMyGeo = () =>
        new Promise((resolve, reject) => {
            if (!navigator.geolocation) return reject(new Error("GPS недоступен"));
            navigator.geolocation.getCurrentPosition(
                (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
                (err) => reject(err),
                { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
            );
        });

    const routeToA = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const my = await getMyGeo();
            const r = await axiosInstance.get(`/express/express-orders/${orderId}/route/to-A`, {
                params: { myLat: my.lat, myLng: my.lng },
            });
            if (!r.data?.success) throw new Error(r.data?.message || "Не удалось получить маршрут");
            openUrl(r.data.url);
        } catch (e) {
            console.error(e);
            alert(e.response?.data?.message || e.message || "Ошибка маршрута до A");
        } finally {
            setBusy(false);
        }
    };

    const routeAToB = async () => {
        if (busy) return;
        setBusy(true);
        try {
            const r = await axiosInstance.get(`/express/express-orders/${orderId}/route/A-to-B`);
            if (!r.data?.success) throw new Error(r.data?.message || "Не удалось получить маршрут");
            openUrl(r.data.url);
        } catch (e) {
            console.error(e);
            alert(e.response?.data?.message || e.message || "Ошибка маршрута A→B");
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="express-actions-row">
            {canToA && (
                <button className="express-btn express-btnGhost" type="button" onClick={routeToA} disabled={busy}>
                    <FaLocationArrow /> До точки A
                </button>
            )}

            {canAToB && (
                <button className="express-btn express-btnGhost" type="button" onClick={routeAToB} disabled={busy}>
                    <FaRoute /> Маршрут A→B
                </button>
            )}
        </div>
    );
};

export default ExpressRouteButtons;