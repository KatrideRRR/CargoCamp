import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from "../utils/authContext";
import axios from "axios";
import '../styles/ProfilePage.css';  // Импортируем CSS файл
const apiUrl = process.env.REACT_APP_API_URL;

const ProfilePage = () => {
    const [profile, setProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const navigate = useNavigate();
    const { logout, isAuthenticated } = useAuth();

    const handleUploadDocuments = async (files) => {
        if (!files) return;
        const token = localStorage.getItem('authToken');

        const formData = new FormData();
        for (let file of files) {
            formData.append('documents', file);
        }

        const response = await fetch(`${apiUrl}/api/auth/upload-documents`, {
            method: 'POST',
            body: formData,
            headers: { Authorization: `Bearer ${token}` },
        });

        const data = await response.json();
        alert(data.message);
    };

    useEffect(() => {
        let isMounted = true;

        const fetchProfileData = async () => {
            const token = localStorage.getItem('authToken');
            console.log('Токен на странице профиля:', token);

            if (!token) {
                navigate('/login');
                return;
            }

            try {
                const response = await axios.get(`${apiUrl}/api/auth/profile`, {
                    headers: { Authorization: `Bearer ${token}` },
                });

                console.log('Данные профиля:', response.data);

                if (isMounted) {
                    setProfile(response.data);
                    setLoading(false);
                }
            } catch (err) {
                console.error('Ошибка:', err.response?.status, err.message);
                if (isMounted) {
                    setError('Не удалось загрузить данные профиля.');
                    setLoading(false);
                    navigate('/login');
                }
            }
        };

        fetchProfileData();

        return () => {
            isMounted = false;
        };
    }, [isAuthenticated, navigate]);

    const handleLogout = () => {
        logout();
        navigate('/login');
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
        const fullStar = '★';
        const emptyStar = '☆';
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
    console.log('isVerified:', profile.isVerified);

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
                            <p className="info rating">{profile.rating ? renderStars(profile.rating) : 'Нет рейтинга'}</p>
                        </div>

                        {/* Верификация */}
                        <div className="section">
                            <h2 className="subtitle">Верификация:</h2>
                            <p className={`info verification-status ${profile.isVerified ? 'verified' : 'not-verified'}`}>
                                {profile.isVerified ? 'Пройдена' : 'Не пройдена'}
                            </p>
                            {!profile.isVerified && (
                                <button
                                    onClick={() => {
                                        const input = document.createElement('input');
                                        input.type = 'file';
                                        input.multiple = true;
                                        input.onchange = async (e) => {
                                            const files = e.target.files;
                                            await handleUploadDocuments(files);
                                        };
                                        input.click();
                                    }}
                                    className="upload-button"
                                >
                                    Выбрать файлы и загрузить
                                </button>
                            )}
                        </div>

                        {/* Кнопка "Мои жалобы" */}
                        <button onClick={handleMyComplaints} className="complaints-button">
                            Мои жалобы
                        </button>
                        {/* Кнопка "История заказов" */}
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
