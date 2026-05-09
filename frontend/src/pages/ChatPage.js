import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Capacitor } from "@capacitor/core";
import axiosInstance from "../utils/axiosInstance";
import { useParams, useNavigate } from "react-router-dom";
import "../styles/ChatPage.css";
import { useUser } from "../utils/userContext";
import { socket } from "../socketClient";
import Modal from "react-modal";

const apiUrl = process.env.REACT_APP_API_URL;

function getAvatarUrl(user) {
    if (!user?.avatar) return null;
    return user.avatar.startsWith("http") ? user.avatar : `${apiUrl}${user.avatar}`;
}

function getOrderStatusLabel(status) {
    const map = {
        pending: "Ожидает",
        active: "В процессе",
        completed: "Завершён",
        expired: "Истёк",
        pending_payment: "Ожидает оплату",
    };

    return map[status] || status || "—";
}

function formatMessageTime(value) {
    if (!value) return "";

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";

    return d.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatDatePill(value) {
    if (!value) return "Сегодня";

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "Сегодня";

    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();

    if (isToday) return "Сегодня";

    return d.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
    });
}

const ChatPage = () => {
    const params = useParams();
    const orderId = params.orderId;
    const orderType = params.orderType || "regular";
    const navigate = useNavigate();
    const { currentUser } = useUser();

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

    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [selectedUser, setSelectedUser] = useState(null);
    const [order, setOrder] = useState(null);

    const [isDisputeModalOpen, setIsDisputeModalOpen] = useState(false);
    const [selectedOrderForDispute, setSelectedOrderForDispute] = useState(null);
    const [disputeReasonCode, setDisputeReasonCode] = useState("poor_quality");
    const [disputeReason, setDisputeReason] = useState("");
    const [disputeDescription, setDisputeDescription] = useState("");
    const [disputeLoading, setDisputeLoading] = useState(false);
    const [orderDispute, setOrderDispute] = useState(null);

    const messagesContainerRef = useRef(null);
    const textareaRef = useRef(null);

    const selectedUserAvatar = getAvatarUrl(selectedUser);

    const scrollToBottom = useCallback((behavior = "smooth") => {
        if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTo({
                top: messagesContainerRef.current.scrollHeight,
                behavior,
            });
        }
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages, scrollToBottom]);

    useEffect(() => {
        if (!currentUser?.id) return;

        socket.emit("joinChat", {
            userId: currentUser.id,
            orderId,
            orderType,
        });

        const handleReceiveMessage = (message) => {
            if (String(message.orderId) !== String(orderId)) return;

            setMessages((prev) => {
                const exists = prev.some((msg) => String(msg.id) === String(message.id));
                if (exists) return prev;
                return [...prev, message];
            });
        };

        socket.on("receiveMessage", handleReceiveMessage);

        return () => {
            socket.off("receiveMessage", handleReceiveMessage);
        };
    }, [currentUser?.id, orderId, orderType]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);
                setError("");

                const orderEndpoint =
                    orderType === "express"
                        ? `/express/express-orders/${orderId}`
                        : `/orders/${orderId}`;

                const { data: orderResponse } = await axiosInstance.get(orderEndpoint);

                const orderData =
                    orderType === "express"
                        ? orderResponse.order || orderResponse
                        : orderResponse;

                setOrder(orderData);

                try {
                    const { data: disputeData } = await axiosInstance.get(
                        `/disputes/order/${orderData.id}`
                    );

                    setOrderDispute(disputeData || null);
                } catch (e) {
                    if (e?.response?.status !== 404) {
                        console.error(`Ошибка загрузки спора для заказа ${orderData.id}:`, e);
                    }

                    setOrderDispute(null);
                }

                const otherUserId =
                    String(orderData.creatorId) === String(currentUser.id)
                        ? orderData.executorId
                        : orderData.creatorId;

                const { data: user } = await axiosInstance.get(`/auth/${otherUserId}`);

                setSelectedUser(user);

                const { data: messagesData } = await axiosInstance.get(
                    `/messages/${orderType}/${orderId}`
                );

                setMessages(Array.isArray(messagesData) ? messagesData : []);

                socket.emit("markAsRead", {
                    userId: currentUser.id,
                    orderId,
                    orderType,
                });

                requestAnimationFrame(() => scrollToBottom("auto"));
            } catch (err) {
                console.error(err);

                if (err?.response?.status === 401) {
                    setError("Сессия устарела. Выполните вход заново.");
                    return;
                }

                setError("Не удалось загрузить данные чата.");
            } finally {
                setLoading(false);
            }
        };

        if (orderId && currentUser?.id) {
            fetchData();
        }
    }, [orderId, orderType, currentUser?.id, scrollToBottom]);

    const handleSendMessage = useCallback(async () => {
        if (!newMessage.trim() || !currentUser || !orderId || !selectedUser) return;

        try {
            const messageData = {
                content: newMessage.trim(),
                receiverId: selectedUser.id,
                orderId,
                orderType,
            };

            const { data } = await axiosInstance.post("/messages", messageData);

            setMessages((prev) => {
                const exists = prev.some((msg) => String(msg.id) === String(data.id));
                if (exists) return prev;
                return [...prev, data];
            });

            setNewMessage("");

            if (textareaRef.current) {
                textareaRef.current.style.height = "44px";
            }

            requestAnimationFrame(() => scrollToBottom());
        } catch (err) {
            console.error(err);

            if (err?.response?.status === 401) {
                setError("Сессия устарела. Выполните вход заново.");
                return;
            }

            setError("Не удалось отправить сообщение.");
        }
    }, [newMessage, currentUser, orderId, selectedUser, orderType, scrollToBottom]);

    const handleInputChange = (e) => {
        setNewMessage(e.target.value);

        const textarea = textareaRef.current;
        if (!textarea) return;

        textarea.style.height = "auto";
        textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    };

    const handleKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    };

    const handleBack = () => {
        navigate(-1);
    };

    const handleCallUser = () => {
        const phone = selectedUser?.phone;

        if (!phone) {
            alert("Телефон пользователя не найден");
            return;
        }

        window.open(`tel:${phone}`);
    };

    const handleRouteClick = () => {
        const coordinates = order?.coordinates || order?.toCoordinates || order?.destinationCoordinates;

        if (!coordinates || !String(coordinates).includes(",")) {
            alert("Координаты заказа не найдены");
            return;
        }

        const [orderLat, orderLon] = String(coordinates)
            .split(",")
            .map((coord) => parseFloat(coord));

        if (!Number.isFinite(orderLat) || !Number.isFinite(orderLon)) {
            alert("Некорректные координаты заказа");
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userLat = position.coords.latitude;
                const userLon = position.coords.longitude;

                const url = `https://yandex.ru/navi/?rtext=${userLat},${userLon}~${orderLat},${orderLon}&rtt=auto`;

                window.open(url, "_blank");
            },
            (err) => {
                console.error(err);
                alert("Не удалось определить местоположение");
            },
            {
                enableHighAccuracy: true,
                timeout: 12000,
                maximumAge: 0,
            }
        );
    };

    const disputeReasonOptions = [
        { value: "work_not_done", label: "Работа не выполнена" },
        { value: "poor_quality", label: "Низкое качество работы" },
        { value: "missed_deadline", label: "Нарушены сроки" },
        { value: "wrong_price", label: "Спор по стоимости" },
        { value: "rude_behavior", label: "Некорректное поведение" },
        { value: "other", label: "Другое" },
    ];

    const openDisputeModal = (orderToDispute) => {
        setSelectedOrderForDispute(orderToDispute);
        setDisputeReasonCode("poor_quality");
        setDisputeReason("");
        setDisputeDescription("");
        setIsDisputeModalOpen(true);
    };

    const closeDisputeModal = () => {
        setIsDisputeModalOpen(false);
        setSelectedOrderForDispute(null);
        setDisputeReasonCode("poor_quality");
        setDisputeReason("");
        setDisputeDescription("");
        setDisputeLoading(false);
    };

    const fetchOrderDispute = async (targetOrderId) => {
        try {
            const res = await axiosInstance.get(`/disputes/order/${targetOrderId}`);

            if (res.data) {
                setOrderDispute(res.data);
                return res.data;
            }

            return null;
        } catch (e) {
            if (e?.response?.status !== 404) {
                console.error(`Ошибка получения спора по заказу ${targetOrderId}:`, e);
            }

            setOrderDispute(null);
            return null;
        }
    };

    const submitDispute = async () => {
        try {
            if (!currentUser?.id) {
                alert("Вы не авторизованы");
                navigate("/login");
                return;
            }

            if (!selectedOrderForDispute?.id) {
                alert("Заказ не выбран");
                return;
            }

            if (!disputeReason.trim()) {
                alert("Укажите краткую причину спора");
                return;
            }

            setDisputeLoading(true);

            const res = await axiosInstance.post("/disputes/open", {
                orderId: selectedOrderForDispute.id,
                reasonCode: disputeReasonCode,
                reason: disputeReason.trim(),
                description: disputeDescription.trim(),
            });

            if (res.data?.dispute) {
                setOrderDispute(res.data.dispute);
            }

            alert("Спор успешно открыт");
            closeDisputeModal();
        } catch (e) {
            console.error("Ошибка открытия спора:", e);
            alert(e?.response?.data?.message || "Не удалось открыть спор");
        } finally {
            setDisputeLoading(false);
        }
    };

    const handleDisputeClick = async () => {
        if (!order?.id) {
            alert("Заказ не найден");
            return;
        }

        const existingDispute = orderDispute || (await fetchOrderDispute(order.id));

        if (existingDispute) {
            alert(
                `Спор уже открыт.\n\nСтатус: ${existingDispute.status}\nПричина: ${existingDispute.reason}${
                    existingDispute.description ? `\nОписание: ${existingDispute.description}` : ""
                }`
            );
            return;
        }

        openDisputeModal(order);
    };

    const groupedMessages = useMemo(() => {
        let lastDate = null;

        return messages.map((msg) => {
            const d = msg.createdAt || msg.created_at || msg.timestamp;
            const currentDate = d ? new Date(d).toDateString() : "unknown";
            const showDate = currentDate !== lastDate;
            lastDate = currentDate;

            return {
                ...msg,
                showDate,
                dateLabel: formatDatePill(d),
                timeLabel: formatMessageTime(d),
            };
        });
    }, [messages]);

    if (loading) {
        return (
            <div className="chat-page">
                <div className="chat-loading">Загрузка чата...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="chat-page">
                <div className="chat-error">Ошибка: {error}</div>
            </div>
        );
    }

    return (
        <div className={`chat-page chat-page--no-bottom-menu chat-page--${platform}`}>
            <div className="chat-container">
                <header className="chat-header">
                    <button
                        type="button"
                        className="chat-back-button"
                        onClick={handleBack}
                        aria-label="Назад"
                    >
                        ‹
                    </button>

                    <div className="chat-user">
                        <div className="chat-avatar-wrap">
                            {selectedUserAvatar ? (
                                <img
                                    src={selectedUserAvatar}
                                    alt={selectedUser?.username || "Пользователь"}
                                    className="chat-avatar"
                                />
                            ) : (
                                <div className="chat-avatar chat-avatar-placeholder">
                                    {(selectedUser?.username || "U").charAt(0).toUpperCase()}
                                </div>
                            )}
                        </div>

                        <div className="chat-header-text">
                            <div className="chat-header-title">
                                {selectedUser?.username || "Собеседник"}
                            </div>
                            <div className="chat-header-subtitle">
                                Заказ #{order?.id || orderId}
                            </div>
                        </div>
                    </div>
                </header>

                <section className="chat-order-card compact">
                    <div className="chat-order-main compact">
                        <div className="chat-order-info">
                            <div className="chat-order-top">
                                <span className="chat-order-title">Заказ #{order?.id || orderId}</span>
                                <span className={`chat-order-status status-${order?.status || "unknown"}`}>
                                {getOrderStatusLabel(order?.status)}
                            </span>
                            </div>
                        </div>

                        <div className="chat-order-actions compact">
                            <button
                                type="button"
                                className="chat-order-btn route"
                                onClick={handleRouteClick}
                            >
                                Маршрут
                            </button>

                            <button
                                type="button"
                                className="chat-order-btn call"
                                onClick={handleCallUser}
                            >
                                Позвонить
                            </button>

                            {orderType === "regular" && (
                                <button
                                    type="button"
                                    className={`chat-order-btn dispute ${orderDispute ? "opened" : ""}`}
                                    onClick={handleDisputeClick}
                                >
                                    {orderDispute ? "Спор открыт" : "Спор"}
                                </button>
                            )}
                        </div>
                    </div>
                </section>

                <div className="chat-messages" ref={messagesContainerRef}>
                    {groupedMessages.length > 0 ? (
                        groupedMessages.map((msg) => {
                            const isMine = String(msg.senderId) === String(currentUser.id);

                            return (
                                <React.Fragment key={msg.id}>
                                    {msg.showDate && (
                                        <div className="chat-date-pill">
                                            {msg.dateLabel}
                                        </div>
                                    )}

                                    <div className={`chat-message-row ${isMine ? "mine" : "theirs"}`}>
                                        {!isMine && (
                                            <div className="chat-message-avatar-space">
                                                {selectedUserAvatar ? (
                                                    <img
                                                        src={selectedUserAvatar}
                                                        alt=""
                                                        className="chat-message-avatar"
                                                    />
                                                ) : (
                                                    <div className="chat-message-avatar chat-avatar-placeholder small">
                                                        {(selectedUser?.username || "U").charAt(0).toUpperCase()}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <div
                                            className={`chat-message ${
                                                isMine ? "chat-message-sent" : "chat-message-received"
                                            }`}
                                        >
                                            <p>{msg.content}</p>
                                            <span className="chat-message-time">
                                            {msg.timeLabel}
                                                {isMine && <span className="chat-checks"> ✓✓</span>}
                                        </span>
                                        </div>
                                    </div>
                                </React.Fragment>
                            );
                        })
                    ) : (
                        <div className="chat-empty">
                            <div className="chat-empty-icon">💬</div>
                            <div>Сообщений пока нет</div>
                            <small>Напишите первым по этому заказу</small>
                        </div>
                    )}
                </div>

                <div className="chat-input-container">
                <textarea
                    ref={textareaRef}
                    value={newMessage}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder="Введите сообщение..."
                    className="chat-input"
                    rows="1"
                />

                    <button
                        onClick={handleSendMessage}
                        className="chat-send-button"
                        disabled={!newMessage.trim()}
                        aria-label="Отправить сообщение"
                    >
                        ➤
                    </button>
                </div>

                <Modal
                    appElement={document.getElementById("root")}
                    isOpen={isDisputeModalOpen}
                    onRequestClose={closeDisputeModal}
                    contentLabel="Открытие спора"
                    className="chat-dispute-modal"
                    overlayClassName="chat-dispute-overlay"
                >
                    <div className="chat-dispute-content">
                        <button
                            type="button"
                            onClick={closeDisputeModal}
                            className="chat-dispute-close"
                        >
                            ✖
                        </button>

                        <h2 className="chat-dispute-title">Открыть спор</h2>

                        {selectedOrderForDispute && (
                            <p className="chat-dispute-order">
                                Заказ №{selectedOrderForDispute.id}
                            </p>
                        )}

                        <div className="chat-dispute-group">
                            <label>Категория причины</label>
                            <select
                                value={disputeReasonCode}
                                onChange={(e) => setDisputeReasonCode(e.target.value)}
                                className="chat-dispute-input"
                            >
                                {disputeReasonOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="chat-dispute-group">
                            <label>Краткая причина</label>
                            <input
                                type="text"
                                value={disputeReason}
                                onChange={(e) => setDisputeReason(e.target.value)}
                                className="chat-dispute-input"
                                placeholder="Например: работа выполнена не полностью"
                                maxLength={255}
                            />
                        </div>

                        <div className="chat-dispute-group">
                            <label>Подробное описание</label>
                            <textarea
                                value={disputeDescription}
                                onChange={(e) => setDisputeDescription(e.target.value)}
                                className="chat-dispute-textarea"
                                placeholder="Опишите подробно, в чём проблема"
                                rows={5}
                            />
                        </div>

                        <div className="chat-dispute-actions">
                            <button
                                type="button"
                                className="chat-dispute-cancel"
                                onClick={closeDisputeModal}
                                disabled={disputeLoading}
                            >
                                Отмена
                            </button>

                            <button
                                type="button"
                                className="chat-dispute-submit"
                                onClick={submitDispute}
                                disabled={disputeLoading}
                            >
                                {disputeLoading ? "Открываем..." : "Открыть спор"}
                            </button>
                        </div>
                    </div>
                </Modal>

            </div>
        </div>
    );
};

export default ChatPage;