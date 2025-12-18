import React, { useEffect, useState } from "react";
import axios from "axios";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { useNavigate } from "react-router-dom";
import { YMaps, Map, Placemark } from "@pbe/react-yandex-maps";
import "../styles/CreateOrderPage.css";
import imageCompression from "browser-image-compression";
import {FaCreditCard, FaMoneyBillWave, FaQuestionCircle, FaUniversity} from "react-icons/fa";
import PromotionOptions, { PROMOTION_PRICES } from "../components/PromotionOptions";

const apiUrl = process.env.REACT_APP_API_URL;

function CreateOrderPage() {
    const [formData, setFormData] = useState({
        description: "",
        address: "",
        workTime: null,
        photoUrl: null,
        proposedSum: "",
        type: "",
        paymentType: "",  // Добавлено для хранения типа оплаты
    });
    const [error, setError] = useState("");
    const [markerPosition, setMarkerPosition] = useState(null);
    const navigate = useNavigate();
    const currentDate = new Date(); // Текущая дата и время
    const [images, setImages] = useState([]); // Состояние для хранения выбранных изображений
    const [category, setCategory] = useState([]);
    const [subcategory, setSubcategory] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState('');
    const [selectedSubcategory, setSelectedSubcategory] = useState('');
    const [addressSuggestions, setAddressSuggestions] = useState([]); // Подсказки для адреса
    const [paymentType, setPaymentType] = useState("");
    const [selectedMethod, setSelectedMethod] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const paymentMethods = [
        { id: "cash", label: "Наличные", icon: "💵" },
        { id: "guarantee", label: "Гарантия", icon: "🛡️" },
        { id: "installment", label: "Рассрочка", icon: "💳" },
    ];
    const [promotion, setPromotion] = useState({
        highlight: false,
        recommended: false,
        push: false,
    });
    const [services, setServices] = useState([]);
    const [selectedService, setSelectedService] = useState('');

    const promotionTotal = Object.entries(promotion).reduce(
        (sum, [key, enabled]) =>
            enabled ? sum + PROMOTION_PRICES[key] : sum,
        0
    );

    const handleImageChange = async (event) => {
        const files = event.target.files;
        const compressedImages = [];

        for (const file of files) {
            const options = {
                maxSizeMB: 0.5, // Максимальный размер 0.5MB
                maxWidthOrHeight: 1024, // Максимальная ширина/высота 1024px
                useWebWorker: true,
            };

            try {
                const compressedFile = await imageCompression(file, options);
                compressedImages.push(compressedFile);
            } catch (error) {
                console.error("Ошибка сжатия изображения:", error);
            }
        }

        setImages(prevImages => [...prevImages, ...compressedImages]);
    };

    useEffect(() => {
        // Получение списка категорий при загрузке компонента
        axios.get(`${apiUrl}/api/category`)
            .then(response => {
                setCategory(response.data);
            })
            .catch(error => {
                console.error('Ошибка при загрузке категорий', error);
            });
    }, []);

    const handleCategoryChange = (event) => {
        const categoryId = event.target.value;
        setSelectedCategory(categoryId);

        if (!categoryId) {
            setSubcategory([]);
            return;
        }

        // Получение подкатегорий для выбранной категории
        axios.get(`${apiUrl}/api/category/subcategory/${categoryId}`)
            .then(response => {
                setSubcategory(response.data);
            })
            .catch(error => {
                console.error('Ошибка при загрузке подкатегорий', error);
            });
    };

    const getMinTime = (selectedDate) => {
        if (!selectedDate || selectedDate.toDateString() === currentDate.toDateString()) {
            // Если дата совпадает с сегодняшней или не выбрана, возвращаем текущее время
            return new Date(
                currentDate.getFullYear(),
                currentDate.getMonth(),
                currentDate.getDate(),
                currentDate.getHours(),
                currentDate.getMinutes()
            );
        } else {
            // Для других дат минимальное время — начало суток
            return new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate(), 0, 0, 0);
        }
    };

    useEffect(() => {
        const token = localStorage.getItem("authToken");
        if (!token) {
            alert("Вы не авторизованы! Пожалуйста, войдите в систему.");
            navigate("/login");
        }
    }, [navigate]);

    const handleAddressChange = async (e) => {
        const address = e.target.value;
        setFormData({...formData, address});

        // Если вводим хотя бы 3 символа, начинаем запрашивать подсказки
        if (address.length > 3) {
            try {
                const response = await fetch(
                    `https://geocode-maps.yandex.ru/1.x/?apikey=bf97867b-5ffb-4fc4-9fd5-8997874b300e&geocode=${encodeURIComponent(
                        address
                    )}&format=json`
                );
                const data = await response.json();
                const suggestions = data.response.GeoObjectCollection.featureMember.map(item => item.GeoObject.name);
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
        setFormData({...formData, address});
        setAddressSuggestions([]); // Закрываем список подсказок

        try {
            const response = await fetch(
                `https://geocode-maps.yandex.ru/1.x/?apikey=bf97867b-5ffb-4fc4-9fd5-8997874b300e&geocode=${encodeURIComponent(address)}&format=json`
            );
            const data = await response.json();
            const coordinates = data.response.GeoObjectCollection.featureMember[0].GeoObject.Point.pos.split(' ');
            const [longitude, latitude] = coordinates.map(coord => parseFloat(coord));
            setMarkerPosition([latitude, longitude]); // Обновляем позицию маркера
        } catch (err) {
            console.error("Ошибка получения координат:", err);
        }
    };

    useEffect(() => {
        console.log('🔧 Услуги подкатегории:', services);
    }, [services]);

    const handleSelect = (event, paymentId) => {
        event.preventDefault();
        setSelectedMethod(paymentId);
        setPaymentType(paymentId); // Обновляем состояние paymentType
        setFormData(prevState => ({ ...prevState, paymentType: paymentId })); // Обновляем formData
    };

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!paymentType) {
            setError("Пожалуйста, выберите тип оплаты");
            return;
        }

        if (isSubmitting) return; // Предотвращаем повторное нажатие
        setIsSubmitting(true);

        const orderData = {
            promotion,
            promotionCost: promotionTotal,
            categoryId: selectedCategory,
            subcategoryId: selectedSubcategory,
            description: "Оплата за услугу",
            paymentType: formData.paymentType,
            serviceId:selectedService || null,
        };
        // Отправить данные на сервер
        console.log('Создание заказа:', orderData);

        // Создаем FormData
        const data = new FormData();

        // Добавляем все поля из formData в FormData
        Object.keys(formData).forEach((key) => {
            if (formData[key] !== null && formData[key] !== undefined && key !== "images") {
                data.append(key, formData[key]);
            }

        });
        data.append("categoryId", Number(selectedCategory));
        data.append("subcategoryId", Number(selectedSubcategory));
        data.append("serviceId", Number(selectedService));
        data.append("promotion", JSON.stringify(promotion)); // <— ВАЖНО

        // Добавляем изображения, если они есть
        images.forEach((image) => {
            data.append("images", image); // добавляем изображения в FormData
        });

        // Добавляем координаты на карту
        if (markerPosition) {
            data.append("coordinates", markerPosition.join(","));
        }

        const token = localStorage.getItem("authToken");
        if (!token) {
            setError("Вы не авторизованы! Пожалуйста, войдите в систему.");
            return;
        }

        try {
            // Шаг 1: создаём заказ с статусом pending или pending_payment
            const response = await axios.post(`${apiUrl}/api/orders/`, data, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "multipart/form-data",
                },
            });

            const orderId = response.data.id;

            if (promotionTotal > 0) {
                // ⬇️ НОВАЯ логика оплаты продвижения
                const payResp = await axios.post(
                    `${apiUrl}/api/payments/order/promotion/create`,
                    { orderId },
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    }
                );

                if (!payResp.data?.success) {
                    setError(payResp.data?.error || "Не удалось создать платёж за продвижение");
                    setIsSubmitting(false);
                    return;
                }

                // редирект в ЮKassa
                window.location.href = payResp.data.confirmationUrl;
            } else {
                alert("Заказ успешно создан");
                navigate("/orders");
            }
        } catch (err) {
            console.error("Ошибка при создании заказа:", err);
            setError("Не удалось создать заказ. Попробуйте снова.");
        }

        console.log(paymentType);
    };

    const getPaymentIcon = (type) => {
        switch (type) {
            case 'guarantee':
                return <FaUniversity title="Гарантия" />;
            case 'cash':
                return <FaMoneyBillWave title="Наличные" />;
            case 'installment':
                return <FaCreditCard title="Рассрочка" />;
            default:
                return <FaQuestionCircle title="Неизвестно" />;
        }
    };

    const fetchServices = async (subcategoryId) => {
        if (!subcategoryId) {
            setServices([]);
            return;
        }

        try {
            const response = await axios.get(`${apiUrl}/api/category/services/${subcategoryId}`);
            setServices(response.data);
        } catch (error) {
            console.error("Ошибка при загрузке услуг:", error);
            setServices([]);
        }
    };

    const handleSubcategoryChange = async (e) => {
        const subId = e.target.value;
        setSelectedSubcategory(subId);
        setSelectedService('');
        await fetchServices(subId); // 👈 загружаем услуги
    };

    const handleDescriptionChange = (e) => {
        const textarea = e.target;
        textarea.style.height = "auto"; // Сброс высоты
        textarea.style.height = `${textarea.scrollHeight}px`; // Установка высоты на основе контента
        setFormData({...formData, description: textarea.value});
    };

    return (
        <YMaps query={{apikey: "bf97867b-5ffb-4fc4-9fd5-8997874b300e"}}>
            <div className="create-order-page">
                <div className="container">
                <div className="form-container">
                        {error && <p className="error-text">{error}</p>}
                        <form onSubmit={handleSubmit} className="form">
                            <div className="input-group-responsive">
                                <div>
                                    <label>Выберите категорию:</label>
                                    <select
                                        className="select-responsive"
                                        value={selectedCategory}
                                        onChange={handleCategoryChange}
                                    >
                                        <option value="">Выберите категорию</option>
                                        {category
                                            .filter(cat => cat.id !== 12 && cat.id !== 13)
                                            .map(cat => (
                                                <option key={cat.id} value={cat.id}>
                                                    {cat.name}
                                                </option>
                                            ))}
                                    </select>
                                </div>

                                <div>
                                    <label>Выберите подкатегорию:</label>
                                    <select
                                        className="select-responsive"
                                        value={selectedSubcategory}
                                        onChange={handleSubcategoryChange}
                                        disabled={!selectedCategory}
                                    >
                                        <option value="">Выберите подкатегорию</option>
                                        {subcategory.map(sub => (
                                            <option key={sub.id} value={sub.id}>
                                                {sub.name}{sub.price ? ` — ${sub.price} ₽` : ''}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {services.length > 0 && (
                                    <div>
                                        <label>Услуга:</label>
                                        <select
                                            className="select-responsive"
                                            value={selectedService}
                                            onChange={(e) => setSelectedService(e.target.value)}
                                        >
                                            <option value="">Выберите услугу</option>
                                            {services.map(service => (
                                                <option key={service.id} value={service.id}>
                                                    {service.name} — {service.price} ₽
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                            </div>


                            <div className="input-group">
                                <label className="label">Описание работы</label>
                                <textarea
                                    className="textarea"
                                    placeholder="Введите описание работы"
                                    value={formData.description}
                                    onChange={handleDescriptionChange}
                                    rows="3" // Начальная высота
                                />
                            </div>

                            <div className="input-group">
                                <label className="label">Адрес</label>
                                <input
                                    className="input"
                                    type="text"
                                    placeholder="Введите адрес"
                                    value={formData.address}
                                    onChange={handleAddressChange}
                                    required
                                />
                                {addressSuggestions.length > 0 && (
                                    <ul className="address-suggestions">
                                        {addressSuggestions.map((address, index) => (
                                            <li key={index} onClick={() => handleAddressSelect(address)}>
                                                {address}
                                            </li>
                                        ))}
                                    </ul>
                                )}

                            </div>

                            <div className="map-container">
                                <Map
                                    defaultState={{center: [44.9572, 34.1108], zoom: 10}}
                                    style={{width: "100%", height: "300px"}}
                                >
                                    {markerPosition && <Placemark geometry={markerPosition}/>}
                                </Map>
                            </div>

                            <div className="input-row">
                                <div className="input-group date-picker">
                                    <label className="label">Дата и время</label>
                                    <DatePicker
                                        selected={formData.workTime}
                                        onChange={(date) => setFormData({...formData, workTime: date})}
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
                                        popperProps={{
                                            modifiers: [
                                                {
                                                    name: "preventOverflow",
                                                    options: {
                                                        boundary: "viewport",
                                                    },
                                                },
                                                {
                                                    name: "offset",
                                                    options: {
                                                        offset: [0, 8],
                                                    },
                                                },
                                            ],
                                        }}
                                    />


                                </div>
                                <div className="input-group">
                                    <label className="label">Предложенная сумма</label>
                                    <input
                                        className="input"
                                        type="number"
                                        placeholder="Введите сумму"
                                        value={formData.proposedSum}
                                        onChange={(e) =>
                                            setFormData({...formData, proposedSum: e.target.value})
                                        }
                                        required
                                    />
                                </div>
                            </div>
                            {/* Блок загрузки изображений */}
                            <div className="file-upload-container">
                                <label htmlFor="file-input" className="file-input-label">
                                    Загрузить изображения
                                </label>
                                <input
                                    id="file-input"
                                    type="file"
                                    className="file-input"
                                    multiple
                                    accept="image/*"
                                    onChange={handleImageChange}
                                />
                            </div>

                            {/* Область предпросмотра загруженных изображений */}
                            <div className="image-preview">
                                {images.length > 0 ? (
                                    images.map((image, index) => (
                                        <img key={index} src={URL.createObjectURL(image)} alt={`Preview ${index + 1}`}
                                             className="image-preview-item"/>
                                    ))
                                ) : (
                                    <p className="no-image-text">Изображения не выбраны</p>
                                )}
                            </div>

                            <h3 className="payment-title">Выберите способ оплаты</h3>
                            <div className="payment-selector">

                                {paymentMethods.map((paymentType) => (
                                    <button
                                        key={paymentType.id}
                                        className={`payment-option ${selectedMethod === paymentType.id ? "selected" : ""}`}
                                        onClick={(event) => handleSelect(event, paymentType.id)}
                                    >
                                        <div className="payment-icon-container-create">
        <span className="payment-icon">
          {getPaymentIcon(paymentType.id)} {/* Используем функцию getPaymentIcon */}
        </span>
                                            <span className="payment-label-create">{paymentType.label}</span>
                                        </div>
                                    </button>
                                ))}
                            </div>

                            <div className="promotion-options">

                                {/* Блок продвижения */}
                                <PromotionOptions value={promotion} onChange={setPromotion}/>

                                <div className="mt-4 text-sm text-gray-600">
                                    <p>Итоговая стоимость продвижения: <strong>{promotionTotal} ₽</strong></p>
                                    <p className="text-xs text-gray-500 mt-2">
                                        💡 Мы не гарантируем, что заказ будет принят исполнителем. Продвижение лишь
                                        повышает шансы.
                                    </p>
                                    <p className="text-xs text-red-500 mt-1">
                                        ⏰ Заказ будет автоматически перемещен в "историю заказов" через 24 часа, если
                                        его никто не примет.
                                    </p>
                                </div>
                            </div>


                            <button type="submit" disabled={isSubmitting} className="submit-button">
                                {isSubmitting ? "Создание..." : "Создать заказ"}
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </YMaps>
    );
}

export default CreateOrderPage;