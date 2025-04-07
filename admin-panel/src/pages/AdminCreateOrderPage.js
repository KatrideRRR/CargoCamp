import React, { useEffect, useState } from "react";
import axios from "axios";
import {useNavigate, useParams} from "react-router-dom";
import DatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";
import '../styles/AdminCreateOrderPage.css';

const apiUrl = process.env.REACT_APP_API_URL;

function AdminCreateOrderPage() {
    const { userId } = useParams(); // Получаем ID пользователя из URL
    const [formData, setFormData] = useState({
        userId: userId,  // Инициализируем userId
        description: "",
        address: "",
        workTime: null,
        proposedSum: "",
        type: "",
    });

    const [markerPosition, setMarkerPosition] = useState(null);
    const [error, setError] = useState("");
    const navigate = useNavigate();
    const [category, setCategory] = useState([]);
    const [subcategory, setSubcategory] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState('');
    const [selectedSubcategory, setSelectedSubcategory] = useState('');
    const [addressSuggestions, setAddressSuggestions] = useState([]); // Подсказки для адреса

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
        const currentDate = new Date(); // Текущая дата
        if (!selectedDate || selectedDate.toDateString() === currentDate.toDateString()) {
            // Если дата совпадает с сегодняшней или не выбрана, минимальное время — текущее время
            return new Date(
                currentDate.getFullYear(),
                currentDate.getMonth(),
                currentDate.getDate(),
                currentDate.getHours(),
                currentDate.getMinutes()
            );
        } else {
            // Для других дат минимальное время — начало суток
            return new Date(0, 0, 0, 0, 0, 0);
        }
    };


    const handleSubmit = async (e) => {
        e.preventDefault();


        const orderData = {
            userId: userId, // Передаем userId для создания заказа
            categoryId: selectedCategory,
            subcategoryId: selectedSubcategory,
            description: formData.description,
            address: formData.address,
            workTime: formData.workTime ? formData.workTime.toISOString() : null, // Преобразуем в ISO-строку, если нужно
            proposedSum: formData.proposedSum,
            type: formData.type,
            coordinates: markerPosition ? markerPosition.join(",") : null, // Если есть координаты
        };

// Отправка запроса с данными в формате JSON
        try {
            const token = localStorage.getItem("authToken");

            await axios.post(`${apiUrl}/api/admin/create-order`, orderData, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json', // Указываем тип контента как JSON
                },
            });
            alert("Заказ успешно создан");
            navigate("/orders");
        } catch (err) {
            console.error("Ошибка при создании заказа:", err);
            setError("Не удалось создать заказ. Попробуйте снова.");
        }

    };

    const handleTypeInputChange = (value) => {
        setFormData({ ...formData, type: value });
    };

    const handleAddressChange = async (e) => {
        const address = e.target.value;
        setFormData({ ...formData, address });

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
        setFormData({ ...formData, address });
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
    const handleDescriptionChange = (e) => {
        const textarea = e.target;
        textarea.style.height = "auto"; // Сброс высоты
        textarea.style.height = `${textarea.scrollHeight}px`; // Установка высоты на основе контента
        setFormData({ ...formData, description: textarea.value });
    };



    return (
            <div className="create-order-page">
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

                        <button type="submit" className="submit-button">
                            Создать заказ
                        </button>
                    </form>
                </div>
            </div>
    );
}

export default AdminCreateOrderPage;
