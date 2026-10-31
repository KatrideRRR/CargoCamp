import {
    useCallback,
    useEffect,
    useState,
} from "react";

const PREFIX = "cc:chat:reply:v1:";

function readSavedReply(key) {
    try {
        const raw = localStorage.getItem(key);

        if (!raw) return null;

        const value = JSON.parse(raw);

        if (
            !Number.isSafeInteger(Number(value.id)) ||
            Number(value.id) <= 0
        ) {
            return null;
        }

        return value;
    } catch {
        return null;
    }
}

export default function useChatReply({
                                         userId,
                                         orderId,
                                         orderType,
                                     }) {
    const key = [
        PREFIX,
        userId,
        orderType,
        orderId,
    ].join(":");

    const [state, setState] = useState(() => ({
        key,
        reply: readSavedReply(key),
    }));

    /*
     * Не переносим выбранную цитату
     * при переключении на другой заказ.
     */
    useEffect(() => {
        setState({
            key,
            reply: readSavedReply(key),
        });
    }, [key]);

    const replyTo =
        state.key === key
            ? state.reply
            : null;

    const selectReply = useCallback(
        (message) => {
            if (!message?.id) return;

            const selected = {
                id: Number(message.id),
                senderId: message.senderId,
                content: String(
                    message.content || ""
                ).slice(0, 140),
            };

            try {
                localStorage.setItem(
                    key,
                    JSON.stringify(selected)
                );
            } catch (error) {
                console.warn(
                    "Не удалось сохранить выбранный ответ:",
                    error
                );
            }

            setState({
                key,
                reply: selected,
            });
        },
        [key]
    );

    /*
     * expectedId позволяет не очистить новую
     * цитату, если предыдущая отправка
     * завершилась с задержкой.
     */
    const clearReply = useCallback(
        (expectedId) => {
            setState((previous) => {
                if (previous.key !== key) {
                    return previous;
                }

                if (
                    expectedId != null &&
                    String(previous.reply?.id) !==
                    String(expectedId)
                ) {
                    return previous;
                }

                try {
                    localStorage.removeItem(key);
                } catch {
                    // Состояние React всё равно очистим.
                }

                return {
                    key,
                    reply: null,
                };
            });
        },
        [key]
    );

    return {
        replyTo,
        selectReply,
        clearReply,
    };
}