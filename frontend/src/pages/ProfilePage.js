import { toast } from "react-toastify";
import React, { useEffect, useMemo, useState } from "react";
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
    const [showAgreement, setShowAgreement] = useState(false);
    const [hasDebt, setHasDebt] = useState(false);
    const [debtAmount, setDebtAmount] = useState(0);

    const navigate = useNavigate();
    const { logout, isAuthenticated } = useAuth();

    const getRemainingDays = (expiresAt) => {
        if (!expiresAt) return 0;
        const now = new Date();
        const expiration = new Date(expiresAt);
        const diff = expiration - now;
        return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
    };

    const subscriptionLabel = useMemo(() => {
        if (!profile) return "";
        if (profile.subscriptionType === "premium") {
            return `Премиум активен • осталось ${getRemainingDays(profile.subscriptionExpiresAt)} дн.`;
        }
        if (profile.subscriptionType === "trial") {
            return `Пробная подписка • осталось ${getRemainingDays(profile.subscriptionExpiresAt)} дн.`;
        }
        return "Обычный аккаунт";
    }, [profile]);

    useEffect(() => {
        let isMounted = true;

        const fetchProfileData = async () => {
            const token = localStorage.getItem("authToken");
            if (!token) {
                navigate("/login");
                return;
            }

            try {
                const response = await axios.get(`${apiUrl}/api/auth/profile`, {
                    headers: { Authorization: `Bearer ${token}` },
                });

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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [profile]);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (
            params.get("bindReturn") === "1" ||
            params.get("debtReturn") === "1" ||
            params.get("premiumReturn") === "1"
        ) {
            setTimeout(() => window.location.reload(), 1500);
        }
    }, []);

    const loadDebtStatus = async () => {
        const token = localStorage.getItem("authToken");

        try {
            const response = await axios.get(`${apiUrl}/api/orders/me/status`, {
                headers: { Authorization: `Bearer ${token}` },
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
            if (!token) return toast.error("Вы не авторизованы");
            if (!debtAmount || debtAmount <= 0) return toast.info("Долгов нет");

            const res = await axios.post(
                `${apiUrl}/api/payments/debt/create`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );

            if (!res.data?.success) return toast.error(res.data?.error || "Ошибка создания платежа");
            if (res.data.noDebt) return toast.info("Долгов нет");

            window.location.href = res.data.confirmationUrl;
        } catch (e) {
            console.error("handlePayDebt error:", e);
            toast.error("Ошибка при оплате задолженности");
        }
    };

    const handleBuyPremium = async (duration) => {
        try {
            const token = localStorage.getItem("authToken");
            if (!token) return toast.error("Вы не авторизованы");

            const res = await axios.post(
                `${apiUrl}/api/payments/premium/create`,
                { duration },
                { headers: { Authorization: `Bearer ${token}` } }
            );

            if (!res.data?.success) return toast.error(res.data?.error || "Ошибка создания платежа");

            window.location.href = res.data.confirmationUrl;
        } catch (e) {
            console.error(e);
            toast.error("Ошибка при оплате Premium");
        }
    };

    const handleBindCard = async () => {
        try {
            const token = localStorage.getItem("authToken");
            if (!token) return toast.error("Вы не авторизованы");

            const res = await axios.post(
                `${apiUrl}/api/payments/card/bind/create`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );

            if (!res.data?.success) return toast.error(res.data?.error || "Ошибка привязки карты");

            window.location.href = res.data.confirmationUrl;
        } catch (e) {
            console.error("bind card error:", e);
            toast.error("Ошибка привязки карты");
        }
    };

    const handleUnbindCard = async () => {
        try {
            const token = localStorage.getItem("authToken");
            if (!token) return toast.error("Вы не авторизованы");

            const res = await axios.post(
                `${apiUrl}/api/payments/card/unbind`,
                {},
                { headers: { Authorization: `Bearer ${token}` } }
            );

            if (res.data?.success) {
                toast.success("Карта успешно удалена");
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
        if (profile) navigate(`/complaints/${profile.id}`);
    };

    const handleOrderHistory = () => {
        if (profile) navigate(`/orders-history/${profile.id}`);
    };

    const renderStars = (rating) => {
        const maxStars = 5;
        const fullStar = "★";
        const emptyStar = "☆";
        return fullStar.repeat(Math.round(rating)) + emptyStar.repeat(maxStars - Math.round(rating));
    };

    const handleAgree = () => {
        setShowAgreement(false);
        handleBindCard();
    };

    const handleAutoUpload = async (files) => {
        const token = localStorage.getItem("authToken");
        if (!files.length) return;

        const formData = new FormData();
        for (let file of files) formData.append("documents", file);

        try {
            await axios.post(`${apiUrl}/api/auth/upload-documents`, formData, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "multipart/form-data",
                },
            });

            toast.success("Документы успешно загружены");
        } catch (error) {
            console.error("Ошибка загрузки документов:", error);
            toast.error("Ошибка загрузки документов");
        }
    };

    const verificationText = useMemo(() => {
        if (!profile) return "";
        if (profile.userStatus === "pensioner") return "Пенсионер";
        if (profile.userStatus === "verified") return "Пройдена";
        return "Не пройдена";
    }, [profile]);

    if (loading) return <div className="profile-loading">Загрузка данных профиля...</div>;
    if (error)
        return (
            <div className="profile-loading">
                <p className="profile-error">{error}</p>
            </div>
        );

    return (
        <div className="profile-page">
            <div className="profile-shell">
                <div className="profile-header glass">
                    <div className="profile-header-top">
                        <div>
                            <h1 className="profile-title">Профиль</h1>
                            <p className="profile-subtitle">Управление аккаунтом и оплатой</p>
                        </div>

                        <button className="profile-chip" onClick={() => navigate("/info")}>
                            Информация
                        </button>
                    </div>

                    {profile && (
                        <div className="profile-identity">
                            <div className="identity-row">
                                <div className="identity-main">
                                    <div className="identity-name">{profile.username}</div>
                                    <div className="identity-meta">
                                        <span className="identity-pill">ID: {profile.id}</span>
                                        <span className="identity-pill">
                      Рейтинг: {profile.rating ? renderStars(profile.rating) : "Нет"}
                    </span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Платежи */}
                <div className="profile-card glass">
                    <div className="card-head">
                        <div>
                            <h2 className="card-title">Платежи</h2>
                            <p className="card-subtitle">Карта, комиссия и задолженность</p>
                        </div>
                    </div>

                    {paymentMethodId ? (
                        <div className="card-row">
                            <div className="card-row-text">
                                <div className="card-strong">Карта привязана</div>
                                <div className="card-muted">
                                    {profile?.cardType} •••• {profile?.cardLastFour}
                                </div>
                            </div>
                            <button className="btn btn-ghost-danger" onClick={handleUnbindCard}>
                                Удалить
                            </button>
                        </div>
                    ) : (
                        <button className="btn btn-primary" onClick={handleBindCard}>
                            Привязать карту
                        </button>
                    )}

                    {hasDebt && (
                        <div className="alert alert-danger">
                            <div>
                                <div className="alert-title">Задолженность по комиссии</div>
                                <div className="alert-text">{(debtAmount / 100).toFixed(2)} ₽</div>
                            </div>
                            <button className="btn btn-danger" onClick={handlePayDebt}>
                                Оплатить
                            </button>
                        </div>
                    )}
                </div>

                {/* Premium */}
                <div className="profile-card glass">
                    <div className="card-head">
                        <div>
                            <h2 className="card-title">Premium</h2>
                            <p className="card-subtitle">{subscriptionLabel}</p>
                        </div>
                    </div>

                    <div className="grid-2">
                        <button className="btn btn-primary" onClick={() => handleBuyPremium("7d")}>
                            Купить (7 дней)
                        </button>
                        <button className="btn btn-primary" onClick={() => handleBuyPremium("30d")}>
                            Купить (30 дней)
                        </button>
                    </div>
                </div>

                {/* Верификация */}
                <div className="profile-card glass">
                    <div className="card-head">
                        <div>
                            <h2 className="card-title">Верификация</h2>
                            <p className={`card-subtitle status-${profile?.userStatus || "unknown"}`}>
                                {verificationText}
                            </p>
                        </div>

                        <button className="profile-chip" onClick={() => setShowVerificationModal(true)}>
                            Подробнее
                        </button>
                    </div>

                    <label className="upload-glass">
                        <input
                            type="file"
                            multiple
                            accept="image/*,.pdf"
                            onChange={(e) => handleAutoUpload(e.target.files)}
                            style={{ display: "none" }}
                        />
                        <span>Загрузить документы</span>
                    </label>
                </div>

                {/* Действия */}
                <div className="profile-actions glass">
                    <button onClick={handleMyComplaints} className="btn btn-ghost">
                        Мои жалобы
                    </button>
                    <button onClick={handleOrderHistory} className="btn btn-ghost">
                        История заказов
                    </button>
                    <button onClick={() => navigate("/info")} className="btn btn-ghost">
                        Информация и документы
                    </button>
                    <button onClick={handleLogout} className="btn btn-ghost-danger">
                        Выйти
                    </button>
                </div>
            </div>

            {showAgreement && (
                <AgreementModal
                    isOpen={showAgreement}
                    onClose={() => setShowAgreement(false)}
                    onAgree={handleAgree}
                    onCancel={() => setShowAgreement(false)}
                />
            )}

            {showVerificationModal && (
                <div className="modal-overlay" onClick={() => setShowVerificationModal(false)}>
                    <div className="modal-window" onClick={(e) => e.stopPropagation()}>
                        <h3>О верификации пользователя</h3>
                        <div className="modal-content">
                            <p>
                                Верификация необходима для повышения доверия к вам как к пользователю платформы. Мы просим
                                загрузить скан паспорта или другого документа, удостоверяющего личность, чтобы подтвердить,
                                что вы — реальный человек.
                            </p>
                            <p>
                                <strong>Для пенсионеров:</strong> если вы подтвердите пенсионный статус, исполнители будут
                                видеть отметку и получать <strong>скидку на комиссию</strong>.
                            </p>
                            <p>🔒 Все документы обрабатываются вручную и хранятся в зашифрованном виде.</p>
                            <p className="warning">
                                ⚠️ Попытка загрузки поддельных документов приведет к ограничению или блокировке аккаунта.
                            </p>

                            <button className="btn btn-ghost" onClick={() => setShowVerificationModal(false)}>
                                Закрыть
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ProfilePage;