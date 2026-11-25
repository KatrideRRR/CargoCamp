import axiosInstance from "./axiosInstance";

function endpoint(orderId) {
    return (
        `/express/express-orders/${orderId}` +
        "/reservation"
    );
}

export async function requestNextExpressOrder({
                                                  orderId,
                                                  sourceOrderId,
                                                  latitude,
                                                  longitude,
                                              }) {
    const { data } =
        await axiosInstance.post(
            `${endpoint(orderId)}/request`,
            {
                sourceOrderId,
                latitude,
                longitude,
            }
        );

    return data;
}

export async function getExpressReservationRequests(
    orderId
) {
    const { data } =
        await axiosInstance.get(
            `${endpoint(orderId)}/requests`
        );

    if (
        !Array.isArray(data?.requests)
    ) {
        throw new Error(
            "Некорректный ответ сервера"
        );
    }

    return data.requests;
}

export async function approveNextExpressOrder(
    orderId,
    requestId
) {
    const { data } =
        await axiosInstance.post(
            `${endpoint(orderId)}/approve`,
            {
                requestId,
            }
        );

    return data;
}

export async function rejectNextExpressOrder(
    orderId,
    requestId
) {
    const { data } =
        await axiosInstance.post(
            `${endpoint(orderId)}/reject`,
            {
                requestId,
            }
        );

    return data;
}

export async function cancelNextExpressOrder(
    orderId
) {
    const { data } =
        await axiosInstance.post(
            `${endpoint(orderId)}/cancel`
        );

    return data;
}

export async function getMyExpressReservation() {
    const { data } =
        await axiosInstance.get(
            "/express/express-orders/reservation/me"
        );

    if (
        data?.success !== true
    ) {
        throw new Error(
            "Не удалось проверить следующее бронирование"
        );
    }

    return data.request || null;
}

export function getCurrentReservationLocation() {
    return new Promise(
        (resolve, reject) => {
            if (!navigator.geolocation) {
                reject(
                    new Error(
                        "Геолокация недоступна"
                    )
                );

                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const {
                        latitude,
                        longitude,
                        accuracy,
                    } = position.coords;

                    if (
                        !Number.isFinite(latitude) ||
                        !Number.isFinite(longitude) ||
                        !Number.isFinite(accuracy)
                    ) {
                        reject(
                            new Error(
                                "Не удалось определить местоположение"
                            )
                        );

                        return;
                    }

                    if (accuracy > 200) {
                        reject(
                            new Error(
                                "Недостаточная точность геолокации. Повторите попытку."
                            )
                        );

                        return;
                    }

                    resolve({
                        latitude,
                        longitude,
                    });
                },

                () => {
                    reject(
                        new Error(
                            "Разрешите доступ к геолокации и повторите попытку"
                        )
                    );
                },

                {
                    enableHighAccuracy: true,
                    timeout: 15000,
                    maximumAge: 0,
                }
            );
        }
    );
}