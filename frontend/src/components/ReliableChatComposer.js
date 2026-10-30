import React, {
    useEffect,
    useRef,
    useState,
} from "react";

import axiosInstance from "../utils/axiosInstance";

import "../styles/ReliableChatComposer.css";

const STORAGE_PREFIX = "cc:chat:pending:v1:";

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
        const raw = sessionStorage.getItem(key);

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
        sessionStorage.setItem(
            key,
            JSON.stringify(message)
        );
    } catch (error) {
        console.warn(
            "Не удалось сохранить неотправленное сообщение:",
            error
        );
    }
}

function removePending(key, clientMessageId) {
    try {
        const saved = readPending(key);

        if (
            saved?.clientMessageId ===
            clientMessageId
        ) {
            sessionStorage.removeItem(key);
        }
    } catch {
        // Состояние в памяти остаётся доступным.
    }
}

export default function ReliableChatComposer({
                                                 userId,
                                                 receiverId,
                                                 orderId,
                                                 orderType,
                                                 messages,
                                                 onConfirmed,
                                             }) {
    const storageKey = [
        STORAGE_PREFIX,
        userId,
        orderType,
        orderId,
    ].join(":");

    const [pending, setPending] = useState(
        () => readPending(storageKey)
    );

    const [text, setText] = useState(
        () => readPending(storageKey)?.content || ""
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

        setText((previous) =>
            previous.trim() === pending.content
                ? ""
                : previous
        );
    }, [messages, pending, storageKey]);

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
            String(receiverId)
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

        const textarea = textareaRef.current;

        if (!textarea) return;

        textarea.style.height = "auto";

        textarea.style.height =
            `${Math.min(textarea.scrollHeight, 120)}px`;
    };

    return (
        <div className="chat-input-container">
            <textarea
                ref={textareaRef}
                value={text}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
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