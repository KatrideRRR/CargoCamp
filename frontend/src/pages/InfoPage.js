import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import "../styles/InfoPage.css";

export default function InfoPage() {
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

    return (
        <div className={`info-page info-page--${platform}`}>
            <div className="info-wrap">
                <div className="info-top">
                    <button className="info-back" onClick={() => navigate(-1)}>
                        ← Назад
                    </button>

                    <h1 className="info-title">Информация</h1>
                    <p className="info-subtitle">Документы, контакты и как работает сервис</p>
                </div>

                <div className="info-grid">
                    <button className="info-card info-card--link" onClick={() => navigate("/services")}>
                        <div className="info-card-head">
                            <h3 className="info-card-title">Услуги и цены CargoCamp</h3>
                            <span className="info-pill">Открыть</span>
                        </div>
                        <p className="info-card-text">Фиксированные тарифы сервиса и условия работы.</p>
                    </button>

                    <div className="info-card">
                        <div className="info-card-head">
                            <h3 className="info-card-title">Как работает CargoCamp</h3>
                            <span className="info-pill info-pill--soft">Коротко</span>
                        </div>

                        <ol className="info-list">
                            <li>Заказчик размещает заказ с описанием задачи.</li>
                            <li>Исполнители откликаются и предлагают условия.</li>
                            <li>Стороны договариваются о стоимости и сроках.</li>
                            <li>Сервис берёт оплату только за услуги платформы.</li>
                        </ol>
                    </div>

                    {/* Документы без модалок */}
                    <details className="info-card info-details">
                        <summary className="info-summary">
                            <div className="info-summary-left">
                                <h3 className="info-card-title">Политика конфиденциальности</h3>
                                <p className="info-card-text">Какие данные собираем и как защищаем.</p>
                            </div>
                            <span className="info-chevron" aria-hidden="true">⌄</span>
                        </summary>

                        <div className="info-doc">
                            <h4>1. Общие положения</h4>
                            <p>
                                Настоящая Политика регулирует порядок обработки и защиты персональных данных пользователей
                                веб-приложения CargoCamp.
                            </p>
                            <p>Используя Сервис, пользователь подтверждает согласие с условиями Политики.</p>

                            <h4>2. Какие данные мы собираем</h4>
                            <ul>
                                <li>имя, фамилию (если указаны);</li>
                                <li>номер телефона;</li>
                                <li>адрес электронной почты;</li>
                                <li>фотографии и описания работ, загружаемые пользователями;</li>
                                <li>данные для авторизации;</li>
                                <li>данные о заказах и действиях в Сервисе;</li>
                                <li>информацию, передаваемую браузером (cookies, технические данные).</li>
                            </ul>

                            <h4>3. Цели обработки данных</h4>
                            <ul>
                                <li>регистрация пользователей;</li>
                                <li>обеспечение работы Сервиса;</li>
                                <li>коммуникация заказчиков и исполнителей;</li>
                                <li>приём оплаты и уведомлений;</li>
                                <li>улучшение качества услуг;</li>
                                <li>исполнение требований законодательства РФ.</li>
                            </ul>

                            <h4>4. Передача данных третьим лицам</h4>
                            <ul>
                                <li>сервисам оплаты (например, Тинькофф);</li>
                                <li>хостинг-провайдерам;</li>
                                <li>контрагентам, обеспечивающим работу Сервиса;</li>
                                <li>государственным органам — по требованию закона.</li>
                            </ul>
                            <p>Мы не продаём персональные данные.</p>

                            <h4>5. Срок хранения</h4>
                            <p>Данные хранятся до удаления аккаунта либо до достижения целей обработки.</p>

                            <h4>6. Защита данных</h4>
                            <p>Используем технические и организационные меры защиты, включая шифрование и ограничение доступа.</p>

                            <h4>7. Права пользователя</h4>
                            <ul>
                                <li>получать информацию о своих данных;</li>
                                <li>требовать их изменения или удаления;</li>
                                <li>отзывать согласие на обработку.</li>
                            </ul>

                            <h4>8. Контакты по вопросам данных</h4>
                            <p>Email: partner@cargocamp.ru</p>
                            <p>Телефон: +7 (978) 686 41 18</p>
                        </div>
                    </details>

                    <details className="info-card info-details">
                        <summary className="info-summary">
                            <div className="info-summary-left">
                                <h3 className="info-card-title">Публичная оферта</h3>
                                <p className="info-card-text">Условия использования сервиса CargoCamp.</p>
                            </div>
                            <span className="info-chevron" aria-hidden="true">⌄</span>
                        </summary>

                        <div className="info-doc">
                            <h4>1. Общие положения</h4>
                            <p>
                                Настоящая Публичная оферта является предложением заключить договор на использование веб-сервиса CargoCamp.
                                Используя Сервис, пользователь подтверждает согласие с условиями Оферты.
                            </p>

                            <h4>2. Предмет оферты</h4>
                            <ul>
                                <li>размещение заказов заказчиками;</li>
                                <li>поиск и выполнение заказов исполнителями;</li>
                                <li>обмен информацией и файлами между пользователями.</li>
                            </ul>

                            <h4>3. Регистрация и использование</h4>
                            <p>
                                Пользователь обязан предоставлять достоверные данные. Администрация вправе ограничивать или блокировать
                                доступ при нарушении правил.
                            </p>

                            <h4>4. Права и обязанности</h4>
                            <p><b>Пользователь обязуется:</b></p>
                            <ul>
                                <li>использовать Сервис в соответствии с законодательством РФ;</li>
                                <li>не размещать запрещённый или недостоверный контент;</li>
                                <li>соблюдать правила Сервиса.</li>
                            </ul>

                            <p><b>Администрация обязуется:</b></p>
                            <ul>
                                <li>обеспечивать техническое функционирование;</li>
                                <li>защищать персональные данные пользователей.</li>
                            </ul>

                            <h4>5. Заказы и сделки</h4>
                            <p>
                                Администрация не является стороной сделок между заказчиком и исполнителем. Ответственность за выполнение работ,
                                сроки и качество лежит на пользователях.
                            </p>

                            <h4>6. Платные услуги сервиса и порядок оформления</h4>
                            <p>
                                Сервис CargoCamp предоставляет платные цифровые услуги платформы (например, продвижение заказа,
                                сервисная комиссия исполнителя за взятие заказа, Premium, погашение задолженности).
                                Пользователь выбирает услугу, подтверждает сумму к оплате и переходит к оплате через платёжного провайдера.
                                Услуга считается заказанной и подлежит предоставлению после подтверждения успешной оплаты.
                            </p>

                            <h4>7. Срок предоставления услуг</h4>
                            <p>
                                Сроки предоставления платных услуг указаны на странице «Услуги и цены CargoCamp» (/services).
                                Услуги активируются после успешной оплаты.
                            </p>

                            <h4>8. Возвраты</h4>
                            <p>
                                Поскольку сервис оказывает цифровые услуги, возврат возможен в случае, если услуга фактически не была
                                предоставлена по вине сервиса (например, оплата прошла, а функция не активировалась).
                                Для рассмотрения возврата необходимо обратиться в поддержку: partner@cargocamp.ru, указав дату и сумму платежа,
                                а также назначение платежа. Срок рассмотрения — до 10 календарных дней.
                            </p>

                            <h4>9. Претензии и поддержка</h4>
                            <p>
                                Претензии по работе сервиса и платным услугам направляются на email: partner@cargocamp.ru.
                                В обращении необходимо указать номер телефона аккаунта, дату и сумму платежа, а также описание ситуации.
                                Ответ предоставляется в срок до 10 календарных дней.
                            </p>

                            <h4>10. Доставка</h4>
                            <p>
                                Доставка не применяется, так как CargoCamp оказывает цифровые (информационные) услуги.
                            </p>

                            <h4>11. Изменение оферты</h4>
                            <p>Администрация может изменять условия Оферты. Новая версия вступает в силу с момента публикации.</p>

                            <h4>12. Заключительные положения</h4>
                            <p>Споры решаются в соответствии с законодательством Российской Федерации.</p>
                        </div>
                    </details>
                </div>

                <div className="info-footer">
                    <div className="info-footer-card">
                        <div className="info-footer-row">
                            <span className="k">Email</span>
                            <span className="v">partner@cargocamp.ru</span>
                        </div>
                        <div className="info-footer-row">
                            <span className="k">Телефон</span>
                            <span className="v">+7 (978) 686 41 18</span>
                        </div>
                        <div className="info-footer-row">
                            <span className="k">ИП</span>
                            <span className="v">Аджиаметов Аким Ибришевич</span>
                        </div>
                        <div className="info-footer-row">
                            <span className="k">ИНН</span>
                            <span className="v">9109 0845 7603</span>
                        </div>
                        <div className="info-footer-row">
                            <span className="k">ОГРН/ОГРНИП</span>
                            <span className="v">325911200109660</span>
                        </div>
                        <div className="info-footer-row">
                            <span className="k">Адрес</span>
                            <span className="v">Республика Крым, г. Симферополь, улица Балаклавская 39</span>
                        </div>
                    </div>

                    {/* чтобы не перекрывалось нижним меню */}
                    <div className="info-safe-area" />
                </div>
            </div>
        </div>
    );
}