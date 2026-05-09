import React, { useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import InputMask from "react-input-mask";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../utils/authContext";
import { useUser } from "../utils/userContext";
import "../styles/LoginPage.css";

const apiUrl = process.env.REACT_APP_API_URL;

// маленький хелпер: удобнее и для фронта (не обязательно, но полезно)
const normalizePhoneClient = (raw) => String(raw || "").replace(/\D/g, "");

const LoginPage = () => {
    const [phone, setPhone] = useState("");
    const [mode, setMode] = useState(null); // "password" | "sms" | "reset" | null

    // login by password
    const [password, setPassword] = useState("");

    // login by sms
    const [smsCode, setSmsCode] = useState("");
    const [isSmsSent, setIsSmsSent] = useState(false);

    // reset password
    const [resetCode, setResetCode] = useState("");
    const [resetSent, setResetSent] = useState(false);
    const [newPassword, setNewPassword] = useState("");
    const [newPassword2, setNewPassword2] = useState("");

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    const navigate = useNavigate();
    const { login } = useAuth();
    const { setCurrentUser } = useUser();

    const phoneDigits = useMemo(() => normalizePhoneClient(phone), [phone]);

    const platform = useMemo(() => {
        const params = new URLSearchParams(window.location.search);
        const forcedPlatform = params.get("platform");

        if (forcedPlatform === "ios") return "ios";
        if (forcedPlatform === "android") return "android";
        if (forcedPlatform === "web") return "web";

        const currentPlatform = Capacitor.getPlatform();

        if (currentPlatform === "ios") return "ios";
        if (currentPlatform === "android") return "android";

        return "web";
    }, []);

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

    const guardPhone = () => {
        if (!phoneDigits || phoneDigits.length < 11) {
            setError("Введите корректный номер телефона");
            return false;
        }
        return true;
    };

    const handleLoginPassword = async (e) => {
        e.preventDefault();
        if (busy) return;

        setError("");
        setMessage("");

        if (!guardPhone()) return;
        if (!password) return setError("Введите пароль");

        setBusy(true);
        try {
            // можно отправлять phone как digits, сервер всё равно нормализует
            const response = await axios.post(`${apiUrl}/api/auth/login`, { phone: phoneDigits, password });
            const { token, user } = response.data;
            finishLogin(token, user);
        } catch (err) {
            setError(err.response?.data?.message || "Ошибка авторизации");
        } finally {
            setBusy(false);
        }
    };

    const sendSmsCode = async () => {
        if (busy) return;

        setError("");
        setMessage("");

        if (!guardPhone()) return;

        setBusy(true);
        try {
            await axios.post(`${apiUrl}/api/auth/send-sms`, {
                phone: phoneDigits,
                purpose: "login",
            });
            setIsSmsSent(true);
            setMessage("Код отправлен на ваш номер");
        } catch (err) {
            setError(err.response?.data?.message || "Ошибка отправки SMS");
        } finally {
            setBusy(false);
        }
    };

    const handleLoginSms = async (e) => {
        e.preventDefault();
        if (busy) return;

        setError("");
        setMessage("");

        if (!guardPhone()) return;
        if (!smsCode.trim()) return setError("Введите код из SMS");

        setBusy(true);
        try {
            const response = await axios.post(`${apiUrl}/api/auth/login-sms`, {
                phone: phoneDigits,
                smsCode: smsCode.trim(),
            });
            const { token, user } = response.data;
            finishLogin(token, user);
        } catch (err) {
            setError(err.response?.data?.message || "Ошибка входа по SMS");
        } finally {
            setBusy(false);
        }
    };

    // --- RESET PASSWORD FLOW ---

    const sendResetCode = async () => {
        if (busy) return;

        setError("");
        setMessage("");

        if (!guardPhone()) return;

        setBusy(true);
        try {
            // можно тот же /send-sms, но на бэке желательно другой текст сообщения (не критично)
            await axios.post(`${apiUrl}/api/auth/send-sms`, {
                phone: phoneDigits,
                purpose: "password_reset",
            });
            setResetSent(true);
            setMessage("Код для сброса отправлен на ваш номер");
        } catch (err) {
            setError(err.response?.data?.message || "Ошибка отправки SMS");
        } finally {
            setBusy(false);
        }
    };

    const confirmResetPassword = async (e) => {
        e.preventDefault();
        if (busy) return;

        setError("");
        setMessage("");

        if (!guardPhone()) return;

        const c = resetCode.trim();
        if (!c) return setError("Введите код из SMS");

        if (!newPassword || newPassword.length < 6) {
            return setError("Пароль должен быть минимум 6 символов");
        }
        if (newPassword !== newPassword2) {
            return setError("Пароли не совпадают");
        }

        setBusy(true);
        try {
            const r = await axios.post(`${apiUrl}/api/auth/password-reset/confirm`, {
                phone: phoneDigits,
                smsCode: c,
                newPassword,
            });

            setMessage(r.data?.message || "Пароль изменён. Теперь войдите.");

            // после успешной смены пароля — переводим на вход по паролю
            setMode("password");
            setPassword("");
            setResetCode("");
            setNewPassword("");
            setNewPassword2("");
            setResetSent(false);
        } catch (err) {
            setError(err.response?.data?.message || "Ошибка смены пароля");
        } finally {
            setBusy(false);
        }
    };

    const switchMode = (nextMode) => {
        setMode(nextMode);
        setError("");
        setMessage("");

        // сбрасываем все поля, чтобы не путались состояния
        setPassword("");
        setSmsCode("");
        setIsSmsSent(false);

        setResetCode("");
        setResetSent(false);
        setNewPassword("");
        setNewPassword2("");
    };

    return (
        <div className={`login-page auth-page auth-page--${platform}`}>
            <div className="auth-bg auth-bg--one" />
            <div className="auth-bg auth-bg--two" />
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

                            <button
                                type="button"
                                className={`btn btn-seg ${mode === "reset" ? "btn-seg-active" : ""}`}
                                onClick={() => switchMode("reset")}
                            >
                                Сброс пароля
                            </button>
                        </div>

                        {/* ---- LOGIN: PASSWORD ---- */}
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

                                {/* Кнопка теперь переводит в режим "reset", а не делает генерацию пароля */}
                                <button type="button" className="linkButton" onClick={() => switchMode("reset")}>
                                    Забыли пароль?
                                </button>

                                <button type="submit" className="btn btn-primary" disabled={busy}>
                                    {busy ? "Входим..." : "Войти"}
                                </button>
                            </form>
                        )}

                        {/* ---- LOGIN: SMS ---- */}
                        {mode === "sms" && (
                            <form onSubmit={handleLoginSms} className="innerForm">
                                {!isSmsSent ? (
                                    <button type="button" className="btn btn-primary" onClick={sendSmsCode} disabled={busy}>
                                        {busy ? "Отправляем..." : "Получить код"}
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
                                            <button type="button" className="btn btn-ghost" onClick={sendSmsCode} disabled={busy}>
                                                Отправить ещё раз
                                            </button>
                                            <button type="submit" className="btn btn-primary" disabled={busy}>
                                                {busy ? "Проверяем..." : "Войти"}
                                            </button>
                                        </div>
                                    </>
                                )}
                            </form>
                        )}

                        {/* ---- RESET PASSWORD ---- */}
                        {mode === "reset" && (
                            <form onSubmit={confirmResetPassword} className="innerForm">
                                {!resetSent ? (
                                    <>
                                        <div className="hintText">
                                            Мы отправим код по SMS. После этого вы сможете задать новый пароль.
                                        </div>
                                        <button type="button" className="btn btn-primary" onClick={sendResetCode} disabled={busy}>
                                            {busy ? "Отправляем..." : "Получить код"}
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <div className="field">
                                            <label className="label">Код из SMS</label>
                                            <input
                                                type="text"
                                                value={resetCode}
                                                onChange={(e) => setResetCode(e.target.value)}
                                                required
                                                className="input"
                                                placeholder="Введите код"
                                            />
                                        </div>

                                        <div className="field">
                                            <label className="label">Новый пароль</label>
                                            <input
                                                type="password"
                                                value={newPassword}
                                                onChange={(e) => setNewPassword(e.target.value)}
                                                required
                                                className="input"
                                                placeholder="Минимум 6 символов"
                                            />
                                        </div>

                                        <div className="field">
                                            <label className="label">Повторите пароль</label>
                                            <input
                                                type="password"
                                                value={newPassword2}
                                                onChange={(e) => setNewPassword2(e.target.value)}
                                                required
                                                className="input"
                                                placeholder="Повторите пароль"
                                            />
                                        </div>

                                        <div className="smsActions">
                                            <button type="button" className="btn btn-ghost" onClick={sendResetCode} disabled={busy}>
                                                Отправить код ещё раз
                                            </button>

                                            <button type="submit" className="btn btn-primary" disabled={busy}>
                                                {busy ? "Сохраняем..." : "Сменить пароль"}
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