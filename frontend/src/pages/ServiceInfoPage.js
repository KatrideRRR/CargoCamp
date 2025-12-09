import React from 'react';
import '../styles/ServiceInfoPage.css';

export default function ServiceInfoPage() {
    return (
        <div className="info-page-container">
            <div className="info-page-card">
                <h1 className="info-title">Услуги сервиса CargoCamp и цены</h1>
                <p className="info-subtitle">
                    CargoCamp — онлайн-платформа для размещения заказов и поиска исполнителей.
                    Сервис не является исполнителем работ и не продаёт товары. Платежи через
                    интернет-эквайринг принимаются только за услуги сервиса.
                </p>

                {/* О сервисе */}
                <section className="info-section">
                    <h2 className="info-section-title">1. О сервисе</h2>
                    <p className="info-text">
                        Платформа предоставляет заказчикам и исполнителям техническую возможность
                        найти друг друга, обменяться информацией и договориться об условиях
                        выполнения работ. Стоимость работ по заказу определяется сторонами
                        самостоятельно и выплачивается исполнителю отдельно от сервисных платежей
                        CargoCamp.
                    </p>
                </section>

                {/* Услуги и цены */}
                <section className="info-section">
                    <h2 className="info-section-title">2. Услуги сервиса и фиксированные цены</h2>

                    <div className="tariff-list">
                        <div className="tariff-item">
                            <div className="tariff-name">Размещение заказа в системе</div>
                            <div className="tariff-price">0 ₽</div>
                            <p className="tariff-desc">
                                Создание и публикация заказа на платформе для поиска исполнителей.
                            </p>
                        </div>

                        <div className="tariff-item">
                            <div className="tariff-name">Продвижение заказа в выдаче</div>
                            <div className="tariff-price">50 ₽ / 100 ₽ / 150 ₽</div>
                            <p className="tariff-desc">
                                Дополнительный платные услуги для продвижения заказа в списке:
                                Выделение цветом в общем списке, рекомендуемый заказ (появление в отдельном списке),
                                и пуш уведомление для ближайших исполнителей соответсвенно.
                            </p>
                        </div>

                        <div className="tariff-item">
                            <div className="tariff-name">Комиссия сервиса за взятие заказа с типом оплаты "Наличные"</div>
                            <div className="tariff-price">200 ₽</div>
                            <p className="tariff-desc">
                                За взятие в работу стандартного заказа с типом оплаты "Наличные" исполнитель имеет право оплатить
                                фиксированную комиссию сразу или же позволить зафиксировать в его профиле задолженность в 200 ₽
                                и оплатить когда ему удобно перед запросом последующего заказа.
                            </p>
                        </div>

                        <div className="tariff-item">
                            <div className="tariff-name">Сервисный сбор при безопасной сделке</div>
                            <div className="tariff-price">10% от суммы заказа</div>
                            <p className="tariff-desc">
                                Комиссия сервиса за организацию безопасного удержания и перевода
                                средств после завершения заказа. Конкретная сумма комиссии всегда
                                отображается пользователю перед оплатой.
                            </p>
                        </div>

                        <div className="tariff-item">
                            <div className="tariff-name">Погашение задолженности перед сервисом</div>
                            <div className="tariff-price">Сумма задолженности (фиксировано)</div>
                            <p className="tariff-desc">
                                Оплата накопившегося долга пользователя перед сервисом (поле
                                <code> debt</code> в личном кабинете). Конкретная сумма оплаты
                                отображается до подтверждения платежа.
                            </p>
                        </div>

                        <div className="tariff-item">
                            <div className="tariff-name">Покупка статуса Premium</div>
                            <div className="tariff-price">2500 ₽/ 9000 ₽</div>
                            <p className="tariff-desc">
                                Для любого пользователя имеется возможность приобрести премиум статус в профиле.
                                Этот статус дает возможность на неделю или месяц соответсвенно не иметь ограниений
                                на взятие в работу любого количества заказов без комиссии.
                            </p>
                        </div>
                    </div>
                </section>

                {/* За что мы НЕ принимаем оплату */}
                <section className="info-section">
                    <h2 className="info-section-title">3. За что мы не принимаем оплату</h2>
                    <p className="info-text">
                        CargoCamp не принимает оплату за сами работы или услуги исполнителей.
                        Расчёты между заказчиком и исполнителем по итогам выполненного заказа
                        осуществляются напрямую между ними на согласованных условиях.
                    </p>
                </section>

                {/* Как проходят платежи */}
                <section className="info-section">
                    <h2 className="info-section-title">4. Как проходят платежи</h2>
                    <ul className="info-list">
                        <li>Пользователь выбирает услугу сервиса (продвижение, сервисный сбор и т.п.).</li>
                        <li>Перед оплатой всегда показана конкретная сумма платежа.</li>
                        <li>Оплата проводится через платёжного провайдера (интернет-эквайринг).</li>
                        <li>После успешной оплаты пользователь видит подтверждение в личном кабинете.</li>
                    </ul>
                </section>

                {/* Контакты и реквизиты */}
                <section className="info-section">
                    <h2 className="info-section-title">5. Контакты и реквизиты</h2>
                    <p className="info-text">
                        По вопросам работы сервиса, оплаты и документов вы можете обратиться:
                    </p>
                    <ul className="info-list">
                        <li>Email: <b>partner@cargocamp.ru</b></li>
                        <li>Телефон: <b>+7 (978) 686-41-18</b></li>
                        <li>ИП: Аджиаметов Аким Ибришевич</li>
                        <li>ИНН: 9109 0845 7603</li>
                        <li>ОГРНИП: 325911200109660</li>
                    </ul>
                </section>

                <p className="info-note">
                    Дополнительную юридическую информацию вы можете найти в разделах
                    «Публичная оферта» и «Политика конфиденциальности» на сайте.
                </p>
            </div>
        </div>
    );
}