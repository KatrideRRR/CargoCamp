import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

let ymapsLoaderPromise = null;

function loadYMaps(apiKey) {
    if (window.ymaps) {
        return Promise.resolve(window.ymaps);
    }

    if (ymapsLoaderPromise) {
        return ymapsLoaderPromise;
    }

    ymapsLoaderPromise = new Promise((resolve, reject) => {
        const existing = document.getElementById("yandex-maps-script");

        if (existing) {
            existing.addEventListener("load", () => resolve(window.ymaps), {
                once: true,
            });

            existing.addEventListener("error", reject, {
                once: true,
            });

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

function getCoordsFromOrder(order) {
    const raw = String(order?.coordinates || "");
    const [lat, lng] = raw.split(",").map((x) => Number(String(x).trim()));

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
    }

    return [lat, lng];
}

export default function YandexMapModal({
                                           isOpen,
                                           onClose,
                                           initialLat,
                                           initialLng,
                                           onPick,
                                           showOrders = false,
                                           orders = [],
                                           currentUserId = null,
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

    const safeOrders = useMemo(() => {
        if (!Array.isArray(orders)) return [];
        return orders;
    }, [orders]);

    const initialCenter = useMemo(() => {
        const lat = Number(initialLat);
        const lng = Number(initialLng);

        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            return [lat, lng];
        }

        // Москва как безопасный fallback
        return [55.751244, 37.618423];
    }, [initialLat, initialLng]);

    const hasInitialCoords = useMemo(() => {
        const lat = Number(initialLat);
        const lng = Number(initialLng);

        return Number.isFinite(lat) && Number.isFinite(lng);
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
            const res = await ymaps.geocode([lat, lng], {
                results: 1,
            });

            const first = res.geoObjects.get(0);

            return (
                first?.getAddressLine?.() ||
                `Координаты: ${lat.toFixed(5)}, ${lng.toFixed(5)}`
            );
        } catch {
            return `Координаты: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        }
    }, []);

    const setPickedPoint = useCallback(
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

                    if (!coords || coords.length < 2) return;

                    await setPickedPoint(coords[0], coords[1], false);
                };

                dragHandlerRef.current = dragHandler;
                placemark.events.add("dragend", dragHandler);
            } else {
                userPlacemarkRef.current.geometry.setCoordinates([lat, lng]);
            }

            if (shouldCenter) {
                map.setCenter([lat, lng], Math.max(map.getZoom(), 12));
            }

            const address = await reverseGeocode(lat, lng);

            setPicked({
                lat,
                lng,
                address,
            });
        },
        [reverseGeocode]
    );

    const renderOrders = useCallback(() => {
        const map = mapRef.current;
        const ymaps = ymapsRef.current;

        if (!map || !ymaps) return;

        if (!ordersCollectionRef.current) {
            ordersCollectionRef.current = new ymaps.GeoObjectCollection();
            map.geoObjects.add(ordersCollectionRef.current);
        }

        const collection = ordersCollectionRef.current;
        collection.removeAll();

        if (!showOrders || safeOrders.length === 0) return;

        safeOrders.forEach((order) => {
            const coords = getCoordsFromOrder(order);

            if (!coords) return;

            const title = order.express
                ? `Экспресс №${order.expressId}`
                : `Заказ №${order.id}`;

            const price = Number(order.proposedSum ?? 0).toLocaleString("ru-RU");

            const serviceLine = [
                order?.category?.name,
                order?.subcategory?.name,
                order?.service?.name,
            ]
                .filter(Boolean)
                .join(" • ");

            const isOwnOrder =
                currentUserId &&
                Number(order.creatorId) === Number(currentUserId);

            const orderUrl = order.express
                ? `/express-order/${order.expressId}`
                : `/order/${order.id}`;

            const openButtonText = order.express
                ? "Открыть экспресс"
                : "Открыть заказ";

            const ownOrderBadge = isOwnOrder
                ? `<span class="cc-map-balloon__badge cc-map-balloon__badge-own">Мой заказ</span>`
                : "";

            const balloonBody = `
    <div class="cc-map-balloon">
        ${ownOrderBadge}

        <div class="cc-map-balloon__address">
            ${order.address || "Без адреса"}
        </div>

        ${
                serviceLine
                    ? `<div class="cc-map-balloon__service">${serviceLine}</div>`
                    : ""
            }

        <div class="cc-map-balloon__meta">
            <span>${price} ₽</span>
            ${
                Number.isFinite(order._distance)
                    ? `<span>${order._distance.toFixed(1)} км</span>`
                    : ""
            }
        </div>

        <a class="cc-map-balloon__btn" href="${orderUrl}">
            ${openButtonText}
        </a>
    </div>
`;

            const placemarkOptions = isOwnOrder
                ? {
                    preset: "islands#circleIcon",
                    iconColor: "#94a3b8",
                }
                : order.express
                    ? {
                        preset: "islands#greenDotIcon",
                    }
                    : {
                        preset: "islands#blueDotIcon",
                    };

            const placemark = new ymaps.Placemark(
                coords,
                {
                    hintContent: title,
                    balloonContentHeader: `
            <div class="cc-map-balloon__header">
                ${title}
            </div>
        `,
                    balloonContentBody: balloonBody,
                },
                placemarkOptions
            );

            collection.add(placemark);
        });
    }, [safeOrders, showOrders, currentUserId]);

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

                const ymaps = await loadYMaps(apiKey);
                await ymaps.ready();

                if (cancelled || !mapNodeRef.current) return;

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
                    zoom: hasInitialCoords ? 12 : 10,
                    controls: ["zoomControl"],
                });

                mapRef.current = map;

                const clickHandler = async (e) => {
                    const coords = e.get("coords");

                    if (!coords || coords.length < 2) return;

                    await setPickedPoint(coords[0], coords[1], true);
                };

                clickHandlerRef.current = clickHandler;
                map.events.add("click", clickHandler);

                // Дать контейнеру модалки отрисоваться, затем подогнать карту.
                requestAnimationFrame(async () => {
                    if (cancelled || !mapRef.current) return;

                    try {
                        map.container.fitToViewport();
                    } catch {}

                    if (hasInitialCoords) {
                        await setPickedPoint(initialCenter[0], initialCenter[1], false);
                    }

                    renderOrders();
                });
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

            try {
                if (userPlacemarkRef.current && dragHandlerRef.current) {
                    userPlacemarkRef.current.events.remove(
                        "dragend",
                        dragHandlerRef.current
                    );
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
        hasInitialCoords,
        setPickedPoint,
        renderOrders,
    ]);

    useEffect(() => {
        if (!isOpen || !mapRef.current) return;

        renderOrders();
    }, [isOpen, renderOrders]);

    if (!isOpen) return null;

    return createPortal(
        <div className="glass-modal-overlay" onClick={onClose}>
            <div className="glass-modal" onClick={(e) => e.stopPropagation()}>
                <div className="glass-modal-head">
                    <div>
                        <div className="glass-modal-title">
                            Выберите точку на карте
                        </div>

                        <div className="glass-modal-subtitle">
                            Кликните по карте или перетащите красную метку
                        </div>
                    </div>

                    <button
                        type="button"
                        className="glass-icon-btn"
                        onClick={onClose}
                        aria-label="Закрыть"
                    >
                        ×
                    </button>
                </div>

                <div className="glass-map-wrap">
                    <div ref={mapNodeRef} className="glass-map" />

                    {loading && (
                        <div className="glass-map-loading">
                            Загрузка карты…
                        </div>
                    )}
                </div>

                {error && <div className="glass-error">{error}</div>}

                <div className="glass-modal-footer">
                    <div className="glass-picked">
                        <div className="glass-picked-label">Выбрано:</div>
                        <div className="glass-picked-value">
                            {picked?.address || "Ничего не выбрано"}
                        </div>
                    </div>

                    <div className="glass-actions">
                        <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={onClose}
                        >
                            Отмена
                        </button>

                        <button
                            type="button"
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