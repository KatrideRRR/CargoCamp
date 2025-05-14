import React, { useState } from 'react';
import axiosInstance from '../utils/axiosInstance';
import '../styles/ExpressOrderPage.css';

const subcategoryOptions = {
    taxi: [
        { label: 'Перевозка пассажиров', icon: '🚕' },
        { label: 'Перевозка детей', icon: '🧒' },
        { label: 'Перевозка животных', icon: '🐶' },
        { label: 'Перевозка между городами', icon: '🛣️' },
    ],
    courier: [
        { label: 'Доставка цветов', icon: '💐' },
        { label: 'Доставка еды/продуктов', icon: '🍔' },
        { label: 'Доставка документов', icon: '📄' },
    ],
};


const ExpressOrderPage = () => {
    const [type, setType] = useState('taxi'); // taxi | courier
    const [form, setForm] = useState({
        from: '',
        to: '',
        proposedSum: '',
        description: '',
        paymentType: 'cash',
        subcategory: '',
    });

    const handleChange = (e) => {
        setForm({ ...form, [e.target.name]: e.target.value });
    };

    const handleSubcategorySelect = (subcategory) => {
        setForm({ ...form, subcategory });
    };

    const handleSubmit = async () => {
        const { from, to, proposedSum, paymentType, subcategory } = form;

        if (!from || !to || !proposedSum || !paymentType || !subcategory) {
            alert('Пожалуйста, заполните все обязательные поля');
            return;
        }

        try {
            await axiosInstance.post('/orders/express', {
                ...form,
                type,
            });
            alert('✅ Заказ успешно создан!');
        } catch (err) {
            console.error('❌ Ошибка создания заказа:', err);
            alert('Ошибка при создании заказа');
        }
    };

    return (
        <div className="express-order-page">
            <h2>Создание {type === 'taxi' ? 'такси' : 'курьерского'} заказа</h2>

            <div className="type-selector">
                <button className={type === 'taxi' ? 'active' : ''} onClick={() => setType('taxi')}>
                    🚕 Такси
                </button>
                <button className={type === 'courier' ? 'active' : ''} onClick={() => setType('courier')}>
                    📦 Курьер
                </button>
            </div>

            <div className="subcategory-selector">
                {subcategoryOptions[type].map((option) => (
                    <button
                        key={option.label}
                        className={`subcategory-button ${form.subcategory === option.label ? 'selected' : ''}`}
                        onClick={() => handleSubcategorySelect(option.label)}
                    >
                        <span className="subcategory-icon">{option.icon}</span> {option.label}
                    </button>
                ))}
            </div>


            <div className="form-fields">
                <label>
                    Откуда <span className="required">*</span>
                    <input name="from" value={form.from} onChange={handleChange} required/>
                </label>

                <label>
                    Куда <span className="required">*</span>
                    <input name="to" value={form.to} onChange={handleChange} required/>
                </label>

                <label>
                    Цена <span className="required">*</span>
                    <input type="number" name="proposedSum" value={form.proposedSum} onChange={handleChange} required/>
                </label>

                <label>
                    Тип оплаты <span className="required">*</span>
                    <select name="paymentType" value={form.paymentType} onChange={handleChange}>
                        <option value="cash">Наличные</option>
                        <option value="guarantee">Гарантия</option>
                        <option value="installment">Рассрочка</option>
                    </select>
                </label>

                <label>
                    Комментарий (необязательно)
                    <textarea name="description" value={form.description} onChange={handleChange}/>
                </label>
            </div>

            <button className="submit-button" onClick={handleSubmit}>
                Создать заказ
            </button>
        </div>
    );
};

export default ExpressOrderPage;