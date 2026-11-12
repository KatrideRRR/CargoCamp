import React, { useEffect, useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import ReCAPTCHA from "react-google-recaptcha";
import "../styles/RegisterPage.css";
import "../styles/RegisterPageDark.css";
import InputMask from "react-input-mask";
import { useAuth } from "../utils/authContext";
import { useUser } from "../utils/userContext";
import {postUserAuth, getJwtUser,} from "../utils/userSession";
import PublicOffer from "../components/PublicOffer";

const apiUrl = process.env.REACT_APP_API_URL;
const siteKey = process.env.REACT_APP_RECAPTCHA_SITE_KEY;

const RegisterPage = () => {
    const [username, setUsername] = useState("");
    const [phone, setPhone] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [captchaValue, setCaptchaValue] = useState(null);
    const [smsCode, setSmsCode] = useState("");
    const [isSmsSent, setIsSmsSent] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isAgreementChecked, setIsAgreementChecked] = useState(false);
    const [smsCooldown, setSmsCooldown] = useState(0);
    const [smsLoading, setSmsLoading] = useState(false);

    const navigate = useNavigate();

    const { login } = useAuth();
    const { setCurrentUser } = useUser();

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

    useEffect(() => {
        if (smsCooldown <= 0) return;

        const timer = setInterval(() => {
            setSmsCooldown((prev) => Math.max(0, prev - 1));
        }, 1000);

        return () => clearInterval(timer);
    }, [smsCooldown]);

    const handleCaptchaChange = (value) => setCaptchaValue(value);
    const handleOpenModal = () => setIsModalOpen(true);
    const handleCloseModal = () => setIsModalOpen(false);
    const handleCheckboxChange = () => setIsAgreementChecked(!isAgreementChecked);

    const sendSmsCode = async () => {
        if (smsLoading || smsCooldown > 0) return;

        setError("");
        setMessage("");

        if (!phone || phone.replace(/\D/g, "").length < 11) {
            setError("Введите корректный номер телефона");
            return;
        }

        if (!captchaValue) {
            setError("Подтвердите reCAPTCHA");
            return;
        }

        try {
            setSmsLoading(true);

            const res = await axios.post(`${apiUrl}/api/auth/send-sms`, {
                phone,
                captchaToken: captchaValue,
                purpose: "register",
            });

            setIsSmsSent(true);
            setSmsCooldown(Number(res.data?.cooldownSec || 60));

            setMessage("Код подтверждения отправлен на ваш номер");
        } catch (err) {
            console.error("Ошибка отправки SMS:", err);

            const waitSec = Number(err.response?.data?.waitSec || 0);
            if (waitSec > 0) {
                setSmsCooldown(waitSec);
            }

            setError(
                err.response?.data?.message ||
                err.response?.data?.error ||
                "Ошибка отправки SMS"
            );
        } finally {
            setSmsLoading(false);
        }
    };

    const handleRegister = async (e) => {
        e.preventDefault();

        if (!isAgreementChecked) {
            setMessage("");
            setError("Пожалуйста, примите публичную оферту");
            return;
        }

        try {
            const sessionData = await postUserAuth(
                "register",
                {
                    username,
                    phone,
                    password,
                    smsCode,
                }
            );

            await login(sessionData);

            const tokenUser = getJwtUser(
                sessionData.token
            );

            setCurrentUser({
                id: tokenUser?.id,
                username,
                phone,
                role: tokenUser?.role || "user",
            });


            navigate("/profile", {
                replace: true,
            });
        } catch (err) {
            console.error("Ошибка регистрации:", err.response?.data || err);

            setError(
                err.response?.data?.message ||
                err.response?.data?.error ||
                "Ошибка регистрации"
            );
        }
    };

    return (
        <div className={`register-page auth-page auth-page--${platform}`}>
            <div className="auth-bg auth-bg--one" />
            <div className="auth-bg auth-bg--two" />
            <div className="register-shell">
                <div className="register-card glass">
                    <div className="register-head">
                        <h1 className="register-title">Регистрация</h1>
                        <p className="register-subtitle">Создайте аккаунт за минуту</p>
                    </div>

                    {error && (
                        <div className="register-error" role="alert">
                            {error}
                        </div>
                    )}

                    {message && (
                        <div className="register-success" role="status">
                            {message}
                        </div>
                    )}

                    <form onSubmit={handleRegister} className="register-form">

                        <div className="field">
                            <label htmlFor="username" className="cc-sr-only">
                                Имя пользователя
                            </label>
                            <input
                                id="username"
                                type="text"
                                autoComplete="username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                required
                                className="input"
                                placeholder="Имя пользователя"
                            />
                        </div>



                        <div className="field">
                            <label htmlFor="phone" className="cc-sr-only">
                                Номер телефона
                            </label>

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
                                        inputMode="tel"
                                        autoComplete="tel"
                                        required
                                        className="input"
                                        placeholder="+7 (___) ___-__-__"
                                    />
                                )}
                            </InputMask>
                        </div>



                        <div className="field">
                            <label htmlFor="password" className="cc-sr-only">
                                Пароль
                            </label>
                            <input
                                id="password"
                                type="password"
                                autoComplete="new-password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className="input"
                                placeholder="Придумайте пароль"
                            />
                        </div>


                        <div className="captchaWrap">
                            <ReCAPTCHA sitekey={siteKey} onChange={handleCaptchaChange} />
                        </div>

                        <div className="agreement glass-soft">
                            <input
                                type="checkbox"
                                checked={isAgreementChecked}
                                onChange={handleCheckboxChange}
                                className="checkbox"
                            />
                            <span className="agreementText">
    Я принимаю{" "}
                                <button type="button" className="linkButton" onClick={handleOpenModal}>
      публичную оферту
    </button>
                                {" "}и даю согласие на обработку персональных данных согласно{" "}
                                <span
                                    className="linkButton"
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => navigate("/info")}
                                    onKeyDown={(e) => e.key === "Enter" && navigate("/info")}
                                >
      Политике конфиденциальности
    </span>
  </span>
                        </div>

                        {!isSmsSent ? (
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={sendSmsCode}
                                disabled={!captchaValue || smsLoading || smsCooldown > 0}
                                title={!captchaValue ? "Подтвердите reCAPTCHA" : ""}
                            >
                                {smsLoading
                                    ? "Отправляем..."
                                    : smsCooldown > 0
                                        ? `Повторно через ${smsCooldown} сек.`
                                        : "Получить код"}
                            </button>
                        ) : (
                            <>

                                <div className="field">
                                    <label htmlFor="register-sms-code" className="cc-sr-only">
                                        Код из SMS
                                    </label>
                                    <input
                                        id="register-sms-code"
                                        type="text"
                                        inputMode="numeric"
                                        autoComplete="one-time-code"
                                        value={smsCode}
                                        onChange={(e) => setSmsCode(e.target.value)}
                                        required
                                        className="input"
                                        placeholder="Введите код"
                                    />
                                </div>


                                <div className="smsActions">
                                    <button
                                        type="button"
                                        className="btn btn-ghost"
                                        onClick={sendSmsCode}
                                        disabled={!captchaValue || smsLoading || smsCooldown > 0}
                                    >
                                        {smsLoading
                                            ? "Отправляем..."
                                            : smsCooldown > 0
                                                ? `Отправить ещё раз через ${smsCooldown} сек.`
                                                : "Отправить код ещё раз"}
                                    </button>

                                    <button
                                        type="submit"
                                        className="btn btn-primary"
                                        disabled={!captchaValue || !smsCode.trim()}
                                    >
                                        Зарегистрироваться
                                    </button>
                                </div>

                                <div className="register-hint">
                                    Если номер указан неверно, исправьте его выше и нажмите «Отправить код ещё раз».
                                </div>
                            </>
                        )}
                    </form>

                    <div className="register-foot">
                        <p className="loginText">
                            Уже есть аккаунт?{" "}
                            <span className="loginLink" onClick={() => navigate("/login")}>
                Войти
              </span>
                        </p>
                    </div>
                </div>
            </div>

            {isModalOpen && (
                <div className="modal-overlay-agreement" onClick={handleCloseModal}>
                    <div className="modal-content-agreement" onClick={(e) => e.stopPropagation()}>
                        <div className="terms-content">
                            <PublicOffer />
                        </div>

                        <button className="btn btn-ghost" onClick={handleCloseModal}>
                            Закрыть
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default RegisterPage;