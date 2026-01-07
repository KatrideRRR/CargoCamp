import React, { useEffect, useMemo, useState } from "react";
import "../styles/CreateExpressOrder.css";
import axiosInstance from "../utils/axiosInstance";
import YandexMapModal from "../components/YandexMapModal";
import ExpressMapConfirmModal from "../components/ExpressMapConfirmModal";
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

const CreateExpressOrder = () => {
    const [type, setType] = useState("taxi");
    const [error, setError] = useState("");

    const [saved, setSaved] = useState([]);
    const [savedLoading, setSavedLoading] = useState(false);

    const [form, setForm] = useState({
        subcategory: "",
        paymentType: "cash", // cash | guarantee
        totalPrice: "",
        description: "",

        fromAddress: "",
        fromLat: "",
        fromLng: "",

        toAddress: "",
        toLat: "",
        toLng: "",
    });

    // map modal controls
    const [showMapFor, setShowMapFor] = useState(null); // "from" | "to" | null

    // confirm modal
    const [showConfirm, setShowConfirm] = useState(false);

    // save suggestion modal state (простая логика — сохраняем через confirm modal после создания)
    const [suggestSave, setSuggestSave] = useState(false);
    const [createdOrderId, setCreatedOrderId] = useState(null);

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

    // GPS for "from"
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
                if (!form.fromAddress?.trim()) setField("fromAddress", "Текущее местоположение (GPS)");
            },
            () => setError("Не удалось получить координаты по GPS"),
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
        );
    };

    const validate = () => {
        if (!type) return "Выберите тип заказа";
        if (!form.subcategory) return "Выберите подкатегорию";
        if (!form.fromAddress?.trim() || !form.toAddress?.trim()) return "Заполните Откуда и Куда";
        if (!coordsOk) return "Нужны координаты точек A и B (выберите из сохранённых / карта / GPS)";
        if (!form.totalPrice || Number(form.totalPrice) <= 0) return "Укажите цену";
        if (!["cash", "guarantee"].includes(form.paymentType)) return "Выберите оплату";
        return "";
    };

    const openConfirm = () => {
        const v = validate();
        if (v) {
            setError(v);
            return;
        }
        setError("");
        setShowConfirm(true);
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
                subcategory: form.subcategory,
                paymentType: form.paymentType,
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
            setShowConfirm(false);

            // предложим сохранить адреса
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

                {/* Subcategory */}
                <div className="exo-glass exo-card">
                    <div className="exo-cardTop">
                        <div>
                            <div className="exo-cardTitle">Вид услуги</div>
                            <div className="exo-cardSub">Выбери вариант — чтобы исполнителям было понятно</div>
                        </div>
                    </div>

                    <div className="exo-subcatGrid">
                        {subcategoryOptions[type].map((opt) => (
                            <button
                                key={opt.label}
                                type="button"
                                className={`exo-subcatBtn ${form.subcategory === opt.label ? "selected" : ""}`}
                                onClick={() => setField("subcategory", opt.label)}
                            >
                                <span className="exo-subcatEmoji">{opt.icon}</span>
                                <span className="exo-subcatLabel">{opt.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

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
                                <div className="exo-label">Откуда</div>
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
                                placeholder="Выбери на карте или введи адрес"
                            />

                            <div className="exo-coordsRow">
                                <input className="exo-control exo-controlSmall" value={form.fromLat} onChange={(e) => setField("fromLat", e.target.value)} placeholder="lat" />
                                <input className="exo-control exo-controlSmall" value={form.fromLng} onChange={(e) => setField("fromLng", e.target.value)} placeholder="lng" />
                            </div>
                        </div>

                        <div className="exo-field">
                            <div className="exo-labelRow">
                                <div className="exo-label">Куда</div>
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
                                placeholder="Выбери на карте или введи адрес"
                            />

                            <div className="exo-coordsRow">
                                <input className="exo-control exo-controlSmall" value={form.toLat} onChange={(e) => setField("toLat", e.target.value)} placeholder="lat" />
                                <input className="exo-control exo-controlSmall" value={form.toLng} onChange={(e) => setField("toLng", e.target.value)} placeholder="lng" />
                            </div>
                        </div>
                    </div>

                    <div className="exo-actionsRow">
                        <button type="button" className="exo-btn exo-btnGhost" onClick={openConfirm}>
                            Проверить маршрут
                        </button>

                        <button type="button" className="exo-btn exo-btnPrimary" onClick={createOrder}>
                            Создать заказ
                        </button>
                    </div>

                    <div className="exo-note">
                        💡 “Проверить маршрут” открывает мини-модалку + кнопку “Открыть в Яндекс.Навигаторе”.
                    </div>
                </div>

                {/* Price + payment + description */}
                <div className="exo-glass exo-card">
                    <div className="exo-cardTop">
                        <div>
                            <div className="exo-cardTitle">Цена и оплата</div>
                            <div className="exo-cardSub">Рассрочку убрали — только наличные или гарантия</div>
                        </div>
                    </div>

                    <div className="exo-grid2">
                        <div className="exo-field">
                            <div className="exo-label">Цена</div>
                            <input
                                className="exo-control"
                                type="number"
                                value={form.totalPrice}
                                onChange={(e) => setField("totalPrice", e.target.value)}
                                placeholder="Например 500"
                            />
                            <div className="exo-hint">Дальше сделаем: подача + цена за км (авторасчёт).</div>
                        </div>

                        <div className="exo-field">
                            <div className="exo-label">Оплата</div>
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
                            <div className="exo-hint">Гарантия — позже подключим холд/списание через YooKassa.</div>
                        </div>
                    </div>

                    <div className="exo-field" style={{ marginTop: 10 }}>
                        <div className="exo-label">Комментарий (необязательно)</div>
                        <textarea
                            className="exo-control exo-textarea"
                            value={form.description}
                            onChange={(e) => setField("description", e.target.value)}
                            placeholder="Например: подъезд, код домофона, позвонить заранее…"
                        />
                    </div>
                </div>
            </div>

            {/* Map modal (your component) */}
            <YandexMapModal
                isOpen={!!showMapFor}
                onClose={() => setShowMapFor(null)}
                initialLat={showMapFor === "from" ? toNum(form.fromLat) : toNum(form.toLat)}
                initialLng={showMapFor === "from" ? toNum(form.fromLng) : toNum(form.toLng)}
                onPick={(picked) => {
                    // ОЖИДАЕМ: picked = { address, lat, lng }
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

            {/* Confirm modal */}
            <ExpressMapConfirmModal
                isOpen={showConfirm}
                onClose={() => setShowConfirm(false)}
                from={{ address: form.fromAddress, lat: form.fromLat, lng: form.fromLng }}
                to={{ address: form.toAddress, lat: form.toLat, lng: form.toLng }}
                routeUrl={routeUrl}
                onCreate={createOrder}
            />

            {/* Suggest save (простая версия без отдельной модалки UI — чтобы быстрее стартануть) */}
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
                            <a className="exo-miniBtn" href={routeUrl || "#"} target="_blank" rel="noreferrer" onClick={(e) => !routeUrl && e.preventDefault()}>
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