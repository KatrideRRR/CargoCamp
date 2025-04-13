import { toast } from "react-toastify";
import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../utils/authContext";
import axios from "axios";
import "../styles/ProfilePage.css"; // Импортируем CSS файл
const apiUrl = process.env.REACT_APP_API_URL;

const ProfilePage = () => {
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [rebillId, setRebillId] = useState(null); // Сохраняем ID привязанной карты
    const navigate = useNavigate();
    const { logout, isAuthenticated } = useAuth();
    const [cardInfo, setCardInfo] = useState();

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
        <div className="container">
            <div className="profile-container">
                {profile ? (
                    <>
                        <div className="section">
                            <h2 className="subtitle">Имя пользователя:</h2>
                            <p className="info">{profile.username}</p>
                        </div>
                        <div className="section">
                            <h2 className="subtitle">ID пользователя:</h2>
                            <p className="info">{profile.id}</p>
                        </div>
                        <div className="section">
                            <h2 className="subtitle">Рейтинг:</h2>
                            <p className="info rating">
                                {profile.rating ? renderStars(profile.rating) : "Нет рейтинга"}
                            </p>
                        </div>

                        <div className="section1">
                            <h2 className="subtitle">Ваша карта:</h2>

                            {rebillId ? (
                                <div>
                                    <p className="info verified">Карта
                                        привязана: {profile.cardType} •••• {profile.cardLastFour}</p>
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


                        <div className="section verification-row">
                            <h2 className="subtitle">Верификация:</h2>
                            <p className={`info verification-status ${profile.isVerified ? "verified" : "not-verified"}`}>
                                {profile.isVerified ? "Пройдена" : "Не пройдена"}
                            </p>
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
        </div>
    );
};

export default ProfilePage;
