import { Capacitor } from "@capacitor/core";
import { AppLauncher } from "@capacitor/app-launcher";

function parseCoordinate(value, type) {
    if (
        value === null ||
        value === undefined ||
        String(value).trim() === ""
    ) {
        return null;
    }

    const number = Number(value);

    if (!Number.isFinite(number)) {
        return null;
    }

    if (type === "lat" && (number < -90 || number > 90)) {
        return null;
    }

    if (type === "lng" && (number < -180 || number > 180)) {
        return null;
    }

    return number;
}

function createCoordinatePoint(latValue, lngValue) {
    const latitude = parseCoordinate(latValue, "lat");
    const longitude = parseCoordinate(lngValue, "lng");

    if (latitude === null || longitude === null) {
        return null;
    }

    if (
        Math.abs(latitude) < 0.000001 &&
        Math.abs(longitude) < 0.000001
    ) {
        return null;
    }

    return {
        latitude,
        longitude,
    };
}

export function parseCoordinatesValue(value) {
    if (!value) {
        return null;
    }

    if (Array.isArray(value) && value.length >= 2) {
        return createCoordinatePoint(value[0], value[1]);
    }

    if (typeof value === "object") {
        return createCoordinatePoint(
            value.latitude ?? value.lat,
            value.longitude ?? value.lng ?? value.lon
        );
    }

    const normalized = String(value)
        .trim()
        .replace(/^Координаты:\s*/i, "")
        .replace(/\s+/g, "");

    const parts = normalized.split(",");

    if (parts.length !== 2) {
        return null;
    }

    return createCoordinatePoint(parts[0], parts[1]);
}

export function isExpressOrder(order, explicitOrderType = null) {
    if (explicitOrderType === "express") {
        return true;
    }

    if (explicitOrderType === "regular") {
        return false;
    }

    return Boolean(
        order?.express === true ||
        order?.kind === "express" ||
        order?.orderType === "express" ||
        order?.type === "taxi" ||
        order?.type === "courier" ||
        order?.fromLat !== undefined ||
        order?.toLat !== undefined
    );
}

export function getExpressNavigationTarget(order) {
    const status = String(order?.status || "");

    if (
        [
            "created",
            "accepted",
            "on_the_way_to_A",
            "arrived_at_A",
            "waiting_at_A",
        ].includes(status)
    ) {
        return "A";
    }

    if (
        [
            "picked_up",
            "in_progress",
            "completed",
        ].includes(status)
    ) {
        return "B";
    }

    return "A";
}

export function getOrderCoordinates(
    order,
    {
        orderType = null,
        target = "auto",
    } = {}
) {
    if (!order) {
        return null;
    }

    const express = isExpressOrder(order, orderType);

    if (!express) {
        return (
            parseCoordinatesValue(order.coordinates) ||
            parseCoordinatesValue(order.destinationCoordinates) ||
            parseCoordinatesValue(order.locationCoordinates)
        );
    }

    const resolvedTarget =
        target === "auto"
            ? getExpressNavigationTarget(order)
            : target;

    if (resolvedTarget === "A") {
        return (
            createCoordinatePoint(
                order.fromLat ?? order.from_lat,
                order.fromLng ?? order.from_lng
            ) ||
            parseCoordinatesValue(
                order.fromCoordinates ??
                order.from_coordinates ??
                order.pickupCoordinates
            )
        );
    }

    return (
        createCoordinatePoint(
            order.toLat ?? order.to_lat,
            order.toLng ?? order.to_lng
        ) ||
        parseCoordinatesValue(
            order.toCoordinates ??
            order.to_coordinates ??
            order.destinationCoordinates
        )
    );
}

export function getOrderCoordinatesForMap(order) {
    if (!order) {
        return null;
    }

    /*
     * Если объект уже нормализован для общей карты
     * и содержит coordinates, используем его первым.
     */
    const normalizedCoordinates =
        parseCoordinatesValue(order.coordinates);

    if (normalizedCoordinates) {
        return [
            normalizedCoordinates.latitude,
            normalizedCoordinates.longitude,
        ];
    }

    /*
     * Экспресс-заказ на общей карте показываем в точке А.
     */
    const expressCoordinates = getOrderCoordinates(order, {
        orderType: "express",
        target: "A",
    });

    if (!expressCoordinates) {
        return null;
    }

    return [
        expressCoordinates.latitude,
        expressCoordinates.longitude,
    ];
}

function buildNavigationUrls(latitude, longitude) {
    const lat = encodeURIComponent(latitude);
    const lng = encodeURIComponent(longitude);

    return {
        native:
            `yandexnavi://build_route_on_map` +
            `?lat_to=${lat}` +
            `&lon_to=${lng}`,

        web:
            `https://yandex.ru/navi/` +
            `?rtext=~${lat},${lng}` +
            `&rtt=auto`,
    };
}

function openWebUrl(url) {
    const opened = window.open(
        url,
        "_blank",
        "noopener,noreferrer"
    );

    /*
     * В некоторых WebView window.open заблокирован.
     */
    if (!opened) {
        window.location.href = url;
    }
}

export async function openOrderRoute(
    order,
    {
        orderType = null,
        target = "auto",
        confirmText = "Открыть маршрут в Яндекс.Навигаторе?",
    } = {}
) {
    const destination = getOrderCoordinates(order, {
        orderType,
        target,
    });

    if (!destination) {
        console.error("Не найдены координаты маршрута:", {
            orderId: order?.id,
            orderType,
            target,
            coordinates: order?.coordinates,
            fromLat: order?.fromLat,
            fromLng: order?.fromLng,
            toLat: order?.toLat,
            toLng: order?.toLng,
        });

        alert("Координаты заказа не найдены");
        return false;
    }

    if (confirmText) {
        const confirmed = window.confirm(confirmText);

        if (!confirmed) {
            return false;
        }
    }

    const { latitude, longitude } = destination;

    const urls = buildNavigationUrls(
        latitude,
        longitude
    );

    if (!Capacitor.isNativePlatform()) {
        openWebUrl(urls.web);
        return true;
    }

    try {
        const result = await AppLauncher.openUrl({
            url: urls.native,
        });

        if (result?.completed === false) {
            throw new Error(
                "Яндекс.Навигатор не открыл ссылку"
            );
        }

        return true;
    } catch (error) {
        console.error(
            "Не удалось открыть приложение Яндекс.Навигатора:",
            error
        );

        try {
            await AppLauncher.openUrl({
                url: urls.web,
            });

            return true;
        } catch (fallbackError) {
            console.error(
                "Не удалось открыть веб-маршрут:",
                fallbackError
            );

            window.location.href = urls.web;
            return true;
        }
    }
}