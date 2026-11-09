import axiosInstance from "./axiosInstance";

const ACTIVE_REGULAR_STATUSES = new Set([
    "active",
    "in_progress",
    "pending_payment",
]);

const ACTIVE_EXPRESS_STATUSES = new Set([
    "accepted",
    "on_the_way_to_A",
    "arrived_at_A",
    "waiting_at_A",
    "picked_up",
    "in_progress",
]);

export async function fetchExecutorBusyState(userId) {
    const id = Number(userId);

    if (!Number.isSafeInteger(id) || id <= 0) {
        throw new Error("Не удалось определить исполнителя");
    }

    /*
     * Оба запроса обязательны.
     *
     * Если один не выполнен, нельзя считать
     * исполнителя свободным.
     */
    const [regularResponse, expressResponse] =
        await Promise.all([
            axiosInstance.get("/orders/active-orders"),

            axiosInstance.get(
                "/express/express-orders/me?mode=active"
            ),
        ]);

    const regularOrders =
        regularResponse.data?.orders;

    const expressOrders =
        expressResponse.data?.orders;

    if (
        !Array.isArray(regularOrders) ||
        !Array.isArray(expressOrders)
    ) {
        throw new Error(
            "Некорректный ответ проверки занятости"
        );
    }

    const hasBusyRegular = regularOrders.some(
        (order) =>
            Number(order.executorId) === id &&
            ACTIVE_REGULAR_STATUSES.has(
                String(order.status)
            )
    );

    const hasBusyTaxi = expressOrders.some(
        (order) =>
            Number(order.executorId) === id &&
            ACTIVE_EXPRESS_STATUSES.has(
                String(order.status)
            )
    );

    return {
        hasBusyRegular,
        hasBusyTaxi,
        hasAnyBusy:
            hasBusyRegular || hasBusyTaxi,
    };
}