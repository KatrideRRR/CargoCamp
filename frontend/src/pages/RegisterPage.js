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
        <div className="register">
            <div className="pageContainer-register">
                <div className="container-r">
                    <div className="contentWrapper">
                        <div className="register-container">
                            <div className="formContainer">
                                <h1 className="title">Регистрация</h1>
                                {error && <p className="error">{error}</p>}

                                <form onSubmit={handleRegister} className="form">
                                    <div className="inputGroup">
                                        <label htmlFor="username" className="label">Имя пользователя:</label>
                                        <input
                                            id="username"
                                            type="text"
                                            value={username}
                                            onChange={(e) => setUsername(e.target.value)}
                                            required
                                            className="input"
                                        />
                                    </div>

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

                                    <ReCAPTCHA sitekey={siteKey} onChange={handleCaptchaChange} />

                                    <div className="agreement">
                                        <input
                                            type="checkbox"
                                            checked={isAgreementChecked}
                                            onChange={handleCheckboxChange}
                                            className="checkbox"
                                        />
                                        <span>
                                        Я согласен с{" "}
                                            <button type="button" className="link-button" onClick={handleOpenModal}>
                                            пользовательским соглашением
                                        </button>
                                    </span>
                                    </div>

                                    {!isSmsSent ? (
                                        <button type="button" className="button" onClick={sendSmsCode} disabled={!captchaValue}>
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
                                                className="input"
                                            />
                                            <button type="submit" className="button" disabled={!captchaValue}>
                                                Зарегистрироваться
                                            </button>
                                        </>
                                    )}
                                </form>



                                <p className="loginText">
                                    Уже есть аккаунт?{" "}
                                    <span className="loginLink" onClick={() => navigate("/login")}>
                                    Войти
                                </span>
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            {isModalOpen && (
                <div className="modal-overlay-agreement" onClick={handleCloseModal}>
                    <div className="modal-content-agreement" onClick={(e) => e.stopPropagation()}>
                        <div className="terms-content">
                            <h3>1. Общие положения</h3>
                            <p>1.1. Платформа CargoCamp предоставляет сервис для взаимодействия
                                между заказчиками и исполнителями различных услуг.</p>
                            <p>1.2. Регистрируясь, пользователь подтверждает, что ознакомлен с
                                условиями и принимает их в полном объёме без каких-либо
                                оговорок.</p>

                            <h3>2. Регистрация и использование аккаунта</h3>
                            <p>2.1. Пользователь обязуется предоставлять достоверную информацию при
                                регистрации.</p>
                            <p>2.2. Администрация имеет право ограничить доступ, временно
                                заблокировать или удалить аккаунт в случае нарушений условий или
                                подозрений на мошеннические действия.</p>
                            <p>2.3. Пользователь несет ответственность за безопасность своих данных
                                для входа и действия, совершённые с его аккаунта.</p>

                            <h3>3. Услуги и ответственность</h3>
                            <p>3.1. CargoCamp не является стороной в отношениях между заказчиком и
                                исполнителем, а лишь предоставляет инфраструктуру для их
                                взаимодействия.</p>
                            <p>3.2. Платформа не несёт ответственности за качество, сроки или другие
                                характеристики оказываемых услуг.</p>
                            <p>3.3. Пользователь обязуется не использовать платформу для незаконной
                                деятельности, распространения запрещённой информации или
                                мошенничества.</p>

                            <h3>4. Финансовые операции</h3>
                            <p>4.1. Пользователь соглашается с тем, что определённые операции могут
                                сопровождаться комиссией, описанной в отдельном соглашении о
                                списании средств.</p>
                            <p>4.2. При использовании платёжных функций пользователь даёт согласие
                                на автоматическое списание средств, если это предусмотрено сценарием
                                работы платформы.</p>

                            <h3>5. Персональные данные</h3>
                            <p>5.1. Регистрируясь, пользователь даёт согласие на обработку своих
                                персональных данных согласно Политике конфиденциальности.</p>
                            <p>5.2. Платформа использует технические и организационные меры защиты
                                данных, однако не несёт ответственности за действия третьих лиц,
                                получивших к ним доступ незаконным способом.</p>

                            <h3>6. Изменения условий</h3>
                            <p>6.1. Администрация платформы имеет право вносить изменения в
                                соглашение без предварительного уведомления. Новая редакция вступает
                                в силу с момента её публикации на сайте.</p>

                            <h3>7. Заключительные положения</h3>
                            <p>7.1. Настоящее соглашение регулируется законодательством Российской
                                Федерации.</p>
                            <p>7.2. В случае возникновения споров, стороны обязуются решить их путём
                                переговоров. При невозможности урегулирования спора он подлежит
                                рассмотрению в судебном порядке по месту регистрации владельца
                                платформы.</p>
                            <h3>8. Автоматическое заключение договора</h3>
                            <p>8.1. В случае, если Исполнитель направляет Заказчику запрос на выполнение заказа
                                через платформу CargoCamp, а Заказчик одобряет данный запрос,
                                между Заказчиком и Исполнителем автоматически заключается
                                договор возмездного оказания услуг на условиях, изложенных в описании соответствующего
                                заказа,
                                включая сроки, стоимость, объем и другие существенные условия.</p>
                            <p>8.2. Факт отправки Исполнителем запроса и последующее одобрение Заказчиком являются
                                юридически значимыми действиями, свидетельствующими о волеизъявлении обеих сторон и
                                замещающими подписание договора в письменной форме.</p>
                            <p>8.3. Такой договор считается заключённым и подписанным обеими сторонами в момент
                                одобрения запроса Заказчиком. Электронные действия пользователей в личном кабинете
                                платформы признаются аналогом собственноручной подписи в соответствии с
                                действующим законодательством.</p>
                            <p>8.4. Платформа CargoCamp не является стороной указанного договора,
                                а лишь предоставляет техническую возможность для его заключения и исполнения.
                                Все обязательства по договору возникают исключительно между Заказчиком и Исполнителем.</p>
                            <p><strong>Нажимая кнопку "Зарегистрироваться", вы подтверждаете, что
                                ознакомлены с условиями настоящего Соглашения и полностью их
                                принимаете.</strong></p>
                        </div>

                        <button className="button" onClick={handleCloseModal}>Закрыть</button>
                    </div>
                </div>
            )}
        </div>
    );

};

export default RegisterPage;
