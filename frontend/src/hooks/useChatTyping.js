import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";

import { socket } from "../socketClient";

const SEND_INTERVAL_MS = 2000;
const IDLE_TIMEOUT_MS = 3000;
const RECEIVE_TIMEOUT_MS = 6000;

/**
 * Индикатор набора текста в чате заказа.
 *
 * Ничего не сохраняет в MySQL или
 * локальном хранилище.
 */
export default function useChatTyping({
                                          userId,
                                          otherUserId,
                                          orderId,
                                          orderType = "regular",
                                      }) {
    const [isOtherTyping, setIsOtherTyping] =
        useState(false);

    const idleTimerRef = useRef(null);
    const receiveTimerRef = useRef(null);

    const lastStartRef = useRef(0);

    /*
     * Останавливаем собственный индикатор.
     */
    const stopTyping = useCallback(() => {
        clearTimeout(idleTimerRef.current);

        idleTimerRef.current = null;
        lastStartRef.current = 0;

        if (
            !socket.connected ||
            !userId ||
            !orderId
        ) {
            return;
        }

        socket.emit("chat:typing", {
            orderId,
            orderType,
            isTyping: false,
        });
    }, [
        userId,
        orderId,
        orderType,
    ]);

    /*
     * Вызывается при изменении текста.
     *
     * Отправляем событие не на каждую букву,
     * а максимум раз в две секунды.
     */
    const notifyTyping = useCallback(
        (value) => {
            clearTimeout(
                idleTimerRef.current
            );

            if (
                !String(value || "").trim()
            ) {
                stopTyping();
                return;
            }

            if (
                !socket.connected ||
                !userId ||
                !otherUserId ||
                !orderId
            ) {
                return;
            }

            const now = Date.now();

            if (
                now - lastStartRef.current >=
                SEND_INTERVAL_MS
            ) {
                lastStartRef.current = now;

                socket.emit("chat:typing", {
                    orderId,
                    orderType,
                    isTyping: true,
                });
            }

            /*
             * Если три секунды пользователь
             * ничего не вводил — прекращаем
             * показывать индикатор.
             */
            idleTimerRef.current =
                setTimeout(
                    stopTyping,
                    IDLE_TIMEOUT_MS
                );
        },
        [
            userId,
            otherUserId,
            orderId,
            orderType,
            stopTyping,
        ]
    );

    /*
     * Принимаем события только от собеседника
     * по текущему заказу.
     */
    useEffect(() => {
        const clearOtherTyping = () => {
            clearTimeout(
                receiveTimerRef.current
            );

            receiveTimerRef.current = null;

            setIsOtherTyping(false);
        };

        const handleTyping = (payload) => {
            if (
                !payload ||
                String(payload.orderId) !==
                String(orderId) ||
                String(payload.orderType) !==
                String(orderType) ||
                String(payload.senderId) !==
                String(otherUserId) ||
                !otherUserId
            ) {
                return;
            }

            clearTimeout(
                receiveTimerRef.current
            );

            if (payload.isTyping === false) {
                clearOtherTyping();
                return;
            }

            if (payload.isTyping !== true) {
                return;
            }

            if (document.hidden) {
                return;
            }

            setIsOtherTyping(true);

            /*
             * Даже если событие остановки
             * потерялось, надпись исчезнет.
             */
            receiveTimerRef.current =
                setTimeout(
                    clearOtherTyping,
                    RECEIVE_TIMEOUT_MS
                );
        };

        const handleVisibility = () => {
            if (document.hidden) {
                clearOtherTyping();
                stopTyping();
            }
        };

        const handleBlur = () => {
            stopTyping();
        };

        socket.on(
            "chat:typing",
            handleTyping
        );

        socket.on(
            "disconnect",
            clearOtherTyping
        );

        document.addEventListener(
            "visibilitychange",
            handleVisibility
        );

        window.addEventListener(
            "blur",
            handleBlur
        );

        return () => {
            stopTyping();
            clearOtherTyping();

            socket.off(
                "chat:typing",
                handleTyping
            );

            socket.off(
                "disconnect",
                clearOtherTyping
            );

            document.removeEventListener(
                "visibilitychange",
                handleVisibility
            );

            window.removeEventListener(
                "blur",
                handleBlur
            );
        };
    }, [
        userId,
        otherUserId,
        orderId,
        orderType,
        stopTyping,
    ]);

    return {
        isOtherTyping,
        notifyTyping,
        stopTyping,
    };
}