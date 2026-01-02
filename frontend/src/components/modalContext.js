import { toast } from "react-toastify";
import React, { createContext, useState, useEffect } from 'react';
import io from 'socket.io-client';
import axiosInstance from '../utils/axiosInstance';
import '../styles/modalContext.css'
import axios from "axios";
export const ModalContext = createContext(null);

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

    useEffect(() => {
        const fetchUserData = async () => {
            try {
                const response = await axiosInstance.get('/auth/profile');
                setCurrUser(response.data);
                setUserId(response.data.id);
                socket.emit('register', response.data.id);
            } catch (error) {
                console.log('⛔️ Ошибка поймана:', error);

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

    const payDebtFromModal = async () => {
        try {
            const res = await axiosInstance.post('/payments/debt/create');

            if (!res.data?.success) {
                toast.error(res.data?.error || 'Ошибка оплаты');
                return;
            }

            if (res.data.noDebt) {
                toast.info('Долгов нет');
                return;
            }

            if (res.data.paidBySavedCard) {
                toast.info('Пробуем списать с привязанной карты...');

                setTimeout(async () => {
                    const refreshed = await axiosInstance.get('/auth/profile');
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
            toast.error('Ошибка оплаты комиссии');
        }
    };

    const handleNotificationClose = () => {
        setNotificationData(null);
    };

    useEffect(() => {

        if (userId) {
            console.log("🔄 Подключаем WebSocket для пользователя:", userId);

            socket.on('orderApproved', (data) => {
                console.log("🔔 Заказ одобрен:", data);

                if (typeof data.debt === "number") {
                    setCurrUser(prev => prev ? ({ ...prev, debt: data.debt }) : prev);
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
            });

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

                        {notificationData.isPremium ? (
                            <p className="text-green-600">
                                У вас активен Premium — комиссия не требуется 🎉
                            </p>
                        ) : notificationData.debt > 0 ? (
                            <>
                                <p style={{ marginTop: 8 }}>
                                    Комиссия: <b>{Math.round(notificationData.debt / 100)} ₽</b>
                                </p>

                                <button onClick={payDebtFromModal}>
                                    Оплатить сейчас
                                </button>

                                <button onClick={handleNotificationClose}>
                                    Оплатить позже
                                </button>
                            </>
                        ) : (
                            <button onClick={handleNotificationClose}>
                                Ок
                            </button>
                        )}
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
        </ModalContext.Provider>
    );
};
