import React, { createContext, useState, useEffect } from 'react';
import io from 'socket.io-client';
import axiosInstance from '../utils/axiosInstance';
import '../styles/modalContext.css'

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
    const [paymentUrl, setPaymentUrl] = useState(null); // Ссылка на оплату

    useEffect(() => {
        const fetchUserData = async () => {
            try {
                const response = await axiosInstance.get('/auth/profile');
                setUserId(response.data.id);
                socket.emit('register', response.data.id); // Регистрация пользователя на сокете
            } catch (error) {
                console.error("❌ Ошибка загрузки профиля:", error);
            }
        };

        fetchUserData();
    }, []);

    useEffect(() => {

        if (userId) {
            console.log("🔄 Подключаем WebSocket для пользователя:", userId);


            // Слушаем уведомления для исполнителя
            socket.on('orderApproved', async (data) => {
                console.log("🔔 Заказ одобрен:", data);

                if (data.message.includes("Ваш запрос")) {
                    setNotificationData({
                        title: "Ваш запрос одобрен!",
                        description: `Заказ номер ${data.orderId}: ${data.message}`,
                        onClose: () => setNotificationData(null),
                    });

                    try {
                        const response = await axiosInstance.post('/payment/pay_commission', {
                            userId,
                            orderId: data.orderId
                        });

                        if (response.data.success) {
                            setPaymentUrl(response.data.PaymentURL);
                        } else {
                            console.error("❌ Ошибка получения ссылки на оплату:", response.data.error);
                        }
                    } catch (error) {
                        console.error("❌ Ошибка запроса на оплату:", error);
                    }
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


    return (
        <ModalContext.Provider value={{ openModal: setModalData, closeModal: () => setModalData(null) }}>
            {children}

                    {/* Уведомление для исполнителя в виде модала */}
            {notificationData && (
                        <div className="modal-overlay">

                            <div className="modal">
                                <h2>{notificationData.title}</h2>
                                <p>{notificationData.description}</p>
                                {paymentUrl ? (
                                    <button onClick={() => window.open(paymentUrl, "_blank")}>
                                        Оплатить комиссию
                                    </button>
                                ) : (
                                    <p>Загрузка ссылки на оплату...</p>
                                )}
                                <button onClick={notificationData.onClose}>Закрыть</button>
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
