import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";

import "../styles/StartPage.css";

const ANDROID_DOWNLOAD_URL =
    "https://cargocamp.ru/downloads/cargocamp-latest.apk";

// Сюда позже подставим публичную ссылку TestFlight.
// Пример: https://testflight.apple.com/join/AbCdEf12
const IOS_TESTFLIGHT_URL = "https://testflight.apple.com/join/EHem7CUq";

const TESTFLIGHT_APP_URL =
    "https://apps.apple.com/app/testflight/id899247664";

export default function StartPage() {
    const navigate = useNavigate();
    const [isIosModalOpen, setIsIosModalOpen] = useState(false);

    // true — приложение запущено внутри Capacitor на Android или iOS.
    // false — сайт открыт в обычном браузере.
    const isNativeApp = Capacitor.isNativePlatform();

    useEffect(() => {

        document.body.classList.add("start-page-open");

        document.documentElement.classList.add("start-page-open");

        return () => {

            document.body.classList.remove("start-page-open");

            document.documentElement.classList.remove("start-page-open");

        };

    }, []);

    const handleIosDownload = () => {
        if (!IOS_TESTFLIGHT_URL) {
            return;
        }

        setIsIosModalOpen(true);
    };

    const closeIosModal = () => {
        setIsIosModalOpen(false);
    };

    const openTestFlightAppStore = () => {
        window.open(
            TESTFLIGHT_APP_URL,
            "_blank",
            "noopener,noreferrer"
        );
    };

    const openCargoCampTestFlight = () => {
        window.location.href = IOS_TESTFLIGHT_URL;
    };

    useEffect(() => {
        if (!isIosModalOpen) {
            return undefined;
        }

        const handleKeyDown = (event) => {
            if (event.key === "Escape") {
                setIsIosModalOpen(false);
            }
        };

        const previousOverflow =
            document.body.style.overflow;

        document.body.style.overflow = "hidden";
        window.addEventListener("keydown", handleKeyDown);

        return () => {
            document.body.style.overflow =
                previousOverflow;

            window.removeEventListener(
                "keydown",
                handleKeyDown
            );
        };
    }, [isIosModalOpen]);

    return (
        <div
            className={`start-page-container ${
                isNativeApp
                    ? "start-page-container--native"
                    : "start-page-container--web"
            }`}
        >
            <div className="start-page-content">
                <div className="start-page-heading">
                    <h1 className="start-page-title">CargoCamp</h1>
                    <p className="start-page-subtitle">
                        Что вы хотите сделать?
                    </p>
                </div>

                <div className="start-page-button-group">
                    <button
                        onClick={() => navigate("/create-order")}
                        className="start-page-role-button"
                        type="button"
                    >
                        <div className="start-page-emoji">🧾</div>

                        <div className="start-page-role-text">
                            <h2 className="start-page-role-title">
                                Создать заказ
                            </h2>

                            <p className="start-page-role-subtitle">
                                Обычный заказ на услугу
                            </p>
                        </div>
                    </button>

                    <button
                        onClick={() => navigate("/express")}
                        className="start-page-role-button"
                        type="button"
                    >
                        <div className="start-page-emoji">🚕</div>

                        <div className="start-page-role-text">
                            <h2 className="start-page-role-title">
                                Такси / Курьер
                            </h2>

                            <p className="start-page-role-subtitle">
                                Быстрый заказ «здесь и сейчас»
                            </p>
                        </div>
                    </button>

                    <button
                        onClick={() => navigate("/orders")}
                        className="
                            start-page-role-button
                            start-page-role-button-soft
                        "
                        type="button"
                    >
                        <div className="start-page-emoji">📋</div>

                        <div className="start-page-role-text">
                            <h2 className="start-page-role-title">
                                Все заказы
                            </h2>

                            <p className="start-page-role-subtitle">
                                Найти заказ и откликнуться
                            </p>
                        </div>
                    </button>
                </div>

                {!isNativeApp && (
                    <section
                        className="start-page-download-section"
                        aria-labelledby="start-page-download-title"
                    >
                        <div className="start-page-download-heading">
                            <h2
                                id="start-page-download-title"
                                className="start-page-download-title"
                            >
                                Скачайте приложение
                            </h2>

                            <p className="start-page-download-description">
                                Получайте уведомления о заказах и сообщениях
                                прямо на телефон
                            </p>
                        </div>

                        <div className="start-page-store-buttons">
                            <a
                                className="
                                    start-page-store-button
                                    start-page-store-button-android
                                "
                                href={ANDROID_DOWNLOAD_URL}
                                download
                                rel="noopener noreferrer"
                                aria-label="Скачать CargoCamp для Android"
                            >
                                <span
                                    className="start-page-store-icon"
                                    aria-hidden="true"
                                >
                                    <svg
                                        viewBox="0 0 24 24"
                                        role="img"
                                    >
                                        <path
                                            fill="currentColor"
                                            d="
                                                M17.523 15.341a1.002 1.002 0 0 0
                                                1.002-1.002V9.576a1.002 1.002 0 1 0
                                                -2.004 0v4.763c0 .553.449 1.002
                                                1.002 1.002ZM6.477 15.341a1.002
                                                1.002 0 0 0 1.002-1.002V9.576a1.002
                                                1.002 0 1 0-2.004 0v4.763c0
                                                .553.449 1.002 1.002 1.002ZM8.051
                                                8.793v7.224c0 .462.375.837.837.837h.957
                                                v2.064a1.002 1.002 0 1 0 2.004 0v-2.064
                                                h.302v2.064a1.002 1.002 0 1 0 2.004
                                                0v-2.064h.957a.837.837 0 0 0
                                                .837-.837V8.793H8.051Zm1.539-3.448
                                                -.868-1.504a.376.376 0 0 1
                                                .651-.376l.88 1.524A5.924 5.924 0 0 1
                                                12 4.724c.615 0 1.208.094 1.766.269
                                                l.883-1.528a.376.376 0 0 1
                                                .651.376l-.872 1.51a4.625 4.625 0 0 1
                                                2.358 2.69H7.214A4.625 4.625 0 0 1
                                                9.59 5.345ZM9.78 7.033a.502.502 0 1 0
                                                0-1.004.502.502 0 0 0 0 1.004Zm4.44
                                                0a.502.502 0 1 0 0-1.004.502.502 0 0
                                                0 0 1.004Z
                                            "
                                        />
                                    </svg>
                                </span>

                                <span className="start-page-store-text">
                                    <span className="start-page-store-label">
                                        Скачать для
                                    </span>

                                    <strong className="start-page-store-name">
                                        Android
                                    </strong>
                                </span>
                            </a>

                            <button
                                className={`
                                    start-page-store-button
                                    start-page-store-button-ios
                                    ${
                                    !IOS_TESTFLIGHT_URL
                                        ? "start-page-store-button-disabled"
                                        : ""
                                }
                                `}
                                type="button"
                                onClick={handleIosDownload}
                                disabled={!IOS_TESTFLIGHT_URL}
                                aria-label={
                                    IOS_TESTFLIGHT_URL
                                        ? "Установить CargoCamp на iPhone"
                                        : "Версия CargoCamp для iPhone скоро появится"
                                }
                            >
                                <span
                                    className="start-page-store-icon"
                                    aria-hidden="true"
                                >
                                    <svg
                                        viewBox="0 0 24 24"
                                        role="img"
                                    >
                                        <path
                                            fill="currentColor"
                                            d="
                                                M16.365 1.43c0 1.14-.417 2.183-1.106
                                                2.982-.738.85-1.948 1.505-2.99
                                                1.419-.13-1.09.428-2.247 1.09-2.96
                                                .73-.79 1.972-1.397 3.006-1.441Zm3.456
                                                14.81c-.354.807-.773 1.55-1.256
                                                2.235-.658.935-1.197 1.582-1.61
                                                1.94-.642.59-1.33.893-2.069.91-.53
                                                0-1.17-.151-1.917-.455-.75-.302-1.44
                                                -.453-2.07-.453-.66 0-1.37.151-2.13
                                                .453-.761.304-1.375.464-1.847.48
                                                -.708.03-1.412-.282-2.115-.935-.448
                                                -.391-1.01-1.061-1.686-2.007-.725
                                                -1.01-1.322-2.181-1.79-3.515-.502
                                                -1.44-.754-2.835-.754-4.188 0-1.55
                                                .34-2.887 1.02-4.007a5.91 5.91 0 0 1
                                                2.13-2.13 5.72 5.72 0 0 1 2.882-.803
                                                c.563 0 1.303.175 2.22.52.914.348
                                                1.5.523 1.758.523.193 0 .844-.205
                                                1.95-.615 1.047-.377 1.93-.533
                                                2.654-.471 1.963.158 3.436.933
                                                4.413 2.33-1.755 1.063-2.623
                                                2.552-2.606 4.463.016 1.49.557
                                                2.729 1.62 3.71.482.46 1.022.814
                                                1.62 1.065-.13.377-.268.74-.417
                                                1.09Z
                                            "
                                        />
                                    </svg>
                                </span>

                                <span className="start-page-store-text">
                                    <span className="start-page-store-label">
                                        {IOS_TESTFLIGHT_URL
                                            ? "Установить на"
                                            : "Скоро для"}
                                    </span>

                                    <strong className="start-page-store-name">
                                        iPhone
                                    </strong>
                                </span>
                            </button>
                        </div>

                        <p className="start-page-download-note">
                            Приложения доступны только на мобильных устройствах
                        </p>
                    </section>
                )}
            </div>

            {isIosModalOpen && (
                <div
                    className="start-page-ios-modal-overlay"
                    role="presentation"
                    onMouseDown={(event) => {
                        if (event.target === event.currentTarget) {
                            closeIosModal();
                        }
                    }}
                >
                    <div
                        className="start-page-ios-modal"
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="ios-install-title"
                        aria-describedby="ios-install-description"
                    >
                        <button
                            type="button"
                            className="start-page-ios-modal-close"
                            onClick={closeIosModal}
                            aria-label="Закрыть инструкцию"
                        >
                            ×
                        </button>

                        <div className="start-page-ios-modal-icon">
                            <svg
                                viewBox="0 0 24 24"
                                aria-hidden="true"
                            >
                                <path
                                    fill="currentColor"
                                    d="
                            M16.365 1.43c0 1.14-.417 2.183-1.106
                            2.982-.738.85-1.948 1.505-2.99
                            1.419-.13-1.09.428-2.247 1.09-2.96
                            .73-.79 1.972-1.397 3.006-1.441Zm3.456
                            14.81c-.354.807-.773 1.55-1.256
                            2.235-.658.935-1.197 1.582-1.61
                            1.94-.642.59-1.33.893-2.069.91-.53
                            0-1.17-.151-1.917-.455-.75-.302-1.44
                            -.453-2.07-.453-.66 0-1.37.151-2.13
                            .453-.761.304-1.375.464-1.847.48
                            -.708.03-1.412-.282-2.115-.935-.448
                            -.391-1.01-1.061-1.686-2.007-.725
                            -1.01-1.322-2.181-1.79-3.515-.502
                            -1.44-.754-2.835-.754-4.188 0-1.55
                            .34-2.887 1.02-4.007a5.91 5.91 0 0 1
                            2.13-2.13 5.72 5.72 0 0 1 2.882-.803
                            c.563 0 1.303.175 2.22.52.914.348
                            1.5.523 1.758.523.193 0 .844-.205
                            1.95-.615 1.047-.377 1.93-.533
                            2.654-.471 1.963.158 3.436.933
                            4.413 2.33-1.755 1.063-2.623
                            2.552-2.606 4.463.016 1.49.557
                            2.729 1.62 3.71.482.46 1.022.814
                            1.62 1.065-.13.377-.268.74-.417
                            1.09Z
                        "
                                />
                            </svg>
                        </div>

                        <h2
                            id="ios-install-title"
                            className="start-page-ios-modal-title"
                        >
                            Установка CargoCamp на iPhone
                        </h2>

                        <p
                            id="ios-install-description"
                            className="start-page-ios-modal-description"
                        >
                            Версия для iPhone пока устанавливается
                            через официальное приложение Apple TestFlight.
                        </p>

                        <div className="start-page-ios-steps">
                            <div className="start-page-ios-step">
                                <div className="start-page-ios-step-number">
                                    1
                                </div>

                                <div className="start-page-ios-step-content">
                                    <div className="start-page-ios-step-title">
                                        Установите TestFlight
                                    </div>

                                    <div className="start-page-ios-step-text">
                                        Нажмите кнопку ниже и установите
                                        бесплатное приложение TestFlight
                                        из App Store.
                                    </div>
                                </div>
                            </div>

                            <div className="start-page-ios-step">
                                <div className="start-page-ios-step-number">
                                    2
                                </div>

                                <div className="start-page-ios-step-content">
                                    <div className="start-page-ios-step-title">
                                        Вернитесь на эту страницу
                                    </div>

                                    <div className="start-page-ios-step-text">
                                        После установки TestFlight снова
                                        откройте CargoCamp в браузере.
                                    </div>
                                </div>
                            </div>

                            <div className="start-page-ios-step">
                                <div className="start-page-ios-step-number">
                                    3
                                </div>

                                <div className="start-page-ios-step-content">
                                    <div className="start-page-ios-step-title">
                                        Откройте приглашение
                                    </div>

                                    <div className="start-page-ios-step-text">
                                        Нажмите «Установить CargoCamp»,
                                        примите приглашение в TestFlight
                                        и установите приложение.
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="start-page-ios-modal-actions">
                            <button
                                type="button"
                                className="
                        start-page-ios-modal-button
                        start-page-ios-modal-button-secondary
                    "
                                onClick={openTestFlightAppStore}
                            >
                    <span className="start-page-ios-button-step">
                        Шаг 1
                    </span>

                                <span>
                        Скачать TestFlight
                    </span>
                            </button>

                            <button
                                type="button"
                                className="
                        start-page-ios-modal-button
                        start-page-ios-modal-button-primary
                    "
                                onClick={openCargoCampTestFlight}
                            >
                    <span className="start-page-ios-button-step">
                        Шаг 2
                    </span>

                                <span>
                        Установить CargoCamp
                    </span>
                            </button>
                        </div>

                        <p className="start-page-ios-modal-note">
                            TestFlight нужен только для установки
                            тестовой версии. После установки CargoCamp
                            появится на экране iPhone как обычное приложение.
                        </p>
                    </div>
                </div>
            )}

        </div>
    );
}