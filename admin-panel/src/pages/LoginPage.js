import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { IMaskInput } from "react-imask";
import "../styles/LoginPage.css";

const apiUrl = process.env.REACT_APP_API_URL;

const normalizePhoneClient = (raw) => String(raw || "").replace(/\D/g, "");

function LoginPage() {
    const [phone, setPhone] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const navigate = useNavigate();

    const phoneDigits = useMemo(() => normalizePhoneClient(phone), [phone]);

    const handleLogin = async (e) => {
        e.preventDefault();
        setError("");

        if (phoneDigits.length < 11) {
            setError("Введите корректный номер телефона");
            return;
        }

        try {
            const response = await axios.post(`${apiUrl}/api/admin/login`, {
                phone: phoneDigits,
                password,
            });

            const { token, user } = response.data;

            localStorage.setItem("authToken", token);
            localStorage.setItem("userRole", user.role);

            navigate("/dashboard", { replace: true });
        } catch (err) {
            setError(err.response?.data?.message || "Неверный логин или пароль.");
        }
    };

    return (
        <div className="login-container">
            <div className="login-box">
                <h2>Вход для администратора</h2>
                {error && <p className="error-message">{error}</p>}

                <form onSubmit={handleLogin}>
                    <IMaskInput
                        mask="+{7} (000) 000-00-00"
                        value={phone}
                        onAccept={(value) => setPhone(value)}
                        placeholder="+7 (___) ___-__-__"
                        type="tel"
                        required
                        className="input"
                    />

                    <input
                        type="password"
                        placeholder="Пароль"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="input"
                    />

                    <button type="submit">Войти</button>
                </form>
            </div>
        </div>
    );
}

export default LoginPage;