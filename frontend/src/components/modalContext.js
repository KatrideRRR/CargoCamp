import { toast } from "react-toastify";
import React, { createContext, useState, useEffect } from "react";
import { socket } from "../socketClient";
import axiosInstance from "../utils/axiosInstance";
import "../styles/modalContext.css";
import axios from "axios";

export const ModalContext = createContext(null);

export const ModalProvider = ({ children }) => {
    const [modalData, setModalData] = useState(null);
    const [userId, setUserId] = useState(null);
    const [notificationData, setNotificationData] = useState(null); // модалка одобрения заказа
    const [completionNotificationData, setCompletionNotificationData] = useState(null); // модалка завершения заказа
    const [showRatingModal, setShowRatingModal] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [rating, setRating] = useState(0);
    const [currUser, setCurrUser] = useState(null);

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

    const payDebtFromModal = async () => {
        try {
            const res = await axiosInstance.post("/payments/debt/create");

            if (!res.data?.success) {
                toast.error(res.data?.error || "Ошибка оплаты");
                return;
            }

            if (res.data.noDebt) {
                toast.info("Долгов нет");
                return;
            }

            if (res.data.paidBySavedCard) {
                toast.info("Пробуем списать с привязанной карты...");

                setTimeout(async () => {
                    const refreshed = await axiosInstance.get("/auth/profile");
                    setCurrUser(refreshed.data);

                    if (Number(refreshed.data.debt || 0) === 0) {
                        setNotificationData(null);
                        toast.success("Комиссия оплачена ✅");
                    }
                }, 2500);

                return;
            }

            window.location.href = res.data.confirmationUrl;
        } catch (e) {
            console.error(e);
            toast.error("Ошибка оплаты комиссии");
        }
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

        const handleOrderCompleted = (data) => {
            console.log("🔔 Уведомление о завершении заказа:", data);

            if (data.message) {
                setCompletionNotificationData({
                    title: "Ожидание завершения заказа",
                    description: `Заказ номер ${data.orderId}: ${data.message}`,
                    orderId: data.orderId,
                    creatorId: data.creatorId,
                    executorId: data.executorId,
                });
            }
        };

        socket.on("orderApproved", handleOrderApproved);
        socket.on("orderCompleted", handleOrderCompleted);

        return () => {
            socket.off("orderApproved", handleOrderApproved);
            socket.off("orderCompleted", handleOrderCompleted);
        };
    }, [userId]);

    const handleCompleteOrder = async (orderId, creatorId, executorId) => {
        console.log("▶ Начало завершения заказа", { orderId, creatorId, executorId });

        setSelectedOrder({
            id: orderId,
            creatorId,
            executorId,
        });

        setCompletionNotificationData(null);
        setShowRatingModal(true);
    };

    console.log(modalData);

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
            }}
        >
            {children}

            {/* Модалка одобрения заказа */}
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
                                <div className="modal-note">
                                    Комиссия: <b>{Math.round(notificationData.debt / 100)} ₽</b>
                                </div>

                                <div className="modal-actions">
                                    <button className="modal-btn modal-btn-primary" onClick={payDebtFromModal}>
                                        Оплатить сейчас
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

            {/* Модалка завершения заказа */}
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
                            <button
                                className="modal-btn modal-btn-primary"
                                onClick={() =>
                                    handleCompleteOrder(
                                        completionNotificationData.orderId,
                                        completionNotificationData.creatorId,
                                        completionNotificationData.executorId
                                    )
                                }
                            >
                                Завершить
                            </button>

                            <button
                                className="modal-btn modal-btn-ghost"
                                onClick={handleCompletionNotificationClose}
                            >
                                Позже
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </ModalContext.Provider>
    );
};