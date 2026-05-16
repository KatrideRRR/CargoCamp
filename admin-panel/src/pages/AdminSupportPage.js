import React, { useEffect, useMemo, useRef, useState } from "react";
import axiosInstance from "../utils/axiosInstance";
import { socket } from "../socketClient";
import "../styles/AdminSupportPage.css";

import {
    FaHeadset,
    FaPaperPlane,
    FaUser,
    FaPhone,
    FaSyncAlt,
    FaInbox,
} from "react-icons/fa";

const AdminSupportPage = () => {
    const [chats, setChats] = useState([]);
    const [selectedUserId, setSelectedUserId] = useState(null);
    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState("");

    const [loadingChats, setLoadingChats] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");

    const bottomRef = useRef(null);

    const selectedChat = useMemo(() => {
        return chats.find((chat) => Number(chat.userId) === Number(selectedUserId));
    }, [chats, selectedUserId]);

    const scrollToBottom = (smooth = true) => {
        setTimeout(() => {
            bottomRef.current?.scrollIntoView({
                behavior: smooth ? "smooth" : "auto",
                block: "end",
            });
        }, 50);
    };

    const fetchChats = async () => {
        try {
            setLoadingChats(true);
            setError("");

            const res = await axiosInstance.get("/admin/support/chats");
            const list = Array.isArray(res.data) ? res.data : [];

            setChats(list);

            if (!selectedUserId && list.length > 0) {
                setSelectedUserId(list[0].userId);
            }
        } catch (err) {
            console.error("Ошибка загрузки чатов поддержки:", err);
            setError("Не удалось загрузить чаты поддержки");
        } finally {
            setLoadingChats(false);
        }
    };

    const fetchMessages = async (userId) => {
        if (!userId) return;

        try {
            setLoadingMessages(true);
            setError("");

            const res = await axiosInstance.get(`/admin/support/chats/${userId}/messages`);
            setMessages(Array.isArray(res.data) ? res.data : []);

            await axiosInstance.patch(`/admin/support/chats/${userId}/read`).catch(() => {});

            setChats((prev) =>
                prev.map((chat) =>
                    Number(chat.userId) === Number(userId)
                        ? { ...chat, unreadCount: 0 }
                        : chat
                )
            );

            scrollToBottom(false);
        } catch (err) {
            console.error("Ошибка загрузки сообщений поддержки:", err);
            setError("Не удалось загрузить сообщения");
        } finally {
            setLoadingMessages(false);
        }
    };

    useEffect(() => {
        fetchChats();
    }, []);

    useEffect(() => {
        if (selectedUserId) {
            fetchMessages(selectedUserId);
        }
    }, [selectedUserId]);

    useEffect(() => {
        socket.emit("subscribeAdminSupport");

        const handleNewUserMessage = async (payload) => {
            const userId = payload?.userId;
            const message = payload?.message;

            if (!userId || !message) {
                fetchChats();
                return;
            }

            setChats((prev) => {
                const exists = prev.some((chat) => Number(chat.userId) === Number(userId));

                if (!exists) {
                    fetchChats();
                    return prev;
                }

                return prev
                    .map((chat) => {
                        if (Number(chat.userId) !== Number(userId)) return chat;

                        const currentlyOpened = Number(selectedUserId) === Number(userId);

                        return {
                            ...chat,
                            lastMessageAt: message.createdAt,
                            unreadCount: currentlyOpened
                                ? 0
                                : Number(chat.unreadCount || 0) + 1,
                        };
                    })
                    .sort((a, b) => {
                        return new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0);
                    });
            });

            if (Number(selectedUserId) === Number(userId)) {
                setMessages((prev) => {
                    const exists = prev.some((m) => m.id === message.id);
                    if (exists) return prev;
                    return [...prev, message];
                });

                await axiosInstance.patch(`/admin/support/chats/${userId}/read`).catch(() => {});
                scrollToBottom();
            }
        };

        const handleAdminReply = (payload) => {
            const userId = payload?.userId;
            const message = payload?.message;

            if (!userId || !message) return;

            if (Number(selectedUserId) === Number(userId)) {
                setMessages((prev) => {
                    const exists = prev.some((m) => m.id === message.id);
                    if (exists) return prev;
                    return [...prev, message];
                });

                scrollToBottom();
            }

            fetchChats();
        };

        socket.on("support:new_message", handleNewUserMessage);
        socket.on("support:admin_reply", handleAdminReply);

        return () => {
            socket.off("support:new_message", handleNewUserMessage);
            socket.off("support:admin_reply", handleAdminReply);
        };
    }, [selectedUserId]);

    useEffect(() => {
        scrollToBottom();
    }, [messages.length]);

    const sendMessage = async () => {
        const text = newMessage.trim();

        if (!text || !selectedUserId || sending) return;

        try {
            setSending(true);
            setError("");
            setNewMessage("");

            const res = await axiosInstance.post(
                `/admin/support/chats/${selectedUserId}/messages`,
                { text }
            );

            if (res.data) {
                setMessages((prev) => {
                    const exists = prev.some((m) => m.id === res.data.id);
                    if (exists) return prev;
                    return [...prev, res.data];
                });
            }

            fetchChats();
            scrollToBottom();
        } catch (err) {
            console.error("Ошибка отправки ответа поддержки:", err);
            setError("Не удалось отправить ответ");
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

    const formatDateTime = (value) => {
        if (!value) return "";

        const date = new Date(value);

        return date.toLocaleString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    const formatTime = (value) => {
        if (!value) return "";

        const date = new Date(value);

        return date.toLocaleTimeString("ru-RU", {
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    const getUsername = (chat) => {
        return chat?.user?.username || `Пользователь #${chat?.userId}`;
    };

    const getInitial = (chat) => {
        const username = getUsername(chat);
        return username?.[0]?.toUpperCase() || "П";
    };

    const isAdminMessage = (message) => {
        return message.senderRole === "admin";
    };

    return (
        <div className="admin-support-page">
            <div className="admin-support-topbar">
                <div>
                    <h1>
                        <FaHeadset />
                        Поддержка
                    </h1>
                    <p>Диалоги пользователей с администрацией CargoCamp</p>
                </div>

                <button
                    type="button"
                    className="admin-support-refresh"
                    onClick={fetchChats}
                    disabled={loadingChats}
                >
                    <FaSyncAlt />
                    Обновить
                </button>
            </div>

            {error && <div className="admin-support-error">{error}</div>}

            <div className="admin-support-layout">
                <aside className="admin-support-sidebar">
                    <div className="admin-support-sidebar-title">
                        <span>Чаты</span>
                        <strong>{chats.length}</strong>
                    </div>

                    {loadingChats ? (
                        <div className="admin-support-state">Загрузка...</div>
                    ) : chats.length === 0 ? (
                        <div className="admin-support-empty-sidebar">
                            <FaInbox />
                            <span>Пока нет обращений</span>
                        </div>
                    ) : (
                        <div className="admin-support-chat-list">
                            {chats.map((chat) => {
                                const active = Number(chat.userId) === Number(selectedUserId);
                                const unread = Number(chat.unreadCount || 0);

                                return (
                                    <button
                                        key={chat.userId}
                                        type="button"
                                        className={`admin-support-chat-item ${
                                            active ? "active" : ""
                                        }`}
                                        onClick={() => setSelectedUserId(chat.userId)}
                                    >
                                        <div className="admin-support-user-avatar">
                                            {chat.user?.avatar ? (
                                                <img src={chat.user.avatar} alt="" />
                                            ) : (
                                                <span>{getInitial(chat)}</span>
                                            )}
                                        </div>

                                        <div className="admin-support-chat-info">
                                            <div className="admin-support-chat-main">
                                                <strong>{getUsername(chat)}</strong>
                                                <small>{formatDateTime(chat.lastMessageAt)}</small>
                                            </div>

                                            <div className="admin-support-chat-sub">
                                                <span>
                                                    <FaPhone />
                                                    {chat.user?.phone || "Телефон не указан"}
                                                </span>

                                                {unread > 0 && (
                                                    <b className="admin-support-unread">
                                                        {unread}
                                                    </b>
                                                )}
                                            </div>
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </aside>

                <section className="admin-support-chat-panel">
                    {!selectedUserId ? (
                        <div className="admin-support-no-chat">
                            <FaHeadset />
                            <h2>Выберите чат</h2>
                            <p>Здесь появится переписка с пользователем.</p>
                        </div>
                    ) : (
                        <>
                            <header className="admin-support-chat-header">
                                <div className="admin-support-user-avatar big">
                                    {selectedChat?.user?.avatar ? (
                                        <img src={selectedChat.user.avatar} alt="" />
                                    ) : (
                                        <span>{getInitial(selectedChat)}</span>
                                    )}
                                </div>

                                <div>
                                    <h2>{getUsername(selectedChat)}</h2>
                                    <p>
                                        <FaUser />
                                        ID: {selectedUserId}
                                        {selectedChat?.user?.phone && (
                                            <>
                                                {" · "}
                                                <FaPhone />
                                                {selectedChat.user.phone}
                                            </>
                                        )}
                                    </p>
                                </div>
                            </header>

                            <main className="admin-support-messages">
                                {loadingMessages ? (
                                    <div className="admin-support-state">
                                        Загрузка сообщений...
                                    </div>
                                ) : messages.length === 0 ? (
                                    <div className="admin-support-no-messages">
                                        Сообщений пока нет
                                    </div>
                                ) : (
                                    <div className="admin-support-message-list">
                                        {messages.map((message) => {
                                            const mine = isAdminMessage(message);

                                            return (
                                                <div
                                                    key={message.id}
                                                    className={`admin-support-message-row ${
                                                        mine ? "mine" : "user"
                                                    }`}
                                                >
                                                    <div className="admin-support-message-bubble">
                                                        <div className="admin-support-message-author">
                                                            {mine
                                                                ? "Администратор"
                                                                : message.sender?.username ||
                                                                "Пользователь"}
                                                        </div>

                                                        <div className="admin-support-message-text">
                                                            {message.text}
                                                        </div>

                                                        <div className="admin-support-message-time">
                                                            {formatTime(message.createdAt)}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}

                                        <div ref={bottomRef} />
                                    </div>
                                )}
                            </main>

                            <form
                                className="admin-support-input-wrap"
                                onSubmit={handleSubmit}
                            >
                                <textarea
                                    value={newMessage}
                                    onChange={(e) => setNewMessage(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Написать ответ пользователю..."
                                    disabled={sending}
                                    rows={1}
                                />

                                <button
                                    type="submit"
                                    disabled={!newMessage.trim() || sending}
                                >
                                    <FaPaperPlane />
                                    Отправить
                                </button>
                            </form>
                        </>
                    )}
                </section>
            </div>
        </div>
    );
};

export default AdminSupportPage;