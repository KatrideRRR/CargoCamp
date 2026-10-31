import React, {
    useEffect,
    useRef,
    useState,
} from "react";

import axiosInstance from "../utils/axiosInstance";

import "../styles/ReliableChatComposer.css";
import ChatReplyQuote from "./ChatReplyQuote";

const STORAGE_PREFIX = "cc:chat:pending:v1:";

const DRAFT_PREFIX = "cc:chat:draft:v1:";

function createMessageId() {
    if (window.crypto?.randomUUID) {
        return window.crypto.randomUUID();
    }

    if (!window.crypto?.getRandomValues) {
        throw new Error(
            "Недоступен безопасный генератор идентификаторов"
        );
    }

    const bytes = new Uint8Array(16);

    window.crypto.getRandomValues(bytes);

    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, (byte) =>
        byte.toString(16).padStart(2, "0")
    ).join("");

    return [
        hex.slice(0, 8),
        hex.slice(8, 12),
        hex.slice(12, 16),
        hex.slice(16, 20),
        hex.slice(20),
    ].join("-");
}

function readPending(key) {
    try {
        const raw =
            localStorage.getItem(key) ||
            sessionStorage.getItem(key);

        if (!raw) return null;

        const value = JSON.parse(raw);

        if (
            !value ||
            typeof value.content !== "string" ||
            typeof value.clientMessageId !== "string"
        ) {
            return null;
        }

        return value;
    } catch {
        return null;
    }
}

function savePending(key, message) {
    try {
        localStorage.setItem(
            key,
            JSON.stringify(message)
        );
    } catch (error) {
        console.warn(
            "Не удалось сохранить отправку:",
            error
        );

        try {
            sessionStorage.setItem(
                key,
                JSON.stringify(message)
            );
        } catch {
            // Продолжаем работу в памяти.
        }
    }
}

function removePending(key, clientMessageId) {
    try {
        const saved = readPending(key);

        if (
            saved?.clientMessageId !==
            clientMessageId
        ) {
            return;
        }

        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
    } catch {
        // Ошибка локального хранилища
        // не влияет на серверное сообщение.
    }
}

function readDraft(key) {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function saveDraft(key, text) {
    try {
        if (!text) {
            localStorage.removeItem(key);
            return;
        }

        localStorage.setItem(key, text);
    } catch (error) {
        console.warn(
            "Не удалось сохранить черновик:",
            error
        );
    }
}

export default function ReliableChatComposer({
                                                 userId,
                                                 receiverId,
                                                 orderId,
                                                 orderType,
                                                 messages,
                                                 onConfirmed,
                                                 onTypingChange,
                                                 onTypingStop,
                                                 replyTo,
                                                 onReplyCleared,
                                                 otherUserName,
                                             }) {
    const storageKey = [
        STORAGE_PREFIX,
        userId,
        orderType,
        orderId,
    ].join(":");

    const draftKey = [
        DRAFT_PREFIX,
        userId,
        orderType,
        orderId,
    ].join(":");

    const [pending, setPending] = useState(
        () => readPending(storageKey)
    );

    const [text, setText] = useState(
        () =>
            readPending(storageKey)?.content ??
            readDraft(draftKey) ??
            ""
    );

    const [sending, setSending] = useState(false);

    const [sendError, setSendError] = useState(
        () => readPending(storageKey)
            ? "Есть сообщение без подтверждения отправки."
            : ""
    );

    const textareaRef = useRef(null);
    const inFlightRef = useRef(false);

    const confirmedIdsRef = useRef(new Set());

    useEffect(() => {
        saveDraft(draftKey, text);
    }, [draftKey, text]);

    useEffect(() => {
        const saved = readPending(storageKey);

        if (saved) {
            savePending(storageKey, saved);
        }
    }, [storageKey]);

    const canSend =
        Boolean(text.trim()) &&
        Boolean(receiverId) &&
        !sending;

    /*
     * Если сообщение уже пришло через Socket.IO
     * или загрузилось из истории, значит сервер
     * действительно его сохранил.
     *
     * Удаляем локальную неподтверждённую копию.
     */
    useEffect(() => {
        if (!pending?.clientMessageId) {
            return;
        }

        const existsOnServer =
            Array.isArray(messages) &&
            messages.some(
                (message) =>
                    message.clientMessageId ===
                    pending.clientMessageId
            );

        if (!existsOnServer) {
            return;
        }

        confirmedIdsRef.current.add(
            pending.clientMessageId
        );

        removePending(
            storageKey,
            pending.clientMessageId
        );

        setPending(null);
        setSendError("");

        if (pending.replyToMessageId) {
            onReplyCleared?.(
                pending.replyToMessageId
            );
        }

        setText((previous) =>
            previous.trim() === pending.content
                ? ""
                : previous
        );
    }, [messages, pending, storageKey, onReplyCleared]);

    const confirmMessage = (
        clientMessageId,
        content
    ) => {
        confirmedIdsRef.current.add(
            clientMessageId
        );

        removePending(
            storageKey,
            clientMessageId
        );

        setPending((previous) =>
            previous?.clientMessageId ===
            clientMessageId
                ? null
                : previous
        );

        setSendError("");

        setText((previous) =>
            previous.trim() === content
                ? ""
                : previous
        );
    };

    const sendMessage = async () => {
        const content = text.trim();

        const selectedReplyId =
            replyTo?.id
                ? Number(replyTo.id)
                : null;

        if (
            !content ||
            !receiverId ||
            inFlightRef.current
        ) {
            return;
        }

        if (content.length > 10000) {
            setSendError(
                "Сообщение не может быть длиннее 10000 символов."
            );
            return;
        }

        if (
            pending &&
            (
                pending.content !== content ||
                String(pending.receiverId) !==
                String(receiverId) ||
                Number(pending.replyToMessageId || 0) !==
                Number(selectedReplyId || 0)
            )
        ) {
            setSendError(
                "Предыдущая отправка не подтверждена. " +
                "Верните исходный текст и цитату для " +
                "безопасного повтора."
            );

            return;
        }

        // Пользователь закончил набирать сообщение.
        onTypingStop?.();

        /*
         * Если текст не менялся после неудачной
         * отправки — используем прежний ID.
         *
         * Новый текст — новое логическое сообщение.
         */
        let outgoing;

        if (
            pending &&
            pending.content === content &&
            String(pending.receiverId) ===
            String(receiverId) &&
            Number(pending.replyToMessageId || 0) ===
            Number(selectedReplyId || 0)
        ) {
            outgoing = pending;
        } else {
            try {
                outgoing = {
                    clientMessageId:
                        createMessageId(),

                    content,

                    receiverId,
                    orderId,
                    orderType,
                    userId,
                    replyToMessageId: selectedReplyId,
                };
            } catch (error) {
                setSendError(error.message);
                return;
            }
        }

        /*
         * Сохраняем ID и текст до начала
         * HTTP-запроса.
         */
        savePending(
            storageKey,
            outgoing
        );

        setPending(outgoing);

        inFlightRef.current = true;

        setSending(true);
        setSendError("");

        try {
            const response =
                await axiosInstance.post(
                    "/messages",
                    {
                        content: outgoing.content,

                        receiverId:
                        outgoing.receiverId,

                        orderId:
                        outgoing.orderId,

                        orderType:
                        outgoing.orderType,

                        clientMessageId:
                        outgoing.clientMessageId,
                        replyToMessageId:
                        outgoing.replyToMessageId,
                    }
                );

            if (!response.data?.id) {
                throw new Error(
                    "Сервер не подтвердил сохранение сообщения"
                );
            }

            onConfirmed?.(response.data);

            confirmMessage(
                outgoing.clientMessageId,
                outgoing.content
            );

            if (outgoing.replyToMessageId) {
                onReplyCleared?.(
                    outgoing.replyToMessageId
                );
            }
        } catch (error) {
            console.error(
                "Ошибка отправки сообщения:",
                error
            );

            /*
             * Сообщение могло уже прийти
             * по Socket.IO. Тогда не показываем
             * ложную ошибку отправки.
             */
            if (
                confirmedIdsRef.current.has(
                    outgoing.clientMessageId
                )
            ) {
                return;
            }

            const status =
                error.response?.status;

            if (status === 401) {
                setSendError(
                    "Сессия завершена. Войдите снова."
                );
            } else if (status === 403 || status === 404) {
                setSendError(
                    "Нет доступа к переписке. Проверьте заказ."
                );
            } else if (status === 409) {
                setSendError(
                    "Отправка отклонена. Проверьте сообщение и собеседника."
                );
            } else {
                setSendError(
                    "Нет подтверждения отправки. Нажмите «Отправить» повторно — дубль не появится."
                );
            }
        } finally {
            inFlightRef.current = false;
            setSending(false);
        }
    };

    const handleKeyDown = (event) => {
        if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent?.isComposing &&
            event.keyCode !== 229
        ) {
            event.preventDefault();

            sendMessage();
        }
    };

    const handleInputChange = (event) => {
        const value = event.target.value;

        setText(value);

        onTypingChange?.(value);

        const textarea = textareaRef.current;

        if (!textarea) return;

        textarea.style.height = "auto";

        textarea.style.height =
            `${Math.min(textarea.scrollHeight, 120)}px`;
    };

    return (
        <div className="chat-input-container">
            {replyTo && (
                <div className="chat-compose-reply">
                    <ChatReplyQuote
                        message={replyTo}
                        currentUserId={userId}
                        otherUserName={otherUserName}
                    />

                    <button
                        type="button"
                        className="chat-compose-reply-close"
                        onClick={() => onReplyCleared?.()}
                        aria-label="Отменить ответ"
                        title="Отменить ответ"
                    >
                        ×
                    </button>
                </div>
            )}
            <textarea
                ref={textareaRef}
                value={text}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onBlur={onTypingStop}
                placeholder="Введите сообщение..."
                className="chat-input"
                rows={1}
                maxLength={10000}
                disabled={sending}
                aria-label="Текст сообщения"
            />

            <button
                type="button"
                onClick={sendMessage}
                className="chat-send-button"
                disabled={!canSend}
                aria-label="Отправить сообщение"
            >
                ➤
            </button>

            {(sending || sendError) && (
                <div
                    className={
                        "chat-send-status " +
                        (sendError
                            ? "chat-send-status--error"
                            : "")
                    }
                    role="status"
                    aria-live="polite"
                >
                    {sending
                        ? "Отправляем сообщение…"
                        : sendError}
                </div>
            )}
        </div>
    );
}