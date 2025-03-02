import React, { createContext, useState, useEffect } from 'react';
import io from 'socket.io-client';
import axiosInstance from '../utils/axiosInstance';
import { useNavigate } from 'react-router-dom'; // Используем useNavigate
import '../styles/modalContext.css'

export const ModalContext = createContext();

const socket = io(process.env.REACT_APP_SOCKET_URL); // Подключаем WebSocket

export const ModalProvider = ({ children }) => {
    const [modalData, setModalData] = useState(null);
    const [userId, setUserId] = useState(null);
    const [notificationData, setNotificationData] = useState(null); // Для уведомлений исполнителю
    const [completionNotificationData, setCompletionNotificationData] = useState(null); // Уведомление по завершению заказа
    const [showRatingModal, setShowRatingModal] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [rating, setRating] = useState(0);
    const navigate = useNavigate();

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

        const fetchExecutorData = async (executorId) => {
            try {
                const response = await axiosInstance.get(`/auth/${executorId}`);
                return response.data;
            } catch (error) {
                console.error("❌ Ошибка загрузки данных исполнителя:", error);
                return null;
            }
        };

        if (userId) {
            console.log("🔄 Подключаем WebSocket для пользователя:", userId);


            // Слушаем уведомления для исполнителя
            socket.on('orderApproved', (data) => {
                console.log("🔔 Заказ одобрен:", data);
                if (data.message.includes("Ваш запрос")) {
                    setNotificationData({
                        title: "Ваш запрос одобрен!",
                        description: `Заказ номер ${data.orderId}: ${data.message}`,
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

    const openModal = (data) => {
        setModalData(data);
    };

    const closeModal = () => {
        setModalData(null);
    };

    const handleApproveOrder = async (orderId, executorId) => {
        try {
            console.log(`👍 Одобрение заказа ${orderId} для исполнителя ${executorId}`);
            await axiosInstance.post(`/orders/${orderId}/approve`, {
                executorId: executorId,
            });

            closeModal();
        } catch (error) {
            console.error("❌ Ошибка при одобрении заказа:", error);
            alert(error.response?.data?.message || "Не удалось одобрить заказ");
        }
    };

    const handleRejectOrder = async (orderId) => {
        try {
            await axiosInstance.post(`/orders/${orderId}/reject`);
            closeModal();
        } catch (error) {
            console.error("Ошибка при отклонении исполнителя:", error);
            alert(error.response?.data?.message || "Не удалось отклонить исполнителя");
        }
    };

    const handleGoToComplaints = (executorId, orderId) => {
        // Используем navigate для перехода
        navigate(`/complaints/${executorId}?orderId=${orderId}`);
    };

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

            {/* Основное модальное окно */}
            {modalData && (
                <div className="modal-overlay">

                    <div className="modal">
                        <h2>{modalData.title}</h2>
                        <p>{modalData.description}</p>
                        <button onClick={modalData.onConfirm}>Одобрить</button>
                        <button onClick={modalData.onCancel}>Отклонить</button>

                        {/* Кнопка для перехода к жалобам на исполнителя */}
                        {modalData.executorId && (
                            <button onClick={() => handleGoToComplaints(modalData.executorId, modalData.orderId)}>
                                Перейти к жалобам на исполнителя
                            </button>
                        )}
                    </div>

                </div>
                    )}

                    {/* Уведомление для исполнителя в виде модала */}
                    {notificationData && (
                        <div className="modal-overlay">

                            <div className="modal">
                                <h2>{notificationData.title}</h2>
                                <p>{notificationData.description}</p>
                                <button onClick={notificationData.onClose}>Закрыть</button>
                            </div>
                        </div>

                    )}

                            {/* Уведомление о завершении заказа */}
                            {completionNotificationData && (
                                <div className="modal-overlay">

                                    <div className="modal">
                                        <h2>{completionNotificationData.title}</h2>
                                        <p>{completionNotificationData.description}</p>
                                        <button onClick={completionNotificationData.onClose}>Завершить</button>
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
