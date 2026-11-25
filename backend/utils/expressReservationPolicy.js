"use strict";

const MAX_DISTANCE_TO_DESTINATION_METERS = 1000;

const REQUEST_TTL_SECONDS = 120;

const EARTH_RADIUS_METERS = 6371000;

function normalizeCoordinate(value, min, max) {
    if (
        value == null ||
        value === "" ||
        !["number", "string"].includes(typeof value)
    ) {
        throw new Error(
            "Некорректные координаты"
        );
    }

    const result = Number(value);

    if (
        !Number.isFinite(result) ||
        result < min ||
        result > max
    ) {
        throw new Error(
            "Некорректные координаты"
        );
    }

    return result;
}

function toRadians(value) {
    return value * Math.PI / 180;
}

function calculateDistanceMeters(
    fromLat,
    fromLng,
    toLat,
    toLng
) {
    const lat1 = normalizeCoordinate(
        fromLat, -90, 90
    );

    const lng1 = normalizeCoordinate(
        fromLng, -180, 180
    );

    const lat2 = normalizeCoordinate(
        toLat, -90, 90
    );

    const lng2 = normalizeCoordinate(
        toLng, -180, 180
    );

    const deltaLat =
        toRadians(lat2 - lat1);

    const deltaLng =
        toRadians(lng2 - lng1);

    const a =
        Math.sin(deltaLat / 2) ** 2 +
        Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(deltaLng / 2) ** 2;

    const safeA = Math.max(
        0,
        Math.min(1, a)
    );

    return Math.round(
        EARTH_RADIUS_METERS *
        2 *
        Math.atan2(
            Math.sqrt(safeA),
            Math.sqrt(1 - safeA)
        )
    );
}

function checkExpressReservationEligibility({
                                                sourceOrder,
                                                executorId,
                                                latitude,
                                                longitude,
                                                hasRegularOrder,
                                                hasReservation,
                                                debtKopecks,
                                            }) {
    if (
        !sourceOrder ||
        Number(sourceOrder.executorId) !==
        Number(executorId)
    ) {
        return {
            allowed: false,
            reason: "SOURCE_ORDER_NOT_FOUND",
        };
    }

    if (
        sourceOrder.status !== "in_progress"
    ) {
        return {
            allowed: false,
            reason: "SOURCE_ORDER_NOT_IN_PROGRESS",
        };
    }

    if (hasRegularOrder !== false) {
        return {
            allowed: false,
            reason: "REGULAR_ORDER_EXISTS",
        };
    }

    if (hasReservation !== false) {
        return {
            allowed: false,
            reason: "RESERVATION_EXISTS",
        };
    }

    if (
        !Number.isSafeInteger(debtKopecks) ||
        debtKopecks !== 0
    ) {
        return {
            allowed: false,
            reason: "DEBT_EXISTS",
        };
    }

    let distanceMeters;

    try {
        distanceMeters =
            calculateDistanceMeters(
                latitude,
                longitude,
                sourceOrder.toLat,
                sourceOrder.toLng
            );
    } catch {
        return {
            allowed: false,
            reason: "INVALID_COORDINATES",
        };
    }

    if (
        distanceMeters >
        MAX_DISTANCE_TO_DESTINATION_METERS
    ) {
        return {
            allowed: false,
            reason: "TOO_FAR_FROM_DESTINATION",
            distanceMeters,
        };
    }

    return {
        allowed: true,
        distanceMeters,
    };
}

module.exports = {
    MAX_DISTANCE_TO_DESTINATION_METERS,
    REQUEST_TTL_SECONDS,
    calculateDistanceMeters,
    checkExpressReservationEligibility,
};