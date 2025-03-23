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

    // 🔹 Функция привязки карты
    const handleBindCard = async () => {
        console.log("🔹 API URL:", apiUrl); // Проверяем, что apiUrl корректный

        try {
            const response = await axios.post(`${apiUrl}/api/payment/bind_card`, { userId: profile.id });
            console.log("🔹 Ответ сервера:", response.data);

            if (response.data.Success) {
                window.location.href = response.data.PaymentURL; // Открываем страницу привязки

            } else {
                alert("Ошибка привязки карты");
            }
        } catch (error) {
            console.error("Ошибка привязки карты:", error);
            alert("Ошибка привязки карты");
        }
    };

    // 🔹 Функция автосписания 100 рублей (пример)
    const handleCharge = async () => {
        if (!rebillId) {
            alert("Карта не привязана!");
            return;
        }

        try {
            const response = await axios.post(`${apiUrl}/api/payment/charge_card`, {
                userId: profile.id,
                rebillId: rebillId,
                amount: 100, // 100 рублей
                description: "Тестовое списание 100 руб."
            });

            if (response.data.Success) {
                alert("Списание успешно!");
            } else {
                alert("Ошибка списания: " + response.data.Message);
            }
        } catch (error) {
            console.error("Ошибка списания:", error);
            alert("Ошибка списания");
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

    // Функция рендера звездочек
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
                            <p className="info rating">{profile.rating ? renderStars(profile.rating) : "Нет рейтинга"}</p>
                        </div>

                        {/* Привязка карты */}
                        <div className="section">
                            <h2 className="subtitle">Привязка карты:</h2>
                            {rebillId ? (
                                <p className="info verified">Карта привязана ✅</p>
                            ) : (
                                <button onClick={handleBindCard} className="bind-card-button">
                                    Привязать карту
                                </button>
                            )}
                        </div>

                        {/* Кнопка автосписания для теста */}
                        {rebillId && (
                            <button onClick={handleCharge} className="charge-button">
                                Списать 100 рублей
                            </button>
                        )}

                        {/* Верификация */}
                        <div className="section">
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
