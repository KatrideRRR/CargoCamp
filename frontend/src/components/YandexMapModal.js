import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";

let ymapsLoaderPromise = null;

function loadYMaps(apiKey) {
    if (window.ymaps) return Promise.resolve(window.ymaps);
    if (ymapsLoaderPromise) return ymapsLoaderPromise;

    ymapsLoaderPromise = new Promise((resolve, reject) => {
        const existing = document.getElementById("yandex-maps-script");

        if (existing) {
            existing.addEventListener("load", () => resolve(window.ymaps), { once: true });
            existing.addEventListener("error", reject, { once: true });
            return;
        }

        const script = document.createElement("script");
        script.id = "yandex-maps-script";
        script.async = true;
        script.src = `https://api-maps.yandex.ru/2.1/?apikey=${apiKey}&lang=ru_RU`;
        script.onload = () => resolve(window.ymaps);
        script.onerror = reject;

        document.head.appendChild(script);
    });

    return ymapsLoaderPromise;
}

export default function YandexMapModal({
                                           isOpen,
                                           onClose,
                                           initialLat,
                                           initialLng,
                                           onPick,
                                           showOrders = true,
                                           orders = [],
                                       }) {
    const apiKey = process.env.REACT_APP_YANDEX_API_KEY;

    const mapNodeRef = useRef(null);
    const mapRef = useRef(null);
    const ymapsRef = useRef(null);
    const userPlacemarkRef = useRef(null);
    const ordersCollectionRef = useRef(null);
    const clickHandlerRef = useRef(null);
    const dragHandlerRef = useRef(null);

    const [loading, setLoading] = useState(false);
    const [picked, setPicked] = useState(null);
    const [error, setError] = useState(null);
    const [mapReady, setMapReady] = useState(false);

    const safeOrders = useMemo(() => (Array.isArray(orders) ? orders : []), [orders]);

    const initialCenter = useMemo(() => {
        const lat = Number(initialLat);
        const lng = Number(initialLng);

        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            return [lat, lng];
        }

        return [55.751244, 37.618423];
    }, [initialLat, initialLng]);

    useEffect(() => {
        if (!isOpen) return;

        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        return () => {
            document.body.style.overflow = prevOverflow;
        };
    }, [isOpen]);

    const reverseGeocode = useCallback(async (lat, lng) => {
        const ymaps = ymapsRef.current;
        if (!ymaps) {
            return `Координаты: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        }

        try {
            const res = await ymaps.geocode([lat, lng], { results: 1 });
            const first = res.geoObjects.get(0);
            return first?.getAddressLine?.() || `Координаты: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        } catch {
            return `Координаты: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        }
    }, []);

    const updatePickedPoint = useCallback(
        async (lat, lng, shouldCenter = false) => {
            const ymaps = ymapsRef.current;
            const map = mapRef.current;
            if (!ymaps || !map) return;

            if (!userPlacemarkRef.current) {
                const placemark = new ymaps.Placemark(
                    [lat, lng],
                    {},
                    {
                        draggable: true,
                        preset: "islands#redIcon",
                    }
                );

                userPlacemarkRef.current = placemark;
                map.geoObjects.add(placemark);

                const dragHandler = async () => {
                    const coords = placemark.geometry.getCoordinates();
                    await updatePickedPoint(coords[0], coords[1], false);
                };

                dragHandlerRef.current = dragHandler;
                placemark.events.add("dragend", dragHandler);
            } else {
                userPlacemarkRef.current.geometry.setCoordinates([lat, lng]);
            }

            if (shouldCenter) {
                map.setCenter([lat, lng], Math.max(map.getZoom(), 12), { duration: 150 });
            }

            const address = await reverseGeocode(lat, lng);
            setPicked({ lat, lng, address });
        },
        [reverseGeocode]
    );

    const renderOrdersToMap = useCallback(() => {
        const map = mapRef.current;
        const ymaps = ymapsRef.current;
        const collection = ordersCollectionRef.current;

        if (!map || !ymaps || !collection) return;

        collection.removeAll();

        if (!showOrders) return;

        const boundsItems = [];

        const selectedCoords = userPlacemarkRef.current?.geometry?.getCoordinates?.();
        if (Array.isArray(selectedCoords) && selectedCoords.length === 2) {
            boundsItems.push(selectedCoords);
        } else {
            const lat = Number(initialLat);
            const lng = Number(initialLng);
            if (Number.isFinite(lat) && Number.isFinite(lng)) {
                boundsItems.push([lat, lng]);
            }
        }

        safeOrders.forEach((order) => {
            const [lat, lng] = String(order.coordinates || "")
                .split(",")
                .map((x) => Number(String(x).trim()));

            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

            boundsItems.push([lat, lng]);

            const placemark = new ymaps.Placemark(
                [lat, lng],
                {
                    balloonContentHeader: order.express
                        ? `Экспресс №${order.expressId}`
                        : `Заказ №${order.id}`,
                    balloonContentBody: `
                        <div style="font-size:13px;line-height:1.4;">
                            <div><b>${order.address || "Без адреса"}</b></div>
                            <div style="margin-top:4px;">
                                ${Number(order.proposedSum || 0).toLocaleString("ru-RU")} ₽
                            </div>
                            <div style="margin-top:4px;color:#475569;">
                                ${order.description || "Без описания"}
                            </div>
                        </div>
                    `,
                    balloonContentFooter: Number.isFinite(order._distance)
                        ? `Расстояние: ${order._distance.toFixed(1)} км`
                        : "",
                    hintContent: order.express
                        ? `Экспресс №${order.expressId}`
                        : `Заказ №${order.id}`,
                },
                {
                    preset: order.express
                        ? "islands#greenDotIcon"
                        : order.is_recommended
                            ? "islands#violetDotIcon"
                            : order.is_highlighted
                                ? "islands#yellowDotIcon"
                                : "islands#blueDotIcon",
                }
            );

            collection.add(placemark);
        });

        try {
            if (boundsItems.length > 1) {
                map.setBounds(boundsItems, {
                    checkZoomRange: true,
                    zoomMargin: 40,
                });
            } else if (boundsItems.length === 1) {
                map.setCenter(boundsItems[0], 12);
            }
        } catch {}
    }, [safeOrders, showOrders, initialLat, initialLng]);

    useEffect(() => {
        if (!isOpen) return;

        if (!apiKey) {
            setError("Нет REACT_APP_YANDEX_API_KEY в .env");
            return;
        }

        let cancelled = false;

        const initMap = async () => {
            try {
                setLoading(true);
                setError(null);
                setPicked(null);
                setMapReady(false);

                const ymaps = await loadYMaps(apiKey);
                await ymaps.ready();

                if (cancelled) return;
                if (!mapNodeRef.current) return;

                ymapsRef.current = ymaps;

                try {
                    mapRef.current?.destroy?.();
                } catch {}

                mapRef.current = null;
                userPlacemarkRef.current = null;
                ordersCollectionRef.current = null;
                clickHandlerRef.current = null;
                dragHandlerRef.current = null;

                const map = new ymaps.Map(mapNodeRef.current, {
                    center: initialCenter,
                    zoom: 11,
                    controls: ["zoomControl", "geolocationControl"],
                });

                mapRef.current = map;

                const ordersCollection = new ymaps.GeoObjectCollection();
                ordersCollectionRef.current = ordersCollection;
                map.geoObjects.add(ordersCollection);

                const clickHandler = async (e) => {
                    const coords = e.get("coords");
                    await updatePickedPoint(coords[0], coords[1], !showOrders);
                };

                clickHandlerRef.current = clickHandler;
                map.events.add("click", clickHandler);

                setTimeout(async () => {
                    if (cancelled || !mapRef.current) return;

                    try {
                        map.container.fitToViewport();
                    } catch {}

                    const lat = Number(initialLat);
                    const lng = Number(initialLng);

                    if (Number.isFinite(lat) && Number.isFinite(lng)) {
                        await updatePickedPoint(lat, lng, false);
                    } else {
                        map.setCenter(initialCenter, 11);
                    }

                    setMapReady(true);

                    // КЛЮЧЕВОЙ ФИКС:
                    // после полного создания карты сразу рисуем заказы
                    setTimeout(() => {
                        if (!cancelled) {
                            renderOrdersToMap();
                        }
                    }, 0);
                }, 150);
            } catch (e) {
                console.error(e);
                setError("Не удалось загрузить Яндекс.Карту");
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        initMap();

        return () => {
            cancelled = true;
            setMapReady(false);

            try {
                if (userPlacemarkRef.current && dragHandlerRef.current) {
                    userPlacemarkRef.current.events.remove("dragend", dragHandlerRef.current);
                }
            } catch {}

            try {
                if (mapRef.current && clickHandlerRef.current) {
                    mapRef.current.events.remove("click", clickHandlerRef.current);
                }
            } catch {}

            try {
                mapRef.current?.destroy?.();
            } catch {}

            mapRef.current = null;
            ymapsRef.current = null;
            userPlacemarkRef.current = null;
            ordersCollectionRef.current = null;
            clickHandlerRef.current = null;
            dragHandlerRef.current = null;

            setLoading(false);
            setError(null);
            setPicked(null);
        };
    }, [
        isOpen,
        apiKey,
        initialCenter,
        initialLat,
        initialLng,
        showOrders,
        updatePickedPoint,
        renderOrdersToMap,
    ]);

    useEffect(() => {
        if (!isOpen || !mapReady) return;
        renderOrdersToMap();
    }, [isOpen, mapReady, renderOrdersToMap]);

    if (!isOpen) return null;

    return createPortal(
        <div className="glass-modal-overlay" onClick={onClose}>
            <div className="glass-modal" onClick={(e) => e.stopPropagation()}>
                <div className="glass-modal-head">
                    <div>
                        <div className="glass-modal-title">Выберите точку на карте</div>
                        <div className="glass-modal-subtitle">
                            {showOrders
                                ? "Синие/цветные метки — заказы, красная метка — ваша точка"
                                : "Кликните по карте или перетащите красную метку"}
                        </div>
                    </div>

                    <button className="glass-icon-btn" onClick={onClose} aria-label="close">
                        ✖
                    </button>
                </div>

                <div className="glass-map-wrap">
                    <div ref={mapNodeRef} className="glass-map" />
                    {loading && <div className="glass-map-loading">Загрузка карты…</div>}
                </div>

                {error && <div className="glass-error">{error}</div>}

                <div className="glass-modal-footer">
                    <div className="glass-picked">
                        <div className="glass-picked-label">Выбрано:</div>
                        <div className="glass-picked-value">{picked?.address || "Ничего не выбрано"}</div>
                    </div>

                    <div className="glass-actions">
                        <button className="btn btn-ghost" onClick={onClose}>
                            Отмена
                        </button>
                        <button
                            className="btn btn-primary"
                            disabled={!picked}
                            onClick={() => onPick?.(picked)}
                        >
                            Сохранить
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}