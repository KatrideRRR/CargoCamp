import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useNavigate, useParams } from "react-router-dom";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import "../styles/AdminCreateOrderPage.css";

const apiUrl = process.env.REACT_APP_API_URL;

function parseYandexGeocoderSuggestions(data) {
    const members = data?.response?.GeoObjectCollection?.featureMember || [];

    return members
        .map((m) => {
            const g = m?.GeoObject;
            const text = g?.metaDataProperty?.GeocoderMetaData?.text;
            const pos = g?.Point?.pos;
            if (!text || !pos) return null;

            const [lon, lat] = pos.split(" ").map(Number);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

            return {
                label: text,
                address: text,
                lat,
                lon,
            };
        })
        .filter(Boolean);
}

function plusHour(d) {
    const x = new Date(d);
    x.setSeconds(0, 0);
    x.setHours(x.getHours() + 1);
    return x;
}

function toNum(v) {
    const n = typeof v === "string" ? Number(v) : v;
    return Number.isFinite(n) ? n : null;
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

function AdminCreateOrderPage() {
    const { userId } = useParams();
    const navigate = useNavigate();
    const token = localStorage.getItem("authToken");
    const YM_KEY = process.env.REACT_APP_YANDEX_API_KEY;

    const [mode, setMode] = useState("regular");
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const [regularForm, setRegularForm] = useState({
        description: "",
        address: "",
        workTime: plusHour(new Date()),
        proposedSum: "",
    });

    const [markerPosition, setMarkerPosition] = useState(null);
    const [categories, setCategories] = useState([]);
    const [subcategories, setSubcategories] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState("");
    const [selectedSubcategory, setSelectedSubcategory] = useState("");
    const [addressSuggestions, setAddressSuggestions] = useState([]);
    const suggestTimerRef = useRef(null);
    const suggestAbortRef = useRef(null);
    const [isAsap, setIsAsap] = useState(true);

    const [expressType, setExpressType] = useState("taxi");
    const [expressForm, setExpressForm] = useState({
        subcategory: "",
        totalPrice: "",
        description: "",
        fromAddress: "",
        fromLat: "",
        fromLng: "",
        toAddress: "",
        toLat: "",
        toLng: "",
    });

    const [expressSuggestions, setExpressSuggestions] = useState({ from: [], to: [] });
    const expressSuggestTimerRef = useRef({ from: null, to: null });
    const expressSuggestAbortRef = useRef({ from: null, to: null });

    const expressSubcategoryOptions = {
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

    const coordsOk = useMemo(() => {
        const fLat = toNum(expressForm.fromLat);
        const fLng = toNum(expressForm.fromLng);
        const tLat = toNum(expressForm.toLat);
        const tLng = toNum(expressForm.toLng);
        return [fLat, fLng, tLat, tLng].every(Number.isFinite);
    }, [expressForm.fromLat, expressForm.fromLng, expressForm.toLat, expressForm.toLng]);

    const [routeCalc, setRouteCalc] = useState({
        loading: false,
        distanceKm: null,
        durationMin: null,
        err: "",
    });

    const recommended = useMemo(() => {
        const km = routeCalc.distanceKm;
        if (!Number.isFinite(km)) return null;

        const { base, perKm } = PRICING[expressType] || PRICING.taxi;
        const rec = Math.round(base + perKm * km);

        return {
            rec,
            km,
            min: routeCalc.durationMin,
        };
    }, [routeCalc.distanceKm, routeCalc.durationMin, expressType]);

    const routeStatus = useMemo(() => {
        if (!coordsOk) return "Укажите точки A и B — покажем расстояние и время.";
        if (routeCalc.loading) return "Считаем маршрут…";
        if (routeCalc.err) return `Маршрут не рассчитан: ${routeCalc.err}`;
        if (recommended) {
            return `~${recommended.km} км · ${Number.isFinite(recommended.min) ? `~${recommended.min} мин` : "—"}`;
        }
        return "Маршрут готов.";
    }, [coordsOk, routeCalc.loading, routeCalc.err, recommended]);

    const applyRecommended = () => {
        if (!recommended?.rec) return;

        setExpressForm((p) => ({
            ...p,
            totalPrice: String(recommended.rec),
        }));
    };

    useEffect(() => {
        let alive = true;

        const run = async () => {
            if (!coordsOk) {
                setRouteCalc({
                    loading: false,
                    distanceKm: null,
                    durationMin: null,
                    err: "",
                });
                return;
            }

            if (!YM_KEY) {
                setRouteCalc({
                    loading: false,
                    distanceKm: null,
                    durationMin: null,
                    err: "Нет REACT_APP_YANDEX_API_KEY",
                });
                return;
            }

            setRouteCalc({
                loading: true,
                distanceKm: null,
                durationMin: null,
                err: "",
            });

            try {
                const r = await calcRouteByYmaps({
                    apiKey: YM_KEY,
                    fromLat: expressForm.fromLat,
                    fromLng: expressForm.fromLng,
                    toLat: expressForm.toLat,
                    toLng: expressForm.toLng,
                });

                if (!alive) return;

                setRouteCalc({
                    loading: false,
                    distanceKm: Number.isFinite(r.distanceKm) ? Number(r.distanceKm.toFixed(2)) : null,
                    durationMin: Number.isFinite(r.durationMin) ? r.durationMin : null,
                    err: "",
                });
            } catch (e) {
                console.error("route calc error:", e);

                if (!alive) return;

                setRouteCalc({
                    loading: false,
                    distanceKm: null,
                    durationMin: null,
                    err: "Не удалось рассчитать маршрут",
                });
            }
        };

        run();

        return () => {
            alive = false;
        };
    }, [
        coordsOk,
        YM_KEY,
        expressForm.fromLat,
        expressForm.fromLng,
        expressForm.toLat,
        expressForm.toLng,
    ]);

    useEffect(() => {
        axios
            .get(`${apiUrl}/api/category`)
            .then((response) => setCategories(response.data || []))
            .catch((e) => console.error("Ошибка при загрузке категорий", e));
    }, []);

    const handleRegularCategoryChange = async (event) => {
        const categoryId = event.target.value;
        setSelectedCategory(categoryId);
        setSelectedSubcategory("");
        setSubcategories([]);

        if (!categoryId) return;

        try {
            const res = await axios.get(`${apiUrl}/api/category/subcategory/${categoryId}`);
            setSubcategories(res.data || []);
        } catch (e) {
            console.error("Ошибка при загрузке подкатегорий", e);
        }
    };

    const handleRegularSubcategoryChange = async (e) => {
        const subId = e.target.value;
        setSelectedSubcategory(subId);

        if (!subId) return;

    };

    const getMinTime = (selectedDate) => {
        const currentDate = new Date();

        if (!selectedDate || selectedDate.toDateString() === currentDate.toDateString()) {
            return new Date(
                currentDate.getFullYear(),
                currentDate.getMonth(),
                currentDate.getDate(),
                currentDate.getHours(),
                currentDate.getMinutes()
            );
        }

        return new Date(
            selectedDate.getFullYear(),
            selectedDate.getMonth(),
            selectedDate.getDate(),
            0,
            0,
            0
        );
    };

    const handleRegularDescriptionChange = (e) => {
        const textarea = e.target;
        textarea.style.height = "auto";
        textarea.style.height = `${textarea.scrollHeight}px`;

        setRegularForm((p) => ({ ...p, description: textarea.value }));
    };

    const handleRegularAddressChange = (e) => {
        const address = e.target.value;
        setRegularForm((p) => ({ ...p, address }));
        setMarkerPosition(null);

        const q = address.trim();
        if (q.length < 3) {
            setAddressSuggestions([]);
            return;
        }

        if (!YM_KEY) {
            setError("Не задан REACT_APP_YANDEX_API_KEY. Подсказки адреса не работают.");
            return;
        }

        if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);

        suggestTimerRef.current = setTimeout(async () => {
            try {
                if (suggestAbortRef.current) suggestAbortRef.current.abort();
                const ctrl = new AbortController();
                suggestAbortRef.current = ctrl;

                const url =
                    `https://geocode-maps.yandex.ru/1.x/?apikey=${YM_KEY}` +
                    `&geocode=${encodeURIComponent(q)}` +
                    `&format=json&results=10&kind=house`;

                const r = await fetch(url, { signal: ctrl.signal });
                const data = await r.json();

                const suggestions = parseYandexGeocoderSuggestions(data);
                const uniq = Array.from(new Map(suggestions.map((s) => [s.label, s])).values());
                setAddressSuggestions(uniq);
            } catch (err) {
                if (err?.name === "AbortError") return;
                console.error("Ошибка геокодирования:", err);
                setAddressSuggestions([]);
            }
        }, 250);
    };

    const handleRegularAddressSelect = (s) => {
        setRegularForm((p) => ({ ...p, address: s.address }));
        setAddressSuggestions([]);
        setMarkerPosition([s.lat, s.lon]);
        setError("");
    };

    const onExpressAddressInput = (kind, value) => {
        if (kind === "from") {
            setExpressForm((p) => ({
                ...p,
                fromAddress: value,
                fromLat: "",
                fromLng: "",
            }));
        } else {
            setExpressForm((p) => ({
                ...p,
                toAddress: value,
                toLat: "",
                toLng: "",
            }));
        }

        const q = String(value || "").trim();
        if (q.length < 3) {
            setExpressSuggestions((p) => ({ ...p, [kind]: [] }));
            return;
        }

        if (!YM_KEY) {
            setError("Не задан REACT_APP_YANDEX_API_KEY. Подсказки адреса не работают.");
            return;
        }

        const t = expressSuggestTimerRef.current[kind];
        if (t) clearTimeout(t);

        expressSuggestTimerRef.current[kind] = setTimeout(async () => {
            try {
                const prevCtrl = expressSuggestAbortRef.current[kind];
                if (prevCtrl) prevCtrl.abort();

                const ctrl = new AbortController();
                expressSuggestAbortRef.current[kind] = ctrl;

                const url =
                    `https://geocode-maps.yandex.ru/1.x/?apikey=${YM_KEY}` +
                    `&geocode=${encodeURIComponent(q)}` +
                    `&format=json&results=8&kind=house`;

                const r = await fetch(url, { signal: ctrl.signal });
                const data = await r.json();

                const items = parseYandexGeocoderSuggestions(data);
                const uniq = Array.from(new Map(items.map((x) => [x.label, x])).values());

                setExpressSuggestions((p) => ({ ...p, [kind]: uniq }));
            } catch (e) {
                if (e?.name === "AbortError") return;
                console.error("suggest error:", e);
                setExpressSuggestions((p) => ({ ...p, [kind]: [] }));
            }
        }, 250);
    };

    const onPickExpressSuggest = (kind, s) => {
        if (kind === "from") {
            setExpressForm((p) => ({
                ...p,
                fromAddress: s.address,
                fromLat: String(s.lat),
                fromLng: String(s.lon),
            }));
        } else {
            setExpressForm((p) => ({
                ...p,
                toAddress: s.address,
                toLat: String(s.lat),
                toLng: String(s.lon),
            }));
        }

        setExpressSuggestions((p) => ({ ...p, [kind]: [] }));
        setError("");
    };

    const handleSubmitRegular = async () => {
        if (!regularForm.address?.trim()) {
            setError("Укажите адрес");
            return;
        }

        if (!selectedCategory) {
            setError("Выберите категорию");
            return;
        }

        if (!markerPosition?.length) {
            setError("Выберите адрес именно из подсказок.");
            return;
        }

        setError("");
        setSubmitting(true);

        try {
            const payload = {
                userId,
                description: regularForm.description || "",
                address: regularForm.address,
                workTime: regularForm.workTime
                    ? new Date(regularForm.workTime).toISOString()
                    : "",
                proposedSum: regularForm.proposedSum || "",
                paymentType: "cash",
                categoryId: Number(selectedCategory),
                subcategoryId: selectedSubcategory ? Number(selectedSubcategory) : null,
                coordinates: `${markerPosition[0]},${markerPosition[1]}`,
            };

            await axios.post(`${apiUrl}/api/admin/create-order`, payload, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            });

            alert("Обычный заказ успешно создан");
            navigate("/orders");
        } catch (err) {
            console.error("Ошибка при создании заказа:", err);
            console.error("Ответ сервера:", err.response?.data);
            setError(err.response?.data?.message || "Не удалось создать заказ");
        } finally {
            setSubmitting(false);
        }
    };

    const handleSubmitExpress = async () => {
        if (!expressForm.fromAddress?.trim() || !expressForm.toAddress?.trim()) {
            setError("Заполните адреса Откуда и Куда");
            return;
        }

        if (!coordsOk) {
            setError("Выберите оба адреса именно из подсказок.");
            return;
        }

        if (!expressForm.totalPrice || Number(expressForm.totalPrice) <= 0) {
            setError("Укажите цену");
            return;
        }

        setError("");
        setSubmitting(true);

        try {
            const payload = {
                userId: Number(userId),
                type: expressType,
                subcategory: expressForm.subcategory || null,
                paymentType: "cash",
                totalPrice: Number(expressForm.totalPrice),
                description: expressForm.description || null,

                fromAddress: expressForm.fromAddress,
                fromLat: Number(expressForm.fromLat),
                fromLng: Number(expressForm.fromLng),

                toAddress: expressForm.toAddress,
                toLat: Number(expressForm.toLat),
                toLng: Number(expressForm.toLng),
            };

            await axios.post(`${apiUrl}/api/admin/create-express-order`, payload, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
            });

            alert("Экспресс-заказ успешно создан");
            navigate("/orders");
        } catch (err) {
            console.error("Ошибка при создании экспресс-заказа:", err);
            setError(err.response?.data?.message || "Не удалось создать экспресс-заказ");
        } finally {
            setSubmitting(false);
        }
    };

    const handleMainSubmit = (e) => {
        e.preventDefault();
        if (submitting) return;

        if (mode === "regular") {
            handleSubmitRegular();
        } else {
            handleSubmitExpress();
        }
    };

    return (
        <div className="admin-create-page">
            <div className="admin-create-shell">
                <div className="admin-glass admin-header-card">
                    <div className="admin-header-row">
                        <div>
                            <div className="admin-page-title">Создать заказ</div>
                            <div className="admin-page-subtitle">
                                Для пользователя #{userId}
                            </div>
                        </div>

                        <div className="admin-mode-switch">
                            <button
                                type="button"
                                className={`admin-mode-btn ${mode === "regular" ? "active" : ""}`}
                                onClick={() => setMode("regular")}
                            >
                                Обычный
                            </button>

                            <button
                                type="button"
                                className={`admin-mode-btn ${mode === "express" ? "active" : ""}`}
                                onClick={() => setMode("express")}
                            >
                                Экспресс
                            </button>
                        </div>
                    </div>
                </div>

                {error && (
                    <div className="admin-glass admin-alert admin-alert-danger">
                        <div className="admin-alert-title">Ошибка</div>
                        <div className="admin-alert-text">{error}</div>
                    </div>
                )}

                <form onSubmit={handleMainSubmit}>
                    {mode === "regular" && (
                        <>
                            <div className="admin-glass admin-section-card">
                                <div className="admin-section-head">
                                    <div>
                                        <div className="admin-section-title">Время и адрес</div>
                                        <div className="admin-section-sub">
                                            Быстрое создание обычного заказа
                                        </div>
                                    </div>
                                </div>

                                <div className="admin-grid-2">
                                    <div className="admin-field">
                                        <div className="admin-label-row">
                                            <div className="admin-label">Режим времени</div>
                                            <button
                                                type="button"
                                                className={`admin-toggle ${isAsap ? "on" : ""}`}
                                                onClick={() => {
                                                    const next = !isAsap;
                                                    setIsAsap(next);

                                                    if (next) {
                                                        setRegularForm((p) => ({
                                                            ...p,
                                                            workTime: plusHour(new Date()),
                                                        }));
                                                    }
                                                }}
                                            >
                                                <span className="admin-toggle-knob" />
                                            </button>
                                        </div>

                                        <div className="admin-hint">
                                            {isAsap ? "Срочно" : "Ко времени"}
                                        </div>
                                    </div>

                                    {!isAsap && (
                                        <div className="admin-field">
                                            <div className="admin-label">Дата и время</div>
                                            <DatePicker
                                                selected={regularForm.workTime}
                                                onChange={(date) =>
                                                    setRegularForm((p) => ({ ...p, workTime: date }))
                                                }
                                                showTimeSelect
                                                timeFormat="HH:mm"
                                                timeIntervals={15}
                                                dateFormat="Pp"
                                                placeholderText="Выберите дату и время"
                                                minDate={new Date()}
                                                minTime={getMinTime(regularForm.workTime)}
                                                maxTime={new Date(0, 0, 0, 23, 59, 59)}
                                                className="admin-control"
                                                portalId="date-picker-portal"
                                            />
                                        </div>
                                    )}
                                </div>

                                <div className="admin-field" style={{ marginTop: 12 }}>
                                    <div className="admin-label">Адрес</div>

                                    <input
                                        className="admin-control"
                                        type="text"
                                        placeholder="Введите адрес"
                                        value={regularForm.address}
                                        onChange={handleRegularAddressChange}
                                    />

                                    {addressSuggestions.length > 0 && (
                                        <ul className="admin-suggestions">
                                            {addressSuggestions.map((s, i) => (
                                                <li
                                                    key={`${s.label}-${i}`}
                                                    onClick={() => handleRegularAddressSelect(s)}
                                                >
                                                    {s.label}
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </div>

                            <div className="admin-glass admin-section-card">
                                <div className="admin-section-head">
                                    <div>
                                        <div className="admin-section-title">Категория</div>
                                        <div className="admin-section-sub">
                                            Категория, подкатегория и услуга
                                        </div>
                                    </div>
                                </div>

                                <div className="admin-field">
                                    <div className="admin-label">Категория</div>
                                    <select
                                        className="admin-control"
                                        value={selectedCategory}
                                        onChange={handleRegularCategoryChange}
                                    >
                                        <option value="">Выберите категорию</option>
                                        {categories
                                            .filter((cat) => !["Такси", "Курьер"].includes(cat.name))
                                            .map((cat) => (
                                                <option key={cat.id} value={cat.id}>
                                                    {cat.name}
                                                </option>
                                            ))}
                                    </select>
                                </div>

                                {selectedCategory && (
                                    <div className="admin-field" style={{ marginTop: 12 }}>
                                        <div className="admin-label">Подкатегория</div>
                                        <select
                                            className="admin-control"
                                            value={selectedSubcategory}
                                            onChange={handleRegularSubcategoryChange}
                                        >
                                            <option value="">Выберите подкатегорию</option>
                                            {subcategories.map((sub) => (
                                                <option key={sub.id} value={sub.id}>
                                                    {sub.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                            </div>

                            <div className="admin-glass admin-section-card">
                                <div className="admin-section-head">
                                    <div>
                                        <div className="admin-section-title">Описание</div>
                                        <div className="admin-section-sub">
                                            Детали задачи
                                        </div>
                                    </div>
                                </div>

                                <div className="admin-field">
                                    <div className="admin-label">Описание</div>
                                    <textarea
                                        className="admin-control admin-textarea"
                                        placeholder="Что нужно сделать?"
                                        value={regularForm.description}
                                        onChange={handleRegularDescriptionChange}
                                        rows={3}
                                    />
                                </div>

                                <div className="admin-field" style={{ marginTop: 12 }}>
                                    <div className="admin-label">Сумма за работу</div>
                                    <input
                                        className="admin-control"
                                        type="number"
                                        placeholder="Например 1500"
                                        value={regularForm.proposedSum}
                                        onChange={(e) =>
                                            setRegularForm((p) => ({
                                                ...p,
                                                proposedSum: e.target.value,
                                            }))
                                        }
                                    />
                                </div>
                            </div>
                        </>
                    )}

                    {mode === "express" && (
                        <>
                            <div className="admin-glass admin-section-card">
                                <div className="admin-section-head">
                                    <div>
                                        <div className="admin-section-title">Тип экспресс-заказа</div>
                                        <div className="admin-section-sub">
                                            Такси или курьер
                                        </div>
                                    </div>
                                </div>

                                <div className="admin-type-grid">
                                    <button
                                        type="button"
                                        className={`admin-type-btn ${expressType === "taxi" ? "active" : ""}`}
                                        onClick={() => {
                                            setExpressType("taxi");
                                            setExpressForm((p) => ({ ...p, subcategory: "" }));
                                        }}
                                    >
                                        🚕 Такси
                                    </button>

                                    <button
                                        type="button"
                                        className={`admin-type-btn ${expressType === "courier" ? "active" : ""}`}
                                        onClick={() => {
                                            setExpressType("courier");
                                            setExpressForm((p) => ({ ...p, subcategory: "" }));
                                        }}
                                    >
                                        📦 Курьер
                                    </button>
                                </div>
                            </div>

                            <div className="admin-glass admin-section-card">
                                <div className="admin-section-head">
                                    <div>
                                        <div className="admin-section-title">Маршрут</div>
                                        <div className="admin-section-sub">
                                            Укажите точки A и B
                                        </div>
                                    </div>
                                </div>

                                <div className="admin-grid-2">
                                    <div className="admin-field">
                                        <div className="admin-label">Откуда (A)</div>

                                        <input
                                            className="admin-control"
                                            value={expressForm.fromAddress}
                                            onChange={(e) =>
                                                onExpressAddressInput("from", e.target.value)
                                            }
                                            placeholder="Адрес точки A"
                                        />

                                        {expressSuggestions.from.length > 0 && (
                                            <ul className="admin-suggestions">
                                                {expressSuggestions.from.map((s, i) => (
                                                    <li
                                                        key={`${s.label}-${i}`}
                                                        onClick={() => onPickExpressSuggest("from", s)}
                                                    >
                                                        {s.label}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>

                                    <div className="admin-field">
                                        <div className="admin-label">Куда (B)</div>

                                        <input
                                            className="admin-control"
                                            value={expressForm.toAddress}
                                            onChange={(e) =>
                                                onExpressAddressInput("to", e.target.value)
                                            }
                                            placeholder="Адрес точки B"
                                        />

                                        {expressSuggestions.to.length > 0 && (
                                            <ul className="admin-suggestions">
                                                {expressSuggestions.to.map((s, i) => (
                                                    <li
                                                        key={`${s.label}-${i}`}
                                                        onClick={() => onPickExpressSuggest("to", s)}
                                                    >
                                                        {s.label}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="admin-glass admin-section-card">
                                <div className="admin-section-head">
                                    <div>
                                        <div className="admin-section-title">Параметры заказа</div>
                                        <div className="admin-section-sub">
                                            Цена, опция и комментарий
                                        </div>
                                    </div>
                                </div>

                                <div className="admin-chips-wrap">
                                    {expressSubcategoryOptions[expressType].map((opt) => {
                                        const selected = expressForm.subcategory === opt.label;

                                        return (
                                            <button
                                                key={opt.label}
                                                type="button"
                                                className={`admin-chip ${selected ? "selected" : ""}`}
                                                onClick={() =>
                                                    setExpressForm((p) => ({
                                                        ...p,
                                                        subcategory: selected ? "" : opt.label,
                                                    }))
                                                }
                                            >
                                                <span>{opt.icon}</span>
                                                <span>{opt.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>

                                <div className="admin-field" style={{ marginTop: 14 }}>
                                    <div className="admin-label-row">
                                        <div className="admin-label">Цена</div>

                                        {recommended?.rec ? (
                                            <button
                                                type="button"
                                                className="admin-mini-btn"
                                                onClick={applyRecommended}
                                                title="Поставить рекомендуемую цену"
                                            >
                                                Рекомендуем {recommended.rec} ₽
                                            </button>
                                        ) : null}
                                    </div>

                                    <input
                                        className="admin-control"
                                        type="number"
                                        value={expressForm.totalPrice}
                                        onChange={(e) =>
                                            setExpressForm((p) => ({
                                                ...p,
                                                totalPrice: e.target.value,
                                            }))
                                        }
                                        placeholder="Например 500"
                                    />

                                    <div className="admin-route-note">
                                        🧭 {routeStatus}
                                    </div>
                                </div>

                                <div className="admin-field" style={{ marginTop: 14 }}>
                                    <div className="admin-label">Комментарий</div>
                                    <textarea
                                        className="admin-control admin-textarea"
                                        value={expressForm.description}
                                        onChange={(e) =>
                                            setExpressForm((p) => ({
                                                ...p,
                                                description: e.target.value,
                                            }))
                                        }
                                        placeholder="Комментарий к экспресс-заказу"
                                        rows={3}
                                    />
                                </div>
                            </div>
                        </>
                    )}

                    <div className="admin-glass admin-bottom-actions">
                        <button
                            type="button"
                            className="admin-action-btn subtle"
                            onClick={() => navigate(-1)}
                        >
                            Назад
                        </button>

                        <button
                            type="submit"
                            disabled={submitting}
                            className="admin-action-btn primary"
                        >
                            {submitting ? "Создание…" : "Создать заказ"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

export default AdminCreateOrderPage;