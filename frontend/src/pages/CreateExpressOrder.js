import React, { useEffect, useMemo, useState, useCallback } from "react";
import "../styles/CreateExpressOrder.css";
import axiosInstance from "../utils/axiosInstance";
import YandexMapModal from "../components/YandexMapModal";
import ExpressRouteMapModal from "../components/ExpressRouteMapModal";
import ExpressSavedAddressesBar from "../components/ExpressSavedAddressesBar";
import { FaTaxi, FaBox, FaLocationArrow, FaMapMarkedAlt } from "react-icons/fa";

const subcategoryOptions = {
    taxi: [
        { label: "Перевозка пассажиров", icon: "🚕" },
        { label: "Перевозка детей", icon: "🧒" },
        { label: "Перевозка животных", icon: "🐶" },
        { label: "Между городами", icon: "🛣️" },
    ],
    courier: [
        { label: "Цветы", icon: "💐" },
        { label: "Еда/продукты", icon: "🍔" },
        { label: "Документы", icon: "📄" },
    ],
};

function toNum(v) {
    const n = typeof v === "string" ? Number(v) : v;
    return Number.isFinite(n) ? n : null;
}

function parseYandexGeocoderSuggestions(data) {
    const members = data?.response?.GeoObjectCollection?.featureMember || [];

    return members
        .map((m) => {
            const g = m?.GeoObject;
            const text = g?.metaDataProperty?.GeocoderMetaData?.text;
            const pos = g?.Point?.pos; // "lon lat"
            if (!text || !pos) return null;

            const [lon, lat] = pos.split(" ").map(Number);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

            return { label: text, address: text, lat, lon };
        })
        .filter(Boolean);
}

function buildYandexNaviUrl(fromLat, fromLng, toLat, toLng) {
    return `https://yandex.ru/navi/?rtext=${Number(fromLat)},${Number(fromLng)}~${Number(toLat)},${Number(toLng)}&rtt=auto`;
}

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

async function calcRouteByYmaps({ apiKey, fromLat, fromLng, toLat, toLng }) {
    const ymaps = await loadYMaps(apiKey);
    await ymaps.ready();

    const route = await ymaps.route(
        [
            [Number(fromLat), Number(fromLng)],
            [Number(toLat), Number(toLng)],
        ],
        { mapStateAutoApply: false }
    );

    const meters = typeof route.getLength === "function" ? route.getLength() : null;
    const seconds = typeof route.getTime === "function" ? route.getTime() : null;

    return {
        distanceKm: Number.isFinite(meters) ? meters / 1000 : null,
        durationMin: Number.isFinite(seconds) ? Math.round(seconds / 60) : null,
    };
}

const PRICING = {
    taxi: { base: 150, perKm: 20 },
    courier: { base: 120, perKm: 15 },
};

const CreateExpressOrder = () => {
    const apiKey = process.env.REACT_APP_YANDEX_API_KEY;

    const [type, setType] = useState("taxi");
    const [error, setError] = useState("");

    const [saved, setSaved] = useState([]);
    const [savedLoading, setSavedLoading] = useState(false);

    const [addrSug, setAddrSug] = useState({ from: [], to: [] });
    const suggestTimerRef = React.useRef({ from: null, to: null });
    const suggestAbortRef = React.useRef({ from: null, to: null });

    const [form, setForm] = useState({
        subcategory: "",       // optional
        totalPrice: "",
        description: "",

        fromAddress: "",
        fromLat: "",
        fromLng: "",

        toAddress: "",
        toLat: "",
        toLng: "",
    });

    const [showMapFor, setShowMapFor] = useState(null); // "from" | "to" | null
    const [showRouteModal, setShowRouteModal] = useState(false);

    const [suggestSave, setSuggestSave] = useState(false);
    const [createdOrderId, setCreatedOrderId] = useState(null);

    // Дополнительно (свернуть)
    const [extraOpen, setExtraOpen] = useState(false);

    // route calc
    const [routeCalc, setRouteCalc] = useState({ loading: false, distanceKm: null, durationMin: null, err: "" });

    const setField = (k, v) => setForm((p) => ({ ...p, [k]: v }));

    const coordsOk = useMemo(() => {
        const fLat = toNum(form.fromLat);
        const fLng = toNum(form.fromLng);
        const tLat = toNum(form.toLat);
        const tLng = toNum(form.toLng);
        return [fLat, fLng, tLat, tLng].every(Number.isFinite);
    }, [form.fromLat, form.fromLng, form.toLat, form.toLng]);

    const routeUrl = useMemo(() => {
        if (!coordsOk) return "";
        return buildYandexNaviUrl(form.fromLat, form.fromLng, form.toLat, form.toLng);
    }, [coordsOk, form.fromLat, form.fromLng, form.toLat, form.toLng]);

    const clearSuggest = (kind) => {
        setAddrSug((p) => ({ ...p, [kind]: [] }));
    };

    const fetchSuggest = (kind, query) => {
        if (!apiKey) return; // REACT_APP_YANDEX_API_KEY
        const q = String(query || "").trim();
        if (q.length < 3) {
            clearSuggest(kind);
            return;
        }

        // debounce
        const t = suggestTimerRef.current[kind];
        if (t) clearTimeout(t);

        suggestTimerRef.current[kind] = setTimeout(async () => {
            try {
                // abort previous request for this field
                const prevCtrl = suggestAbortRef.current[kind];
                if (prevCtrl) prevCtrl.abort();

                const ctrl = new AbortController();
                suggestAbortRef.current[kind] = ctrl;

                const url =
                    `https://geocode-maps.yandex.ru/1.x/?apikey=${apiKey}` +
                    `&geocode=${encodeURIComponent(q)}` +
                    `&format=json&results=8&kind=house`;

                const r = await fetch(url, { signal: ctrl.signal });
                const data = await r.json();

                const items = parseYandexGeocoderSuggestions(data);

                // уберем дубли
                const uniq = Array.from(new Map(items.map((x) => [x.label, x])).values());

                setAddrSug((p) => ({ ...p, [kind]: uniq }));
            } catch (e) {
                if (e?.name === "AbortError") return;
                console.error("suggest error:", e);
                clearSuggest(kind);
            }
        }, 250);
    };

    const onAddressInput = (kind, value) => {
        setField(kind === "from" ? "fromAddress" : "toAddress", value);

        // если человек руками редактирует — координаты лучше сбросить,
        // чтобы не было "старых" координат от предыдущего адреса
        if (kind === "from") {
            setField("fromLat", "");
            setField("fromLng", "");
        } else {
            setField("toLat", "");
            setField("toLng", "");
        }

        fetchSuggest(kind, value);
    };

    const onPickSuggest = (kind, s) => {
        // s: {address, lat, lon}
        if (kind === "from") {
            setField("fromAddress", s.address);
            setField("fromLat", String(s.lat));
            setField("fromLng", String(s.lon));
        } else {
            setField("toAddress", s.address);
            setField("toLat", String(s.lat));
            setField("toLng", String(s.lon));
        }
        clearSuggest(kind);
    };

    const recommended = useMemo(() => {
        const km = routeCalc.distanceKm;
        if (!Number.isFinite(km)) return null;
        const { base, perKm } = PRICING[type] || PRICING.taxi;
        const rec = Math.round(base + perKm * km);
        return { rec, km, min: routeCalc.durationMin };
    }, [routeCalc.distanceKm, routeCalc.durationMin, type]);

    useEffect(() => {
        const load = async () => {
            setSavedLoading(true);
            try {
                const r = await axiosInstance.get("/express/express-addresses/me");
                if (r.data?.success) setSaved(Array.isArray(r.data.items) ? r.data.items : []);
            } catch (e) {
                console.error(e);
            } finally {
                setSavedLoading(false);
            }
        };
        load();
    }, []);

    const detectGpsForFrom = () => {
        setError("");
        if (!navigator.geolocation) {
            setError("GPS недоступен в браузере");
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setField("fromLat", String(pos.coords.latitude));
                setField("fromLng", String(pos.coords.longitude));
            },
            () => setError("Не удалось получить координаты по GPS"),
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
        );
    };

    useEffect(() => {
        let alive = true;

        const run = async () => {
            if (!coordsOk) {
                setRouteCalc({ loading: false, distanceKm: null, durationMin: null, err: "" });
                return;
            }
            if (!apiKey) {
                setRouteCalc({ loading: false, distanceKm: null, durationMin: null, err: "Нет REACT_APP_YANDEX_API_KEY" });
                return;
            }

            setRouteCalc({ loading: true, distanceKm: null, durationMin: null, err: "" });

            try {
                const r = await calcRouteByYmaps({
                    apiKey,
                    fromLat: form.fromLat,
                    fromLng: form.fromLng,
                    toLat: form.toLat,
                    toLng: form.toLng,
                });

                if (!alive) return;

                setRouteCalc({
                    loading: false,
                    distanceKm: Number.isFinite(r.distanceKm) ? Number(r.distanceKm.toFixed(2)) : null,
                    durationMin: Number.isFinite(r.durationMin) ? r.durationMin : null,
                    err: "",
                });
            } catch (e) {
                console.error(e);
                if (!alive) return;
                setRouteCalc({ loading: false, distanceKm: null, durationMin: null, err: "Не удалось рассчитать маршрут" });
            }
        };

        run();
        return () => { alive = false; };
    }, [coordsOk, apiKey, form.fromLat, form.fromLng, form.toLat, form.toLng]);

    const applyRecommended = useCallback(() => {
        if (!recommended?.rec) return;
        setField("totalPrice", String(recommended.rec));
    }, [recommended?.rec]);

    const validate = () => {
        if (!form.fromAddress?.trim() || !form.toAddress?.trim()) return "Заполните Откуда и Куда";
        if (!coordsOk) return "Нужны координаты точек A и B (карта/сохранённые/GPS)";
        if (!form.totalPrice || Number(form.totalPrice) <= 0) return "Укажите цену";
        return "";
    };

    const createOrder = async () => {
        const v = validate();
        if (v) { setError(v); return; }

        setError("");

        try {
            const payload = {
                type,
                subcategory: form.subcategory || null,
                paymentType: "cash", // ✅ фиксируем для скорости (пока)
                totalPrice: Number(form.totalPrice),
                description: form.description || null,

                fromAddress: form.fromAddress,
                fromLat: Number(form.fromLat),
                fromLng: Number(form.fromLng),

                toAddress: form.toAddress,
                toLat: Number(form.toLat),
                toLng: Number(form.toLng),

                basePrice: 0,
                pricePerKm: 0,
            };

            const r = await axiosInstance.post("/express/express-orders", payload);
            if (!r.data?.success) {
                setError(r.data?.message || "Ошибка при создании заказа");
                return;
            }

            const id = r.data.order?.id || null;
            setCreatedOrderId(id);
            setSuggestSave(true);
        } catch (e) {
            console.error(e);
            setError(e.response?.data?.message || "Ошибка при создании заказа");
        }
    };

    const saveAddress = async ({ label, title, address, lat, lng }) => {
        try {
            const r = await axiosInstance.post("/express/express-addresses/me", {
                label,
                title: title?.trim() || null,
                address,
                lat: Number(lat),
                lng: Number(lng),
            });
            if (r.data?.success) {
                const rr = await axiosInstance.get("/express/express-addresses/me");
                if (rr.data?.success) setSaved(Array.isArray(rr.data.items) ? rr.data.items : []);
            }
        } catch (e) {
            console.error(e);
        }
    };

    const routeStatus = useMemo(() => {
        if (!coordsOk) return "Укажи точки A и B на карте — покажем расстояние и время.";
        if (routeCalc.loading) return "Считаем маршрут…";
        if (routeCalc.err) return `Маршрут не рассчитан: ${routeCalc.err}`;
        if (recommended) return `~${recommended.km} км · ${Number.isFinite(recommended.min) ? `~${recommended.min} мин` : "—"}`;
        return "Маршрут готов.";
    }, [coordsOk, routeCalc.loading, routeCalc.err, recommended]);

    return (
        <div className="exo-page">
            <div className="exo-shell">

                {/* Header */}
                <div className="exo-glass exo-header">
                    <div className="exo-headerRow">
                        <div>
                            <div className="exo-title">Экспресс-заказ</div>
                            <div className="exo-subtitle">Две точки + цена — и готово</div>
                        </div>
                        <div className="exo-badges">
                            <span className="exo-pill">{savedLoading ? "Адреса…" : `Адреса: ${saved.length}`}</span>
                            <span className="exo-pill">{type === "taxi" ? "🚕 Такси" : "📦 Курьер"}</span>
                        </div>
                    </div>

                    <div className="exo-typeGrid">
                        <button
                            type="button"
                            className={`exo-typeBtn ${type === "taxi" ? "isActive" : ""}`}
                            onClick={() => { setType("taxi"); setField("subcategory", ""); }}
                        >
                            <span className="exo-typeIcon"><FaTaxi /></span>
                            <span>Такси</span>
                        </button>

                        <button
                            type="button"
                            className={`exo-typeBtn ${type === "courier" ? "isActive" : ""}`}
                            onClick={() => { setType("courier"); setField("subcategory", ""); }}
                        >
                            <span className="exo-typeIcon"><FaBox /></span>
                            <span>Курьер</span>
                        </button>
                    </div>
                </div>

                {error && (
                    <div className="exo-glass exo-alert">
                        <div className="exo-alertTitle">Ошибка</div>
                        <div className="exo-alertText">{error}</div>
                    </div>
                )}

                {/* Saved addresses */}
                <ExpressSavedAddressesBar
                    items={saved}
                    onPickFrom={(item) => {
                        setField("fromAddress", item.address);
                        setField("fromLat", String(item.lat));
                        setField("fromLng", String(item.lng));
                    }}
                    onPickTo={(item) => {
                        setField("toAddress", item.address);
                        setField("toLat", String(item.lat));
                        setField("toLng", String(item.lng));
                    }}
                />

                {/* Main: route + price + create */}
                <div className="exo-glass exo-card">
                    <div className="exo-cardTop">
                        <div>
                            <div className="exo-cardTitle">Маршрут</div>
                            <div className="exo-cardSub">Минимум действий — максимум скорости</div>
                        </div>
                    </div>

                    <div className="exo-grid2">
                        <div className="exo-field">
                            <div className="exo-labelRow">
                                <div className="exo-label">Откуда (A)</div>
                                <div className="exo-miniActions">
                                    <button type="button" className="exo-miniBtn" onClick={detectGpsForFrom}>
                                        <FaLocationArrow /> GPS
                                    </button>
                                    <button type="button" className="exo-miniBtn" onClick={() => setShowMapFor("from")}>
                                        <FaMapMarkedAlt /> Карта
                                    </button>
                                </div>
                            </div>

                            <input
                                className="exo-control"
                                value={form.fromAddress}
                                onChange={(e) => onAddressInput("from", e.target.value)}
                                placeholder="Адрес точки A"
                            />

                            {addrSug.from.length > 0 && (
                                <ul className="suggestions">
                                    {addrSug.from.map((s, i) => (
                                        <li key={`${s.label}-${i}`} onClick={() => onPickSuggest("from", s)}>
                                            {s.label}
                                        </li>
                                    ))}
                                </ul>
                            )}

                            <input type="hidden" value={form.fromLat} readOnly />
                            <input type="hidden" value={form.fromLng} readOnly />
                        </div>

                        <div className="exo-field">
                            <div className="exo-labelRow">
                                <div className="exo-label">Куда (B)</div>
                                <div className="exo-miniActions">
                                    <button type="button" className="exo-miniBtn" onClick={() => setShowMapFor("to")}>
                                        <FaMapMarkedAlt /> Карта
                                    </button>
                                </div>
                            </div>

                            <input
                                className="exo-control"
                                value={form.toAddress}
                                onChange={(e) => onAddressInput("to", e.target.value)}
                                placeholder="Адрес точки B"
                            />

                            {addrSug.to.length > 0 && (
                                <ul className="suggestions">
                                    {addrSug.to.map((s, i) => (
                                        <li key={`${s.label}-${i}`} onClick={() => onPickSuggest("to", s)}>
                                            {s.label}
                                        </li>
                                    ))}
                                </ul>
                            )}

                            <input type="hidden" value={form.toLat} readOnly />
                            <input type="hidden" value={form.toLng} readOnly />
                        </div>
                    </div>

                    {/* Route status + open route */}
                    <div className="exo-note" style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center" }}>
                        <div>🧭 {routeStatus}</div>
                        <button
                            type="button"
                            className="exo-miniBtn"
                            onClick={() => setShowRouteModal(true)}
                            disabled={!coordsOk}
                            title={!coordsOk ? "Сначала выберите точки на карте" : "Показать маршрут"}
                        >
                            Показать маршрут
                        </button>
                    </div>

                    {/* Price compact */}
                    <div className="exo-field" style={{ marginTop: 10 }}>
                        <div className="exo-labelRow">
                            <div className="exo-label">Цена</div>
                            {recommended?.rec ? (
                                <button type="button" className="exo-miniBtn" onClick={applyRecommended} title="Поставить рекомендуемую">
                                    Рекомендуем {recommended.rec} ₽
                                </button>
                            ) : (
                                <div className="exo-recoMini">{coordsOk ? "—" : ""}</div>
                            )}
                        </div>

                        <input
                            className="exo-control"
                            type="number"
                            value={form.totalPrice}
                            onChange={(e) => setField("totalPrice", e.target.value)}
                            placeholder="Например 500"
                        />
                    </div>

                    {/* Extra (collapsed) */}
                    <div style={{ marginTop: 10 }}>
                        <button
                            type="button"
                            className="exo-miniBtn"
                            onClick={() => setExtraOpen((p) => !p)}
                            style={{ width: "100%", justifyContent: "center" }}
                        >
                            {extraOpen ? "Скрыть дополнительно" : "Дополнительно (необязательно)"}
                        </button>

                        {extraOpen && (
                            <div style={{ marginTop: 10 }}>
                                {/* Subcategory chips */}
                                <div className="exo-chipsRow">
                                    <div className="exo-chipsTitle">Опции:</div>
                                    <div className="exo-chips">
                                        {subcategoryOptions[type].map((opt) => {
                                            const selected = form.subcategory === opt.label;
                                            return (
                                                <button
                                                    key={opt.label}
                                                    type="button"
                                                    className={`exo-chip ${selected ? "selected" : ""}`}
                                                    onClick={() => setField("subcategory", selected ? "" : opt.label)}
                                                    title={opt.label}
                                                >
                                                    <span className="exo-chipEmoji">{opt.icon}</span>
                                                    <span className="exo-chipText">{opt.label}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="exo-field" style={{ marginTop: 10 }}>
                  <textarea
                      className="exo-control exo-textarea"
                      value={form.description}
                      onChange={(e) => setField("description", e.target.value)}
                      placeholder="Комментарий (домофон, подъезд, позвонить заранее)…"
                  />
                                </div>

                                <div className="exo-hint" style={{ marginTop: 8 }}>
                                    Оплата сейчас: <b>наличными</b> (пока фиксировано для скорости).
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Single primary action */}
                    <div className="exo-actionsRow" style={{ marginTop: 12 }}>
                        <button type="button" className="exo-btn exo-btnPrimary" onClick={createOrder}>
                            Создать заказ
                        </button>
                    </div>
                </div>
            </div>

            {/* Map modal */}
            <YandexMapModal
                isOpen={!!showMapFor}
                onClose={() => setShowMapFor(null)}
                initialLat={showMapFor === "from" ? toNum(form.fromLat) : toNum(form.toLat)}
                initialLng={showMapFor === "from" ? toNum(form.fromLng) : toNum(form.toLng)}
                onPick={(picked) => {
                    const addr = picked?.address;
                    const lat = picked?.lat;
                    const lng = picked?.lng;

                    if (!addr || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) {
                        setShowMapFor(null);
                        return;
                    }

                    if (showMapFor === "from") {
                        setField("fromAddress", addr);
                        setField("fromLat", String(lat));
                        setField("fromLng", String(lng));
                    } else {
                        setField("toAddress", addr);
                        setField("toLat", String(lat));
                        setField("toLng", String(lng));
                    }

                    setShowMapFor(null);
                }}
            />

            {/* Route modal */}
            <ExpressRouteMapModal
                isOpen={showRouteModal}
                onClose={() => setShowRouteModal(false)}
                type={type}
                pointA={{ address: form.fromAddress, lat: form.fromLat, lng: form.fromLng }}
                pointB={{ address: form.toAddress, lat: form.toLat, lng: form.toLng }}
                onCreate={createOrder}
            />

            {/* Suggest save */}
            {suggestSave && (
                <div className="exo-toastWrap">
                    <div className="exo-glass exo-toast">
                        <div className="exo-toastTitle">
                            ✅ Заказ создан{createdOrderId ? ` (#${createdOrderId})` : ""} — сохранить адреса?
                        </div>

                        <div className="exo-toastRow">
                            <button
                                className="exo-btn exo-btnGhost"
                                type="button"
                                onClick={async () => {
                                    await saveAddress({ label: "home", title: "Дом", address: form.fromAddress, lat: form.fromLat, lng: form.fromLng });
                                    setSuggestSave(false);
                                    alert("Сохранил 'Откуда' как Дом");
                                }}
                            >
                                “Откуда” = Дом
                            </button>

                            <button
                                className="exo-btn exo-btnPrimary"
                                type="button"
                                onClick={async () => {
                                    await saveAddress({ label: "work", title: "Работа", address: form.toAddress, lat: form.toLat, lng: form.toLng });
                                    setSuggestSave(false);
                                    alert("Сохранил 'Куда' как Работа");
                                }}
                            >
                                “Куда” = Работа
                            </button>
                        </div>

                        <div className="exo-toastRow">
                            <button className="exo-miniBtn" type="button" onClick={() => setSuggestSave(false)}>
                                Не сейчас
                            </button>

                            <a
                                className="exo-miniBtn"
                                href={routeUrl || "#"}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => !routeUrl && e.preventDefault()}
                            >
                                Открыть в Яндекс
                            </a>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CreateExpressOrder;