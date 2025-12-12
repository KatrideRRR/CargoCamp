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
    const [paymentMethodId, setPaymentMethodId] = useState(null);
    const navigate = useNavigate();
    const { logout, isAuthenticated, user } = useAuth();    const [cardInfo, setCardInfo] = useState();
    const [showAgreement, setShowAgreement] = useState(false);
    const [hasDebt, setHasDebt] = useState(false);
    const [debtAmount, setDebtAmount] = useState(0);
    const getRemainingDays = (expiresAt) => {
        if (!expiresAt) return 0;
        const now = new Date();
        const expiration = new Date(expiresAt);
        const diff = expiration - now;
        return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    };

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
                    setPaymentMethodId(response.data.yookassaPaymentMethodId || null);
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

    useEffect(() => {
        if (profile) {
            loadDebtStatus();
        }
    }, [profile]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get("bindReturn") === "1" || params.get("debtReturn") === "1" || params.get("premiumReturn") === "1") {
            setTimeout(() => window.location.reload(), 1500);
        }
    }, []);

    const loadDebtStatus = async () => {
        const token = localStorage.getItem("authToken");

        try {
            const response = await axios.get(`${apiUrl}/api/orders/me/status`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            setDebtAmount(response.data.debt || 0);
            setHasDebt((response.data.debt || 0) > 0);
        } catch (e) {
            console.error("Ошибка проверки долга:", e);
        }
    };

    const handlePayDebt = async () => {
        try {
            const token = localStorage.getItem("authToken");
            if (!token) {
                toast.error("Вы не авторизованы");
                return;
            }

            if (!debtAmount || debtAmount <= 0) {
                toast.info("Долгов нет");
                return;
            }

            const res = await axios.post(
                `${apiUrl}/api/payments/debt/create`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );

            if (!res.data?.success) {
                toast.error(res.data?.error || "Ошибка создания платежа");
                return;
            }

            if (res.data.noDebt) {
                toast.info("Долгов нет");
                return;
            }

            window.location.href = res.data.confirmationUrl;
        } catch (e) {
            console.error("handlePayDebt error:", e);
            toast.error("Ошибка при оплате задолженности");
        }
    };

    const handleBuyPremium = async (duration) => {
        try {
            const token = localStorage.getItem("authToken");
            if (!token) {
                toast.error("Вы не авторизованы");
                return;
            }

            const res = await axios.post(
                `${apiUrl}/api/payments/premium/create`,
                { duration }, // "7d" | "30d"
                { headers: { Authorization: `Bearer ${token}` } }
            );

            if (!res.data?.success) {
                toast.error(res.data?.error || "Ошибка создания платежа");
                return;
            }

            window.location.href = res.data.confirmationUrl;
        } catch (e) {
            console.error(e);
            toast.error("Ошибка при оплате Premium");
        }
    };

    const handleBindCard = async () => {
        try {
            const token = localStorage.getItem("authToken");
            if (!token) {
                toast.error("Вы не авторизованы");
                return;
            }

            const res = await axios.post(
                `${apiUrl}/api/payments/card/bind/create`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );

            if (!res.data?.success) {
                toast.error(res.data?.error || "Ошибка привязки карты");
                return;
            }

            window.location.href = res.data.confirmationUrl;
        } catch (e) {
            console.error("bind card error:", e);
            toast.error("Ошибка привязки карты");
        }
    };

    const handleUnbindCard = async () => {
        try {
            const token = localStorage.getItem("authToken");
            if (!token) {
                toast.error("Вы не авторизованы");
                return;
            }

            const res = await axios.post(
                `${apiUrl}/api/payments/card/unbind`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );

            if (res.data?.success) {
                toast.success("Карта успешно удалена");
                setPaymentMethodId(null);
                setCardInfo(null);

                // обновим профиль, чтобы подтянуть cardLastFour/cardType
                // можешь просто вызвать fetchProfileData ещё раз, но у тебя оно внутри useEffect.
                // проще:
                window.location.reload();
            } else {
                toast.error(res.data?.error || "Ошибка при удалении карты");
            }
        } catch (e) {
            console.error("unbind error:", e);
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

                                        {paymentMethodId ? (
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


                                        {hasDebt && (
                                            <div className="debt-box">
                                                <p className="text-red-600 font-semibold">
                                                    У вас задолженность по комиссии: {(debtAmount / 100).toFixed(2)} ₽
                                                </p>

                                                <button className="btn btn-red" onClick={handlePayDebt}>
                                                    Оплатить задолженность
                                                </button>
                                            </div>
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
