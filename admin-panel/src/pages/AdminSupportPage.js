import React, { useEffect, useMemo, useRef, useState } from "react";
import axiosInstance from "../utils/axiosInstance";
import { socket } from "../socketClient";
import "../styles/AdminSupportPage.css";
import { jwtDecode } from "jwt-decode";
import {
    FaHeadset,
    FaPaperPlane,
    FaUser,
    FaPhone,
    FaSyncAlt,
    FaInbox,
} from "react-icons/fa";

function mergeSupportMessages(previous, incoming) {
    const byId = new Map();

    for (const message of previous) {
        byId.set(String(message.id), message);
    }

    for (const message of incoming) {
        const key = String(message.id);

        byId.set(key, {
            ...(byId.get(key) || {}),
            ...message,
        });
    }

    return [...byId.values()].sort(
        (a, b) => Number(a.id) - Number(b.id)
    );
}

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

    const selectedUserRef = useRef(null);
    const sendingRef = useRef(false);

    const adminId = useMemo(() => {
        try {
            const token =
                localStorage.getItem("authToken");

            return jwtDecode(token)?.id || "unknown";
        } catch {
            return "unknown";
        }
    }, []);

    const draftKeyFor = (userId) =>
        `cc:support:admin:${adminId}:${userId}:draft`;

    const pendingKeyFor = (userId) =>
        `cc:support:admin:${adminId}:${userId}:pending`;

    selectedUserRef.current = selectedUserId;

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

            setSelectedUserId((previous) =>
                previous || list[0]?.userId || null
            );
        } catch (err) {
            console.error("Ошибка загрузки чатов поддержки:", err);
            setError("Не удалось загрузить чаты поддержки");
        } finally {
            setLoadingChats(false);
        }
    };

    const fetchMessages = async (
        userId,
        { silent = false } = {}
    ) => {
        if (!userId) return;

        const requestedUserId = Number(userId);

        try {
            if (!silent) {
                setLoadingMessages(true);
            }

            const res = await axiosInstance.get(
                `/admin/support/chats/${requestedUserId}/messages`
            );

            /*
             * Пока загружали историю, администратор
             * мог открыть другой диалог.
             */
            if (
                Number(selectedUserRef.current) !==
                requestedUserId
            ) {
                return;
            }

            const incoming =
                Array.isArray(res.data)
                    ? res.data
                    : [];

            setMessages((previous) =>
                mergeSupportMessages(
                    previous,
                    incoming
                )
            );

            setError("");

            if (!document.hidden) {
                const lastUserMessageId =
                    incoming
                        .filter(
                            (message) =>
                                message.senderRole ===
                                "user"
                        )
                        .reduce(
                            (max, message) =>
                                Math.max(
                                    max,
                                    Number(message.id)
                                ),
                            0
                        );

                if (lastUserMessageId > 0) {
                    await axiosInstance.patch(
                        `/admin/support/chats/${requestedUserId}/read`,
                        {
                            throughId:
                            lastUserMessageId,
                        }
                    );

                    if (
                        Number(selectedUserRef.current) ===
                        requestedUserId
                    ) {
                        setChats((previous) =>
                            previous.map((chat) =>
                                Number(chat.userId) ===
                                requestedUserId
                                    ? {
                                        ...chat,
                                        unreadCount: 0,
                                    }
                                    : chat
                            )
                        );
                    }
                }
            }

            if (!silent) {
                scrollToBottom(false);
            }
        } catch (err) {
            console.error(
                "Ошибка загрузки поддержки:",
                err
            );

            if (
                Number(selectedUserRef.current) ===
                requestedUserId
            ) {
                setError(
                    "Не удалось обновить переписку"
                );
            }
        } finally {
            if (
                !silent &&
                Number(selectedUserRef.current) ===
                requestedUserId
            ) {
                setLoadingMessages(false);
            }
        }
    };

    useEffect(() => {
        fetchChats();
    }, []);

    useEffect(() => {
        setMessages([]);

        if (!selectedUserId) {
            setNewMessage("");
            return;
        }

        try {
            const pending = JSON.parse(
                localStorage.getItem(
                    pendingKeyFor(selectedUserId)
                ) || "null"
            );

            const draft =
                localStorage.getItem(
                    draftKeyFor(selectedUserId)
                );

            setNewMessage(
                pending?.text ||
                draft ||
                ""
            );
        } catch {
            setNewMessage("");
        }

        fetchMessages(selectedUserId);
    }, [selectedUserId]);

    useEffect(() => {
        const subscribeAdminSupport = () => {
            socket.emit("subscribeAdminSupport");

            fetchChats();

            if (selectedUserRef.current) {
                fetchMessages(
                    selectedUserRef.current,
                    {
                        silent: true,
                    }
                );
            }
        };

        const handleNewUserMessage = (payload) => {
            const userId =
                Number(payload?.userId);

            const message =
                payload?.message;

            if (!userId || !message?.id) {
                fetchChats();
                return;
            }

            if (
                Number(selectedUserRef.current) ===
                userId
            ) {
                setMessages((previous) =>
                    mergeSupportMessages(
                        previous,
                        [message]
                    )
                );

                if (!document.hidden) {
                    axiosInstance.patch(
                        `/admin/support/chats/${userId}/read`,
                        {
                            throughId: message.id,
                        }
                    ).then(() => {
                        fetchChats();
                    }).catch((error) => {
                        console.warn(
                            "Не удалось подтвердить прочтение:",
                            error
                        );
                    });
                }
            }

            fetchChats();
        };

        const handleAdminReply = (payload) => {
            const userId =
                Number(payload?.userId);

            const message =
                payload?.message;

            if (!userId || !message?.id) {
                return;
            }

            if (
                Number(selectedUserRef.current) ===
                userId
            ) {
                setMessages((previous) =>
                    mergeSupportMessages(
                        previous,
                        [message]
                    )
                );
            }

            fetchChats();
        };

        const handleRead = (payload) => {
            if (
                payload?.readerRole !== "user"
            ) {
                return;
            }

            if (
                Number(payload?.userId) !==
                Number(selectedUserRef.current)
            ) {
                return;
            }

            setMessages((previous) =>
                previous.map((message) => {
                    if (
                        message.senderRole !==
                        "admin"
                    ) {
                        return message;
                    }

                    if (
                        payload.throughId != null &&
                        Number(message.id) >
                        Number(payload.throughId)
                    ) {
                        return message;
                    }

                    return {
                        ...message,
                        isReadByUser: true,
                    };
                })
            );
        };

        const handleOnline = () => {
            fetchChats();

            if (selectedUserRef.current) {
                fetchMessages(
                    selectedUserRef.current,
                    {
                        silent: true,
                    }
                );
            }
        };

        const handleVisibility = () => {
            if (!document.hidden) {
                handleOnline();
            }
        };

        socket.on(
            "connect",
            subscribeAdminSupport
        );

        socket.on(
            "support:new_message",
            handleNewUserMessage
        );

        socket.on(
            "support:admin_reply",
            handleAdminReply
        );

        socket.on(
            "support:read",
            handleRead
        );

        window.addEventListener(
            "online",
            handleOnline
        );

        document.addEventListener(
            "visibilitychange",
            handleVisibility
        );

        if (socket.connected) {
            subscribeAdminSupport();
        } else {
            socket.connect();
        }

        return () => {
            socket.off(
                "connect",
                subscribeAdminSupport
            );

            socket.off(
                "support:new_message",
                handleNewUserMessage
            );

            socket.off(
                "support:admin_reply",
                handleAdminReply
            );

            socket.off(
                "support:read",
                handleRead
            );

            window.removeEventListener(
                "online",
                handleOnline
            );

            document.removeEventListener(
                "visibilitychange",
                handleVisibility
            );

            socket.disconnect();
        };
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages.length]);

    const sendMessage = async () => {
        const text = newMessage.trim();

        const targetUserId =
            Number(selectedUserId);

        if (
            !text ||
            !targetUserId ||
            sendingRef.current
        ) {
            return;
        }

        const pendingKey =
            pendingKeyFor(targetUserId);

        const draftKey =
            draftKeyFor(targetUserId);

        let pending = null;

        try {
            pending = JSON.parse(
                localStorage.getItem(pendingKey) ||
                "null"
            );
        } catch {
            pending = null;
        }

        if (pending && pending.text !== text) {
            setError(
                "Предыдущая отправка не подтверждена. " +
                "Повторите отправку исходного текста."
            );
            return;
        }

        if (!pending) {
            if (!window.crypto?.randomUUID) {
                setError(
                    "Безопасная отправка недоступна"
                );
                return;
            }

            pending = {
                text,
                clientMessageId:
                    window.crypto.randomUUID(),
            };
        }

        try {
            localStorage.setItem(
                pendingKey,
                JSON.stringify(pending)
            );
        } catch (error) {
            setError(
                "Не удалось сохранить попытку отправки"
            );
            return;
        }

        sendingRef.current = true;

        setSending(true);
        setError("");

        try {
            const res = await axiosInstance.post(
                `/admin/support/chats/${targetUserId}/messages`,
                {
                    text: pending.text,

                    clientMessageId:
                    pending.clientMessageId,
                }
            );

            if (!res.data?.id) {
                throw new Error(
                    "Сервер не подтвердил сообщение"
                );
            }

            localStorage.removeItem(pendingKey);
            localStorage.removeItem(draftKey);

            /*
             * Не добавляем ответ в чужой чат,
             * если администратор уже переключился.
             */
            if (
                Number(selectedUserRef.current) ===
                targetUserId
            ) {
                setMessages((previous) =>
                    mergeSupportMessages(
                        previous,
                        [res.data]
                    )
                );

                setNewMessage((previous) =>
                    previous.trim() === pending.text
                        ? ""
                        : previous
                );

                scrollToBottom();
            }

            fetchChats();
        } catch (err) {
            console.error(
                "Ошибка ответа поддержки:",
                err
            );

            if (
                Number(selectedUserRef.current) ===
                targetUserId
            ) {
                setError(
                    "Нет подтверждения отправки. " +
                    "Повторите отправку того же текста."
                );
            }
        } finally {
            sendingRef.current = false;
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
                                                            {mine && (
                                                                <span
                                                                    title={
                                                                        message.isReadByUser
                                                                            ? "Прочитано пользователем"
                                                                            : "Сохранено на сервере"
                                                                    }
                                                                >
        {message.isReadByUser ? " ✓✓" : " ✓"}
    </span>
                                                            )}

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
                                    onChange={(e) => {
                                        const value = e.target.value;

                                        setNewMessage(value);

                                        if (selectedUserId) {
                                            try {
                                                localStorage.setItem(
                                                    draftKeyFor(selectedUserId),
                                                    value
                                                );
                                            } catch {
                                                // Продолжаем работу в React.
                                            }
                                        }
                                    }}
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