
import {
    useCallback,
    useEffect,
    useState,
} from "react";

import axiosInstance from "../utils/axiosInstance";

const BATCH_SIZE = 100;

export default function useVerifiedAssignments(
    orders
) {
    const [revision, setRevision] =
        useState(0);

    const [result, setResult] = useState({
        key: "",
        byOrderId: {},
        loading: false,
        error: "",
    });

    /*
     * Стабильный ключ.
     *
     * Даже если React создаёт новый массив
     * заказов при каждом рендере,
     * запрос не повторяется без изменения ID.
     */
    const idsKey = [
        ...new Set(
            (Array.isArray(orders) ? orders : [])
                .map((order) =>
                    Number(order?.id)
                )
                .filter(
                    (id) =>
                        Number.isSafeInteger(id) &&
                        id > 0
                )
        ),
    ]
        .sort((a, b) => a - b)
        .join(",");

    const refresh = useCallback(() => {
        setRevision((current) => current + 1);
    }, []);

    useEffect(() => {
        let cancelled = false;

        if (!idsKey) {
            setResult({
                key: "",
                byOrderId: {},
                loading: false,
                error: "",
            });

            return;
        }

        const ids = idsKey
            .split(",")
            .map(Number);

        async function load() {
            setResult({
                key: idsKey,
                byOrderId: {},
                loading: true,
                error: "",
            });

            try {
                const byOrderId = {};

                /*
                 * Загружаем по 100 заказов.
                 *
                 * Последовательные запросы
                 * не создают лишнюю нагрузку
                 * при большой истории.
                 */
                for (
                    let offset = 0;
                    offset < ids.length;
                    offset += BATCH_SIZE
                ) {
                    const batch = ids.slice(
                        offset,
                        offset + BATCH_SIZE
                    );

                    const response =
                        await axiosInstance.post(
                            "/contracts/assignments/summary",
                            {
                                orderIds: batch,
                            }
                        );

                    if (
                        !response.data?.success ||
                        !Array.isArray(
                            response.data.assignments
                        )
                    ) {
                        throw new Error(
                            "Некорректный ответ сервера"
                        );
                    }

                    for (
                        const contract of
                        response.data.assignments
                        ) {
                        byOrderId[
                            String(contract.orderId)
                            ] = contract;
                    }
                }

                if (cancelled) return;

                setResult({
                    key: idsKey,
                    byOrderId,
                    loading: false,
                    error: "",
                });

            } catch (error) {
                if (cancelled) return;

                console.error(
                    "Verified assignments loading error:",
                    error
                );

                setResult({
                    key: idsKey,
                    byOrderId: {},
                    loading: false,
                    error:
                        error.response?.data?.message ||
                        "Не удалось проверить подтверждённые договоры",
                });
            }
        }

        load();

        return () => {
            cancelled = true;
        };

    }, [idsKey, revision]);

    /*
     * Поддерживаем уже существующее
     * обновление свайпом в приложении.
     */
    useEffect(() => {
        window.addEventListener(
            "appPullToRefresh",
            refresh
        );

        return () => {
            window.removeEventListener(
                "appPullToRefresh",
                refresh
            );
        };
    }, [refresh]);

    return {
        byOrderId:
            result.key === idsKey
                ? result.byOrderId
                : {},

        loading:
            result.key !== idsKey ||
            result.loading,

        error:
            result.key === idsKey
                ? result.error
                : "",

        refresh,
    };
}
