// src/pages/CreateOrderPage.jsx
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { useNavigate } from "react-router-dom";
import "../styles/CreateOrderPage.css";
import imageCompression from "browser-image-compression";
import { FaCreditCard, FaMoneyBillWave, FaQuestionCircle, FaUniversity } from "react-icons/fa";
import PromotionOptions, { PROMOTION_PRICES } from "../components/PromotionOptions";
import YandexMapModal from "../components/YandexMapModal";

const apiUrl = process.env.REACT_APP_API_URL;

function isCoordsString(v) {
    if (!v) return false;
    return String(v).trim().startsWith("Координаты:");
}

function looksLikeCoordsString(v) {
    if (!v) return false;
    const s = String(v).trim();
    return s.startsWith("Координаты:") || /^\d{1,3}\.\d+,\s*\d{1,3}\.\d+$/.test(s);
}

function parseYandexGeocoderSuggestions(data) {
    const members = data?.response?.GeoObjectCollection?.featureMember || [];

    return members
        .map((m) => {
            const g = m?.GeoObject;
            const text = g?.metaDataProperty?.GeocoderMetaData?.text; // ✅ полный адрес
            const pos = g?.Point?.pos; // "lon lat"
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

// reverse geocode через Yandex Geocoder: geocode=lng,lat
async function reverseGeocodeYandex({ lat, lng, apiKey }) {
    if (!apiKey) throw new Error("No Yandex API key");
    const url = `https://geocode-maps.yandex.ru/1.x/?apikey=${apiKey}&geocode=${lng},${lat}&format=json&results=1&kind=house`;
    const r = await fetch(url);
    const data = await r.json();

    const first = data?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
    const text = first?.metaDataProperty?.GeocoderMetaData?.text || first?.name || null;

    return text;
}

function plusHour(d) {
    const x = new Date(d);
    x.setSeconds(0, 0);
    x.setMinutes(x.getMinutes()); // оставляем как есть
    x.setHours(x.getHours() + 1);
    return x;
}

function CreateOrderPage() {
    const navigate = useNavigate();
    const currentDate = useMemo(() => new Date(), []);
    const YM_KEY = process.env.REACT_APP_YANDEX_API_KEY;

    const [formData, setFormData] = useState({
        description: "",
        address: "",
        workTime: null,
        proposedSum: "",
    });

    const [error, setError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [images, setImages] = useState([]);

    const [markerPosition, setMarkerPosition] = useState(null); // [lat, lng]
    const [addressSuggestions, setAddressSuggestions] = useState([]); // [{label,address,lat,lon}]    const [images, setImages] = useState([]);

    const [category, setCategory] = useState([]);
    const [subcategory, setSubcategory] = useState([]);
    const [services, setServices] = useState([]);

    const [selectedCategory, setSelectedCategory] = useState("");
    const [selectedSubcategory, setSelectedSubcategory] = useState("");
    const [selectedService, setSelectedService] = useState("");

    const [addressOpen, setAddressOpen] = useState(false);
    const [timeOpen, setTimeOpen] = useState(false);

    const [promotion, setPromotion] = useState({ highlight: false, recommended: false, push: false });

    // ✅ один источник правды
    const [paymentType, setPaymentType] = useState("");
    const [selectedMethod, setSelectedMethod] = useState(null);

    // address
    const [profile, setProfile] = useState(null);
    const [addressMode, setAddressMode] = useState("profile"); // profile | custom
    const [showMapModal, setShowMapModal] = useState(false);
    const [addrResolving, setAddrResolving] = useState(false);
    const [addrResolveError, setAddrResolveError] = useState(null);
    const suggestTimerRef = React.useRef(null);
    const suggestAbortRef = React.useRef(null);

    // ✅ тумблер: ON = срочно
    const [isAsap, setIsAsap] = useState(true);

    const paymentMethods = useMemo(
        () => [
            { id: "cash", label: "Наличные" },
            { id: "guarantee", label: "Гарантия" },
            { id: "installment", label: "Рассрочка" },
        ],
        []
    );

    const promotionTotal = useMemo(() => {
        return Object.entries(promotion).reduce(
            (sum, [key, enabled]) => (enabled ? sum + PROMOTION_PRICES[key] : sum),
            0
        );
    }, [promotion]);

    useEffect(() => {
        const token = localStorage.getItem("authToken");
        if (!token) {
            alert("Вы не авторизованы! Пожалуйста, войдите в систему.");
            navigate("/login");
        }
    }, [navigate]);

    // default workTime (asap)
    useEffect(() => {
        setIsAsap(true);
        setTimeOpen(false);
        setFormData((p) => ({ ...p, workTime: plusHour(new Date()) }));
    }, []);

    // preload location
    useEffect(() => {
        const token = localStorage.getItem("authToken");
        if (!token) return;

        (async () => {
            try {
                const res = await axios.get(`${apiUrl}/api/auth/location/me`, {
                    headers: { Authorization: `Bearer ${token}` },
                });

                const loc = res.data?.location;
                if (!loc) return;

                setProfile(loc);

                const lat = Number(loc.locationLat);
                const lng = Number(loc.locationLng);
                const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

                if (loc.locationAddress && !looksLikeCoordsString(loc.locationAddress)) {
                    setFormData((p) => ({ ...p, address: loc.locationAddress }));
                    if (hasCoords) setMarkerPosition([lat, lng]);
                    return;
                }

                if (hasCoords) {
                    setMarkerPosition([lat, lng]);
                    setAddrResolving(true);
                    setAddrResolveError(null);

                    const addr = await reverseGeocodeYandex({ lat, lng, apiKey: YM_KEY });
                    if (addr) setFormData((p) => ({ ...p, address: addr }));
                    else setAddrResolveError("Не удалось распознать адрес. Введите вручную или выберите на карте.");

                    setAddrResolving(false);
                    return;
                }

                setAddrResolveError("В профиле нет адреса. Укажите вручную или выберите на карте.");
            } catch (e) {
                console.error("location preload error:", e);
                setAddrResolveError("Не удалось загрузить местоположение из профиля.");
            } finally {
                setAddrResolving(false);
            }
        })();
    }, [YM_KEY]);

    useEffect(() => {
        axios
            .get(`${apiUrl}/api/category`)
            .then((response) => setCategory(response.data))
            .catch((e) => console.error("Ошибка при загрузке категорий", e));
    }, []);

    const handleImageChange = async (event) => {
        const files = event.target.files;
        const compressed = [];

        for (const file of files) {
            try {
                const compressedFile = await imageCompression(file, {
                    maxSizeMB: 0.5,
                    maxWidthOrHeight: 1024,
                    useWebWorker: true,
                });
                compressed.push(compressedFile);
            } catch (e) {
                console.error("Ошибка сжатия изображения:", e);
            }
        }

        setImages((prev) => [...prev, ...compressed]);
    };

    const handleCategoryChange = async (event) => {
        const categoryId = event.target.value;
        setSelectedCategory(categoryId);
        setSelectedSubcategory("");
        setSelectedService("");
        setServices([]);
        setSubcategory([]);

        if (!categoryId) return;

        try {
            const res = await axios.get(`${apiUrl}/api/category/subcategory/${categoryId}`);
            setSubcategory(res.data);
        } catch (e) {
            console.error("Ошибка при загрузке подкатегорий", e);
        }
    };

    const fetchServices = async (subcategoryId) => {
        if (!subcategoryId) {
            setServices([]);
            return;
        }
        try {
            const res = await axios.get(`${apiUrl}/api/category/services/${subcategoryId}`);
            setServices(res.data);
        } catch (e) {
            console.error("Ошибка при загрузке услуг:", e);
            setServices([]);
        }
    };

    const handleSubcategoryChange = async (e) => {
        const subId = e.target.value;
        setSelectedSubcategory(subId);
        setSelectedService("");
        await fetchServices(subId);
    };

    const getMinTime = (selectedDate) => {
        if (!selectedDate || selectedDate.toDateString() === currentDate.toDateString()) {
            return new Date(
                currentDate.getFullYear(),
                currentDate.getMonth(),
                currentDate.getDate(),
                currentDate.getHours(),
                currentDate.getMinutes()
            );
        }
        return new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 0, 0, 0);
    };

    const handleAddressChange = (e) => {
        const address = e.target.value;
        setFormData((p) => ({ ...p, address }));
        setAddressMode("custom");

        // чистим если мало символов
        const q = address.trim();
        if (q.length < 3) {
            setAddressSuggestions([]);
            return;
        }

        // debounce
        if (suggestTimerRef.current) clearTimeout(suggestTimerRef.current);

        suggestTimerRef.current = setTimeout(async () => {
            try {
                // abort предыдущий запрос
                if (suggestAbortRef.current) suggestAbortRef.current.abort();
                const ctrl = new AbortController();
                suggestAbortRef.current = ctrl;

                // ⚠️ results=10 + kind=house → чаще дает адреса до дома
                const url =
                    `https://geocode-maps.yandex.ru/1.x/?apikey=${YM_KEY}` +
                    `&geocode=${encodeURIComponent(q)}` +
                    `&format=json&results=10&kind=house`;

                const r = await fetch(url, { signal: ctrl.signal });
                const data = await r.json();

                const suggestions = parseYandexGeocoderSuggestions(data);

                // можно чуть “умнее”: убрать дубли
                const uniq = Array.from(new Map(suggestions.map(s => [s.label, s])).values());

                setAddressSuggestions(uniq);
            } catch (err) {
                if (err?.name === "AbortError") return;
                console.error("Ошибка геокодирования:", err);
                setAddressSuggestions([]);
            }
        }, 250);
    };

    const handleAddressSelect = (s) => {
        // s = {label,address,lat,lon}
        setFormData((p) => ({ ...p, address: s.address }));
        setAddressSuggestions([]);
        setAddressMode("custom");
        setMarkerPosition([s.lat, s.lon]);
    };

    const detectGps = () => {
        if (!navigator.geolocation) {
            setAddrResolveError("GPS недоступен в браузере");
            return;
        }

        setAddrResolving(true);
        setAddrResolveError(null);

        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;

                setMarkerPosition([lat, lng]);

                try {
                    const addr = await reverseGeocodeYandex({ lat, lng, apiKey: YM_KEY });
                    if (!addr) {
                        setAddrResolveError("Не удалось распознать адрес по GPS. Введите вручную или выберите на карте.");
                        return;
                    }
                    setFormData((p) => ({ ...p, address: addr }));
                } catch (e) {
                    console.error("reverse geocode error:", e);
                    setAddrResolveError("Не удалось распознать адрес по GPS. Введите вручную или выберите на карте.");
                } finally {
                    setAddrResolving(false);
                }
            },
            (err) => {
                console.error(err);
                setAddrResolving(false);
                setAddrResolveError("Не удалось определить координаты по GPS. Введите вручную или выберите на карте.");
            },
            { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
        );
    };

    const handleSelectPayment = (event, id) => {
        event.preventDefault();
        setSelectedMethod(id);
        setPaymentType(id);
    };

    const getPaymentIcon = (type) => {
        switch (type) {
            case "guarantee":
                return <FaUniversity title="Гарантия" />;
            case "cash":
                return <FaMoneyBillWave title="Наличные" />;
            case "installment":
                return <FaCreditCard title="Рассрочка" />;
            default:
                return <FaQuestionCircle title="Неизвестно" />;
        }
    };

    const handleDescriptionChange = (e) => {
        const textarea = e.target;
        textarea.style.height = "auto";
        textarea.style.height = `${textarea.scrollHeight}px`;
        setFormData((p) => ({ ...p, description: textarea.value }));
    };

    useEffect(() => {
        if (!addressOpen) setAddressSuggestions([]);
    }, [addressOpen]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");

        if (!paymentType) {
            setError("Пожалуйста, выберите тип оплаты");
            return;
        }
        if (!formData.address?.trim()) {
            setError("Адрес обязателен");
            setAddressOpen(true);
            return;
        }
        if (isCoordsString(formData.address)) {
            setError("Нужно указать адрес текстом (не координаты). Выберите адрес на карте или введите вручную.");
            setAddressOpen(true);
            return;
        }
        if (!selectedCategory || !selectedSubcategory) {
            setError("Выберите категорию и подкатегорию");
            return;
        }

        if (isSubmitting) return;
        setIsSubmitting(true);

        const data = new FormData();

        data.append("description", formData.description || "");
        data.append("address", formData.address);
        data.append("workTime", formData.workTime ? new Date(formData.workTime).toISOString() : "");
        data.append("proposedSum", formData.proposedSum || "");
        data.append("paymentType", paymentType);

        data.append("categoryId", Number(selectedCategory));
        data.append("subcategoryId", Number(selectedSubcategory));

        if (selectedService && Number(selectedService) > 0) data.append("serviceId", Number(selectedService));

        data.append("promotion", JSON.stringify(promotion));
        images.forEach((img) => data.append("images", img));

        if (markerPosition?.length === 2) {
            data.append("coordinates", `${markerPosition[0]},${markerPosition[1]}`);
        }

        const token = localStorage.getItem("authToken");
        if (!token) {
            setError("Вы не авторизованы! Пожалуйста, войдите в систему.");
            setIsSubmitting(false);
            return;
        }

        try {
            const response = await axios.post(`${apiUrl}/api/orders/`, data, {
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "multipart/form-data" },
            });

            const orderId = response.data.id;

            if (promotionTotal > 0) {
                const payResp = await axios.post(
                    `${apiUrl}/api/payments/order/promotion/create`,
                    { orderId },
                    { headers: { Authorization: `Bearer ${token}` } }
                );

                if (!payResp.data?.success) {
                    setError(payResp.data?.error || "Не удалось создать платёж за продвижение");
                    setIsSubmitting(false);
                    return;
                }

                window.location.href = payResp.data.confirmationUrl;
            } else {
                alert("Заказ успешно создан");
                navigate("/orders");
            }
        } catch (err) {
            console.error("Ошибка при создании заказа:", err);
            setError(err.response?.data?.message || "Не удалось создать заказ. Попробуйте снова.");
            setIsSubmitting(false);
        }
    };

    const toggleAsap = () => {
        const next = !isAsap;
        setIsAsap(next);

        if (next) {
            // Срочно
            setTimeOpen(false);
            setFormData((p) => ({ ...p, workTime: plusHour(new Date()) }));
        } else {
            // Ко времени
            setTimeOpen(true);
            // если вдруг workTime пустой — зададим на ближайшее +1 час как старт
            setFormData((p) => ({ ...p, workTime: p.workTime ? p.workTime : plusHour(new Date()) }));
        }
    };

    return (
        <div className="create-page">
            <div className="create-shell">
                {/* Header */}
                <div className="glass header-card">
                    <div className="header-top">
                        <div className="headerTopRow">
                            <div className="header-titles">
                                <div className="header-title">Создать заказ</div>
                                <div className="header-sub">Адрес и время подставятся автоматически</div>
                            </div>

                            {/* компактный чип времени справа */}
                            <div className="timeChip" role="group" aria-label="Время выполнения">
                                <div className="timeChipText">
                                    <div className="timeChipLabel">Время</div>
                                    <div className="timeChipValue">{isAsap ? "Срочно" : "Ко времени"}</div>
                                </div>

                                <button
                                    type="button"
                                    className={`toggle mini ${isAsap ? "on" : ""}`}
                                    onClick={toggleAsap}
                                    aria-label="Срочно / ко времени"
                                    title="Срочно / ко времени"
                                >
                                    <span className="toggleKnob" />
                                </button>
                            </div>
                        </div>
                        {/* ✅ 2 независимые мини-карточки в 2 колонки */}

                        {/* RIGHT: Time mini card */}
                        {!isAsap && (
                            <div className={`miniCard ${timeOpen ? "open" : ""}`}>
                                {timeOpen && (
                                    <div className="miniDrop">
                                        <div className="glass field">
                                            <div className="label">Ко времени</div>
                                            <DatePicker
                                                selected={formData.workTime}
                                                onChange={(date) => setFormData((p) => ({ ...p, workTime: date }))}
                                                showTimeSelect
                                                timeFormat="HH:mm"
                                                timeIntervals={15}
                                                dateFormat="Pp"
                                                placeholderText="Выберите дату и время"
                                                minDate={new Date()}
                                                minTime={getMinTime(formData.workTime)}
                                                maxTime={new Date(0, 0, 0, 23, 59, 59)}
                                                className="control"
                                                portalId="date-picker-portal"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="headerMiniGrid">
                            {/* LEFT: Address mini card */}
                            <div className={`miniCard ${addressOpen ? "open" : ""}`}>
                                <button
                                    type="button"
                                    className="miniCardBtn"
                                    onClick={() => {
                                        setAddressOpen((p) => !p);
                                        setTimeOpen(false); // чтобы не было ощущения “вложенности”
                                    }}
                                >
                                    <div className="miniTop">
                                        <span className="miniLabel">Адрес</span>
                                        <span className="miniChevron">{addressOpen ? "⌃" : "⌄"}</span>
                                    </div>

                                    <div className={`miniValue ${formData.address ? "" : "danger"}`}>
                                        {formData.address ? "Указан" : "Не указан"}
                                    </div>

                                    {/* мелким — реальный адрес (если есть), иначе подсказка */}
                                    <div className="miniSub">
                                        {addrResolving
                                            ? "Определяем…"
                                            : formData.address
                                                ? formData.address
                                                : "Нажмите, чтобы указать"}
                                    </div>
                                </button>

                                {/* раскрытие адреса — только под address */}
                                {addressOpen && (
                                    <div className="miniDrop">
                                        <div className="glass field">
                                            <div className="label">Адрес</div>
                                            <input
                                                className="control"
                                                type="text"
                                                placeholder="Введите адрес"
                                                value={formData.address}
                                                onChange={handleAddressChange}
                                            />

                                            {addrResolveError && <div className="inline-error">{addrResolveError}</div>}

                                            {addressSuggestions.length > 0 && (
                                                <ul className="suggestions">
                                                    {addressSuggestions.map((s, i) => (
                                                        <li key={`${s.label}-${i}`} onClick={() => handleAddressSelect(s)}>
                                                            {s.label}
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>

                                        <div className="address-row" style={{ marginTop: 10, paddingTop: 10 }}>
                                            <div className="muted-strong">Адрес из профиля?</div>

                                            <div className="chip-row">
                                                <button
                                                    type="button"
                                                    className={`chip-btn ${addressMode === "profile" ? "active" : ""}`}
                                                    onClick={async () => {
                                                        setAddressMode("profile");
                                                        setAddrResolveError(null);

                                                        const addr = profile?.locationAddress;
                                                        const lat = Number(profile?.locationLat);
                                                        const lng = Number(profile?.locationLng);
                                                        const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

                                                        if (addr && !looksLikeCoordsString(addr)) {
                                                            setFormData((p) => ({ ...p, address: addr }));
                                                            if (hasCoords) setMarkerPosition([lat, lng]);
                                                            return;
                                                        }

                                                        if (hasCoords) {
                                                            setMarkerPosition([lat, lng]);
                                                            setAddrResolving(true);
                                                            const resolved = await reverseGeocodeYandex({ lat, lng, apiKey: YM_KEY });
                                                            setAddrResolving(false);

                                                            if (resolved) setFormData((p) => ({ ...p, address: resolved }));
                                                            else setAddrResolveError("В профиле нет распознанного адреса. Введите вручную или выберите на карте.");
                                                            return;
                                                        }

                                                        setAddrResolveError("В профиле нет адреса. Введите вручную или выберите на карте.");
                                                    }}
                                                >
                                                    Да
                                                </button>

                                                <button
                                                    type="button"
                                                    className={`chip-btn ${addressMode === "custom" ? "active" : ""}`}
                                                    onClick={() => setAddressMode("custom")}
                                                >
                                                    Нет
                                                </button>
                                            </div>

                                            {addressMode === "custom" && (
                                                <div className="grid2" style={{ marginTop: 10 }}>
                                                    <button type="button" className="action-btn subtle" onClick={() => setShowMapModal(true)}>
                                                        На карте
                                                    </button>
                                                    <button type="button" className="action-btn subtle" onClick={detectGps} disabled={addrResolving}>
                                                        GPS
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        <YandexMapModal
                                            isOpen={showMapModal}
                                            onClose={() => setShowMapModal(false)}
                                            initialLat={markerPosition?.[0]}
                                            initialLng={markerPosition?.[1]}
                                            onPick={(picked) => {
                                                setFormData((p) => ({ ...p, address: picked.address }));
                                                setMarkerPosition([picked.lat, picked.lng]);
                                                setAddressMode("custom");
                                                setShowMapModal(false);
                                            }}
                                        />
                                    </div>
                                )}
                            </div>


                        </div>
                    </div>
                </div>

                {error && (
                    <div className="glass alert-card alert-danger">
                        <div className="alert-title">Ошибка</div>
                        <div className="alert-text">{error}</div>
                    </div>
                )}

                {/* Category */}
                <div className="glass section-card">
                    <div className="section-head">
                        <div>
                            <div className="section-title">Категория</div>
                            <div className="section-sub">Выберите категорию, подкатегорию и услугу</div>
                        </div>
                    </div>

                    {/* Шаг 1: Категория всегда видна */}
                    <div className="glass field">
                        <div className="label">Категория</div>
                        <select className="control" value={selectedCategory} onChange={handleCategoryChange}>
                            <option value="">Выберите категорию</option>
                            {category
                                .filter((cat) => !["Такси", "Курьер"].includes(cat.name))
                                .map((cat) => (
                                    <option key={cat.id} value={cat.id}>
                                        {cat.name}
                                    </option>
                                ))}
                        </select>
                    </div>

                    {/* Шаг 2: Подкатегория показывается только после выбора категории */}
                    {selectedCategory && (
                        <div className="glass field" style={{ marginTop: 10 }}>
                            <div className="label">Подкатегория</div>
                            <select
                                className="control"
                                value={selectedSubcategory}
                                onChange={handleSubcategoryChange}
                            >
                                <option value="">Выберите подкатегорию</option>
                                {subcategory.map((sub) => (
                                    <option key={sub.id} value={sub.id}>
                                        {sub.name}
                                        {sub.price ? ` — ${sub.price} ₽` : ""}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    {/* Шаг 3: Услуга — только когда выбрана подкатегория и услуги есть */}
                    {selectedSubcategory && services.length > 0 && (
                        <div className="glass field" style={{ marginTop: 10 }}>
                            <div className="label">Услуга</div>
                            <select
                                className="control"
                                value={selectedService}
                                onChange={(e) => setSelectedService(e.target.value)}
                            >
                                <option value="">Выберите услугу</option>
                                {services.map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {s.name} — {s.price} ₽
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>

                {/* Description */}
                <div className="glass section-card">
                    <div className="section-head">
                        <div>
                            <div className="section-title">Описание</div>
                            <div className="section-sub">Коротко и понятно</div>
                        </div>
                    </div>

                    <div className="glass field">
                        <div className="label">Описание работы</div>
                        <textarea
                            className="control textarea"
                            placeholder="Что нужно сделать? Нюансы, материалы, сроки"
                            value={formData.description}
                            onChange={handleDescriptionChange}
                            rows="3"
                        />

                        <label className="upload inline">
                            <input type="file" multiple accept="image/*" onChange={handleImageChange} style={{ display: "none" }} />
                            <span>📎 Прикрепить фото</span>
                        </label>

                        {images.length > 0 ? (
                            <div className="docsGrid" style={{ marginTop: 12 }}>
                                {images.map((img, i) => (
                                    <div className="glass doc" key={i}>
                                        <img className="docImg" src={URL.createObjectURL(img)} alt={`Preview ${i + 1}`} />
                                        <div className="docName">Фото {i + 1}</div>
                                    </div>
                                ))}
                            </div>
                        ) : null}

                    </div>
                </div>

                {/* Payment + promotion */}
                <div className="glass section-card">
                    <div className="section-head">
                        <div>
                            <div className="section-title">Оплата и продвижение</div>
                            <div className="section-sub">Сумма за работу + способ оплаты + опции продвижения</div>
                        </div>
                    </div>

                    {/* сумма перенесена сюда */}
                    <div className="glass field">
                        <div className="label">Сумма за работу</div>
                        <input
                            className="control"
                            type="number"
                            placeholder="Например 1500"
                            value={formData.proposedSum}
                            onChange={(e) => setFormData((p) => ({ ...p, proposedSum: e.target.value }))}
                            required
                        />
                        <div className="hint">Эту сумму вы оплачиваете исполнителю. Сейчас оплачивается только продвижение.</div>
                    </div>

                    <div className="glass field" style={{ marginTop: 10 }}>
                        <div className="label">Способ оплаты</div>

                        <div className="payGrid">
                            {paymentMethods.map((m) => (
                                <button
                                    key={m.id}
                                    title={m.label}
                                    className={`payTile ${selectedMethod === m.id ? "selected" : ""}`}
                                    onClick={(event) => handleSelectPayment(event, m.id)}
                                    type="button"
                                >
                                    <span className="payIco">{getPaymentIcon(m.id)}</span>
                                    <span className="payLabel">{m.label}</span>
                                </button>
                            ))}
                        </div>

                        {selectedMethod && (
                            <div className="muted" style={{ marginTop: 8 }}>
                                Выбран способ оплаты: <b>{paymentMethods.find((x) => x.id === selectedMethod)?.label}</b>
                            </div>
                        )}

                    </div>

                    <div className="glass promoBox">
                        <PromotionOptions value={promotion} onChange={setPromotion} />
                    </div>

                    <div className="glass total">
                        <div>
                            <div className="totalTitle">К оплате сейчас</div>
                            <div className="totalSub">Оплачивается только продвижение</div>
                        </div>
                        <div className="totalAmount">{promotionTotal} ₽</div>
                    </div>

                    <div className="muted">💡 Если продвижение не выбрано — оплата сейчас = 0 ₽.</div>
                </div>

                {/* actions */}
                <div className="glass bottomActions">
                    <button type="button" className="action-btn subtle" onClick={() => navigate(-1)}>
                        Назад
                    </button>

                    <button type="submit" disabled={isSubmitting} className="action-btn primary" onClick={handleSubmit}>
                        {isSubmitting ? "Создание…" : "Создать заказ"}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default CreateOrderPage;