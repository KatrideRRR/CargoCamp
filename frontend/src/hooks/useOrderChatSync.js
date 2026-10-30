import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";

import axiosInstance from "../utils/axiosInstance";
import { socket } from "../socketClient";

const PAGE_SIZE = 100;

/**
 * Объединение сообщений по серверному ID.
 *
 * Socket.IO и HTTP могут доставить одно и то же
 * сообщение, но на экране оно останется одним.
 */
function mergeMessages(previous, incoming) {
    if (!Array.isArray(incoming) || !incoming.length) {
        return previous;
    }

    const byId = new Map();

    for (const message of previous) {
        if (message?.id != null) {
            byId.set(
                String(message.id),
                message
            );
        }
    }

    for (const message of incoming) {
        if (message?.id == null) {
            continue;
        }

        const key = String(message.id);

        byId.set(key, {
            ...(byId.get(key) || {}),
            ...message,
        });
    }

    return Array.from(byId.values()).sort((a, b) => {
        const firstTime =
            Date.parse(a.createdAt || a.created_at) || 0;

        const secondTime =
            Date.parse(b.createdAt || b.created_at) || 0;

        if (firstTime !== secondTime) {
            return firstTime - secondTime;
        }

        return Number(a.id) - Number(b.id);
    });
}

export default function useOrderChatSync({
                                             userId,
                                             orderId,
                                             orderType = "regular",
                                         }) {
    const scopeKey =
        `${userId || "none"}:${orderType}:${orderId}`;

    const [state, setState] = useState({
        key: scopeKey,
        messages: [],
        loading: true,
        error: "",
    });

    const syncRef = useRef(null);

    const messages =
        state.key === scopeKey
            ? state.messages
            : [];

    const loadingMessages =
        state.key !== scopeKey ||
        state.loading;

    const syncError =
        state.key === scopeKey
            ? state.error
            : "";

    /*
     * Добавление сообщения, подтверждённого
     * сервером через POST или Socket.IO.
     */
    const addMessage = useCallback(
        (message) => {
            if (!message?.id) return;

            setState((previous) => {
                if (previous.key !== scopeKey) {
                    return previous;
                }

                return {
                    ...previous,
                    messages: mergeMessages(
                        previous.messages,
                        [message]
                    ),
                };
            });
        },
        [scopeKey]
    );

    /*
     * Ручное обновление чата.
     * Используется при pull-to-refresh
     * и кнопке повторной синхронизации.
     */
    const refreshMessages = useCallback(
        () => {
            return (
                syncRef.current?.() ||
                Promise.resolve()
            );
        },
        []
    );

    useEffect(() => {
        if (!userId || !orderId) {
            return;
        }

        let disposed = false;

        /*
         * cursor обновляется только после
         * успешного HTTP-запроса.
         *
         * Не меняем его из Socket.IO:
         * иначе можно пропустить сообщения,
         * пришедшие раньше по времени.
         */
        let cursor = 0;

        let inFlight = null;
        let rerunRequested = false;

        setState({
            key: scopeKey,
            messages: [],
            loading: true,
            error: "",
        });

        const updateState = (updater) => {
            if (disposed) return;

            setState((previous) => {
                if (previous.key !== scopeKey) {
                    return previous;
                }

                return updater(previous);
            });
        };

        /*
         * Загрузка пропущенных сообщений
         * порциями по 100.
         */
        const loadMissingMessages = async () => {
            let hasMore = true;

            while (hasMore && !disposed) {
                const response =
                    await axiosInstance.get(
                        `/messages/sync/${orderType}/${orderId}`,
                        {
                            params: {
                                afterId: cursor,
                            },
                        }
                    );

                if (disposed) return;

                const payload = response.data;

                if (
                    !payload ||
                    !Array.isArray(payload.messages)
                ) {
                    throw new Error(
                        "Некорректный ответ синхронизации"
                    );
                }

                const batch = payload.messages;

                if (batch.length > PAGE_SIZE) {
                    throw new Error(
                        "Сервер вернул слишком много сообщений"
                    );
                }

                const nextCursor =
                    Number(payload.nextCursor);

                if (
                    !Number.isSafeInteger(nextCursor) ||
                    nextCursor < cursor ||
                    (
                        batch.length > 0 &&
                        nextCursor === cursor
                    )
                ) {
                    throw new Error(
                        "Некорректный курсор сообщений"
                    );
                }

                updateState((previous) => ({
                    ...previous,

                    messages: mergeMessages(
                        previous.messages,
                        batch
                    ),
                }));

                cursor = nextCursor;

                hasMore = Boolean(payload.hasMore);

                if (hasMore && batch.length === 0) {
                    throw new Error(
                        "Пустая страница синхронизации"
                    );
                }
            }
        };

        /*
         * Не запускаем несколько параллельных
         * синхронизаций.
         *
         * Если во время загрузки пришёл сигнал
         * о восстановлении сети — повторяем
         * проверку после текущего запроса.
         */
        const synchronize = () => {
            if (disposed) {
                return Promise.resolve();
            }

            if (inFlight) {
                rerunRequested = true;
                return inFlight;
            }

            const task = (async () => {
                do {
                    rerunRequested = false;

                    try {
                        await loadMissingMessages();

                        updateState((previous) => ({
                            ...previous,
                            error: "",
                        }));

                        /*
                         * Уведомления можно отметить
                         * прочитанными, только когда
                         * пользователь реально смотрит
                         * открытый чат.
                         */
                        if (
                            !disposed &&
                            socket.connected &&
                            !document.hidden
                        ) {
                            socket.emit(
                                "markAsRead",
                                {
                                    orderId,
                                    orderType,
                                }
                            );
                        }
                    } catch (error) {
                        if (disposed) return;

                        console.error(
                            "Ошибка синхронизации чата:",
                            error
                        );

                        updateState((previous) => ({
                            ...previous,
                            error:
                                "Не удалось обновить переписку. Проверьте интернет.",
                        }));
                    }
                } while (
                    rerunRequested &&
                    !disposed
                    );
            })();

            inFlight = task.finally(() => {
                inFlight = null;

                updateState((previous) => ({
                    ...previous,
                    loading: false,
                }));
            });

            return inFlight;
        };

        syncRef.current = synchronize;

        /*
         * Подписываемся на конкретный заказ
         * после подключения или переподключения.
         */
        const joinCurrentChat = () => {
            socket.emit(
                "joinChat",
                {
                    orderId,
                    orderType,
                },
                (result) => {
                    if (
                        result?.ok === false &&
                        !disposed
                    ) {
                        console.warn(
                            "Подписка на чат отклонена:",
                            result.message
                        );
                    }
                }
            );
        };

        /*
         * Новые сообщения сразу отображаются.
         * Но HTTP-курсор НЕ меняем.
         */
        const handleReceiveMessage = (message) => {
            if (!message?.id) return;

            if (
                String(message.orderId) !==
                String(orderId)
            ) {
                return;
            }

            if (
                String(message.orderType) !==
                String(orderType)
            ) {
                return;
            }

            const isParticipant =
                String(message.senderId) ===
                String(userId) ||
                String(message.receiverId) ===
                String(userId);

            if (!isParticipant) return;

            updateState((previous) => ({
                ...previous,

                messages: mergeMessages(
                    previous.messages,
                    [message]
                ),
            }));

            if (
                String(message.receiverId) ===
                String(userId) &&
                socket.connected &&
                !document.hidden
            ) {
                socket.emit("markAsRead", {
                    orderId,
                    orderType,
                });
            }
        };

        const handleConnect = () => {
            joinCurrentChat();

            // Получаем всё, что пропустили офлайн.
            synchronize();
        };

        const handleOnline = () => {
            synchronize();
        };

        const handleFocus = () => {
            synchronize();
        };

        const handleVisibility = () => {
            if (!document.hidden) {
                synchronize();
            }
        };

        /*
         * Подписки на события.
         */
        socket.on(
            "receiveMessage",
            handleReceiveMessage
        );

        socket.on(
            "connect",
            handleConnect
        );

        window.addEventListener(
            "online",
            handleOnline
        );

        window.addEventListener(
            "focus",
            handleFocus
        );

        document.addEventListener(
            "visibilitychange",
            handleVisibility
        );

        /*
         * Первая синхронизация выполняется
         * даже при отключённом Socket.IO,
         * если HTTP уже работает.
         */
        synchronize();

        if (socket.connected) {
            joinCurrentChat();
        }

        return () => {
            disposed = true;

            if (syncRef.current === synchronize) {
                syncRef.current = null;
            }

            socket.off(
                "receiveMessage",
                handleReceiveMessage
            );

            socket.off(
                "connect",
                handleConnect
            );

            window.removeEventListener(
                "online",
                handleOnline
            );

            window.removeEventListener(
                "focus",
                handleFocus
            );

            document.removeEventListener(
                "visibilitychange",
                handleVisibility
            );

            if (socket.connected) {
                socket.emit("leaveChat");
            }
        };
    }, [
        scopeKey,
        userId,
        orderId,
        orderType,
    ]);

    return {
        messages,
        addMessage,
        refreshMessages,
        loadingMessages,
        syncError,
    };
}