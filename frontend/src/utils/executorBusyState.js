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

    if (
        !Number.isSafeInteger(id) ||
        id <= 0
    ) {
        throw new Error(
            "Не удалось определить исполнителя"
        );
    }

    const [
        regularResponse,
        expressResponse,
    ] = await Promise.all([
        axiosInstance.get(
            "/orders/active-orders"
        ),

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

    const ownRegularOrders =
        regularOrders.filter(
            (order) =>
                Number(order.executorId) === id
        );

    const ownExpressOrders =
        expressOrders.filter(
            (order) =>
                Number(order.executorId) === id
        );

    const activeRegularOrders =
        ownRegularOrders.filter(
            (order) =>
                ACTIVE_REGULAR_STATUSES.has(
                    String(order.status)
                )
        );

    const activeExpressOrders =
        ownExpressOrders.filter(
            (order) =>
                ACTIVE_EXPRESS_STATUSES.has(
                    String(order.status)
                )
        );

    const hasRegularReservation =
        ownRegularOrders.some(
            (order) =>
                order.status === "reserved"
        );

    const hasExpressReservation =
        ownExpressOrders.some(
            (order) =>
                order.status === "reserved"
        );

    const hasBusyRegular =
        activeRegularOrders.length > 0;

    const hasBusyTaxi =
        activeExpressOrders.length > 0;

    const hasReservation =
        hasRegularReservation ||
        hasExpressReservation;

    const currentExpressOrder =
        activeExpressOrders.length === 1
            ? activeExpressOrders[0]
            : null;

    const canRequestNextExpress =
        !hasBusyRegular &&
        !hasReservation &&
        currentExpressOrder?.status ===
        "in_progress";

    return {
        hasBusyRegular,
        hasBusyTaxi,

        hasRegularReservation,
        hasExpressReservation,
        hasReservation,

        currentExpressOrder,

        canRequestNextExpress,

        hasAnyBusy:
            hasBusyRegular ||
            hasBusyTaxi ||
            hasReservation,
    };
}