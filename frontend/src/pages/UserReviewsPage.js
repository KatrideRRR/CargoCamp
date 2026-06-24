import React, { useEffect, useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useParams, Link, useNavigate } from "react-router-dom";
import axiosInstance from "../utils/axiosInstance";
import "../styles/UserReviewsPage.css";

const Stars = ({ value = 0 }) => {
    const v = Math.max(0, Math.min(5, Number(value) || 0));
    const full = Math.round(v);
    return (
        <div className="stars" aria-label={`Рейтинг ${v} из 5`}>
            {[1, 2, 3, 4, 5].map((i) => (
                <span key={i} className={i <= full ? "star on" : "star"}>★</span>
            ))}
        </div>
    );
};

const UserReviewsPage = () => {
    const { userId } = useParams();
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

    const [user, setUser] = useState(null);        // профиль
    const [reviews, setReviews] = useState([]);    // отзывы на пользователя
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const avgRating = useMemo(() => {
        const list = Array.isArray(reviews) ? reviews : [];
        if (!list.length) return 0;
        const sum = list.reduce((acc, r) => acc + Number(r.rating || 0), 0);
        return sum / list.length;
    }, [reviews]);

    const fetchReviewsData = async ({ silent = false } = {}) => {
        try {
            if (!silent) {
                setLoading(true);
            }

            setError(null);

            const [uRes, rRes] = await Promise.all([
                axiosInstance.get(`/auth/user/${userId}`),
                axiosInstance.get(`/auth/reviews/user/${userId}`),
            ]);

            setUser(uRes.data);
            setReviews(rRes.data?.reviews || []);
        } catch (err) {
            setError(err.response?.data?.message || "Ошибка загрузки данных");
        } finally {
            if (!silent) {
                setLoading(false);
            }
        }
    };

    useEffect(() => {
        fetchReviewsData();

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

    useEffect(() => {
        const onPullToRefresh = async (e) => {
            try {
                await fetchReviewsData({ silent: true });
            } finally {
                e.detail?.done?.();
            }
        };

        window.addEventListener("appPullToRefresh", onPullToRefresh);

        return () => {
            window.removeEventListener("appPullToRefresh", onPullToRefresh);
        };

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

    if (loading) return <div className="reviewsPageState">Загрузка...</div>;
    if (error) return <div className="reviewsPageState error">Ошибка: {error}</div>;

    return (
        <div className={`reviewsPage reviewsPage--${platform}`}>
            <div className="reviewsWrap">
                <div className="reviewsTop">
                    <button className="backBtn" onClick={() => navigate(-1)}>← Назад</button>

                    <div className="titleRow">
                        <h1 className="title">Отзывы</h1>
                        <div className="countPill">{reviews.length}</div>
                    </div>

                    <div className="userCard">
                        <div className="userMain">
                            <div className="userName">{user?.username || "Пользователь"}</div>
                            <div className="userMeta">ID: {user?.id}</div>
                        </div>

                        <div className="ratingBox">
                            <div className="ratingValue">{avgRating ? avgRating.toFixed(1) : "—"}</div>
                            <Stars value={avgRating} />
                            <div className="ratingHint">средняя по отзывам</div>
                        </div>
                    </div>

                    <Link to={`/user-orders/${userId}`} className="viewOrdersBtn">
                        Посмотреть заказы пользователя
                    </Link>
                </div>

                {reviews.length > 0 ? (
                    <ul className="reviewsList">
                        {reviews.map((r) => (
                            <li key={r.id} className="reviewCard">
                                <div className="reviewHeader">
                                    <div className="left">
                                        <div className="orderPill">Заказ #{r.orderId}</div>
                                        <div className="datePill">
                                            {r.createdAt ? new Date(r.createdAt).toLocaleString() : ""}
                                        </div>
                                    </div>

                                    <div className="right">
                                        <div className="score">{Number(r.rating || 0).toFixed(0)}</div>
                                        <Stars value={r.rating} />
                                    </div>
                                </div>

                                {r.text ? (
                                    <div className="reviewText">{r.text}</div>
                                ) : (
                                    <div className="reviewText muted">Без комментария</div>
                                )}

                                <div className="reviewFooter">
                                    <span className="fromUser">От пользователя ID: {r.fromUserId}</span>
                                </div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="emptyState">
                        Пока нет отзывов.
                    </div>
                )}
            </div>
        </div>
    );
};

export default UserReviewsPage;