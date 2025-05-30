import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import ReCAPTCHA from "react-google-recaptcha";
import '../styles/RegisterPage.css';
import InputMask from 'react-input-mask';

const apiUrl = process.env.REACT_APP_API_URL;
const siteKey = process.env.REACT_APP_RECAPTCHA_SITE_KEY;

const RegisterPage = () => {
    const [username, setUsername] = useState('');
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [captchaValue, setCaptchaValue] = useState(null);
    const [smsCode, setSmsCode] = useState('');
    const [isSmsSent, setIsSmsSent] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isAgreementChecked, setIsAgreementChecked] = useState(false);
    const navigate = useNavigate();

    const handleCaptchaChange = (value) => setCaptchaValue(value);
    const handleOpenModal = () => setIsModalOpen(true);
    const handleCloseModal = () => setIsModalOpen(false);
    const handleCheckboxChange = () => setIsAgreementChecked(!isAgreementChecked);

    const sendSmsCode = async () => {
        try {
            await axios.post(`${apiUrl}/api/auth/send-sms`, { phone });
            setIsSmsSent(true);
            alert("Код подтверждения отправлен на ваш номер");
        } catch (err) {
            setError("Ошибка отправки SMS");
        }
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        if (!isAgreementChecked) {
            alert('Пожалуйста, примите пользовательское соглашение');
            return;
        }
        try {
            const response = await axios.post(`${apiUrl}/api/auth/register`, {
                username,
                phone,
                password,
                smsCode,
                captchaToken: captchaValue
            });
            const { token } = response.data;
            localStorage.setItem('authToken', token);
            alert('Пользователь успешно создан');
            navigate('/profile');
        } catch (err) {
            setError(err.response?.data?.message || 'Ошибка регистрации');
        }
    };

    return (
        <div className="register-container">
            <div className="form-container">
                <h1 className="title">Регистрация</h1>
                {error && <p className="error">{error}</p>}
                <form onSubmit={handleRegister} className="form">
                    <div className="input-group">
                        <label htmlFor="username">Имя пользователя:</label>
                        <input
                            id="username"
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                        />
                    </div>
                    <div className="input-group">
                        <label htmlFor="phone">Телефон:</label>
                        <InputMask
                            mask="+7 (999) 999-99-99"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                        >
                            {(inputProps) => (
                                <input
                                    {...inputProps}
                                    id="phone"
                                    type="tel"
                                    required
                                />
                            )}
                        </InputMask>

                    </div>
                    <div className="input-group">
                        <label htmlFor="password">Пароль:</label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                        />
                    </div>

                    <ReCAPTCHA sitekey={siteKey} onChange={handleCaptchaChange} />

                    <div className="agreement">
                        <input
                            type="checkbox"
                            checked={isAgreementChecked}
                            onChange={handleCheckboxChange}
                        />
                        <span>
                            Я согласен с{' '}
                            <button type="button" className="link-button" onClick={handleOpenModal}>
                                пользовательским соглашением
                            </button>
                        </span>
                    </div>

                    {!isSmsSent ? (
                        <button type="button" onClick={sendSmsCode} disabled={!captchaValue}>
                            Получить код
                        </button>
                    ) : (
                        <>
                            <input
                                type="text"
                                placeholder="Код из SMS"
                                value={smsCode}
                                onChange={(e) => setSmsCode(e.target.value)}
                                required
                            />
                            <button type="submit" disabled={!captchaValue}>
                                Зарегистрироваться
                            </button>
                        </>
                    )}
                </form>

                {isModalOpen && (
                    <div className="modal-overlay" onClick={handleCloseModal}>
                        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                            <div className="terms-content">
                                <h3>1. Общие положения</h3>
                                <p>1.1. CargoCamp – это платформа, объединяющая заказчиков и исполнителей для поиска и выполнения грузоперевозок, доставки и других услуг.</p>
                                <p>1.2. Администрация предоставляет техническую возможность взаимодействия, но не является стороной сделок.</p>
                            </div>
                            <button onClick={handleCloseModal}>Закрыть</button>
                        </div>
                    </div>
                )}

                <p className="login-text">
                    Уже есть аккаунт?{' '}
                    <span className="login-link" onClick={() => navigate('/login')}>
                        Войти
                    </span>
                </p>
            </div>
        </div>
    );
};

export default RegisterPage;
