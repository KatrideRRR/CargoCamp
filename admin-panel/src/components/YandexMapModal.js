import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";

function loadYMaps(apiKey) {
    if (window.ymaps) return Promise.resolve(window.ymaps);

    const id = "yandex-maps-script";
    const existing = document.getElementById(id);

    if (existing) {
        return new Promise((resolve, reject) => {
            existing.addEventListener("load", () => resolve(window.ymaps));
            existing.addEventListener("error", reject);
        });
    }

    return new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.id = id;
        s.async = true;
        s.src = `https://api-maps.yandex.ru/2.1/?apikey=${apiKey}&lang=ru_RU`;
        s.onload = () => resolve(window.ymaps);
        s.onerror = reject;
        document.head.appendChild(s);
    });
}

export default function YandexMapModal({
                                           isOpen,
                                           onClose,
                                           initialLat,
                                           initialLng,
                                           onPick, // ({ lat, lng, address })
                                       }) {
    const apiKey = process.env.REACT_APP_YANDEX_API_KEY;

    const mapRef = useRef(null);
    const mapInstanceRef = useRef(null);
    const placemarkRef = useRef(null);
    const ymapsRef = useRef(null);

    const [loading, setLoading] = useState(false);
    const [picked, setPicked] = useState(null);
    const [error, setError] = useState(null);

    const center = useMemo(() => {
        const lat = Number.isFinite(Number(initialLat)) ? Number(initialLat) : 55.751244;
        const lng = Number.isFinite(Number(initialLng)) ? Number(initialLng) : 37.618423;
        return [lat, lng];
    }, [initialLat, initialLng]);

    // ✅ блокируем скролл страницы, пока модалка открыта
    useEffect(() => {
        if (!isOpen) return;

        const prev = document.body.style.overflow;
        document.body.style.overflow = "hidden";

        return () => {
            document.body.style.overflow = prev;
        };
    }, [isOpen]);

    const setPointOnMap = useCallback(async (lat, lng) => {
        const ymaps = ymapsRef.current;
        const map = mapInstanceRef.current;
        if (!ymaps || !map) return;

        // маркер
        if (!placemarkRef.current) {
            placemarkRef.current = new ymaps.Placemark([lat, lng], {}, { draggable: true });
            map.geoObjects.add(placemarkRef.current);

            placemarkRef.current.events.add("dragend", async () => {
                const c = placemarkRef.current.geometry.getCoordinates();
                await setPointOnMap(c[0], c[1]);
            });
        } else {
            placemarkRef.current.geometry.setCoordinates([lat, lng]);
        }

        map.setCenter([lat, lng], Math.max(map.getZoom(), 12), { duration: 200 });

        // reverse geocode (адрес)
        let address = `Координаты: ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        try {
            const res = await ymaps.geocode([lat, lng], { results: 1 });
            const first = res.geoObjects.get(0);
            const line = first?.getAddressLine?.();
            if (line) address = line;
        } catch {
            // не критично
        }

        setPicked({ lat, lng, address });
    }, []);

    useEffect(() => {
        if (!isOpen) return;

        if (!apiKey) {
            setError("Нет REACT_APP_YANDEX_API_KEY в .env");
            return;
        }

        let canceled = false;

        const init = async () => {
            try {
                setLoading(true);
                setError(null);
                setPicked(null);

                const ymaps = await loadYMaps(apiKey);
                await ymaps.ready();

                if (canceled) return;

                ymapsRef.current = ymaps;

                // на всякий — если осталась старая карта
                try {
                    mapInstanceRef.current?.destroy?.();
                } catch {}
                mapInstanceRef.current = null;
                placemarkRef.current = null;

                const map = new ymaps.Map(mapRef.current, {
                    center,
                    zoom: 11,
                    controls: ["zoomControl", "geolocationControl"],
                });

                mapInstanceRef.current = map;

                // ✅ часто без этого карта может быть "пустая", если контейнер появился только что
                setTimeout(() => {
                    try {
                        map.container.fitToViewport();
                    } catch {}
                }, 0);

                // если есть стартовые координаты — поставим маркер
                if (Number.isFinite(Number(initialLat)) && Number.isFinite(Number(initialLng))) {
                    await setPointOnMap(Number(initialLat), Number(initialLng));
                }

                map.events.add("click", async (e) => {
                    const coords = e.get("coords");
                    await setPointOnMap(coords[0], coords[1]);
                });
            } catch (e) {
                console.error(e);
                setError("Не удалось загрузить Яндекс.Карту");
            } finally {
                setLoading(false);
            }
        };

        init();

        return () => {
            canceled = true;

            try {
                mapInstanceRef.current?.destroy?.();
            } catch {}

            mapInstanceRef.current = null;
            placemarkRef.current = null;
            ymapsRef.current = null;
            setLoading(false);
            setError(null);
            setPicked(null);
        };
    }, [isOpen, apiKey, center, initialLat, initialLng, setPointOnMap]);

    if (!isOpen) return null;

    // ✅ вот тут Portal в body — чтобы модалка ВСЕГДА была поверх профиля/нижних кнопок
    return createPortal(
        <div className="glass-modal-overlay" onClick={onClose}>
            <div className="glass-modal" onClick={(e) => e.stopPropagation()}>
                <div className="glass-modal-head">
                    <div>
                        <div className="glass-modal-title">Выберите точку на карте</div>
                        <div className="glass-modal-subtitle">Кликните по карте или перетащите маркер</div>
                    </div>

                    <button className="glass-icon-btn" onClick={onClose} aria-label="close">
                        ✖
                    </button>
                </div>

                <div className="glass-map-wrap">
                    <div ref={mapRef} className="glass-map" />
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
                        <button className="btn btn-primary" disabled={!picked} onClick={() => onPick?.(picked)}>
                            Сохранить
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}