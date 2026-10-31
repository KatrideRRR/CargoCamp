import {
    useCallback,
    useEffect,
    useRef,
} from "react";

import axiosInstance from "../utils/axiosInstance";

/**
 * Подтверждает прочтение входящих сообщений,
 * когда пользователь просматривает конец чата.
 *
 * Не создаёт элементов интерфейса.
 */
export default function ChatReadTracker({
                                            userId,
                                            orderId,
                                            orderType,
                                            messages,
                                            containerRef,
                                        }) {
    const latestMessagesRef = useRef(messages);

    latestMessagesRef.current = messages;

    const confirmedIdRef = useRef(0);
    const inFlightRef = useRef(false);
    const retryRequestedRef = useRef(false);
    const mountedRef = useRef(false);

    const markVisibleMessagesRead =
        useCallback(async () => {
            if (
                !mountedRef.current ||
                !userId ||
                !orderId ||
                document.hidden
            ) {
                return;
            }

            const container =
                containerRef.current;

            if (!container) return;

            /*
             * Не отмечаем новые сообщения,
             * когда человек читает старую историю.
             */
            const distanceFromBottom =
                container.scrollHeight -
                container.scrollTop -
                container.clientHeight;

            if (distanceFromBottom > 24) {
                return;
            }

            let lastIncomingId = 0;
            let lastKnownReadId = 0;

            for (
                const message of
            latestMessagesRef.current || []
                ) {
                const messageId =
                    Number(message.id);

                if (
                    !Number.isSafeInteger(messageId) ||
                    messageId <= 0
                ) {
                    continue;
                }

                if (
                    String(message.receiverId) !==
                    String(userId) ||
                    String(message.senderId) ===
                    String(userId)
                ) {
                    continue;
                }

                lastIncomingId = Math.max(
                    lastIncomingId,
                    messageId
                );

                if (message.readAt) {
                    lastKnownReadId = Math.max(
                        lastKnownReadId,
                        messageId
                    );
                }
            }

            confirmedIdRef.current = Math.max(
                confirmedIdRef.current,
                lastKnownReadId
            );

            if (
                lastIncomingId <=
                confirmedIdRef.current
            ) {
                return;
            }

            /*
             * Если запрос уже выполняется,
             * запоминаем необходимость повтора.
             */
            if (inFlightRef.current) {
                retryRequestedRef.current = true;
                return;
            }

            inFlightRef.current = true;

            try {
                const { data } =
                    await axiosInstance.post(
                        `/messages/read/${orderType}/${orderId}`,
                        {
                            throughId:
                            lastIncomingId,
                        }
                    );

                if (!mountedRef.current) {
                    return;
                }

                confirmedIdRef.current = Math.max(
                    confirmedIdRef.current,
                    Number(
                        data?.lastReadMessageId
                    ) || 0
                );
            } catch (error) {
                /*
                 * При потере связи не утверждаем,
                 * что сервер подтвердил прочтение.
                 *
                 * Повторим при восстановлении
                 * интернета или возвращении в чат.
                 */
                console.warn(
                    "Не удалось подтвердить прочтение:",
                    error
                );
            } finally {
                inFlightRef.current = false;

                if (
                    retryRequestedRef.current &&
                    mountedRef.current
                ) {
                    retryRequestedRef.current = false;

                    requestAnimationFrame(
                        markVisibleMessagesRead
                    );
                }
            }
        }, [
            userId,
            orderId,
            orderType,
            containerRef,
        ]);

    /*
     * При появлении сообщений проверяем
     * положение списка после отрисовки.
     */
    useEffect(() => {
        const frame = requestAnimationFrame(
            markVisibleMessagesRead
        );

        return () => {
            cancelAnimationFrame(frame);
        };
    }, [
        messages,
        markVisibleMessagesRead,
    ]);

    /*
     * Повторяем проверку при прокрутке,
     * возвращении приложения на экран
     * и восстановлении связи.
     */
    useEffect(() => {
        mountedRef.current = true;

        const container =
            containerRef.current;

        const handleActivity = () => {
            markVisibleMessagesRead();
        };

        const handleVisibility = () => {
            if (!document.hidden) {
                requestAnimationFrame(
                    markVisibleMessagesRead
                );
            }
        };

        container?.addEventListener(
            "scroll",
            handleActivity,
            {
                passive: true,
            }
        );

        window.addEventListener(
            "online",
            handleActivity
        );

        window.addEventListener(
            "focus",
            handleActivity
        );

        document.addEventListener(
            "visibilitychange",
            handleVisibility
        );

        const frame = requestAnimationFrame(
            markVisibleMessagesRead
        );

        return () => {
            mountedRef.current = false;

            cancelAnimationFrame(frame);

            container?.removeEventListener(
                "scroll",
                handleActivity
            );

            window.removeEventListener(
                "online",
                handleActivity
            );

            window.removeEventListener(
                "focus",
                handleActivity
            );

            document.removeEventListener(
                "visibilitychange",
                handleVisibility
            );
        };
    }, [
        containerRef,
        markVisibleMessagesRead,
    ]);

    return null;
}