import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import ReCAPTCHA from "react-google-recaptcha";
const apiUrl = process.env.REACT_APP_API_URL;

const RegisterPage = () => {
    const [username, setUsername] = useState('');
    const [phone, setPhone] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();
    const [captchaValue, setCaptchaValue] = useState(null);
    const [smsCode, setSmsCode] = useState("");
    const [isSmsSent, setIsSmsSent] = useState(false);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isAgreementChecked, setIsAgreementChecked] = useState(false);

    const handleCaptchaChange = (value) => {
        setCaptchaValue(value);
    };
    // Отправка SMS-кода
    const sendSmsCode = async () => {
        try {
            await axios.post(`${apiUrl}/api/auth/send-sms`, { phone });
            setIsSmsSent(true);
            alert("Код подтверждения отправлен на ваш номер");
        } catch (err) {
            setError("Ошибка отправки SMS");
        }
    };
    const handleOpenModal = () => setIsModalOpen(true);
    const handleCloseModal = () => setIsModalOpen(false);
    const handleCheckboxChange = () => setIsAgreementChecked(!isAgreementChecked);


    const handleRegister = async (e) => {
        e.preventDefault();
        if (!isAgreementChecked) {
            alert('Пожалуйста, примите пользовательское соглашение');
            return;
        }

        try {
            const response = await axios.post(`${apiUrl}/api/auth/register`, { username, phone, password, smsCode, captchaToken: captchaValue
            });
            const { token } = response.data;
            localStorage.setItem('authToken', token); // Сохраняем токен
            alert('Пользователь успешно создан');
            navigate('/profile'); // Перенаправление на профиль
        } catch (err) {
            console.error(err);
            setError(err.response?.data?.message || 'Ошибка регистрации');
        }
    };

    return (
        <div style={styles.container}>
            <div style={styles.formContainer}>
                <h1 style={styles.title}>Регистрация</h1>
                {error && <p style={styles.error}>{error}</p>}
                <form onSubmit={handleRegister} style={styles.form}>
                    <div style={styles.inputGroup}>
                        <label htmlFor="username" style={styles.label}>Имя пользователя:</label>
                        <input
                            id="username"
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            required
                            style={styles.input}
                        />
                    </div>
                    <div style={styles.inputGroup}>
                        <label htmlFor="phone" style={styles.label}>Телефон:</label>
                        <input
                            id="phone"
                            type="phone"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            required
                            style={styles.input}
                        />
                    </div>
                    <div style={styles.inputGroup}>
                        <label htmlFor="password" style={styles.label}>Пароль:</label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            required
                            style={styles.input}
                        />
                    </div>
                    <ReCAPTCHA
                        sitekey="6LeZUOAqAAAAAO8RbiFwH4WsUXxQgt9TUzeGrghl"
                        onChange={handleCaptchaChange}
                    />

                    <div>
                        <input
                            type="checkbox"
                            checked={isAgreementChecked}
                            onChange={handleCheckboxChange}
                        />
                        <span>
                        Я согласен с{' '}
                            <a href="#" onClick={handleOpenModal}>
                            пользовательским соглашением
                        </a>
                    </span>
                    </div>

                    {!isSmsSent ? (
                        <button type="button" onClick={sendSmsCode} disabled={!captchaValue}>Получить код</button>
                    ) : (
                        <>
                            <input type="text" placeholder="Код из SMS" value={smsCode}
                                   onChange={(e) => setSmsCode(e.target.value)} required/>

                            <button type="submit" disabled={!captchaValue} style={styles.button}>Зарегистрироваться
                            </button>
                        </>
                    )}
                </form>
                {/* Модальное окно с пользовательским соглашением */}
                {isModalOpen && (
                    <div className="modal-overlay" onClick={handleCloseModal}>
                        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                            <div className="terms-content">
                                <h3>1. Общие положения</h3>
                                <p>1.1. CargoCamp – это платформа, объединяющая заказчиков (далее – «Заказчики») и
                                    исполнителей (далее – «Исполнители») для поиска и выполнения грузоперевозок,
                                    доставки и других услуг.</p>
                                <p>1.2. Администрация Сервиса (далее – «Администрация») предоставляет техническую
                                    возможность взаимодействия между пользователями, но не является стороной сделок.</p>
                                <p>1.3. Пользователи обязуются соблюдать условия Соглашения, действующее
                                    законодательство и принципы добросовестности.</p>

                                <h3>2. Регистрация и учетная запись</h3>
                                <p>2.1. Для доступа к Сервису пользователь должен пройти регистрацию, указав достоверные
                                    данные.</p>
                                <p>2.2. Регистрация доступна только лицам, достигшим 18 лет.</p>
                                <p>2.3. Пользователь несет ответственность за сохранность своих учетных данных и
                                    действия, совершенные с его аккаунта.</p>
                                <p>2.4. Администрация вправе заблокировать или удалить аккаунт при нарушении условий
                                    Соглашения.</p>
                                <p>2.5. Администрация имеет право запрашивать у Исполнителей документы, подтверждающие
                                    личность и профессиональную квалификацию.</p>

                                <h3>3. Права и обязанности пользователей</h3>
                                <h4>3.1. Заказчики</h4>
                                <p>- Размещать заказы с достоверной информацией.</p>
                                <p>- Оплачивать выполненные заказы в соответствии с выбранным способом оплаты.</p>
                                <p>- Не отменять заказы без уважительной причины.</p>
                                <p>- Соблюдать условия сотрудничества с Исполнителями.</p>
                                <p>- Оставлять объективные отзывы о выполненных заказах.</p>

                                <h4>3.2. Исполнители</h4>
                                <p>- Предоставлять услуги качественно и в срок.</p>
                                <p>- Не изменять условия заказа без согласования с Заказчиком.</p>
                                <p>- Соблюдать правила платформы и законодательства.</p>
                                <p>- Верифицировать свою личность при необходимости.</p>
                                <p>- Выполнять заказы в соответствии с описанием и договоренностями.</p>

                                <h3>4. Оплата и комиссии</h3>
                                <p>4.1. Оплата производится по одному из вариантов:</p>
                                <ul>
                                    <li><strong>Наличные:</strong> Исполнитель получает оплату от Заказчика, платформа
                                        списывает фиксированную комиссию.
                                    </li>
                                    <li><strong>Гарантированная оплата:</strong> средства резервируются у Заказчика и
                                        передаются Исполнителю после выполнения заказа.
                                    </li>
                                    <li><strong>Рассрочка:</strong> оплата через банк, где деньги переводятся
                                        Исполнителю, а Заказчик погашает долг частями.
                                    </li>
                                </ul>
                                <p>4.2. Комиссия Сервиса взимается в зависимости от выбранного способа оплаты.</p>
                                <p>4.3. В случае отмены заказа возврат средств осуществляется по согласованным
                                    условиям.</p>
                                <p>4.4. Исполнители не могут требовать оплату сверх согласованной суммы.</p>

                                <h3>5. Рейтинг, отзывы и санкции</h3>
                                <p>5.1. После выполнения заказа Заказчик и Исполнитель могут оставить отзывы друг о
                                    друге.</p>
                                <p>5.2. Рейтинг формируется на основе оценок, отзывов и успешных сделок.</p>
                                <p>5.3. Администрация имеет право скрывать или удалять отзывы, содержащие ложную
                                    информацию, оскорбления или клевету.</p>
                                <p>5.4. За систематические нарушения правил (отмена заказов, обман, низкое качество
                                    работы) Администрация может применять санкции, включая временную блокировку или
                                    удаление аккаунта.</p>

                                <h3>6. Гарантии и ответственность</h3>
                                <p>6.1. CargoCamp не несет ответственности за качество услуг Исполнителей и
                                    добросовестность Заказчиков.</p>
                                <p>6.2. Администрация вправе заблокировать пользователя за мошенничество, нарушение
                                    условий Соглашения или законодательства.</p>
                                <p>6.3. Споры между пользователями решаются самостоятельно, в отдельных случаях
                                    Администрация может выступать посредником.</p>
                                <p>6.4. Администрация не несет ответственности за возможные убытки пользователей,
                                    связанные с использованием Сервиса.</p>

                                <h3>7. Обработка персональных данных</h3>
                                <p>7.1. Регистрация в Сервисе означает согласие на обработку персональных данных.</p>
                                <p>7.2. Персональные данные используются для идентификации пользователей, улучшения
                                    работы Сервиса и обеспечения безопасности.</p>
                                <p>7.3. Администрация не передает персональные данные третьим лицам, за исключением
                                    случаев, предусмотренных законом.</p>

                                <h3>8. Заключительные положения</h3>
                                <p>8.1. Администрация вправе вносить изменения в Соглашение. Обновленный текст
                                    размещается на сайте и вступает в силу с момента публикации.</p>
                                <p>8.2. Если пользователь продолжает использовать Сервис после внесения изменений, это
                                    означает его согласие с новыми условиями.</p>

                            </div>

                            <button onClick={handleCloseModal}>Закрыть</button>
                        </div>
                    </div>
                )}


                <p style={styles.loginText}>
                    Уже есть аккаунт?{' '}
                    <span
                        onClick={() => navigate('/login')}
                        style={styles.loginLink}
                    >
                        Войти
                    </span>
                </p>
            </div>
            <style jsx>{`
                .modal {
                    display: none; /* Скрыто по умолчанию */
                    position: fixed;
                    z-index: 1;
                    left: 0;
                    top: 0;
                    width: 100%;
                    height: 100%;
                    overflow: auto;
                    background-color: rgb(0,0,0); /* Черный фон */
                    background-color: rgba(0,0,0,0.4); /* Полупрозрачный фон */
                    padding-top: 60px;
                }

                .modal-content {
                    background-color: white;
                    margin: 5% auto;
                    padding: 20px;
                    border: 1px solid #888;
                    width: 80%;
                    max-width: 800px;
                    overflow-y: auto;
                    max-height: 80vh;
                    border-radius: 8px;
                }

                .close-btn {
                    color: #aaa;
                    float: right;
                    font-size: 28px;
                    font-weight: bold;
                }

                .close-btn:hover,
                .close-btn:focus {
                    color: black;
                    text-decoration: none;
                    cursor: pointer;
                }

                .terms-content {
                    font-size: 14px;
                    line-height: 1.6;
                    max-height: 70vh;
                    overflow-y: auto;
                }

                h3 {
                    color: #333;
                    font-size: 18px;
                    margin-top: 20px;
                }

                h4 {
                    color: #444;
                    font-size: 16px;
                }

                p, ul {
                    margin-bottom: 15px;
                }

                ul {
                    margin-left: 20px;
                }

                li {
                    margin-bottom: 10px;
                }

                .modal-content h2 {
                    margin-top: 0;
                }

                .modal-content p {
                    font-size: 14px;
                    margin-bottom: 20px;
                    color: #333;
                }

                .modal-content button {
                    padding: 10px 20px;
                    background-color: #007bff;
                    color: white;
                    border: none;
                    border-radius: 5px;
                    cursor: pointer;
                    font-size: 16px;
                }

                .modal-content button:hover {
                    background-color: #0056b3;
                }

                /* Для предотвращения кликов по фону */
                .modal-overlay .modal-content {
                    pointer-events: auto;
                }
            `}</style>

        </div>
    );
};

const styles = {
    container: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        backgroundColor: '#f2f2f2',
    },
    formContainer: {
        backgroundColor: '#fff',
        padding: '30px',
        borderRadius: '10px',
        boxShadow: '0 4px 8px rgba(0, 0, 0, 0.1)',
        width: '100%',
        maxWidth: '400px',
        textAlign: 'center',
    },
    title: {
        fontSize: '24px',
        marginBottom: '20px',
        color: '#333',
    },

    error: {
        color: 'red',
        marginBottom: '15px',
        fontSize: '14px',
    },
    form: {
        display: 'flex',
        flexDirection: 'column',
        gap: '15px',
    },
    inputGroup: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
    },
    label: {
        fontSize: '14px',
        marginBottom: '5px',
        color: '#555',
    },
    input: {
        width: '100%',
        padding: '10px',
        fontSize: '16px',
        border: '1px solid #ccc',
        borderRadius: '5px',
    },
    button: {
        padding: '10px 20px',
        fontSize: '16px',
        color: '#fff',
        backgroundColor: '#007aff',
        border: 'none',
        borderRadius: '5px',
        cursor: 'pointer',
    },
    loginText: {
        marginTop: '15px',
        fontSize: '14px',
        color: '#555',
    },
    loginLink: {
        color: '#007aff',
        cursor: 'pointer',
        textDecoration: 'underline',
    },


};

export default RegisterPage;
