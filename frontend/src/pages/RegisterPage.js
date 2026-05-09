import React, { useEffect, useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import ReCAPTCHA from "react-google-recaptcha";
import "../styles/RegisterPage.css";
import InputMask from "react-input-mask";

const apiUrl = process.env.REACT_APP_API_URL;
const siteKey = process.env.REACT_APP_RECAPTCHA_SITE_KEY;

const RegisterPage = () => {
    const [username, setUsername] = useState("");
    const [phone, setPhone] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [captchaValue, setCaptchaValue] = useState(null);
    const [smsCode, setSmsCode] = useState("");
    const [isSmsSent, setIsSmsSent] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isAgreementChecked, setIsAgreementChecked] = useState(false);
    const [smsCooldown, setSmsCooldown] = useState(0);
    const [smsLoading, setSmsLoading] = useState(false);

    const navigate = useNavigate();

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

            alert("Код подтверждения отправлен на ваш номер");
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
            alert("Пожалуйста, примите пользовательское соглашение");
            return;
        }

        try {
            const response = await axios.post(`${apiUrl}/api/auth/register`, {
                username,
                phone,
                password,
                smsCode,
            });

            const { token } = response.data;
            localStorage.setItem("authToken", token);
            alert("Пользователь успешно создан");
            navigate("/profile");
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

                    {error && <div className="register-error">{error}</div>}

                    <form onSubmit={handleRegister} className="register-form">
                        <div className="field">
                            <label htmlFor="username" className="label">
                                Имя пользователя
                            </label>
                            <input
                                id="username"
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                required
                                className="input"
                                placeholder="Например: Akim"
                            />
                        </div>

                        <div className="field">
                            <label htmlFor="phone" className="label">
                                Телефон
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
                                        required
                                        className="input"
                                        placeholder="+7 (___) ___-__-__"
                                    />
                                )}
                            </InputMask>
                        </div>

                        <div className="field">
                            <label htmlFor="password" className="label">
                                Пароль
                            </label>
                            <input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                className="input"
                                placeholder="Минимум 6–8 символов"
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
      пользовательское соглашение
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
                            {/* ТВОЙ ТЕКСТ Соглашения — без изменений */}
                            <h3>1. Общие положения</h3>
                            <p>
                                1.1. Платформа CargoCamp предоставляет сервис для взаимодействия между заказчиками и
                                исполнителями различных услуг.
                            </p>
                            <p>
                                1.2. Регистрируясь, пользователь подтверждает, что ознакомлен с условиями и принимает их
                                в полном объёме без каких-либо оговорок.
                            </p>

                            <h3>2. Регистрация и использование аккаунта</h3>
                            <p>2.1. Пользователь обязуется предоставлять достоверную информацию при регистрации.</p>
                            <p>
                                2.2. Администрация имеет право ограничить доступ, временно заблокировать или удалить
                                аккаунт в случае нарушений условий или подозрений на мошеннические действия.
                            </p>
                            <p>
                                2.3. Пользователь несет ответственность за безопасность своих данных для входа и
                                действия, совершённые с его аккаунта.
                            </p>

                            <h3>3. Услуги и ответственность</h3>
                            <p>
                                3.1. CargoCamp не является стороной в отношениях между заказчиком и исполнителем, а лишь
                                предоставляет инфраструктуру для их взаимодействия.
                            </p>
                            <p>
                                3.2. Платформа не несёт ответственности за качество, сроки или другие характеристики
                                оказываемых услуг.
                            </p>
                            <p>
                                3.3. Пользователь обязуется не использовать платформу для незаконной деятельности,
                                распространения запрещённой информации или мошенничества.
                            </p>

                            <h3>4. Финансовые операции</h3>
                            <p>
                                4.1. Пользователь соглашается с тем, что определённые операции могут сопровождаться
                                комиссией, описанной в отдельном соглашении о списании средств.
                            </p>
                            <p>
                                4.2. При использовании платёжных функций пользователь даёт согласие на автоматическое
                                списание средств, если это предусмотрено сценарием работы платформы.
                            </p>

                            <h3>5. Персональные данные</h3>
                            <p>
                                5.1. Регистрируясь, пользователь даёт согласие на обработку своих персональных данных
                                согласно Политике конфиденциальности.
                            </p>
                            <p>
                                5.2. Платформа использует технические и организационные меры защиты данных, однако не
                                несёт ответственности за действия третьих лиц, получивших к ним доступ незаконным
                                способом.
                            </p>

                            <h3>6. Изменения условий</h3>
                            <p>
                                6.1. Администрация платформы имеет право вносить изменения в соглашение без
                                предварительного уведомления. Новая редакция вступает в силу с момента её публикации на
                                сайте.
                            </p>

                            <h3>7. Заключительные положения</h3>
                            <p>7.1. Настоящее соглашение регулируется законодательством Российской Федерации.</p>
                            <p>
                                7.2. В случае возникновения споров, стороны обязуются решить их путём переговоров. При
                                невозможности урегулирования спора он подлежит рассмотрению в судебном порядке по месту
                                регистрации владельца платформы.
                            </p>

                            <h3>8. Автоматическое заключение договора</h3>
                            <p>
                                8.1. В случае, если Исполнитель направляет Заказчику запрос на выполнение заказа через
                                платформу CargoCamp, а Заказчик одобряет данный запрос, между Заказчиком и Исполнителем
                                автоматически заключается договор возмездного оказания услуг на условиях, изложенных в
                                описании соответствующего заказа.
                            </p>
                            <p>
                                8.2. Факт отправки Исполнителем запроса и последующее одобрение Заказчиком являются
                                юридически значимыми действиями, свидетельствующими о волеизъявлении обеих сторон и
                                замещающими подписание договора в письменной форме.
                            </p>
                            <p>
                                8.3. Такой договор считается заключённым и подписанным обеими сторонами в момент
                                одобрения запроса Заказчиком.
                            </p>
                            <p>
                                8.4. Платформа CargoCamp не является стороной указанного договора, а лишь предоставляет
                                техническую возможность для его заключения и исполнения.
                            </p>
                            <p>
                                <strong>
                                    Нажимая кнопку "Зарегистрироваться", вы подтверждаете, что ознакомлены с условиями
                                    настоящего Соглашения и полностью их принимаете.
                                </strong>
                            </p>
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