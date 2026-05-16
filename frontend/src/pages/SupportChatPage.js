import React, { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import axiosInstance from "../utils/axiosInstance";
import { socket } from "../socketClient";
import { useAuth } from "../utils/authContext";
import "../styles/SupportChatPage.css";

import {
    FaArrowLeft,
    FaPaperPlane,
    FaHeadset,
    FaCheckDouble,
} from "react-icons/fa";

const SupportChatPage = () => {
    const navigate = useNavigate();
    const { user } = useAuth();

    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState("");
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");

    const bottomRef = useRef(null);

    useEffect(() => {
        document.body.classList.add("hide-bottom-menu");

        return () => {
            document.body.classList.remove("hide-bottom-menu");
        };
    }, []);

    const currentUserId = useMemo(() => {
        return user?.id || user?.userId || null;
    }, [user]);

    const scrollToBottom = (smooth = true) => {
        setTimeout(() => {
            bottomRef.current?.scrollIntoView({
                behavior: smooth ? "smooth" : "auto",
                block: "end",
            });
        }, 50);
    };

    const fetchMessages = async () => {
        try {
            setLoading(true);
            setError("");

            const res = await axiosInstance.get("/support/messages");

            setMessages(Array.isArray(res.data) ? res.data : []);

            await axiosInstance.patch("/support/read").catch(() => {});
        } catch (err) {
            console.error("Ошибка загрузки чата поддержки:", err);
            setError("Не удалось загрузить чат поддержки");
        } finally {
            setLoading(false);
            scrollToBottom(false);
        }
    };

    useEffect(() => {
        fetchMessages();
    }, []);

    useEffect(() => {
        if (!currentUserId) return;

        socket.emit("subscribeSupportChat", currentUserId);
        socket.emit("subscribeToNotifications", currentUserId);

        const handleSupportReply = async (payload) => {
            const message = payload?.message;

            if (!message) return;

            setMessages((prev) => {
                const exists = prev.some((m) => m.id === message.id);
                if (exists) return prev;
                return [...prev, message];
            });

            await axiosInstance.patch("/support/read").catch(() => {});
            scrollToBottom();
        };

        const handleSupportNewMessage = async (payload) => {
            const message = payload?.message;

            if (!message) return;

            setMessages((prev) => {
                const exists = prev.some((m) => m.id === message.id);
                if (exists) return prev;
                return [...prev, message];
            });

            scrollToBottom();
        };

        socket.on("support:reply", handleSupportReply);
        socket.on("support:new_message", handleSupportNewMessage);

        return () => {
            socket.off("support:reply", handleSupportReply);
            socket.off("support:new_message", handleSupportNewMessage);
        };
    }, [currentUserId]);

    useEffect(() => {
        scrollToBottom();
    }, [messages.length]);

    const sendMessage = async () => {
        const text = newMessage.trim();

        if (!text || sending) return;

        try {
            setSending(true);
            setError("");

            setNewMessage("");

            const res = await axiosInstance.post("/support/messages", {
                text,
            });

            if (res.data) {
                setMessages((prev) => {
                    const exists = prev.some((m) => m.id === res.data.id);
                    if (exists) return prev;
                    return [...prev, res.data];
                });
            }

            scrollToBottom();
        } catch (err) {
            console.error("Ошибка отправки сообщения в поддержку:", err);
            setError("Не удалось отправить сообщение");
            setNewMessage(text);
        } finally {
            setSending(false);
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        sendMessage();
    };

    const handleKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    const formatTime = (dateValue) => {
        if (!dateValue) return "";

        const date = new Date(dateValue);

        return date.toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    const isMyMessage = (message) => {
        return message.senderRole === "user";
    };

    return (
        <div className="support-chat-page">
            <header className="support-chat-header">
                <button
                    className="support-back-button"
                    onClick={() => navigate(-1)}
                    type="button"
                    aria-label="Назад"
                >
                    <FaArrowLeft />
                </button>

                <div className="support-header-avatar">
                    <FaHeadset />
                </div>

                <div className="support-header-info">
                    <h1>Поддержка CargoCamp</h1>
                    <p>Поможем с заказами, оплатой и работой приложения</p>
                </div>
            </header>

            <main className="support-chat-body">
                <div className="support-info-card">
                    <strong>Здравствуйте!</strong>
                    <span>
                        Напишите нам, если возник вопрос. Не отправляйте в чат данные банковских карт,
                        коды из SMS и пароли.
                    </span>
                </div>

                {loading ? (
                    <div className="support-state">Загрузка чата...</div>
                ) : error ? (
                    <div className="support-error">{error}</div>
                ) : messages.length === 0 ? (
                    <div className="support-empty">
                        <FaHeadset />
                        <h2>Чат поддержки</h2>
                        <p>Напишите первое сообщение — администратор ответит здесь.</p>
                    </div>
                ) : (
                    <div className="support-messages-list">
                        {messages.map((message) => {
                            const mine = isMyMessage(message);

                            return (
                                <div
                                    key={message.id}
                                    className={`support-message-row ${
                                        mine ? "mine" : "admin"
                                    }`}
                                >
                                    {!mine && (
                                        <div className="support-message-avatar">
                                            <FaHeadset />
                                        </div>
                                    )}

                                    <div className="support-message-bubble">
                                        {!mine && (
                                            <div className="support-message-author">
                                                Поддержка
                                            </div>
                                        )}

                                        <div className="support-message-text">
                                            {message.text}
                                        </div>

                                        <div className="support-message-meta">
                                            <span>{formatTime(message.createdAt)}</span>
                                            {mine && <FaCheckDouble />}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                <div ref={bottomRef} />
            </main>

            <form className="support-chat-input-wrap" onSubmit={handleSubmit}>
                <textarea
                    className="support-chat-input"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Напишите сообщение..."
                    rows={1}
                    disabled={sending}
                />

                <button
                    className="support-send-button"
                    type="submit"
                    disabled={!newMessage.trim() || sending}
                    aria-label="Отправить"
                >
                    <FaPaperPlane />
                </button>
            </form>
        </div>
    );
};

export default SupportChatPage;