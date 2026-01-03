import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import axiosInstance from "../utils/axiosInstance";
import "../styles/OrderHistotyPage.css";

import { FiFileText, FiStar, FiCheckCircle } from "react-icons/fi";
import { FaRegMoneyBillAlt } from "react-icons/fa";

const apiUrl = process.env.REACT_APP_API_URL;

const OrderHistoryPage = () => {
    const { userId } = useParams();

    const [orders, setOrders] = useState([]);
    const [myReviewedOrderIds, setMyReviewedOrderIds] = useState(() => new Set());

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // review modal state
    const [reviewModalOpen, setReviewModalOpen] = useState(false);
    const [reviewOrder, setReviewOrder] = useState(null);
    const [reviewRating, setReviewRating] = useState(0);
    const [reviewText, setReviewText] = useState("");
    const [reviewSending, setReviewSending] = useState(false);

    // UI
    const [expandedDesc, setExpandedDesc] = useState(() => ({})); // orderId -> bool

    const fetchCompletedOrders = async () => {
        try {
            const response = await axiosInstance.get(`/orders/completed/${userId}`);
            const formatted = (response.data || []).map((order) => ({
                ...order,
                completedAt: order.completedAt
                    ? new Date(order.completedAt).toLocaleDateString()
                    : "Не указана",
            }));
            setOrders(formatted);
        } catch (err) {
            setError(err.response?.data?.message || "Ошибка загрузки заказов");
        }
    };

    const fetchMyReviews = async () => {
        try {
            const res = await axiosInstance.get("/auth/reviews/my");
            const ids = new Set((res.data?.reviews || []).map((r) => r.orderId));
            setMyReviewedOrderIds(ids);
        } catch (e) {
            console.error("fetchMyReviews error:", e);
        }
    };

    useEffect(() => {
        (async () => {
            try {
                setLoading(true);
                setError(null);
                await Promise.all([fetchCompletedOrders(), fetchMyReviews()]);
            } finally {
                setLoading(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

    const canReview = (order) =>
        order.status === "completed" && !!order.executorId && !myReviewedOrderIds.has(order.id);

    const toggleDesc = (orderId) => {
        setExpandedDesc((prev) => ({ ...prev, [orderId]: !prev[orderId] }));
    };

    const submitReview = async () => {
        if (!reviewOrder) return;
        if (reviewRating < 1 || reviewRating > 5) {
            alert("Поставь оценку от 1 до 5");
            return;
        }

        try {
            setReviewSending(true);

            await axiosInstance.post("/auth/review", {
                orderId: reviewOrder.id,
                rating: reviewRating,
                text: reviewText,
            });

            setMyReviewedOrderIds((prev) => {
                const next = new Set(prev);
                next.add(reviewOrder.id);
                return next;
            });

            setReviewModalOpen(false);
            setReviewOrder(null);
            setReviewRating(0);
            setReviewText("");
            alert("Отзыв сохранён ✅");
        } catch (e) {
            console.error("submitReview error:", e);
            alert(e.response?.data?.message || "Не удалось отправить отзыв");
        } finally {
            setReviewSending(false);
        }
    };

    const sortedOrders = useMemo(() => [...orders].reverse(), [orders]);

    if (loading) return <div className="oh-state">Загрузка истории заказов…</div>;
    if (error) return <div className="oh-state oh-state--error">Ошибка: {error}</div>;

    return (
        <div className="oh-page">
            <div className="oh-shell">
                <div className="oh-header glass">
                    <div className="oh-title-row">
                        <div className="oh-title">История заказов</div>
                        <span className="oh-count">{orders.length}</span>
                    </div>
                    <div className="oh-subtitle">Здесь отображаются завершённые заказы</div>
                </div>

                {orders.length > 0 ? (
                    <ul className="oh-list">
                        {sortedOrders.map((order) => {
                            const isDescExpanded = !!expandedDesc[order.id];
                            const desc = order.description || "—";
                            const shouldClamp = desc && desc.length > 140;

                            return (
                                <li key={order.id} className="oh-card glass">
                                    <div className="oh-card-head">
                                        <div className="oh-card-head-left">
                                            <div className="oh-order-num">Заказ №{order.id}</div>

                                            <div className="oh-meta">
                        <span className="oh-pill oh-pill--done">
                          <FiCheckCircle style={{ marginRight: 6 }} />
                          Завершён
                        </span>

                                                <span className="oh-dot">•</span>
                                                <span className="oh-muted">Дата: {order.completedAt}</span>
                                            </div>
                                        </div>

                                        <div className="oh-price">
                                            <FaRegMoneyBillAlt style={{ marginRight: 8 }} />
                                            <span className="oh-price-val">{order.proposedSum} ₽</span>
                                        </div>
                                    </div>

                                    <div className="oh-grid">
                                        <div className="oh-kv">
                                            <span className="oh-k">Тип</span>
                                            <span className="oh-v">{order.type || "—"}</span>
                                        </div>

                                        <div className="oh-kv">
                                            <span className="oh-k">Адрес</span>
                                            <span className="oh-v">{order.address || "—"}</span>
                                        </div>

                                        <div className="oh-kv oh-kv--wide">
                                            <div className="oh-desc-head">
                                                <span className="oh-k">Описание</span>

                                                {shouldClamp && (
                                                    <button
                                                        type="button"
                                                        className="oh-link-btn"
                                                        onClick={() => toggleDesc(order.id)}
                                                    >
                                                        {isDescExpanded ? "Свернуть" : "Подробнее"}
                                                    </button>
                                                )}
                                            </div>

                                            <span
                                                className={`oh-v oh-desc ${shouldClamp ? "clampable" : ""} ${
                                                    isDescExpanded ? "expanded" : "collapsed"
                                                }`}
                                            >
                        {desc}
                      </span>
                                        </div>

                                        <div className="oh-kv">
                                            <span className="oh-k">ID создателя</span>
                                            <span className="oh-v">{order.creatorId || "—"}</span>
                                        </div>

                                        <div className="oh-kv">
                                            <span className="oh-k">ID исполнителя</span>
                                            <span className="oh-v">{order.executorId || "—"}</span>
                                        </div>
                                    </div>

                                    <div className="oh-actions">
                                        {order.contractPath && (
                                            <a
                                                className="btn btn-ghost"
                                                href={`${apiUrl || "http://localhost:5001"}/${order.contractPath.replace(
                                                    /^.*contracts[\\/]/,
                                                    "contracts/"
                                                )}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                <FiFileText style={{ marginRight: 8 }} />
                                                Скачать договор (PDF)
                                            </a>
                                        )}

                                        {canReview(order) ? (
                                            <button
                                                className="btn btn-primary"
                                                onClick={() => {
                                                    setReviewOrder(order);
                                                    setReviewRating(0);
                                                    setReviewText("");
                                                    setReviewModalOpen(true);
                                                }}
                                            >
                                                <FiStar style={{ marginRight: 8 }} />
                                                Оставить отзыв
                                            </button>
                                        ) : (
                                            <span className="oh-pill oh-pill--muted">
                        <FiCheckCircle style={{ marginRight: 6 }} />
                        Отзыв недоступен
                      </span>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                ) : (
                    <div className="oh-empty glass">
                        <div className="oh-empty-title">Пока пусто</div>
                        <div className="oh-empty-sub">Завершённых заказов ещё нет.</div>
                    </div>
                )}
            </div>

            {/* Review modal (glass) */}
            {reviewModalOpen && reviewOrder && (
                <div
                    className="oh-modal-overlay"
                    onClick={() => !reviewSending && setReviewModalOpen(false)}
                >
                    <div className="oh-modal glass" onClick={(e) => e.stopPropagation()}>
                        <div className="oh-modal-head">
                            <div className="oh-modal-title">Отзыв по заказу #{reviewOrder.id}</div>
                            <button
                                className="btn btn-ghost"
                                onClick={() => !reviewSending && setReviewModalOpen(false)}
                            >
                                Закрыть
                            </button>
                        </div>

                        <div className="oh-stars">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <button
                                    key={star}
                                    type="button"
                                    className={`oh-star ${star <= reviewRating ? "selected" : ""}`}
                                    onClick={() => !reviewSending && setReviewRating(star)}
                                    aria-label={`Поставить ${star}`}
                                >
                                    ★
                                </button>
                            ))}
                        </div>

                        <textarea
                            className="oh-textarea"
                            value={reviewText}
                            onChange={(e) => setReviewText(e.target.value)}
                            rows="4"
                            placeholder="Комментарий (необязательно)"
                            disabled={reviewSending}
                        />

                        <div className="oh-modal-actions">
                            <button
                                className="btn btn-ghost"
                                onClick={() => setReviewText("")}
                                disabled={reviewSending}
                            >
                                Очистить
                            </button>

                            <button
                                className="btn btn-primary"
                                onClick={submitReview}
                                disabled={reviewSending || reviewRating === 0}
                            >
                                {reviewSending ? "Отправляем…" : "Отправить отзыв"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OrderHistoryPage;