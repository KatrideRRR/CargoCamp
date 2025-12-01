import { toast } from "react-toastify";
import React, { createContext, useState, useEffect } from 'react';
import io from 'socket.io-client';
import axiosInstance from '../utils/axiosInstance';
import '../styles/modalContext.css'
import axios from "axios";
import {useAuth} from "../utils/authContext";
const cloudApi = process.env.CLOUDPAYMENTS_PUBLIC_ID;

const apiUrl = process.env.REACT_APP_API_URL;

export const ModalContext = createContext();
const socket = io(process.env.REACT_APP_SOCKET_URL, {
    transports: ['websocket'],
    withCredentials: true
});

export const ModalProvider = ({ children }) => {
    const [modalData, setModalData] = useState(null);
    const [userId, setUserId] = useState(null);
    const [notificationData, setNotificationData] = useState(null); // Для уведомлений исполнителю
    const [completionNotificationData, setCompletionNotificationData] = useState(null); // Уведомление по завершению заказа
    const [showRatingModal, setShowRatingModal] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [rating, setRating] = useState(0);
    const [currUser, setCurrUser] = useState(null);
    const auth = useAuth() || {};
    const user = auth.user || null;
    const [debtAmount, setDebtAmount] = useState(0);
    const [hasDebt, setHasDebt] = useState(false);
    const [profile, setProfile] = useState(null);
    const { title = '', description = '', isPremium = false, onClose = () => {} } = notificationData || {};
    const [modal, setModal] = useState(null);

    useEffect(() => {
        const fetchUserData = async () => {
            try {
                const response = await axiosInstance.get('/auth/profile');
                setCurrUser(response.data);     // <-- добавлено
                setUserId(response.data.id);
                socket.emit('register', response.data.id);
            } catch (error) {
                console.log('⛔️ Ошибка поймана:', error); // <-- сюда попадает?

                if (axios.isAxiosError(error)) {
                    if (error.response?.status === 401) {
                        console.info("ℹ️ Пользователь не авторизован");
                        return;
                    }

                    console.warn("⚠️ Ответ сервера с ошибкой:", error.response?.status, error.response?.data);
                } else {
                    console.error("❌ Неизвестная ошибка:", error);
                }
            }
        };

        fetchUserData();
    }, []);

    const fetchCommission = async (orderId) => {
        try {
            const res = await axiosInstance.post('/payments/commission/check', {
                userId: currUser.id,
                orderId
            });

            if (!res.data.success) {
                throw new Error("Ошибка получения комиссии");
            }

            return res.data; // { commissionRub, commissionKopecks, isPremium }
        } catch (e) {
            console.error("Ошибка получения комиссии:", e);
            toast.error("Не удалось получить комиссию");
            return null;
        }
    };

    const openCommissionWidget = async (orderId) => {
        const info = await fetchCommission(orderId);
        if (!info) return;

        if (info.isPremium || info.commissionRub <= 0) {
            toast.success("У вас Premium — комиссия не требуется 🎉");
            return;
        }

        const amount = Number(info.commissionRub);
        if (!amount || amount <= 0) {
            toast.success("Комиссия отсутствует или Premium — оплата не требуется 🎉");
            return;
        }

        if (!window.cp) {
            console.error("CloudPayments widget not loaded");
            return;
        }

        const widget = new window.cp.CloudPayments();

        widget.charge(
            {
                publicId: cloudApi,
                description: `Комиссия за заказ #${orderId}`,
                amount,                        // <- число
                currency: "RUB",
                invoiceId: `commission_${orderId}`, // <- max 50 символов
                accountId: String(currUser.id)      // <- лучше уникальный идентификатор платежа

            },
            async (options) => {
                if (!options?.cardCryptogramPacket) {
                    toast.error("Ошибка: не получена криптограмма карты");
                    return;
                }
                await handlePayCommission(orderId, options.cardCryptogramPacket);
            },
            (reason) => {
                console.error("Платёж отменён:", reason);
            }
        );
    };

    const handlePayCommission = async (orderId, cardCryptogramPacket) => {
        try {
            const res = await axiosInstance.post(`/payments/commission`, {
                userId: currUser.id,
                orderId,
                cardCryptogramPacket,
            });

            if (res.data.success) {
                console.log("Комиссия оплачена:", res.data);

                // обновляем пользователя
                setCurrUser(prev => ({ ...prev, debt: 0 }));

                toast.success("Комиссия успешно оплачена!");

                // закрываем модалку, если нужно
                setModal(null);
            } else {
                console.error(res.data);
                toast.error(res.data.error || "Ошибка оплаты");
            }
        } catch (err) {
            console.error("Ошибка оплаты комиссии:", err);
            toast.error("Ошибка оплаты");
        }
    };

    const handleNotificationClose = () => {
        // Если не премиум и не оплачено — создаём долг
        if (notificationData && !notificationData.isPremium && !notificationData.paid) {
            setCurrUser(prev => ({
                ...prev,
                debt: (prev.debt || 0) + notificationData.commissionAmount || 0
            }));
        }
        setNotificationData(null);
    };

    useEffect(() => {

        if (userId) {
            console.log("🔄 Подключаем WebSocket для пользователя:", userId);


            // Слушаем уведомления для исполнителя
            socket.on('orderApproved', (data) => {
                console.log("🔔 Заказ одобрен:", data);

                // обновляем долг пользователя, если сервер прислал
                if (typeof data.debt === "number") {
                    setCurrUser(prev => ({ ...prev, debt: data.debt }));
                }

                if (data.message.includes("Ваш запрос")) {
                    const isPremiumUser = currUser?.subscription_type === "premium";

                    setNotificationData({
                        title: "Ваш запрос одобрен!",
                        description: `Заказ номер ${data.orderId}: ${data.message}`,
                        isPremium: isPremiumUser,
                        orderId: data.orderId,
                        commissionAmount: data.commissionAmount, // <<< ВАЖНО
                        paid: data.paid || false,
                        onClose: () => setNotificationData(null),
                    });
                }
            });

            // Слушаем уведомления о завершении заказа
            socket.on('orderCompleted', (data) => {
                console.log("🔔 Уведомление о завершении заказа:", data);

                if (data.message) {
                    setCompletionNotificationData({
                        title: "Ожидание завершения заказа",
                        description: `Заказ номер ${data.orderId}: ${data.message}`,
                        orderId: data.orderId,
                        creatorId: data.creatorId,  // ✅ Добавили
                        executorId: data.executorId // ✅ Добавили
                    });
                }
            });


            return () => {
                socket.off('orderApproved');
                socket.off('orderCompleted');
            };
        }
    }, [userId]);

    const handleCompleteOrder = async (orderId, creatorId, executorId) => {
        console.log("▶ Начало завершения заказа", { orderId, creatorId, executorId });

        setSelectedOrder({
            id: orderId,
            creatorId,
            executorId
        });

        setShowRatingModal(true);

    };

    const submitRating = async () => {
        if (!selectedOrder || rating === 0) {
            console.error("⛔ Ошибка: заказ не выбран или рейтинг не установлен");
            return;
        }

        try {
            console.log(`📤 Отправка рейтинга: ${rating} для заказа ${selectedOrder.id}`);

            const token = localStorage.getItem('authToken');
            console.log("🎯 Данные о заказе перед отправкой рейтинга:", selectedOrder);
            console.log("👤 Текущий пользователь (ставит оценку):", userId);
            // Определяем, кого оценивает пользователь
            const ratedUserId = selectedOrder.executorId === userId
                ? selectedOrder.creatorId
                : selectedOrder.executorId;

            console.log("🎯 Оценка пользователя:", ratedUserId);

            // Отправляем рейтинг
            await axiosInstance.post("/auth/rate", {
                userId: ratedUserId,
                rating,

            }, {
                headers: { Authorization: `Bearer ${token}` },
            });

            // Завершаем заказ
            await axiosInstance.post(`/orders/complete/${selectedOrder.id}`, {},
                { headers: { Authorization: `Bearer ${token}` } }
            );

            console.log("✅ Заказ успешно завершен");
            setCompletionNotificationData(null);

            // Закрываем модал и сбрасываем состояния
            setShowRatingModal(false);
            setSelectedOrder(null);
            setRating(0);

        } catch (error) {
            console.error("❌ Ошибка при завершении заказа или отправке рейтинга", error);
        }
    };

    console.log(modalData);

    return (
        <ModalContext.Provider value={{ openModal: setModalData, closeModal: () => setModalData(null) }}>
            {children}

                    {/* Уведомление для исполнителя в виде модала */}
            {notificationData && (
                <div className="modal-overlay">
                    <div className="modal">
                        <h2>{notificationData.title}</h2>
                        <p>{notificationData.description}</p>

                        {!notificationData.isPremium && (
                            <button onClick={() => openCommissionWidget(notificationData.orderId)} >
                                Оплатить комиссию
                            </button>

                        )}
                        {notificationData.isPremium && (
                            <p className="text-green-600">
                                У вас активен Premium — комиссия не требуется 🎉
                            </p>
                        )}

                        <button onClick={handleNotificationClose}>Закрыть</button>
                    </div>
                </div>
            )}

            {/* Окно завершения заказа */}
            {completionNotificationData && (
                <div className="modal-overlay">
                    <div className="modal">
                        <h2>{completionNotificationData.title}</h2>
                        <p>{completionNotificationData.description}</p>
                        <button onClick={() => handleCompleteOrder(
                            completionNotificationData.orderId,
                            completionNotificationData.creatorId,
                            completionNotificationData.executorId
                        )}>
                            Завершить
                        </button>

                    </div>
                </div>
            )}

            {/* Модальное окно для оценки */}
            {showRatingModal && selectedOrder && (
                <div className="modal-overlay">
                <div className="modal">
                        <h2>Оцените участника</h2>
                        <div className="stars">
                            {[1, 2, 3, 4, 5].map((star) => (
                                <span
                                    key={star}
                                    className={star <= rating ? "star selected" : "star"}
                                    onClick={() => setRating(star)}
                                >
                                    ★
                                </span>
                            ))}
                        </div>
                        <button onClick={submitRating} disabled={rating === 0}>
                            Завершить заказ
                        </button>
                    </div>
                </div>
            )}

        </ModalContext.Provider>
    );
};
