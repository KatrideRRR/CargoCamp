import React, { useEffect, useState } from "react";
import axios from "axios";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import { useNavigate } from "react-router-dom";
import { YMaps, Map, Placemark } from "@pbe/react-yandex-maps";
import "../styles/CreateOrderPage.css";

function CreateOrderPage({currentUserId}) {
    const [formData, setFormData] = useState({
        description: "",
        address: "",
        workTime: null,
        photoUrl: null,
        proposedSum: "",
        type: "",
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
    const paymentMethods = [
        { id: "cash", label: "Наличные", icon: "💵" },
        { id: "guarantee", label: "Гарантия", icon: "🛡️" },
        { id: "installments", label: "Рассрочка", icon: "💳" },
    ];
    const handleImageChange = (event) => {
        const files = event.target.files;
        setImages(prevImages => [...prevImages, ...Array.from(files)]);
    };


    useEffect(() => {
        // Получение списка категорий при загрузке компонента
        axios.get('http://localhost:5000/api/category')
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
        axios.get(`http://localhost:5000/api/category/subcategory/${categoryId}`)
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

    const handleTypeInputChange = (value) => {
        setFormData({...formData, type: value});
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

        // Запрос координат для выбранного адреса
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


    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!paymentType) {
            setError("Пожалуйста, выберите тип оплаты");
            return;
        }
        setFormData(prevState => ({ ...prevState, paymentType }));

        const orderData = {
            categoryId: selectedCategory,
            subcategoryId: selectedSubcategory,
            description: "Оплата за услугу",
            paymentType: paymentType,  // Убедитесь, что это поле отправляется
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
        data.append("paymentType", paymentType); // Добавляем в FormData
        data.append("categoryId", Number(selectedCategory));
        data.append("subcategoryId", Number(selectedSubcategory));

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
            await axios.post("http://localhost:5000/api/orders/", data, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "multipart/form-data",
                },
            });
            alert("Заказ успешно создан");
            navigate("/orders");
        } catch (err) {
            console.error("Ошибка при создании заказа:", err);
            setError("Не удалось создать заказ. Попробуйте снова.");
        }

        try {
            const response = await fetch("http://localhost:5000/api/payments/create", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(paymentType)
            });

            const data = await response.json();

            if (data.success && data.paymentUrl) {
                window.location.href = data.paymentUrl;
            } else {
                alert("Ошибка при создании платежа");
            }
        } catch (err) {
            console.error("Ошибка при создании платежа:", err);
        }

    };

    const handleDescriptionChange = (e) => {
        const textarea = e.target;
        textarea.style.height = "auto"; // Сброс высоты
        textarea.style.height = `${textarea.scrollHeight}px`; // Установка высоты на основе контента
        setFormData({...formData, description: textarea.value});
    };

    const handleSelect = (event, paymentId) => {
        event.preventDefault();
        setSelectedMethod(paymentId);
        setPaymentType(paymentId); // Обновляем состояние paymentType
    };

    return (
        <YMaps query={{apikey: "bf97867b-5ffb-4fc4-9fd5-8997874b300e"}}>
            <div className="create-order-page">
                <div className="container">
                    <div className="form-container">
                        {error && <p className="error-text">{error}</p>}
                        <form onSubmit={handleSubmit} className="form">
                            <div className="input-group">
                                <div>
                                    <label>Выберите категорию:</label>
                                    <select value={selectedCategory} onChange={handleCategoryChange}>
                                        <option value="">Выберите категорию</option>
                                        {category.map(category => (
                                            <option key={category.id} value={category.id}>
                                                {category.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label>Выберите подкатегорию:</label>
                                    <select
                                        value={selectedSubcategory}
                                        onChange={e => setSelectedSubcategory(e.target.value)}
                                        disabled={!selectedCategory}
                                    >
                                        <option value="">Выберите подкатегорию</option>
                                        {subcategory.map(subcategory => (
                                            <option key={subcategory.id} value={subcategory.id}>
                                                {subcategory.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <label className="label">Ключевое слово</label>
                                <input
                                    className="input"
                                    type="text"
                                    value={formData.type}
                                    onChange={(e) => handleTypeInputChange(e.target.value)}
                                    placeholder="Введите ключевое слово..."
                                    required
                                />

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

                            <h3>Выберите способ оплаты</h3>
                            <div className="payment-selector">
                                {paymentMethods.map((paymentType) => (
                                    <button
                                        key={paymentType.id}
                                        className={`payment-option ${selectedMethod === paymentType.id ? "selected" : ""}`}
                                        onClick={(event) => handleSelect(event, paymentType.id)}
                                    >

                                        <span className="payment-icon">{paymentType.icon}</span>
                                        <span className="payment-label">{paymentType.label}</span>
                                    </button>
                                ))}
                            </div>
                            <button type="submit" className="submit-button">
                                Создать заказ
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        </YMaps>
    )
        ;
}

export default CreateOrderPage;