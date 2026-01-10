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
        { label: "Перевозка между городами", icon: "🛣️" },
    ],
    courier: [
        { label: "Доставка цветов", icon: "💐" },
        { label: "Доставка еды/продуктов", icon: "🍔" },
        { label: "Доставка документов", icon: "📄" },
    ],
};

function toNum(v) {
    const n = typeof v === "string" ? Number(v) : v;
    return Number.isFinite(n) ? n : null;
}

function buildYandexNaviUrl(fromLat, fromLng, toLat, toLng) {
    return `https://yandex.ru/navi/?rtext=${Number(fromLat)},${Number(fromLng)}~${Number(toLat)},${Number(toLng)}&rtt=auto`;
}

/** Загружаем Yandex Maps JS API один раз */
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

/** Пытаемся получить distance/time по дорогам через ymaps.route */
async function calcRouteByYmaps({ apiKey, fromLat, fromLng, toLat, toLng }) {
    const ymaps = await loadYMaps(apiKey);
    await ymaps.ready();

    // ymaps.route возвращает "маршрут" (обычно автомобильный), у него есть getLength()/getTime()
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
    taxi: { base: 150, perKm: 20 },     // пример — легко поменяешь
    courier: { base: 120, perKm: 15 },  // пример — легко поменяешь
};

const CreateExpressOrder = () => {
    const apiKey = process.env.REACT_APP_YANDEX_API_KEY;

    const [type, setType] = useState("taxi");
    const [error, setError] = useState("");

    const [saved, setSaved] = useState([]);
    const [savedLoading, setSavedLoading] = useState(false);

    const [form, setForm] = useState({
        subcategory: "",            // теперь НЕ обязательное
        paymentType: "cash",        // cash | guarantee
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
    const [showConfirm, setShowConfirm] = useState(false);

    const [suggestSave, setSuggestSave] = useState(false);
    const [createdOrderId, setCreatedOrderId] = useState(null);

    // Дополнительно
    const [showExtra, setShowExtra] = useState(false);

    // Рекомендованные расчёты
    const [routeCalc, setRouteCalc] = useState({ loading: false, distanceKm: null, durationMin: null, err: "" });

    const [showRouteModal, setShowRouteModal] = useState(false);

    const paymentMethods = useMemo(
        () => [
            { id: "cash", label: "Наличные" },
            { id: "guarantee", label: "Гарантия" },
        ],
        []
    );

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

    const recommended = useMemo(() => {
        const km = routeCalc.distanceKm;
        if (!Number.isFinite(km)) return null;
        const { base, perKm } = PRICING[type] || PRICING.taxi;
        const rec = Math.round(base + perKm * km);
        return { rec, km, min: routeCalc.durationMin };
    }, [routeCalc.distanceKm, routeCalc.durationMin, type]);

    // load saved addresses
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

    // GPS for "from" — только координаты, без текста "GPS"
    const detectGpsForFrom = () => {
        setError("");
        if (!navigator.geolocation) {
            setError("GPS недоступен в браузере");
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;
                setField("fromLat", String(lat));
                setField("fromLng", String(lng));
                // адрес НЕ подставляем "GPS", чтобы не портить UX
            },
            () => setError("Не удалось получить координаты по GPS"),
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
        );
    };

    // Пересчитываем distance/time, когда появились обе точки
    useEffect(() => {
        let alive = true;

        const run = async () => {
            if (!coordsOk) {
                setRouteCalc((p) => ({ ...p, loading: false, distanceKm: null, durationMin: null, err: "" }));
                return;
            }
            if (!apiKey) {
                setRouteCalc((p) => ({ ...p, loading: false, err: "Нет REACT_APP_YANDEX_API_KEY" }));
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
        return () => {
            alive = false;
        };
    }, [coordsOk, apiKey, form.fromLat, form.fromLng, form.toLat, form.toLng]);

    const validateRouteOnly = () => {
        if (!form.fromAddress?.trim() || !form.toAddress?.trim()) return "Заполните Откуда и Куда";
        if (!coordsOk) return "Нужны координаты точек A и B (выберите на карте/из сохранённых/GPS)";
        return "";
    };

    const openRoutePreview = () => {
        const v = validateRouteOnly();
        if (v) { setError(v); return; }
        setError("");
        setShowRouteModal(true);
    };

    const validate = () => {
        if (!type) return "Выберите тип заказа";
        // ✅ subcategory больше НЕ обязательна
        if (!form.fromAddress?.trim() || !form.toAddress?.trim()) return "Заполните Откуда и Куда";
        if (!coordsOk) return "Нужны координаты точек A и B (выберите из сохранённых / карта / GPS)";
        if (!form.totalPrice || Number(form.totalPrice) <= 0) return "Укажите цену";
        if (!["cash", "guarantee"].includes(form.paymentType)) return "Выберите оплату";
        return "";
    };


    const createOrder = async () => {
        const v = validate();
        if (v) {
            setError(v);
            return;
        }

        try {
            const payload = {
                type,
                subcategory: form.subcategory || null, // optional
                paymentType: form.paymentType,
                totalPrice: Number(form.totalPrice),
                description: form.description || null,

                fromAddress: form.fromAddress,
                fromLat: Number(form.fromLat),
                fromLng: Number(form.fromLng),

                toAddress: form.toAddress,
                toLat: Number(form.toLat),
                toLng: Number(form.toLng),

                // можно оставить нулями (или позже писать туда рекомендованные формулы)
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
            setShowConfirm(false);
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

    const applyRecommended = useCallback(() => {
        if (!recommended?.rec) return;
        setField("totalPrice", String(recommended.rec));
    }, [recommended?.rec]);

    return (
        <div className="exo-page">
            <div className="exo-shell">
                {/* Header */}
                <div className="exo-glass exo-header">
                    <div className="exo-headerRow">
                        <div>
                            <div className="exo-title">Экспресс-заказ</div>
                            <div className="exo-subtitle">Такси или курьер — максимально быстро</div>
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
                            onClick={() => {
                                setType("taxi");
                                setField("subcategory", "");
                            }}
                        >
                            <span className="exo-typeIcon"><FaTaxi /></span>
                            <span>Такси</span>
                        </button>

                        <button
                            type="button"
                            className={`exo-typeBtn ${type === "courier" ? "isActive" : ""}`}
                            onClick={() => {
                                setType("courier");
                                setField("subcategory", "");
                            }}
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

                {/* Saved addresses bar */}
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

                {/* Route */}
                <div className="exo-glass exo-card">
                    <div className="exo-cardTop">
                        <div>
                            <div className="exo-cardTitle">Маршрут</div>
                            <div className="exo-cardSub">Лучше выбирать на карте — меньше ошибок и ожидания</div>
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
                                onChange={(e) => setField("fromAddress", e.target.value)}
                                placeholder="Город, улица, дом, подъезд…"
                            />

                            {/* ✅ Координаты скрываем, но храним */}
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
                                onChange={(e) => setField("toAddress", e.target.value)}
                                placeholder="Город, улица, дом, подъезд…"
                            />

                            {/* ✅ Координаты скрываем, но храним */}
                            <input type="hidden" value={form.toLat} readOnly />
                            <input type="hidden" value={form.toLng} readOnly />
                        </div>
                    </div>

                    <div className="exo-actionsRow">
                        <button type="button" className="exo-btn exo-btnGhost" onClick={openRoutePreview}>
                            Показать маршрут
                        </button>

                        <button type="button" className="exo-btn exo-btnPrimary" onClick={createOrder}>
                            Создать заказ
                        </button>
                    </div>

                    <div className="exo-note">
                        💡 “Проверить маршрут” откроет окно с адресами и кнопкой “Открыть в Яндекс.Навигаторе”.
                    </div>
                </div>

                {/* Price + payment + description */}
                <div className="exo-glass exo-card">
                    <div className="exo-cardTop">
                        <div>
                            <div className="exo-cardTitle">Способ оплаты</div>
                            <div className="exo-cardSub">Выберите заранее — это важно исполнителю</div>
                        </div>
                    </div>

                    <div className="exo-payGrid">
                        {paymentMethods.map((m) => (
                            <button
                                key={m.id}
                                type="button"
                                className={`exo-payTile ${form.paymentType === m.id ? "selected" : ""}`}
                                onClick={() => setField("paymentType", m.id)}
                            >
                                <span className="exo-payLabel">{m.label}</span>
                            </button>
                        ))}
                    </div>

                    <div className="exo-hint">
                        Комиссия сервиса будет считаться от суммы заказа (<b>totalPrice</b>).
                    </div>
                </div>

                <div className="exo-glass exo-card">
                    <div className="exo-cardTop">
                        <div>
                            <div className="exo-cardTitle">Цена</div>
                            <div className="exo-cardSub">Цена — от заказчика. Рекомендация считается по маршруту.</div>
                        </div>
                    </div>

                    <div className="exo-field">
                        <div className="exo-labelRow">
                            <div className="exo-label">Сумма</div>

                            {/* мини-индикатор рекомендации справа */}
                            {coordsOk && (
                                <div className="exo-recoMini">
                                    {routeCalc.loading ? "…" : recommended?.rec ? `${recommended.rec} ₽` : "—"}
                                </div>
                            )}
                        </div>

                        <input
                            className="exo-control"
                            type="number"
                            value={form.totalPrice}
                            onChange={(e) => setField("totalPrice", e.target.value)}
                            placeholder="Например 500"
                        />

                        {/* Рекомендация */}
                        <div className="exo-recoBox">
                            {routeCalc.loading && coordsOk ? (
                                <div className="exo-recoLine">Считаем расстояние и время…</div>
                            ) : recommended ? (
                                <>
                                    <div className="exo-recoLine">
                                        Рекомендуем: <b>{recommended.rec} ₽</b>
                                        <span className="exo-recoMeta">
              {recommended.km} км{Number.isFinite(recommended.min) ? ` · ~${recommended.min} мин` : ""}
            </span>
                                    </div>

                                    <div className="exo-recoActions">
                                        <button type="button" className="exo-miniBtn" onClick={applyRecommended}>
                                            Поставить рекомендуемую
                                        </button>

                                        <button
                                            type="button"
                                            className="exo-miniBtn"
                                            onClick={() => setShowRouteModal(true)}
                                            disabled={!coordsOk}
                                        >
                                            Показать маршрут
                                        </button>
                                    </div>
                                </>
                            ) : coordsOk ? (
                                <div className="exo-recoLine">
                                    Не удалось рассчитать рекомендацию{routeCalc.err ? `: ${routeCalc.err}` : ""}
                                </div>
                            ) : (
                                <div className="exo-recoLine">
                                    Укажи точки A и B на карте — покажем рекомендацию.
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="exo-glass exo-card">
                    <div className="exo-cardTop">
                        <div>
                            <div className="exo-cardTitle">Комментарий</div>
                            <div className="exo-cardSub">Необязательно — подъезд, домофон, позвонить заранее…</div>
                        </div>
                    </div>

                    {/* Дополнительно как чипсы */}
                    <div className="exo-chipsRow">
                        <div className="exo-chipsTitle">Дополнительно:</div>

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

                    {/* выбранная метка отдельно (чтобы понятно было) */}
                    {form.subcategory && (
                        <div className="exo-pickedTag">
                            Выбрано: <b>{form.subcategory}</b>
                            <button type="button" className="exo-miniBtn" onClick={() => setField("subcategory", "")} style={{ marginLeft: 10 }}>
                                Сбросить
                            </button>
                        </div>
                    )}

                    <div className="exo-field" style={{ marginTop: 10 }}>
    <textarea
        className="exo-control exo-textarea"
        value={form.description}
        onChange={(e) => setField("description", e.target.value)}
        placeholder="Например: подъезд 3, код 1122, позвонить за 5 минут…"
    />
                    </div>

                    {/* главная кнопка внизу формы */}
                    <div className="exo-actionsRow" style={{ marginTop: 12 }}>
                        <button type="button" className="exo-btn exo-btnGhost" onClick={openRoutePreview}>
                            Показать маршрут
                        </button>

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

            {/* Confirm modal (только адреса, без координат) */}
            <ExpressRouteMapModal
                isOpen={showRouteModal}
                onClose={() => setShowRouteModal(false)}
                type={type}
                pointA={{ address: form.fromAddress, lat: form.fromLat, lng: form.fromLng }}
                pointB={{ address: form.toAddress, lat: form.toLat, lng: form.toLng }}
                onCreate={createOrder}
                onRouteCalculated={({ distanceKm, durationMin }) => {
                    // если хочешь — можешь в локальный стейт положить и показывать рядом с ценой
                    // сейчас это необязательно, потому что модалка сама показывает
                }}
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
                                    await saveAddress({
                                        label: "home",
                                        title: "Дом",
                                        address: form.fromAddress,
                                        lat: form.fromLat,
                                        lng: form.fromLng,
                                    });
                                    setSuggestSave(false);
                                    alert("Сохранил 'Откуда' как Дом");
                                }}
                            >
                                Сохранить “Откуда” как Дом
                            </button>

                            <button
                                className="exo-btn exo-btnPrimary"
                                type="button"
                                onClick={async () => {
                                    await saveAddress({
                                        label: "work",
                                        title: "Работа",
                                        address: form.toAddress,
                                        lat: form.toLat,
                                        lng: form.toLng,
                                    });
                                    setSuggestSave(false);
                                    alert("Сохранил 'Куда' как Работа");
                                }}
                            >
                                Сохранить “Куда” как Работа
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
                                Открыть маршрут в Яндекс
                            </a>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CreateExpressOrder;