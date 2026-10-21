import {
    useCallback,
    useEffect,
    useState,
} from "react";

import axiosInstance from "../utils/axiosInstance";

const BATCH_SIZE = 100;

export default function useVerifiedAssignments(orders) {
    const [revision, setRevision] = useState(0);

    const [result, setResult] = useState({
        key: "",
        byOrderId: {},
        actsByOrderId: {},
        loading: false,
        error: "",
    });

    const idsKey = [
        ...new Set(
            (Array.isArray(orders) ? orders : [])
                .map((order) => Number(order?.id))
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
        setRevision((prev) => prev + 1);
    }, []);

    useEffect(() => {
        let cancelled = false;

        if (!idsKey) {
            setResult({
                key: "",
                byOrderId: {},
                actsByOrderId: {},
                loading: false,
                error: "",
            });

            return;
        }

        const ids = idsKey.split(",").map(Number);

        async function load() {
            setResult({
                key: idsKey,
                byOrderId: {},
                actsByOrderId: {},
                loading: true,
                error: "",
            });

            try {
                const byOrderId = {};
                const actsByOrderId = {};

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
                            {orderIds: batch}
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

                    /*
                     * Совместимость со старым backend:
                     * до выкладки новой версии
                     * поле acts может отсутствовать.
                     */
                    const acts =
                        Array.isArray(response.data.acts)
                            ? response.data.acts
                            : [];

                    for (const act of acts) {
                        actsByOrderId[
                            String(act.orderId)
                            ] = act;
                    }
                }

                if (cancelled) return;

                setResult({
                    key: idsKey,
                    byOrderId,
                    actsByOrderId,
                    loading: false,
                    error: "",
                });

            } catch (error) {
                if (cancelled) return;

                console.error(
                    "Ошибка загрузки документов:",
                    error
                );

                setResult({
                    key: idsKey,
                    byOrderId: {},
                    actsByOrderId: {},
                    loading: false,

                    error:
                        error.response?.data?.message ||
                        "Не удалось загрузить документы",
                });
            }
        }

        load();

        return () => {
            cancelled = true;
        };

    }, [idsKey, revision]);

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

        actsByOrderId:
            result.key === idsKey
                ? result.actsByOrderId
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
