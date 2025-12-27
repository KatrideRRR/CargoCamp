import React, { useState } from "react";
import InputMask from "react-input-mask";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../utils/authContext";
import { useUser } from "../utils/userContext";
import "../styles/LoginPage.css";

const apiUrl = process.env.REACT_APP_API_URL;

const LoginPage = () => {
    const [phone, setPhone] = useState("");
    const [mode, setMode] = useState(null); // "password" | "sms" | null
    const [password, setPassword] = useState("");
    const [smsCode, setSmsCode] = useState("");
    const [isSmsSent, setIsSmsSent] = useState(false);

    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    const navigate = useNavigate();
    const { login } = useAuth();
    const { setCurrentUser } = useUser();

    const finishLogin = (token, user) => {
        localStorage.setItem("authToken", token);
        login(token);
        setCurrentUser(user);

        if (user.role === "banned") {
            setError("Ваш аккаунт заблокирован.");
            localStorage.removeItem("authToken");
            return;
        }

        navigate("/profile");
    };

    const handleLoginPassword = async (e) => {
        e.preventDefault();
        setError("");
        setMessage("");

        try {
            const response = await axios.post(`${apiUrl}/api/auth/login`, { phone, password });
            const { token, user } = response.data;
            finishLogin(token, user);
        } catch (err) {
            setError(err.response?.data?.message || "Ошибка авторизации");
        }
    };

    const sendSmsCode = async () => {
        setError("");
        setMessage("");

        try {
            await axios.post(`${apiUrl}/api/auth/send-sms`, { phone });
            setIsSmsSent(true);
            setMessage("Код отправлен на ваш номер");
        } catch (err) {
            setError(err.response?.data?.message || "Ошибка отправки SMS");
        }
    };

    const handleLoginSms = async (e) => {
        e.preventDefault();
        setError("");
        setMessage("");

        try {
            const response = await axios.post(`${apiUrl}/api/auth/login-sms`, { phone, smsCode });
            const { token, user } = response.data;
            finishLogin(token, user);
        } catch (err) {
            setError(err.response?.data?.message || "Ошибка входа по SMS");
        }
    };

    const handleRecoverPassword = async () => {
        setError("");
        setMessage("");

        try {
            const response = await axios.post(`${apiUrl}/api/auth/recover-password`, { phone });
            setMessage(response.data.message);
        } catch (err) {
            setError(err.response?.data?.message || "Ошибка восстановления пароля");
        }
    };

    const switchMode = (nextMode) => {
        setMode(nextMode);
        setError("");
        setMessage("");
        setPassword("");
        setSmsCode("");
        setIsSmsSent(false);
    };

    return (
        <div className="login-page">
            <div className="login-shell">
                <div className="login-card glass">
                    <div className="login-head">
                        <h1 className="login-title">Войти</h1>
                        <p className="login-subtitle">Выберите способ входа</p>
                    </div>

                    {error && <div className="login-error">{error}</div>}
                    {message && <div className="login-success">{message}</div>}

                    <div className="login-form">
                        <div className="field">
                            <label htmlFor="phone" className="label">Телефон</label>
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
                                        className="input"
                                        placeholder="+7 (___) ___-__-__"
                                    />
                                )}
                            </InputMask>
                        </div>

                        <div className="modeRow">
                            <button
                                type="button"
                                className={`btn btn-seg ${mode === "password" ? "btn-seg-active" : ""}`}
                                onClick={() => switchMode("password")}
                            >
                                Войти по паролю
                            </button>

                            <button
                                type="button"
                                className={`btn btn-seg ${mode === "sms" ? "btn-seg-active" : ""}`}
                                onClick={() => switchMode("sms")}
                            >
                                Войти по SMS
                            </button>
                        </div>

                        {mode === "password" && (
                            <form onSubmit={handleLoginPassword} className="innerForm">
                                <div className="field">
                                    <label htmlFor="password" className="label">Пароль</label>
                                    <input
                                        id="password"
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        className="input"
                                        placeholder="Введите пароль"
                                    />
                                </div>

                                <button type="button" className="linkButton" onClick={handleRecoverPassword}>
                                    Забыли пароль?
                                </button>

                                <button type="submit" className="btn btn-primary">
                                    Войти
                                </button>
                            </form>
                        )}

                        {mode === "sms" && (
                            <form onSubmit={handleLoginSms} className="innerForm">
                                {!isSmsSent ? (
                                    <button type="button" className="btn btn-primary" onClick={sendSmsCode}>
                                        Получить код
                                    </button>
                                ) : (
                                    <>
                                        <div className="field">
                                            <label className="label">Код из SMS</label>
                                            <input
                                                type="text"
                                                value={smsCode}
                                                onChange={(e) => setSmsCode(e.target.value)}
                                                required
                                                className="input"
                                                placeholder="Введите код"
                                            />
                                        </div>

                                        <div className="smsActions">
                                            <button type="button" className="btn btn-ghost" onClick={sendSmsCode}>
                                                Отправить ещё раз
                                            </button>
                                            <button type="submit" className="btn btn-primary">
                                                Войти
                                            </button>
                                        </div>
                                    </>
                                )}
                            </form>
                        )}

                        <div className="login-foot">
                            <p className="registerText">
                                Нет аккаунта?{" "}
                                <span onClick={() => navigate("/register")} className="registerLink">
                  Зарегистрироваться
                </span>
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;