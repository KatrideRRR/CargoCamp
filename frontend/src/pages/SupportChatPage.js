import React, {
    useEffect,
    useMemo,
    useRef,
    useState,
    useCallback,
} from "react";
import { useNavigate } from "react-router-dom";
import axiosInstance from "../utils/axiosInstance";
import { socket } from "../socketClient";
import { useAuth } from "../utils/authContext";
import "../styles/SupportChatPage.css";
import "../styles/SupportChatPageDark.css";
import SupportPhoneLink from "../components/SupportPhoneLink";

import {
    FaArrowLeft,
    FaPaperPlane,
    FaHeadset,
    FaCheckDouble,
    FaCheck,
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

const SupportChatPage = () => {
    const navigate = useNavigate();
    const { user } = useAuth();

    const [messages, setMessages] = useState([]);
    const [newMessage, setNewMessage] = useState("");
    const [loading, setLoading] = useState(true);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState("");

    const bottomRef = useRef(null);
    const sendingRef = useRef(false);

    useEffect(() => {
        document.body.classList.add("hide-bottom-menu");

        return () => {
            document.body.classList.remove("hide-bottom-menu");
        };
    }, []);

    const currentUserId = useMemo(() => {
        return user?.id || user?.userId || null;
    }, [user]);

    const draftKey =
        `cc:support:user:draft:${currentUserId}`;

    const pendingKey =
        `cc:support:user:pending:${currentUserId}`;

    useEffect(() => {
        if (!currentUserId) return;

        try {
            const pending = JSON.parse(
                localStorage.getItem(pendingKey) ||
                "null"
            );

            const draft =
                localStorage.getItem(draftKey);

            setNewMessage(
                pending?.text ||
                draft ||
                ""
            );
        } catch {
            setNewMessage("");
        }
    }, [
        currentUserId,
        draftKey,
        pendingKey,
    ]);

    const scrollToBottom = (smooth = true) => {
        setTimeout(() => {
            bottomRef.current?.scrollIntoView({
                behavior: smooth ? "smooth" : "auto",
                block: "end",
            });
        }, 50);
    };

    const fetchMessages = useCallback(
        async ({ silent = false } = {}) => {
            try {
                if (!silent) {
                    setLoading(true);
                }

                const res =
                    await axiosInstance.get(
                        "/support/messages"
                    );

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

                /*
                 * Подтверждаем прочтение только
                 * загруженных ответов поддержки.
                 */
                if (!document.hidden) {
                    const lastAdminId =
                        incoming
                            .filter(
                                (message) =>
                                    message.senderRole ===
                                    "admin"
                            )
                            .reduce(
                                (max, message) =>
                                    Math.max(
                                        max,
                                        Number(message.id)
                                    ),
                                0
                            );

                    if (lastAdminId > 0) {
                        await axiosInstance.patch(
                            "/support/read",
                            {
                                throughId:
                                lastAdminId,
                            }
                        );
                    }
                }
            } catch (err) {
                console.error(
                    "Ошибка загрузки чата поддержки:",
                    err
                );

                setError(
                    "Не удалось обновить переписку поддержки"
                );
            } finally {
                if (!silent) {
                    setLoading(false);
                }
            }
        },
        []
    );

    useEffect(() => {
        fetchMessages();
    }, [fetchMessages]);

    useEffect(() => {
        if (!currentUserId) return;

        const subscribeSupport = () => {
            socket.emit("subscribeSupportChat");

            fetchMessages({
                silent: true,
            });
        };

        const receiveMessage = (payload) => {
            if (
                Number(payload?.userId) !==
                Number(currentUserId)
            ) {
                return;
            }

            const message = payload?.message;

            if (!message?.id) return;

            setMessages((previous) =>
                mergeSupportMessages(
                    previous,
                    [message]
                )
            );

            if (
                message.senderRole === "admin" &&
                !document.hidden
            ) {
                axiosInstance.patch(
                    "/support/read",
                    {
                        throughId: message.id,
                    }
                ).catch((error) => {
                    console.warn(
                        "Не удалось подтвердить прочтение ответа:",
                        error
                    );
                });
            }
        };

        const handleRead = (payload) => {
            if (
                Number(payload?.userId) !==
                Number(currentUserId) ||
                payload.readerRole !== "admin"
            ) {
                return;
            }

            setMessages((previous) =>
                previous.map((message) => {
                    if (
                        message.senderRole !== "user"
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
                        isReadByAdmin: true,
                    };
                })
            );
        };

        const handleOnline = () => {
            fetchMessages({
                silent: true,
            });
        };

        const handleVisibility = () => {
            if (!document.hidden) {
                handleOnline();
            }
        };

        socket.on("connect", subscribeSupport);

        socket.on(
            "support:reply",
            receiveMessage
        );

        socket.on(
            "support:new_message",
            receiveMessage
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
            socket.emit("subscribeSupportChat");
        }

        return () => {
            socket.off(
                "connect",
                subscribeSupport
            );

            socket.off(
                "support:reply",
                receiveMessage
            );

            socket.off(
                "support:new_message",
                receiveMessage
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

            if (socket.connected) {
                socket.emit("unsubscribeSupportChat");
            }
        };
    }, [
        currentUserId,
        fetchMessages,
    ]);

    useEffect(() => {
        scrollToBottom();
    }, [messages.length]);

    const sendMessage = async () => {
        const text = newMessage.trim();

        if (
            !text ||
            !currentUserId ||
            sendingRef.current
        ) {
            return;
        }

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
                "Верните исходный текст для безопасного повтора."
            );
            return;
        }

        if (!pending) {
            if (!window.crypto?.randomUUID) {
                setError(
                    "Безопасная отправка недоступна в этом браузере"
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
                "Не удалось сохранить попытку отправки. " +
                "Проверьте доступность хранилища браузера."
            );
            return;
        }

        sendingRef.current = true;
        setSending(true);
        setError("");

        try {
            const res = await axiosInstance.post(
                "/support/messages",
                {
                    text: pending.text,

                    clientMessageId:
                    pending.clientMessageId,
                }
            );

            if (!res.data?.id) {
                throw new Error(
                    "Нет подтверждения сервера"
                );
            }

            setMessages((previous) =>
                mergeSupportMessages(
                    previous,
                    [res.data]
                )
            );

            localStorage.removeItem(pendingKey);
            localStorage.removeItem(draftKey);

            setNewMessage((previous) =>
                previous.trim() === pending.text
                    ? ""
                    : previous
            );
        } catch (err) {
            console.error(
                "Ошибка отправки в поддержку:",
                err
            );

            setError(
                "Нет подтверждения отправки. " +
                "Повторите отправку того же текста."
            );
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

                    <p>
                        Поможем с заказами, оплатой и работой приложения
                    </p>

                    <SupportPhoneLink
                        className="support-chat-phone"
                        showIcon
                    />
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

                {loading && messages.length === 0 ? (
                    <div className="support-state">Загрузка чата...</div>
                ) : error && messages.length === 0 ? (
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
                                            {mine && (
                                                message.isReadByAdmin
                                                    ? (
                                                        <FaCheckDouble
                                                            title="Прочитано поддержкой"
                                                        />
                                                    )
                                                    : (
                                                        <FaCheck
                                                            title="Сохранено на сервере"
                                                        />
                                                    )
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                <div ref={bottomRef} />
            </main>

            {error && messages.length > 0 && (
                <div
                    className="support-error"
                    role="alert"
                >
                    {error}
                </div>
            )}

            <form className="support-chat-input-wrap" onSubmit={handleSubmit}>
                <textarea
                    className="support-chat-input"
                    value={newMessage}
                    onChange={(e) => {
                        const value = e.target.value;

                        setNewMessage(value);

                        try {
                            localStorage.setItem(
                                draftKey,
                                value
                            );
                        } catch {
                            // Состояние React сохранится
                            // до закрытия страницы.
                        }
                    }}
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