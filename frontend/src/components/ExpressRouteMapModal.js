import React, { useEffect, useMemo, useRef, useState } from "react";
import Modal from "react-modal";
import "../styles/CreateExpressOrder.css";

Modal.setAppElement("#root");

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

function isFiniteNum(v) {
    return Number.isFinite(Number(v));
}

export default function ExpressRouteMapModal({
                                                 isOpen,
                                                 onClose,
                                                 pointA, // { address, lat, lng }
                                                 pointB, // { address, lat, lng }
                                                 type,   // taxi|courier (для формулы)
                                                 onCreate, // создать заказ
                                                 pricing = { taxi: { base: 150, perKm: 20 }, courier: { base: 120, perKm: 15 } },
                                                 onRouteCalculated, // optional callback: ({distanceKm, durationMin})
                                             }) {
    const apiKey = process.env.REACT_APP_YANDEX_API_KEY;

    const mapRef = useRef(null);
    const mapInstanceRef = useRef(null);
    const routeRef = useRef(null);
    const ymapsRef = useRef(null);

    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState("");
    const [distanceKm, setDistanceKm] = useState(null);
    const [durationMin, setDurationMin] = useState(null);

    const coordsOk = useMemo(() => {
        return (
            isFiniteNum(pointA?.lat) &&
            isFiniteNum(pointA?.lng) &&
            isFiniteNum(pointB?.lat) &&
            isFiniteNum(pointB?.lng)
        );
    }, [pointA, pointB]);

    const recPrice = useMemo(() => {
        if (!Number.isFinite(distanceKm)) return null;
        const cfg = pricing[type] || pricing.taxi;
        return Math.round(cfg.base + cfg.perKm * distanceKm);
    }, [distanceKm, pricing, type]);

    useEffect(() => {
        if (!isOpen) return;

        let canceled = false;

        const init = async () => {
            try {
                setErr("");
                setLoading(true);
                setDistanceKm(null);
                setDurationMin(null);

                if (!apiKey) {
                    setErr("Нет REACT_APP_YANDEX_API_KEY");
                    return;
                }
                if (!coordsOk) {
                    setErr("Нужно выбрать точки A и B на карте (координаты)");
                    return;
                }

                const ymaps = await loadYMaps(apiKey);
                await ymaps.ready();
                if (canceled) return;

                ymapsRef.current = ymaps;

                // чистим старое
                try { routeRef.current && mapInstanceRef.current?.geoObjects?.remove(routeRef.current); } catch {}
                routeRef.current = null;

                try { mapInstanceRef.current?.destroy?.(); } catch {}
                mapInstanceRef.current = null;

                const center = [Number(pointA.lat), Number(pointA.lng)];

                const map = new ymaps.Map(mapRef.current, {
                    center,
                    zoom: 12,
                    controls: ["zoomControl"],
                });

                mapInstanceRef.current = map;

                // строим маршрут A->B
                const route = await ymaps.route(
                    [
                        [Number(pointA.lat), Number(pointA.lng)],
                        [Number(pointB.lat), Number(pointB.lng)],
                    ],
                    {
                        mapStateAutoApply: true, // авто подгоняет зум/центр под маршрут
                    }
                );

                if (canceled) return;

                routeRef.current = route;
                map.geoObjects.add(route);

                // distance/time
                const meters = typeof route.getLength === "function" ? route.getLength() : null;
                const seconds = typeof route.getTime === "function" ? route.getTime() : null;

                const km = Number.isFinite(meters) ? meters / 1000 : null;
                const min = Number.isFinite(seconds) ? Math.round(seconds / 60) : null;

                setDistanceKm(Number.isFinite(km) ? Number(km.toFixed(2)) : null);
                setDurationMin(Number.isFinite(min) ? min : null);

                onRouteCalculated?.({
                    distanceKm: Number.isFinite(km) ? Number(km.toFixed(2)) : null,
                    durationMin: Number.isFinite(min) ? min : null,
                });

                // фикс для рендера в модалке
                setTimeout(() => {
                    try { map.container.fitToViewport(); } catch {}
                }, 0);
            } catch (e) {
                console.error(e);
                setErr("Не удалось построить маршрут на карте");
            } finally {
                setLoading(false);
            }
        };

        init();

        return () => {
            canceled = true;
            try { mapInstanceRef.current?.destroy?.(); } catch {}
            mapInstanceRef.current = null;
            routeRef.current = null;
            ymapsRef.current = null;
            setLoading(false);
        };
    }, [isOpen, apiKey, coordsOk, pointA, pointB, onRouteCalculated]);

    return (
        <Modal
            isOpen={isOpen}
            onRequestClose={onClose}
            className="exo-modal exo-modalWide"
            overlayClassName="exo-overlay"
            contentLabel="Маршрут A → B"
        >
            <div className="exo-modalHead">
                <div>
                    <div className="exo-modalTitle">Маршрут A → B</div>
                    <div className="exo-modalSub">
                        Проверь, что точки выбраны верно — и только потом создавай заказ
                    </div>
                </div>

                <button className="exo-x" onClick={onClose} type="button">✖</button>
            </div>

            <div className="exo-modalBody">
                <div className="exo-previewRow">
                    <div className="exo-previewLabel">Откуда (A)</div>
                    <div className="exo-previewText">{pointA?.address || "—"}</div>
                </div>

                <div className="exo-previewRow">
                    <div className="exo-previewLabel">Куда (B)</div>
                    <div className="exo-previewText">{pointB?.address || "—"}</div>
                </div>

                <div className="exo-routeMapWrap">
                    <div ref={mapRef} className="exo-routeMap" />
                    {loading && <div className="exo-routeLoading">Строим маршрут…</div>}
                </div>

                {err && <div className="exo-alert" style={{ marginTop: 10 }}>
                    <div className="exo-alertTitle">Ошибка</div>
                    <div className="exo-alertText">{err}</div>
                </div>}

                <div className="exo-routeStats">
                    <div>
                        <b>Расстояние:</b> {Number.isFinite(distanceKm) ? `${distanceKm} км` : "—"}
                    </div>
                    <div>
                        <b>Время:</b> {Number.isFinite(durationMin) ? `~${durationMin} мин` : "—"}
                    </div>
                    <div>
                        <b>Рекомендуем:</b> {recPrice ? `${recPrice} ₽` : "—"}
                    </div>
                </div>

                <div className="exo-modalActions" style={{ marginTop: 12 }}>
                    <button className="exo-btn exo-btnGhost" type="button" onClick={onClose}>
                        Назад
                    </button>
                    <button className="exo-btn exo-btnPrimary" type="button" onClick={onCreate} disabled={!coordsOk || !!err || loading}>
                        Создать заказ
                    </button>
                </div>
            </div>
        </Modal>
    );
}