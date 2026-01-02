import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { useNavigate } from "react-router-dom";
import { YMaps } from "@pbe/react-yandex-maps";
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

// reverse geocode через Yandex Geocoder: geocode=lng,lat
async function reverseGeocodeYandex({ lat, lng, apiKey }) {
    if (!apiKey) throw new Error("No Yandex API key");

    const url = `https://geocode-maps.yandex.ru/1.x/?apikey=${apiKey}&geocode=${lng},${lat}&format=json&results=1&kind=house`;
    const r = await fetch(url);
    const data = await r.json();

    const first = data?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
    const text =
        first?.metaDataProperty?.GeocoderMetaData?.text ||
        first?.name ||
        null;

    return text; // строка адреса или null
}

function roundTo15(d) {
    const x = new Date(d);
    x.setSeconds(0, 0);
    const m = x.getMinutes();
    const add = (15 - (m % 15)) % 15;
    x.setMinutes(m + add);
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

    const [markerPosition, setMarkerPosition] = useState(null); // [lat, lng]
    const [addressSuggestions, setAddressSuggestions] = useState([]);

    const [images, setImages] = useState([]);

    const [category, setCategory] = useState([]);
    const [subcategory, setSubcategory] = useState([]);
    const [services, setServices] = useState([]);

    const [selectedCategory, setSelectedCategory] = useState("");
    const [selectedSubcategory, setSelectedSubcategory] = useState("");
    const [selectedService, setSelectedService] = useState("");

    const [promotion, setPromotion] = useState({ highlight: false, recommended: false, push: false });

    // ✅ один источник правды
    const [paymentType, setPaymentType] = useState("");
    const [selectedMethod, setSelectedMethod] = useState(null);

    const paymentMethods = [
        { id: "cash", label: "Наличные" },
        { id: "guarantee", label: "Гарантия" },
        { id: "installment", label: "Рассрочка" },
    ];

    // адрес из профиля / кастом
    const [profile, setProfile] = useState(null);
    const [addressMode, setAddressMode] = useState("profile"); // profile | custom
    const [showMapModal, setShowMapModal] = useState(false);
    const [addrResolving, setAddrResolving] = useState(false);
    const [addrResolveError, setAddrResolveError] = useState(null);

    // время
    const [scheduleMode, setScheduleMode] = useState("asap"); // asap | scheduled

    const promotionTotal = useMemo(() => {
        return Object.entries(promotion).reduce((sum, [key, enabled]) => (enabled ? sum + PROMOTION_PRICES[key] : sum), 0);
    }, [promotion]);

    // auth guard
    useEffect(() => {
        const token = localStorage.getItem("authToken");
        if (!token) {
            alert("Вы не авторизованы! Пожалуйста, войдите в систему.");
            navigate("/login");
        }
    }, [navigate]);

    // default workTime
    useEffect(() => {
        setFormData((p) => ({ ...p, workTime: roundTo15(new Date()) }));
    }, []);

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

                // 1) Если в профиле нормальный адрес — используем его
                if (loc.locationAddress && !looksLikeCoordsString(loc.locationAddress)) {
                    setFormData((p) => ({ ...p, address: loc.locationAddress }));
                    if (hasCoords) setMarkerPosition([lat, lng]);
                    return;
                }

                // 2) Если адреса нет/он координатный, но координаты есть — reverse → адрес
                if (hasCoords) {
                    setMarkerPosition([lat, lng]);
                    setAddrResolving(true);
                    setAddrResolveError(null);

                    const addr = await reverseGeocodeYandex({ lat, lng, apiKey: YM_KEY });
                    if (addr) {
                        setFormData((p) => ({ ...p, address: addr }));
                    } else {
                        setAddrResolveError("Не удалось распознать адрес по координатам. Введите адрес вручную или выберите на карте.");
                    }

                    setAddrResolving(false);
                    return;
                }

                // 3) Вообще ничего нет — оставляем пустым
                setAddrResolveError("В профиле нет адреса. Укажите адрес вручную или выберите на карте.");
            } catch (e) {
                console.error("location preload error:", e);
                setAddrResolveError("Не удалось загрузить местоположение из профиля.");
            } finally {
                setAddrResolving(false);
            }
        })();
    }, [YM_KEY]);

    // load categories
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

    const handleAddressChange = async (e) => {
        const address = e.target.value;
        setFormData((p) => ({ ...p, address }));
        setAddressMode("custom"); // ✅ если правит руками — значит кастом

        if (address.length > 3) {
            try {
                const r = await fetch(
                    `https://geocode-maps.yandex.ru/1.x/?apikey=${YM_KEY}&geocode=${encodeURIComponent(address)}&format=json`
                );
                const data = await r.json();
                const suggestions = data.response.GeoObjectCollection.featureMember.map((item) => item.GeoObject.name);
                setAddressSuggestions(suggestions);
            } catch (err) {
                console.error("Ошибка геокодирования:", err);
                setAddressSuggestions([]);
            }
        } else {
            setAddressSuggestions([]);
        }
    };

    const handleAddressSelect = async (address) => {
        setFormData((p) => ({ ...p, address }));
        setAddressSuggestions([]);
        setAddressMode("custom");

        try {
            const r = await fetch(
                `https://geocode-maps.yandex.ru/1.x/?apikey=${YM_KEY}&geocode=${encodeURIComponent(address)}&format=json`
            );
            const data = await r.json();
            const pos = data.response.GeoObjectCollection.featureMember?.[0]?.GeoObject?.Point?.pos;
            if (!pos) return;

            const [lon, lat] = pos.split(" ").map((v) => parseFloat(v));
            if (Number.isFinite(lat) && Number.isFinite(lon)) setMarkerPosition([lat, lon]);
        } catch (err) {
            console.error("Ошибка получения координат:", err);
        }
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
                        setAddrResolveError("Не удалось распознать ваш адрес по GPS. Введите адрес вручную или выберите на карте.");
                        return;
                    }
                    setFormData((p) => ({ ...p, address: addr }));
                } catch (e) {
                    console.error("reverse geocode error:", e);
                    setAddrResolveError("Не удалось распознать ваш адрес по GPS. Введите адрес вручную или выберите на карте.");
                } finally {
                    setAddrResolving(false);
                }
            },
            (err) => {
                console.error(err);
                setAddrResolving(false);
                setAddrResolveError("Не удалось определить координаты по GPS. Введите адрес вручную или выберите на карте.");
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

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError("");

        if (!paymentType) {
            setError("Пожалуйста, выберите тип оплаты");
            return;
        }
        if (!formData.address?.trim()) {
            setError("Адрес обязателен");
            return;
        }

        if (isCoordsString(formData.address)) {
            setError("Нужно указать адрес текстом (не координаты). Выберите адрес на карте или введите вручную.");
            setIsSubmitting(false);
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

        // ✅ если есть маркер — отправляем coordinates
        if (markerPosition?.length === 2) {
            data.append("coordinates", `${markerPosition[0]},${markerPosition[1]}`); // lat,lng
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

                if (looksLikeCoordsString(formData.address)) {
                    setError("Укажите адрес текстом. Если адрес не определяется автоматически — введите вручную или выберите на карте.");
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

    return (
        <div className="create-page">
            <div className="create-shell">
                {/* Header как в профиле */}
                <div className="create-header glass">
                    <div className="create-header-top">
                        <div>
                            <h1 className="create-title">Создать заказ</h1>
                            <p className="create-subtitle">Заполните детали — адрес и время подставятся автоматически</p>
                        </div>
                    </div>

                    {/* мини-плашка состояния адреса */}
                    <div className="create-meta">
          <span className="identity-pill">
            Адрес: {formData.address ? "указан" : "не указан"}
          </span>
                        {addrResolving && <span className="identity-pill">Определяем адрес…</span>}
                    </div>
                </div>

                {error && (
                    <div className="alert alert-danger glass">
                        <div>
                            <div className="alert-title">Ошибка</div>
                            <div className="alert-text">{error}</div>
                        </div>
                    </div>
                )}

                {/* 1) Категория */}
                <div className="create-card glass">
                    <div className="card-head">
                        <div>
                            <h2 className="card-title">Категория</h2>
                            <p className="card-subtitle">Выберите категорию, подкатегорию и услугу (если есть)</p>
                        </div>
                    </div>

                    <div className="create-grid-2">
                        <div className="input-group">
                            <label>Категория</label>
                            <select className="input" value={selectedCategory} onChange={handleCategoryChange}>
                                <option value="">Выберите категорию</option>
                                {category
                                    .filter((cat) => cat.id !== 12 && cat.id !== 13)
                                    .map((cat) => (
                                        <option key={cat.id} value={cat.id}>
                                            {cat.name}
                                        </option>
                                    ))}
                            </select>
                        </div>

                        <div className="input-group">
                            <label>Подкатегория</label>
                            <select
                                className="input"
                                value={selectedSubcategory}
                                onChange={handleSubcategoryChange}
                                disabled={!selectedCategory}
                            >
                                <option value="">Выберите подкатегорию</option>
                                {subcategory.map((sub) => (
                                    <option key={sub.id} value={sub.id}>
                                        {sub.name}{sub.price ? ` — ${sub.price} ₽` : ""}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {services.length > 0 && (
                        <div className="input-group" style={{ marginTop: 10 }}>
                            <label>Услуга</label>
                            <select className="input" value={selectedService} onChange={(e) => setSelectedService(e.target.value)}>
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

                {/* 2) Описание */}
                <div className="create-card glass">
                    <div className="card-head">
                        <div>
                            <h2 className="card-title">Описание</h2>
                            <p className="card-subtitle">Опишите задачу — так исполнители быстрее поймут</p>
                        </div>
                    </div>

                    <div className="input-group">
                        <label>Описание работы</label>
                        <textarea
                            className="input create-textarea"
                            placeholder="Введите описание работы"
                            value={formData.description}
                            onChange={handleDescriptionChange}
                            rows="3"
                        />
                    </div>
                </div>

                {/* 3) Адрес */}
                <div className="create-card glass">
                    <div className="card-head">
                        <div>
                            <h2 className="card-title">Адрес</h2>
                            <p className="card-subtitle">Подставляем адрес из профиля, либо выберите на карте</p>
                        </div>
                    </div>

                    <div className="input-group">
                        <label>Адрес</label>
                        <input
                            className="input"
                            type="text"
                            placeholder="Введите адрес"
                            value={formData.address}
                            onChange={handleAddressChange}
                            required
                        />

                        {addrResolveError && <div className="loc-error">{addrResolveError}</div>}

                        {addressSuggestions.length > 0 && (
                            <ul className="address-suggestions">
                                {addressSuggestions.map((a, i) => (
                                    <li key={i} onClick={() => handleAddressSelect(a)}>
                                        {a}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <div className="address-confirm">
                        <div className="address-question">Заказ будет выполняться по этому адресу?</div>

                        <div className="address-actions">
                            <button
                                type="button"
                                className={`btn btn-ghost ${addressMode === "profile" ? "btn-active" : ""}`}
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
                                        else setAddrResolveError("В профиле нет распознанного адреса. Введите адрес вручную или выберите на карте.");
                                        return;
                                    }

                                    setAddrResolveError("В профиле нет адреса. Введите адрес вручную или выберите на карте.");
                                }}
                            >
                                Да (из профиля)
                            </button>

                            <button
                                type="button"
                                className={`btn btn-ghost ${addressMode === "custom" ? "btn-active" : ""}`}
                                onClick={() => setAddressMode("custom")}
                            >
                                Нет, изменить
                            </button>
                        </div>

                        {addressMode === "custom" && (
                            <div className="create-grid-2" style={{ marginTop: 10 }}>
                                <button type="button" className="btn btn-ghost" onClick={() => setShowMapModal(true)}>
                                    Выбрать на карте
                                </button>

                                <button type="button" className="btn btn-ghost" onClick={detectGps} disabled={addrResolving}>
                                    Определить по GPS
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

                {/* 4) Время + сумма */}
                <div className="create-card glass">
                    <div className="card-head">
                        <div>
                            <h2 className="card-title">Время и бюджет</h2>
                            <p className="card-subtitle">Минималистично: тумблер “срочно / по расписанию”</p>
                        </div>
                    </div>

                    <div className="create-grid-2">
                        <div className="input-group">
                            <label>Когда нужно</label>

                            <div className="segmented">
                                <button
                                    type="button"
                                    className={`seg-btn ${scheduleMode === "asap" ? "active" : ""}`}
                                    onClick={() => {
                                        setScheduleMode("asap");
                                        setFormData((p) => ({ ...p, workTime: roundTo15(new Date()) }));
                                    }}
                                >
                                    В ближайшее время
                                </button>

                                <button
                                    type="button"
                                    className={`seg-btn ${scheduleMode === "scheduled" ? "active" : ""}`}
                                    onClick={() => setScheduleMode("scheduled")}
                                >
                                    Выбрать дату и время
                                </button>
                            </div>

                            {scheduleMode === "asap" ? (
                                <div className="asap-chip">
                                    Ближайшее время:{" "}
                                    <strong>{formData.workTime ? new Date(formData.workTime).toLocaleString() : "—"}</strong>
                                </div>
                            ) : (
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
                                    className="input"
                                    portalId="date-picker-portal"
                                />
                            )}
                        </div>
                    </div>
                </div>

                {/* 5) Фото */}
                <div className="create-card glass">
                    <div className="card-head">
                        <div>
                            <h2 className="card-title">Фото</h2>
                            <p className="card-subtitle">До 5 изображений, чтобы было понятнее</p>
                        </div>
                    </div>

                    <label className="upload-glass">
                        <input
                            id="file-input"
                            type="file"
                            multiple
                            accept="image/*"
                            onChange={handleImageChange}
                            style={{ display: "none" }}
                        />
                        <span>Загрузить изображения</span>
                    </label>

                    {images.length > 0 ? (
                        <div className="docs-grid" style={{ marginTop: 12 }}>
                            {images.map((img, i) => (
                                <div className="doc-tile" key={i}>
                                    <img className="doc-img" src={URL.createObjectURL(img)} alt={`Preview ${i + 1}`} />
                                    <div className="doc-name">Фото {i + 1}</div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <div className="docs-empty" style={{ marginTop: 10 }}>Изображения не выбраны</div>
                    )}
                </div>

                {/* 6) Оплата */}
                <div className="create-card glass">
                    <div className="card-head">
                        <div>
                            <h2 className="card-title">Оплата</h2>
                            <p className="card-subtitle">Выберите способ оплаты</p>
                        </div>
                    </div>

                    <div className="input-group" style={{ marginBottom: 12 }}>
                        <label>Предложенная сумма</label>
                        <input
                            className="input"
                            type="number"
                            placeholder="Введите сумму"
                            value={formData.proposedSum}
                            onChange={(e) => setFormData((p) => ({ ...p, proposedSum: e.target.value }))}
                            required
                        />
                    </div>

                    <div className="payment-grid">
                        {paymentMethods.map((m) => (
                            <button
                                key={m.id}
                                className={`pay-tile ${selectedMethod === m.id ? "selected" : ""}`}
                                onClick={(event) => handleSelectPayment(event, m.id)}
                                type="button"
                            >
                                <div className="pay-tile-inner">
                                    <span className="pay-ico">{getPaymentIcon(m.id)}</span>
                                    <span className="pay-label">{m.label}</span>
                                </div>
                            </button>
                        ))}
                    </div>

                    <div className="total-row">
                        <div className="total-left">
                            <div className="total-title">Итог к оплате сейчас</div>
                            <div className="total-sub">Оплачивается только продвижение (если выбрано)</div>
                        </div>
                        <div className="total-amount">{promotionTotal} ₽</div>
                    </div>

                </div>

                {/* 7) Продвижение */}
                <div className="create-card glass">
                    <div className="card-head">
                        <div>
                            <h2 className="card-title">Продвижение</h2>
                            <p className="card-subtitle">Опционально: выделение, рекомендация, пуш</p>
                        </div>
                    </div>

                    <PromotionOptions value={promotion} onChange={setPromotion} />

                    <div className="docs-block" style={{ marginTop: 12 }}>
                        <div className="docs-head">
                            <div className="docs-title">Итог</div>
                            <div className="docs-count">{promotionTotal} ₽</div>
                        </div>
                        <div className="card-muted">
                            💡 Продвижение повышает шансы, но не гарантирует отклик.
                            ⏰ Если никто не примет заказ — уйдёт в историю через 24 часа.
                        </div>
                    </div>
                </div>

                {/* submit */}
                <div className="profile-actions glass">
                    <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
                        Назад
                    </button>

                    <button type="submit" disabled={isSubmitting} className="btn btn-primary" onClick={handleSubmit}>
                        {isSubmitting ? "Создание..." : "Создать заказ"}
                    </button>
                </div>
            </div>
        </div>
    );
}

export default CreateOrderPage;