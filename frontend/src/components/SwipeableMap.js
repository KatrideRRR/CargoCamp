import React, { useEffect, useMemo, useRef, useState } from "react";
import { YMaps, Map, Placemark } from "@pbe/react-yandex-maps";
import { motion } from "framer-motion";

const DEFAULT_CENTER = [44.9572, 34.1108];

const SwipeableMap = ({ orders = [], userLocation, isOpen = false }) => {
    const mapRef = useRef(null);
    const ymapsRef = useRef(null);

    const [fitKey, setFitKey] = useState(0); // чтобы форсить автозум кнопкой

    const userCenter = useMemo(() => {
        const lat = Number(userLocation?.latitude);
        const lng = Number(userLocation?.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return [lat, lng];
    }, [userLocation]);

    const orderPoints = useMemo(() => {
        const pts = [];
        for (const o of orders || []) {
            const parts = String(o.coordinates || "").split(",").map((x) => Number(String(x).trim()));
            const lat = parts?.[0];
            const lng = parts?.[1];
            if (Number.isFinite(lat) && Number.isFinite(lng)) pts.push([lat, lng]);
        }
        return pts;
    }, [orders]);

    const fitToPoints = () => {
        if (!mapRef.current || !ymapsRef.current) return;

        const points = [];
        if (userCenter) points.push(userCenter);
        points.push(...orderPoints);

        // если нет ни одной точки — fallback
        if (!points.length) {
            mapRef.current.setCenter(DEFAULT_CENTER, 9, { duration: 200 });
            return;
        }

        // bounds from points
        const bounds = ymapsRef.current.util.bounds.fromPoints(points);

        // setBounds with margin
        mapRef.current.setBounds(bounds, {
            checkZoomRange: true,
            zoomMargin: 48,
            duration: 250,
        });
    };

    const panToMe = () => {
        if (!mapRef.current || !userCenter) return;
        mapRef.current.setCenter(userCenter, 14, { duration: 220 });
    };

    // ✅ автозум при открытии карты + при изменении координат/заказов
    useEffect(() => {
        if (!isOpen) return;
        fitToPoints();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, userCenter, orderPoints, fitKey]);

    const ymKey = process.env.REACT_APP_YANDEX_API_KEY;

    return (
        <div className="swipe-map-root">
            <YMaps query={{ apikey: ymKey }}>
                <motion.div
                    style={{ width: "100%", height: "55vh" }}
                    layout
                    initial={{ y: 0 }}
                    animate={{ y: 0 }}
                    exit={{ y: "100%" }}
                    transition={{ type: "spring", stiffness: 300 }}
                >
                    <div className="map-ui">
                        <button className="map-ui-btn" onClick={panToMe} disabled={!userCenter}>
                            На меня
                        </button>
                        <button className="map-ui-btn" onClick={() => setFitKey((k) => k + 1)}>
                            Автозум
                        </button>
                    </div>

                    <Map
                        onLoad={(ymaps) => (ymapsRef.current = ymaps)}
                        instanceRef={(ref) => (mapRef.current = ref)}
                        state={{
                            center: userCenter || DEFAULT_CENTER,
                            zoom: userCenter ? 12 : 9,
                        }}
                        style={{ width: "100%", height: "100%" }}
                        modules={["geoObject.addon.balloon", "util.bounds"]}
                    >
                        {/* Пользователь */}
                        {userCenter && (
                            <Placemark
                                geometry={userCenter}
                                properties={{
                                    hintContent: "Ваше местоположение",
                                    balloonContent: "Вы находитесь здесь",
                                }}
                                options={{
                                    preset: "islands#redCircleIcon",
                                    iconColor: "rgba(0,100,251,0.85)",
                                }}
                            />
                        )}

                        {/* Заказы */}
                        {(orders || []).map((order) => {
                            const parts = String(order.coordinates || "").split(",").map((x) => Number(String(x).trim()));
                            const lat = parts?.[0];
                            const lng = parts?.[1];
                            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

                            // разный цвет маркера: приоритет / курьер
                            const iconColor = order.taxi_courier
                                ? "#f59e0b"
                                : order.is_recommended
                                    ? "#6366f1"
                                    : "#007AFF";

                            return (
                                <Placemark
                                    key={order.id}
                                    geometry={[lat, lng]}
                                    properties={{
                                        hintContent: `Заказ #${order.id}`,
                                        balloonContent: `
                      <div style="font-size: 14px;">
                        <p><strong>Сумма:</strong> ${order.proposedSum || "—"} ₽</p>
                        <p><strong>Адрес:</strong> ${order.address || "—"}</p>
                        <button 
                          onclick="window.location.href='/order/${order.id}'" 
                          style="background:#007AFF;color:#fff;border:none;padding:6px 10px;border-radius:8px;cursor:pointer;margin-top:6px;"
                        >
                          Перейти
                        </button>
                      </div>
                    `,
                                    }}
                                    options={{
                                        preset: "islands#dotIcon",
                                        iconColor,
                                        openBalloonOnClick: true,
                                    }}
                                />
                            );
                        })}
                    </Map>
                </motion.div>
            </YMaps>
        </div>
    );
};

export default SwipeableMap;