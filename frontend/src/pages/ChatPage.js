import React, { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { useParams, useNavigate } from "react-router-dom";
import "../styles/ChatPage.css";
import { useUser } from "../utils/userContext";
import { socket } from "../socketClient";

const apiUrl = process.env.REACT_APP_API_URL;

const ChatPage = () => {
    const { orderId } = useParams();
    const navigate = useNavigate();
    const { currentUser } = useUser();

    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [selectedUser, setSelectedUser] = useState(null);

    const messagesContainerRef = useRef(null);
    const textareaRef = useRef(null);

    const authHeader = {
        headers: { Authorization: `Bearer ${localStorage.getItem("authToken")}` },
    };

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

        if (!socket.connected) {
            socket.connect();
        }

        socket.emit("register", currentUser.id);
        socket.emit("joinChat", { userId: currentUser.id, orderId });

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

                const { data: order } = await axios.get(
                    `${apiUrl}/api/orders/${orderId}`,
                    authHeader
                );

                const otherUserId =
                    String(order.creatorId) === String(currentUser.id)
                        ? order.executorId
                        : order.creatorId;

                const { data: user } = await axios.get(
                    `${apiUrl}/api/auth/${otherUserId}`,
                    authHeader
                );

                setSelectedUser(user);

                const { data: messagesData } = await axios.get(
                    `${apiUrl}/api/messages/${orderId}`,
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
    }, [orderId, currentUser?.id, scrollToBottom]);

    const handleSendMessage = useCallback(async () => {
        if (!newMessage.trim() || !currentUser || !orderId || !selectedUser) return;

        try {
            const messageData = {
                content: newMessage.trim(),
                receiverId: selectedUser.id,
                orderId,
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
    }, [newMessage, currentUser, orderId, selectedUser, scrollToBottom]);

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
                        aria-label="Выйти из чата"
                    >
                        ←
                    </button>

                    <div className="chat-header-text">
                        <div className="chat-header-title">Чат по заказу #{orderId}</div>
                        <div className="chat-header-subtitle">
                            Собеседник: {selectedUser?.username || "—"}
                        </div>
                    </div>
                </header>

                <div className="chat-messages" ref={messagesContainerRef}>
                    {messages.length > 0 ? (
                        messages.map((msg) => {
                            const isMine =
                                String(msg.senderId) === String(currentUser.id);

                            return (
                                <div
                                    key={msg.id}
                                    className={`chat-message-row ${isMine ? "mine" : "theirs"}`}
                                >
                                    <div
                                        className={`chat-message ${
                                            isMine
                                                ? "chat-message-sent"
                                                : "chat-message-received"
                                        }`}
                                    >
                                        <p>{msg.content}</p>
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div className="chat-empty">Нет сообщений</div>
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
                    />
                </div>
            </div>
        </div>
    );
};

export default ChatPage;