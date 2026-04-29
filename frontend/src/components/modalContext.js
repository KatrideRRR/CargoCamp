import { toast } from "react-toastify";
import React, { createContext, useState, useEffect } from "react";
import { socket } from "../socketClient";
import axiosInstance from "../utils/axiosInstance";
import "../styles/modalContext.css";
import axios from "axios";
import ReviewModal from "../components/ReviewModal";
import PaymentProviderSelect from "../components/PaymentProviderSelect";

export const ModalContext = createContext(null);

const formatRub = (value) => {
    const n = Number(value || 0);
    return `${n.toLocaleString("ru-RU")} ₽`;
};

const formatDuration = (start, end) => {
    if (!start || !end) return "—";

    const startDate = new Date(start);
    const endDate = new Date(end);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return "—";

    const diffMs = endDate - startDate;
    if (diffMs <= 0) return "—";

    const totalMin = Math.floor(diffMs / 60000);
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;

    if (hours > 0 && mins > 0) return `${hours} ч ${mins} мин`;
    if (hours > 0) return `${hours} ч`;
    return `${mins} мин`;
};

// ✅ кто может оставлять отзыв
const canReviewOrder = ({ orderType, userId, creatorId, executorId }) => {
    if (!userId) return false;

    // для экспресс-заказа отзыв первым оставляет заказчик
    if (orderType === "express") {
        return Number(userId) === Number(creatorId);
    }

    // для обычного заказа оставляем текущую логику — участник заказа
    return (
        Number(userId) === Number(creatorId) ||
        Number(userId) === Number(executorId)
    );
};

export const ModalProvider = ({ children }) => {
    const [modalData, setModalData] = useState(null);
    const [userId, setUserId] = useState(null);
    const [notificationData, setNotificationData] = useState(null);
    const [completionNotificationData, setCompletionNotificationData] = useState(null);

    const [showRatingModal, setShowRatingModal] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [rating, setRating] = useState(0);
    const [currUser, setCurrUser] = useState(null);
    const [reviewLoading, setReviewLoading] = useState(false);

    const [debtModalData, setDebtModalData] = useState(null);
    const [debtPayLoading, setDebtPayLoading] = useState(false);

    const [completionSuccessData, setCompletionSuccessData] = useState(null);

    const [selectedDebtProvider, setSelectedDebtProvider] = useState("yookassa");
    const [selectedNotificationDebtProvider, setSelectedNotificationDebtProvider] = useState("yookassa");

    useEffect(() => {
        const fetchUserData = async () => {
            try {
                const response = await axiosInstance.get("/auth/profile");
                setCurrUser(response.data);
                setUserId(response.data.id);
            } catch (error) {
                console.log("⛔️ Ошибка поймана:", error);

                if (axios.isAxiosError(error)) {
                    if (error.response?.status === 401) {
                        console.info("ℹ️ Пользователь не авторизован");
                        return;
                    }

                    console.warn(
                        "⚠️ Ответ сервера с ошибкой:",
                        error.response?.status,
                        error.response?.data
                    );
                } else {
                    console.error("❌ Неизвестная ошибка:", error);
                }
            }
        };

        fetchUserData();
    }, []);

    const openReviewFromCompletion = (
        orderId,
        creatorId,
        executorId,
        orderType = "regular"
    ) => {
        setSelectedOrder({
            id: orderId,
            creatorId,
            executorId,
            orderType,
            isExpress: orderType === "express",
        });

        setCompletionNotificationData(null);
        setShowRatingModal(true);
    };

    const openCompletionSuccessModal = (payload) => {
        setCompletionSuccessData(payload);
    };

    const closeCompletionSuccessModal = () => {
        setCompletionSuccessData(null);
    };

    const handleSubmitReview = async ({ rating, text }) => {
        if (!selectedOrder?.id) {
            toast.error("Заказ не выбран");
            return;
        }

        try {
            setReviewLoading(true);

            await axiosInstance.post("/auth/review", {
                orderId: selectedOrder.id,
                rating,
                text,
                isExpress: !!selectedOrder.isExpress,
                orderType: selectedOrder.orderType || (selectedOrder.isExpress ? "express" : "regular"),
            });

            toast.success("Отзыв отправлен");
            setShowRatingModal(false);
            setSelectedOrder(null);
            setRating(0);
        } catch (e) {
            console.error("Ошибка отправки отзыва:", e);
            toast.error(e.response?.data?.message || "Не удалось отправить отзыв");
        } finally {
            setReviewLoading(false);
        }
    };

    const payDebtFromModal = async () => {
        if (!debtModalData) return;

        await payDebt({
            returnPath: debtModalData.returnPath,
            provider: selectedDebtProvider,
        });
    };

    const handleNotificationClose = () => {
        setNotificationData(null);
    };

    const handleCompletionNotificationClose = () => {
        setCompletionNotificationData(null);
    };

    useEffect(() => {
        if (!userId) return;

        const handleOrderApproved = (data) => {
            console.log("🔔 Заказ одобрен:", data);

            if (typeof data.debt === "number") {
                setCurrUser((prev) => (prev ? { ...prev, debt: data.debt } : prev));
            }

            if (data.message?.includes("Ваш запрос")) {
                const isPremiumUser = !!data.isPremium;

                setNotificationData({
                    title: "Ваш запрос одобрен!",
                    description: `Заказ номер ${data.orderId}: ${data.message}`,
                    isPremium: isPremiumUser,
                    orderId: data.orderId,
                    debt: Number(data.debt || 0),
                    needPay: !!data.needPay,
                    paid: !!data.paid,
                });
            }
        };

        const handleExpressOrderCompleted = (data) => {
            console.log("🔔 Экспресс-заказ завершён:", data);

            if (!data?.message) return;

            setCompletionNotificationData({
                title: "Экспресс-заказ завершён",
                description: `Заказ номер ${data.orderId}: ${data.message}`,
                orderId: data.orderId,
                creatorId: data.creatorId,
                executorId: data.executorId,
                orderType: "express",
            });
        };

        const handleOrderCompleted = (data) => {
            console.log("🔔 Уведомление о завершении заказа:", data);

            if (data.message) {
                setCompletionNotificationData({
                    title: "Ожидание завершения заказа",
                    description: `Заказ номер ${data.orderId}: ${data.message}`,
                    orderId: data.orderId,
                    creatorId: data.creatorId,
                    executorId: data.executorId,
                    orderType: data.orderType || "regular",
                });
            }
        };

        socket.on("orderApproved", handleOrderApproved);
        socket.on("orderCompleted", handleOrderCompleted);
        socket.on("expressOrderCompleted", handleExpressOrderCompleted);

        return () => {
            socket.off("orderApproved", handleOrderApproved);
            socket.off("orderCompleted", handleOrderCompleted);
            socket.off("expressOrderCompleted", handleExpressOrderCompleted);
        };
    }, [userId]);

    const openDebtModal = ({ title, description, amount, returnPath }) => {
        setDebtModalData({
            title: title || "Нужно погасить задолженность",
            description:
                description ||
                "У вас есть задолженность по комиссии. Чтобы взять заказ в работу, сначала оплатите её.",
            amount: Number(amount || 0),
            returnPath: returnPath || "/profile?debtReturn=1",
        });
    };

    const closeDebtModal = () => {
        if (debtPayLoading) return;
        setDebtModalData(null);
    };

    const payDebt = async ({ returnPath, provider }) => {
        try {
            setDebtPayLoading(true);

            const endpoint =
                provider === "tbank"
                    ? "/tbank-payments/debt/create"
                    : "/payments/debt/create";

            const res = await axiosInstance.post(endpoint, {
                returnPath: returnPath || "/profile?debtReturn=1",
            });

            if (!res.data?.success) {
                toast.error(res.data?.error || "Ошибка оплаты");
                setDebtPayLoading(false);
                return;
            }

            if (res.data.noDebt) {
                toast.info("Долгов нет");
                setDebtModalData(null);
                setNotificationData(null);
                setDebtPayLoading(false);
                return;
            }

            /**
             * Это актуально для ЮKassa, если есть сохранённая карта.
             * Для Т-Банка сейчас будет обычный редирект.
             */
            if (res.data.paidBySavedCard) {
                toast.info("Пробуем списать с привязанной карты...");

                setTimeout(async () => {
                    try {
                        const refreshed = await axiosInstance.get("/auth/profile");
                        setCurrUser(refreshed.data);

                        if (Number(refreshed.data.debt || 0) === 0) {
                            setDebtModalData(null);
                            setNotificationData(null);
                            toast.success("Комиссия оплачена ✅");
                        } else {
                            toast.info("Платёж обрабатывается. Проверьте статус чуть позже.");
                        }
                    } catch (e) {
                        console.error(e);
                        toast.error("Не удалось обновить профиль после оплаты");
                    } finally {
                        setDebtPayLoading(false);
                    }
                }, 2500);

                return;
            }

            if (!res.data.confirmationUrl) {
                toast.error("Ссылка на оплату не получена");
                setDebtPayLoading(false);
                return;
            }

            window.location.href = res.data.confirmationUrl;
        } catch (e) {
            console.error(e);
            toast.error(e.response?.data?.error || "Ошибка оплаты комиссии");
            setDebtPayLoading(false);
        }
    };

    const handleCompleteOrder = (orderId, creatorId, executorId, orderType = "regular") => {
        setSelectedOrder({
            id: orderId,
            creatorId,
            executorId,
            orderType,
            isExpress: orderType === "express",
        });

        setCompletionNotificationData(null);
        setShowRatingModal(true);
    };

    const canReviewFromCompletionNotification = completionNotificationData
        ? canReviewOrder({
            orderType: completionNotificationData.orderType,
            userId,
            creatorId: completionNotificationData.creatorId,
            executorId: completionNotificationData.executorId,
        })
        : false;

    const canReviewFromSuccessModal = completionSuccessData
        ? canReviewOrder({
            orderType: completionSuccessData.orderType,
            userId,
            creatorId: completionSuccessData.creatorId,
            executorId: completionSuccessData.executorId,
        })
        : false;

    return (
        <ModalContext.Provider
            value={{
                openModal: setModalData,
                closeModal: () => setModalData(null),
                showRatingModal,
                setShowRatingModal,
                selectedOrder,
                setSelectedOrder,
                rating,
                setRating,
                currUser,
                setCurrUser,
                openCompletionSuccessModal,
                closeCompletionSuccessModal,
                openDebtModal,
                closeDebtModal,
            }}
        >
            {children}

            {notificationData && (
                <div className="modal-overlay">
                    <div className="modal modal-compact">
                        <button
                            className="modal-close"
                            onClick={handleNotificationClose}
                            aria-label="Закрыть"
                            type="button"
                        >
                            ×
                        </button>

                        <div className="modal-icon">✓</div>
                        <h2 className="modal-title">{notificationData.title}</h2>
                        <p className="modal-text">{notificationData.description}</p>

                        {notificationData.isPremium ? (
                            <>
                                <div className="modal-note modal-note-success">
                                    У вас активен Premium — комиссия не требуется.
                                </div>

                                <div className="modal-actions">
                                    <button className="modal-btn modal-btn-primary" onClick={handleNotificationClose}>
                                        Понятно
                                    </button>
                                </div>
                            </>
                        ) : notificationData.debt > 0 ? (
                            <>
                                <PaymentProviderSelect
                                    selectedProvider={selectedNotificationDebtProvider}
                                    onSelect={setSelectedNotificationDebtProvider}
                                    disabled={debtPayLoading}
                                />

                                <div className="modal-note">
                                    Комиссия: <b>{Math.round(notificationData.debt / 100)} ₽</b>
                                </div>

                                <div className="modal-actions">
                                    <button
                                        className="modal-btn modal-btn-primary"
                                        onClick={() =>
                                            payDebt({
                                                returnPath: "/profile?debtReturn=1",
                                                provider: selectedNotificationDebtProvider,
                                            })
                                        }
                                        disabled={debtPayLoading}
                                    >
                                        {debtPayLoading ? "Переходим к оплате..." : "Оплатить сейчас"}
                                    </button>

                                    <button className="modal-btn modal-btn-ghost" onClick={handleNotificationClose}>
                                        Позже
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="modal-actions">
                                <button className="modal-btn modal-btn-primary" onClick={handleNotificationClose}>
                                    Понятно
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {completionNotificationData && (
                <div className="modal-overlay">
                    <div className="modal modal-compact">
                        <button
                            className="modal-close"
                            onClick={handleCompletionNotificationClose}
                            aria-label="Закрыть"
                            type="button"
                        >
                            ×
                        </button>

                        <div className="modal-icon">⏳</div>
                        <h2 className="modal-title">{completionNotificationData.title}</h2>
                        <p className="modal-text">{completionNotificationData.description}</p>

                        <div className="modal-actions">
                            {canReviewFromCompletionNotification && (
                                <button
                                    className="modal-btn modal-btn-primary"
                                    onClick={() =>
                                        handleCompleteOrder(
                                            completionNotificationData.orderId,
                                            completionNotificationData.creatorId,
                                            completionNotificationData.executorId,
                                            completionNotificationData.orderType
                                        )
                                    }
                                >
                                    Завершить
                                </button>
                            )}

                            {canReviewFromCompletionNotification && (
                                <button
                                    className="modal-btn modal-btn-ghost"
                                    onClick={() =>
                                        openReviewFromCompletion(
                                            completionNotificationData.orderId,
                                            completionNotificationData.creatorId,
                                            completionNotificationData.executorId,
                                            completionNotificationData.orderType
                                        )
                                    }
                                >
                                    Оставить отзыв
                                </button>
                            )}

                            <button
                                className="modal-btn modal-btn-ghost"
                                onClick={handleCompletionNotificationClose}
                            >
                                {canReviewFromCompletionNotification ? "Позже" : "Закрыть"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {completionSuccessData && (
                <div className="modal-overlay">
                    <div className="modal modal-compact modal-success">
                        <button
                            className="modal-close"
                            onClick={closeCompletionSuccessModal}
                            aria-label="Закрыть"
                            type="button"
                        >
                            ×
                        </button>

                        <div className="modal-icon modal-icon-party">🎉</div>
                        <h2 className="modal-title">Заказ успешно завершён</h2>
                        <p className="modal-text">{completionSuccessData.title}</p>

                        <div className="modal-summary">
                            <div className="modal-summary-row">
                                <span>Ваш доход</span>
                                <b>{formatRub(completionSuccessData.amount)}</b>
                            </div>

                            <div className="modal-summary-row">
                                <span>Время выполнения</span>
                                <b>{formatDuration(completionSuccessData.startedAt, completionSuccessData.completedAt)}</b>
                            </div>
                        </div>

                        <div className="modal-actions">
                            {canReviewFromSuccessModal && (
                                <button
                                    className="modal-btn modal-btn-primary"
                                    onClick={() =>
                                        openReviewFromCompletion(
                                            completionSuccessData.orderId,
                                            completionSuccessData.creatorId,
                                            completionSuccessData.executorId,
                                            completionSuccessData.orderType || "regular"
                                        )
                                    }
                                >
                                    Оставить отзыв
                                </button>
                            )}

                            <button
                                className="modal-btn modal-btn-ghost"
                                onClick={closeCompletionSuccessModal}
                            >
                                Закрыть
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {debtModalData && (
                <div className="modal-overlay">
                    <div className="modal modal-compact">
                        <button
                            className="modal-close"
                            onClick={closeDebtModal}
                            aria-label="Закрыть"
                            type="button"
                        >
                            ×
                        </button>

                        <div className="modal-icon">⚠️</div>
                        <h2 className="modal-title">{debtModalData.title}</h2>
                        <p className="modal-text">{debtModalData.description}</p>

                        <div className="modal-note">
                            К оплате: <b>{Math.round(debtModalData.amount / 100)} ₽</b>
                        </div>

                        <PaymentProviderSelect
                            selectedProvider={selectedDebtProvider}
                            onSelect={setSelectedDebtProvider}
                            disabled={debtPayLoading}
                        />

                        <div className="modal-actions">
                            <button
                                className="modal-btn modal-btn-primary"
                                onClick={payDebtFromModal}
                                disabled={debtPayLoading}
                            >
                                {debtPayLoading ? "Переходим к оплате..." : "Оплатить сейчас"}
                            </button>

                            <button
                                className="modal-btn modal-btn-ghost"
                                onClick={handleNotificationClose}
                                disabled={debtPayLoading}
                            >
                                Позже
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ReviewModal
                isOpen={showRatingModal}
                onClose={() => {
                    if (reviewLoading) return;
                    setShowRatingModal(false);
                    setSelectedOrder(null);
                }}
                onSubmit={handleSubmitReview}
                loading={reviewLoading}
                title="Оставить отзыв"
                subtitle="Оцените участника и при желании добавьте комментарий"
            />
        </ModalContext.Provider>
    );
};