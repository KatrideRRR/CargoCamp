import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axiosInstance from "../utils/axiosInstance";
import "../styles/OrderHistotyPage.css";

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

    const fetchCompletedOrders = async () => {
        try {
            const response = await axiosInstance.get(`/orders/completed/${userId}`);
            const formattedOrders = (response.data || []).map((order) => ({
                ...order,
                completedAt: order.completedAt
                    ? new Date(order.completedAt).toLocaleDateString()
                    : "Не указана",
            }));
            setOrders(formattedOrders);
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
    }, [userId]);

    const handleRestore = async (orderId) => {
        try {
            const response = await axiosInstance.post(`/orders/${orderId}/restore`);
            if (response.data.success) {
                alert("Заказ восстановлен!");
                await fetchCompletedOrders();
            } else {
                alert("Не удалось восстановить заказ");
            }
        } catch (error) {
            console.error("Ошибка при восстановлении:", error);
            alert("Ошибка при восстановлении заказа");
        }
    };

    const handlePay = async (orderId) => {
        try {
            const response = await axiosInstance.post(`/payment/pay-pending/${orderId}`);
            const { paymentUrl } = response.data;
            if (paymentUrl) window.location.href = paymentUrl;
            else alert("Не удалось получить ссылку на оплату");
        } catch (error) {
            console.error("Ошибка при оплате:", error);
            alert("Ошибка при попытке оплаты");
        }
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

    if (loading) return <div className="loading-message">Загрузка истории заказов...</div>;
    if (error) return <div className="error-message">Ошибка: {error}</div>;

    return (
        <div className="order-history">
            <div className="pageContainer">
                <div className="contentWrapper">
                    <h1>История заказов ({orders.length})</h1>

                    {orders.length > 0 ? (
                        <ul className="order-list">
                            {[...orders].reverse().map((order) => {
                                const canReview =
                                    order.status === "completed" &&
                                    !!order.executorId &&
                                    !myReviewedOrderIds.has(order.id);

                                return (
                                    <li key={order.id} className="order-item">
                                        <p><strong>№ заказа:</strong> {order.id}</p>
                                        <p><strong>Тип заказа:</strong> {order.type}</p>
                                        <p><strong>Описание:</strong> {order.description}</p>
                                        <p><strong>Адрес:</strong> {order.address}</p>
                                        <p><strong>Цена:</strong> {order.proposedSum} ₽</p>

                                        <p>
                                            <strong>Статус:</strong>{" "}
                                            {order.status === "expired"
                                                ? "Просрочен"
                                                : order.status === "pending_payment"
                                                    ? "Ожидает оплаты"
                                                    : "Завершён"}
                                        </p>

                                        <p><strong>ID создателя:</strong> {order.creatorId}</p>
                                        <p><strong>ID исполнителя:</strong> {order.executorId}</p>
                                        <p><strong>Дата завершения:</strong> {order.completedAt}</p>

                                        {order.contractPath && (
                                            <a
                                                href={`http://localhost:5001/${order.contractPath.replace(
                                                    /^.*contracts[\\/]/,
                                                    "contracts/"
                                                )}`}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                Скачать договор (PDF)
                                            </a>
                                        )}

                                        {order.status === "pending_payment" && (
                                            <button onClick={() => handlePay(order.id)} className="pay-button">
                                                Оплатить и разместить
                                            </button>
                                        )}

                                        {order.status === "expired" && (
                                            <button onClick={() => handleRestore(order.id)} className="restore-button">
                                                Восстановить заказ
                                            </button>
                                        )}

                                        {canReview && (
                                            <button
                                                className="review-button"
                                                onClick={() => {
                                                    setReviewOrder(order);
                                                    setReviewRating(0);
                                                    setReviewText("");
                                                    setReviewModalOpen(true);
                                                }}
                                            >
                                                Оставить отзыв
                                            </button>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                    ) : (
                        <p>Завершенных или просроченных заказов нет.</p>
                    )}
                </div>
            </div>

            {/* Review modal (простая версия, потом сделаем glass красиво) */}
            {reviewModalOpen && reviewOrder && (
                <div className="modal-overlay" onClick={() => !reviewSending && setReviewModalOpen(false)}>
                    <div className="modal" onClick={(e) => e.stopPropagation()}>
                        <h2>Отзыв по заказу #{reviewOrder.id}</h2>

                        <div className="stars">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <span
                                    key={star}
                                    className={star <= reviewRating ? "star selected" : "star"}
                                    onClick={() => !reviewSending && setReviewRating(star)}
                                >
                  ★
                </span>
                            ))}
                        </div>

                        <textarea
                            value={reviewText}
                            onChange={(e) => setReviewText(e.target.value)}
                            rows="4"
                            placeholder="Комментарий (необязательно)"
                            disabled={reviewSending}
                        />

                        <button onClick={submitReview} disabled={reviewSending || reviewRating === 0}>
                            {reviewSending ? "Отправляем..." : "Отправить отзыв"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default OrderHistoryPage;