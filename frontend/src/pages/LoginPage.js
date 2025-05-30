import React, { useState } from "react";
import InputMask from 'react-input-mask';
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../utils/authContext";
import { useUser } from "../utils/userContext";
import "../styles/LoginPage.css";
const apiUrl = process.env.REACT_APP_API_URL;

const LoginPage = () => {
    const [phone, setPhone] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const navigate = useNavigate();
    const { login } = useAuth();
    const { setCurrentUser } = useUser();
    const [message, setMessage] = useState("");

    const handleLogin = async (e) => {
        e.preventDefault();
        try {
            const response = await axios.post(`${apiUrl}/api/auth/login`, { phone, password });
            const { token, user } = response.data;
            localStorage.setItem("authToken", token);
            login(token);
            setCurrentUser(user);

            if (user.role === "banned") {
                setError("Ваш аккаунт заблокирован.");
                localStorage.removeItem("authToken");
                return;
            }

            navigate("/profile");
        } catch (err) {
            setError(err.response?.data?.message || "Ошибка авторизации");
        }
    };

    // Восстановление пароля через SMS
    const handleRecoverPassword = async () => {
        try {
            const response = await axios.post(`${apiUrl}/api/auth/recover-password`, { phone });
            setMessage(response.data.message);
        } catch (err) {
            setError(err.response?.data?.message || "Ошибка восстановления пароля");
        }
    };

    return (
        <div className="container">
            <div className="formContainer">
                <h1 className="title">Войти в аккаунт</h1>
                {error && <p className="error">{error}</p>}
                {message && <p className="error" style={{ color: "green" }}>{message}</p>}

                <form onSubmit={handleLogin} className="form">
                    <div className="inputGroup">
                        <label htmlFor="phone" className="label">Телефон:</label>
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

                                />
                            )}
                        </InputMask>

                    </div>

                    <div className="inputGroup">
                        <label htmlFor="password" className="label">Пароль:</label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            className="input"
                        />
                    </div>

                    {/* Кнопка "Забыли пароль?" */}
                    <button type="button" className="forgotPassword" onClick={handleRecoverPassword}>
                        Забыли пароль?
                    </button>

                    <button type="submit" className="button">Войти</button>
                </form>

                <p className="registerText">
                    Нет аккаунта?{" "}
                    <span onClick={() => navigate("/register")} className="registerLink">
                        Зарегистрироваться
                    </span>
                </p>
            </div>
        </div>
    );
};

export default LoginPage;
