/* global cp */

import { toast } from "react-toastify";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../utils/authContext";
import axios from "axios";
import "../styles/ProfilePage.css";
import AgreementModal from "../components/AgreementModal";
const apiUrl = process.env.REACT_APP_API_URL;

const ProfilePage = () => {
    const [showVerificationModal, setShowVerificationModal] = useState(false);
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [rebillId, setRebillId] = useState(null); // Сохраняем ID привязанной карты
    const navigate = useNavigate();
    const { logout, isAuthenticated } = useAuth();
    const [cardInfo, setCardInfo] = useState();
    const [showAgreement, setShowAgreement] = useState(false);
    const getRemainingDays = (expiresAt) => {
        if (!expiresAt) return 0;
        const now = new Date();
        const expiration = new Date(expiresAt);
        const diff = expiration - now;
        return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    };
    const { user } = useAuth();

    useEffect(() => {
        let isMounted = true;

        const fetchProfileData = async () => {
            const token = localStorage.getItem("authToken");
            console.log("Токен на странице профиля:", token);

            if (!token) {
                navigate("/login");
                return;
            }

            try {
                const response = await axios.get(`${apiUrl}/api/auth/profile`, {
                    headers: { Authorization: `Bearer ${token}` },
                });

                console.log("Данные профиля:", response.data);

                if (isMounted) {
                    setProfile(response.data);
                    setRebillId(response.data.rebillId || null); // Загружаем ID карты, если есть
                    setLoading(false);
                }
            } catch (err) {
                console.error("Ошибка:", err.response?.status, err.message);
                if (isMounted) {
                    setError("Не удалось загрузить данные профиля.");
                    setLoading(false);
                    navigate("/login");
                }
            }
        };

        fetchProfileData();


        return () => {
            isMounted = false;
        };
    }, [isAuthenticated, navigate]);

    const handleBuyPremium = async (duration) => {
        const token = localStorage.getItem("authToken");
        const { data } = await axios.get(`${apiUrl}/api/payments/public-id`);

        // серверные цены
        const prices = { "7d": 2500, "30d": 9000 };

        const amount = prices[duration];
        if (!amount) {
            console.error("Неверная длительность, amount = undefined");
            toast.error("Ошибка: неправильный тип премиума");
            return;
        }

        const widget = new cp.CloudPayments();

        widget.charge(
            {
                publicId: data.publicId,
                description: `Покупка премиума (${duration})`,
                amount, // теперь корректно
                currency: "RUB",
                accountId: user.id,
                skin: "mini",
            },
            async function (options) {
                try {
                    const response = await axios.post(
                        `${apiUrl}/api/payments/premium`,
                        {
                            userId: user.id,
                            duration,
                            cardCryptogramPacket: options.cryptogram,
                        },
                        { headers: { Authorization: `Bearer ${token}` } }
                    );

                    if (response.data.success) {
                        toast.success("Премиум успешно оплачен!");
                    } else {
                        toast.error(response.data.error);
                    }
                } catch (err) {
                    toast.error("Ошибка сервера");
                }
            },
            () => toast.error("Платёж отменён")
        );
    };

    const handleBindCard = async () => {
        const token = localStorage.getItem("authToken");

        const { data } = await axios.get(`${apiUrl}/api/payments/public-id`);

        const widget = new cp.CloudPayments();

        widget.charge(
            {
                publicId: data.publicId,
                description: "Привязка карты",
                amount: 1.00,         // НЕ менять, CloudPayments требует реальный чардж
                currency: "RUB",
                accountId: user.id,
                skin: "mini"
            },
            async function (options) {
                // успешная оплата → есть cryptogram
                try {
                    const response = await axios.post(
                        `${apiUrl}/api/payments/card/bind`,
                        {
                            userId: user.id,
                            cardCryptogramPacket: options.cryptogram
                        },
                        { headers: { Authorization: `Bearer ${token}` } }
                    );

                    if (response.data.success) {
                        toast.success("Карта успешно привязана!");
                        window.location.reload();
                    } else {
                        toast.error(response.data.error);
                    }
                } catch (err) {
                    toast.error("Ошибка привязки карты");
                    console.error(err);
                }
            },
            function () {
                toast.error("Привязка отменена пользователем");
            }
        );
    };

    const handleUnbindCard = async () => {
        const token = localStorage.getItem("authToken");

        if (!token) {
            toast.error("Вы не авторизованы");
            return;
        }

        try {
            const response = await fetch(`${apiUrl}/api/payments/card/unbind`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    userId: user.id, // <-- обязательно отправляем userId
                }),
            });

            const result = await response.json();

            if (response.ok && result.success) {
                toast.success("Карта успешно удалена");

                setRebillId(null);
                setCardInfo(null);
            } else {
                toast.error(result.error || result.message || "Ошибка при удалении карты");
            }
        } catch (error) {
            console.error("Ошибка при удалении карты:", error);
            toast.error("Сервер не отвечает");
        }
    };

    const handleLogout = () => {
        logout();
        navigate("/login");
    };

    const handleMyComplaints = () => {
        if (profile) {
            navigate(`/complaints/${profile.id}`);
        }
    };

    const handleOrderHistory = () => {
        if (profile) {
            navigate(`/orders-history/${profile.id}`);
        }
    };

    const renderStars = (rating) => {
        const maxStars = 5;
        const fullStar = "★";
        const emptyStar = "☆";
        return fullStar.repeat(Math.round(rating)) + emptyStar.repeat(maxStars - Math.round(rating));
    };

    const handleAgree = () => {
        setShowAgreement(false);
        handleBindCard(); // твоя функция
    };

    const handleAutoUpload = async (files) => {
        const token = localStorage.getItem("authToken");

        if (!files.length) return;

        const formData = new FormData();
        for (let file of files) {
            formData.append("documents", file);
        }

        try {
            const response = await axios.post(`${apiUrl}/api/auth/upload-documents`, formData, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "multipart/form-data",
                },
            });
            console.log(response)

            toast.success("Документы успешно загружены");
            // TODO: можно обновить профиль, если хочешь, чтобы верификация менялась на лету
        } catch (error) {
            console.error("Ошибка загрузки документов:", error);
            toast.error("Ошибка загрузки документов");
        }
    };

    if (loading) {
        return <div className="loading-container">Загрузка данных профиля...</div>;
    }

    if (error) {
        return (
            <div className="error-container">
                <p className="error-text">{error}</p>
            </div>
        );
    }

    return (
        <div className="profile">

            <div className="pageContainer-profile">

                <div className="container-p">
                    <div className="contentWrapper">

                        <div className="profile-container">
                            {profile ? (
                                <>
                                    <div className="section username">
                                        <h2 className="subtitle">Имя пользователя:</h2>
                                        <p className="info">{profile.username}</p>
                                    </div>
                                    <div className="section user-id">
                                        <h2 className="subtitle">ID пользователя:</h2>
                                        <p className="info">{profile.id}</p>
                                    </div>
                                    <div className="section user-rating">
                                        <h2 className="subtitle">Рейтинг:</h2>
                                        <p className="info rating">
                                            {profile.rating ? renderStars(profile.rating) : "Нет рейтинга"}
                                        </p>
                                    </div>


                                    <div className="section1 card-section">
                                        <h2 className="subtitle">Ваша карта:</h2>

                                        {rebillId ? (
                                            <div className="card-info">
                                                <p className="info verified">
                                                    Карта привязана: {profile.cardType} •••• {profile.cardLastFour}
                                                </p>
                                                <button className="unbind-button" onClick={handleUnbindCard}>
                                                    Удалить карту
                                                </button>
                                            </div>
                                        ) : (
                                            <button className="bind-card-button" onClick={handleBindCard}>
                                                Привязать карту
                                            </button>
                                        )}
                                    </div>


                                    <div className="section premium-section">
                                        {profile.subscriptionType === "premium" ? (
                                            <p className="info premium-status">
                                                Премиум активен
                                                на {getRemainingDays(profile.subscriptionExpiresAt)} дней
                                            </p>
                                        ) : profile.subscriptionType === "trial" ? (
                                            <p className="info trial-status">
                                                🔄 Пробная подписка.
                                                Осталось: {getRemainingDays(profile.subscriptionExpiresAt)} дней
                                            </p>
                                        ) : (
                                            <p className="info">У вас обычный аккаунт.</p>
                                        )}

                                        <div className="subscription-buttons">
                                            <button onClick={() => handleBuyPremium("7d")} className="subscribe-button">
                                                Купить Премиум (7 дней)
                                            </button>
                                            <button onClick={() => handleBuyPremium("30d")} className="subscribe-button">
                                                Купить Премиум (30 дней)
                                            </button>
                                        </div>
                                    </div>


                                    <div className="section verification-upload">
                                        <div className="verification-header">
                                            <h2 className="subtitle">Верификация:</h2>
                                            <p className={`info verification-status ${profile.userStatus}`}>
                                                {profile.userStatus === "pensioner"
                                                    ? "Пенсионер"
                                                    : profile.userStatus === "verified"
                                                        ? "Пройдена"
                                                        : "Не пройдена"}
                                            </p>
                                        </div>

                                        <div className="verification-content">


                                            <p className="verification-description">
    <span className="verification-more-link" onClick={() => setShowVerificationModal(true)}>
        Подробнее о верификации
    </span>
                                            </p>
                                            <label className="upload-label">
                                                <input
                                                    type="file"
                                                    multiple
                                                    accept="image/*,.pdf"
                                                    onChange={(e) => handleAutoUpload(e.target.files)}
                                                    style={{display: "none"}}
                                                />
                                                <span className="upload-button-style">Загрузить документы</span>

                                            </label>
                                        </div>
                                    </div>


                                    {/* Кнопки навигации */}
                                    <button onClick={handleMyComplaints} className="complaints-button">
                                        Мои жалобы
                                    </button>
                                    <button onClick={handleOrderHistory} className="history-button">
                                        История заказов
                                    </button>
                                    <button onClick={handleLogout} className="logout-button">
                                        Выйти
                                    </button>
                                </>
                            ) : (
                                <p className="info">Загрузка данных профиля...</p>
                            )}
                        </div>

                        {showAgreement && (
                            <AgreementModal
                                isOpen={showAgreement}
                                onClose={() => setShowAgreement(false)}
                                onAgree={handleAgree}
                                onCancel={() => setShowAgreement(false)}
                            />
                        )}

                    </div>
                </div>
            </div>
            {showVerificationModal && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <h3>О верификации пользователя</h3>
                        <p>
                            Верификация необходима для повышения доверия к вам как к пользователю платформы.
                            Мы просим загрузить скан паспорта или другого документа, удостоверяющего личность,
                            чтобы подтвердить, что вы — реальный человек, а не фейковый аккаунт.
                        </p>
                        <p>
                            <strong>Для пенсионеров:</strong> если вы подтвердите свой пенсионный статус,
                            исполнители будут видеть соответствующую отметку и получать <strong>скидку на комиссию</strong>
                            при выполнении ваших заказов. Это увеличивает шанс, что ваш заказ примут быстрее.
                        </p>
                        <p>
                            🔒 Все документы обрабатываются вручную и хранятся в зашифрованном виде.
                            Мы не передаем их третьим лицам.
                        </p>
                        <p className="warning">
                            ⚠️ Попытка загрузки поддельных документов приведет к ограничению или блокировке аккаунта.
                        </p>
                        <button className="close-button" onClick={() => setShowVerificationModal(false)}>
                            Закрыть
                        </button>
                    </div>
                </div>
            )}

        </div>

    );
};

export default ProfilePage;
