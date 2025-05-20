import { toast } from "react-toastify";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../utils/authContext";
import axios from "axios";
import "../styles/ProfilePage.css"; // Импортируем CSS файл
import AgreementModal from "../components/AgreementModal";
const apiUrl = process.env.REACT_APP_API_URL;

const ProfilePage = () => {
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

    const handleBuyPremium = async (days) => {
        const token = localStorage.getItem("authToken");
        const duration = `${days}d`; // '7d' или '30d'

        try {
            const response = await axios.post(`${apiUrl}/api/auth/buy`, {
                duration,
            }, {
                headers: { Authorization: `Bearer ${token}` },
            });

            if (response.data.success) {
                toast.success(`Премиум активирован до ${new Date(response.data.until).toLocaleDateString()}`);
                window.location.reload(); // или вручную обнови профиль
            } else {
                toast.error("Не удалось оформить подписку");
            }
        } catch (error) {
            console.error("Ошибка при подписке:", error);
            toast.error("Ошибка сервера при подписке");
        }
    };


    const handleBindCard = async () => {
        const token = localStorage.getItem("authToken");
        try {
            const response = await axios.post(`${apiUrl}/api/payment/bind-card`, {},{
                headers: { Authorization: `Bearer ${token}` },
            } );

            if (response.data.paymentUrl) {
                window.location.href = response.data.paymentUrl;
            } else {
                toast.error("Ошибка при получении ссылки для привязки карты");
            }
        } catch (error) {
            toast.error("Ошибка при привязке карты");
            console.error("Ошибка при привязке карты:", error);
        }
    };

    const handleUnbindCard = async () => {
        const token = localStorage.getItem("authToken");
        try {
            const response = await fetch(`${apiUrl}/api/payment/unbind-card`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${token}`,
                },
            });

            const result = await response.json();

            console.log(cardInfo);

            if (response.ok) {
                toast.success("Карта успешно удалена");
                setRebillId(null);
                setCardInfo(null);
            } else {
                toast.error(result.message || "Ошибка при удалении карты");
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

    const handleCardLinkClick = () => {
        setShowAgreement(true);
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
                                            <button className="bind-card-button" onClick={handleCardLinkClick}>
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
                                            <button onClick={() => handleBuyPremium(7)} className="subscribe-button">
                                                Купить Премиум (7 дней)
                                            </button>
                                            <button onClick={() => handleBuyPremium(30)} className="subscribe-button">
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
        </div>

    );
};

export default ProfilePage;
