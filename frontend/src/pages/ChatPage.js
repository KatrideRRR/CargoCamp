import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import axios from "axios";
import { useParams, useNavigate } from "react-router-dom";
import "../styles/ChatPage.css";
import { useUser } from "../utils/userContext";
import { socket } from "../socketClient";

const apiUrl = process.env.REACT_APP_API_URL;

function getAvatarUrl(user) {
    if (!user?.avatar) return null;
    return user.avatar.startsWith("http") ? user.avatar : `${apiUrl}${user.avatar}`;
}

function formatRub(value) {
    const n = Number(value || 0);
    return `${n.toLocaleString("ru-RU")} ₽`;
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

function getPaymentTypeLabel(type) {
    const map = {
        cash: "Наличными",
        guarantee: "Гарантия",
        installment: "Рассрочка",
        installments: "Рассрочка",
    };

    return map[type] || "—";
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

    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [selectedUser, setSelectedUser] = useState(null);
    const [order, setOrder] = useState(null);
    const [orderExpanded, setOrderExpanded] = useState(true);

    const messagesContainerRef = useRef(null);
    const textareaRef = useRef(null);

    const authHeader = useMemo(() => ({
        headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
    }), []);

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
    }, [currentUser?.id, orderId]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                setLoading(true);
                setError("");

                const orderUrl =
                    orderType === "express"
                        ? `${apiUrl}/api/express/express-orders/${orderId}`
                        : `${apiUrl}/api/orders/${orderId}`;

                const { data: orderResponse } = await axios.get(orderUrl, authHeader);

                const orderData =
                    orderType === "express"
                        ? orderResponse.order || orderResponse
                        : orderResponse;

                setOrder(orderData);

                const otherUserId =
                    String(orderData.creatorId) === String(currentUser.id)
                        ? orderData.executorId
                        : orderData.creatorId;

                const { data: user } = await axios.get(
                    `${apiUrl}/api/auth/${otherUserId}`,
                    authHeader
                );

                setSelectedUser(user);

                const { data: messagesData } = await axios.get(
                    `${apiUrl}/api/messages/${orderType}/${orderId}`,
                    authHeader
                );

                setMessages(messagesData);

                socket.emit("markAsRead", {
                    userId: currentUser.id,
                    orderId,
                });

                requestAnimationFrame(() => scrollToBottom("auto"));
            } catch (err) {
                console.error(err);
                setError("Не удалось загрузить данные чата.");
            } finally {
                setLoading(false);
            }
        };

        if (orderId && currentUser?.id) {
            fetchData();
        }
    }, [orderId, currentUser?.id, scrollToBottom, authHeader]);

    const handleSendMessage = useCallback(async () => {
        if (!newMessage.trim() || !currentUser || !orderId || !selectedUser) return;

        try {
            const messageData = {
                content: newMessage.trim(),
                receiverId: selectedUser.id,
                orderId,
                orderType,
            };

            const { data } = await axios.post(
                `${apiUrl}/api/messages`,
                messageData,
                authHeader
            );

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
            setError("Не удалось отправить сообщение.");
        }
    }, [newMessage, currentUser, orderId, selectedUser, scrollToBottom, authHeader]);

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

    const handleOrderDetails = () => {
        if (orderType === "express") {
            navigate("/active-orders");
            return;
        }

        navigate(`/order/${orderId}`);
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
        <div className="chat-page chat-page--no-bottom-menu">
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
                            <span className="chat-online-dot" />
                        </div>

                        <div className="chat-header-text">
                            <div className="chat-header-title">
                                {selectedUser?.username || "Собеседник"}
                            </div>
                            <div className="chat-header-subtitle">
                                Онлайн
                            </div>
                        </div>
                    </div>

                    <div className="chat-header-actions">
                        <button type="button" className="chat-icon-button" aria-label="Позвонить">
                            ☎
                        </button>
                        <button
                            type="button"
                            className="chat-icon-button"
                            aria-label="Информация"
                            onClick={() => setOrderExpanded((prev) => !prev)}
                        >
                            ⋯
                        </button>
                    </div>
                </header>

                <section className={`chat-order-card ${orderExpanded ? "expanded" : "collapsed"}`}>
                    <button
                        type="button"
                        className="chat-order-main"
                        onClick={() => setOrderExpanded((prev) => !prev)}
                    >
                        <div className="chat-order-icon">▣</div>

                        <div className="chat-order-info">
                            <div className="chat-order-top">
                                <span className="chat-order-title">Заказ #{order?.id || orderId}</span>
                                <span className={`chat-order-status status-${order?.status || "unknown"}`}>
                                    {getOrderStatusLabel(order?.status)}
                                </span>
                            </div>

                            <div className="chat-order-line">
                                <span>📍</span>
                                <span>{order?.address || "Адрес не указан"}</span>
                            </div>

                            <div className="chat-order-line">
                                <span>₽</span>
                                <span>{formatRub(order?.proposedSum || order?.finalPriceKopecks / 100)}</span>
                            </div>
                        </div>

                        <div className="chat-order-map">
                            <span>📍</span>
                        </div>
                    </button>

                    {orderExpanded && (
                        <div className="chat-order-extra">
                            <div className="chat-order-extra-grid">
                                <div>
                                    <span>Оплата</span>
                                    <b>{getPaymentTypeLabel(order?.paymentType)}</b>
                                </div>
                                <div>
                                    <span>Сделка</span>
                                    <b>{order?.dealStatus || "—"}</b>
                                </div>
                            </div>

                            {order?.description && (
                                <div className="chat-order-description">
                                    {order.description}
                                </div>
                            )}

                            <div className="chat-order-actions">
                                <button
                                    type="button"
                                    className="chat-order-btn secondary"
                                    onClick={handleOrderDetails}
                                >
                                    Подробнее
                                </button>
                                <button
                                    type="button"
                                    className="chat-order-btn primary"
                                    onClick={handleOrderDetails}
                                >
                                    К заказу
                                </button>
                            </div>
                        </div>
                    )}
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

                <div className="chat-quick-actions">
                    <button type="button">🚗 Я выехал</button>
                    <button type="button">📍 На месте</button>
                    <button type="button">✅ Заказ выполнен</button>
                </div>

                <div className="chat-input-container">
                    <button type="button" className="chat-attach-button" aria-label="Прикрепить файл">
                        📎
                    </button>

                    <button type="button" className="chat-attach-button" aria-label="Фото">
                        🖼
                    </button>

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
            </div>
        </div>
    );
};

export default ChatPage;