"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    calculateDistanceMeters,
    checkExpressReservationEligibility,
} = require(
    "../utils/expressReservationPolicy"
);

function makeInput(overrides = {}) {
    return {
        sourceOrder: {
            id: 101,
            executorId: 7,
            status: "in_progress",
            toLat: 44.9521,
            toLng: 34.1024,
        },

        executorId: 7,

        latitude: 44.9521,
        longitude: 34.1024,

        hasRegularOrder: false,
        hasReservation: false,

        debtKopecks: 0,

        ...overrides,
    };
}

test("расстояние между одинаковыми точками равно нулю", () => {
    assert.equal(
        calculateDistanceMeters(
            44.9521,
            34.1024,
            44.9521,
            34.1024
        ),
        0
    );
});

test("корректно рассчитывает расстояние", () => {
    const distance =
        calculateDistanceMeters(
            0, 0,
            0, 0.01
        );

    assert.ok(
        distance > 1110 &&
        distance < 1115
    );
});

test("принимает числовые координаты из DECIMAL", () => {
    assert.equal(
        calculateDistanceMeters(
            "44.9521",
            "34.1024",
            44.9521,
            34.1024
        ),
        0
    );
});

test("отклоняет отсутствующие координаты", () => {
    assert.throws(
        () =>
            calculateDistanceMeters(
                null,
                34.1024,
                44.9521,
                34.1024
            ),
        /Некорректные координаты/
    );
});

test("разрешает запрос следующего заказа около точки Б", () => {
    const result =
        checkExpressReservationEligibility(
            makeInput()
        );

    assert.equal(result.allowed, true);
    assert.equal(result.distanceMeters, 0);
});

test("запрещает запрос далеко от точки Б", () => {
    const result =
        checkExpressReservationEligibility(
            makeInput({
                latitude: 45.1,
            })
        );

    assert.equal(result.allowed, false);

    assert.equal(
        result.reason,
        "TOO_FAR_FROM_DESTINATION"
    );
});

test("нельзя бронировать до начала поездки", () => {
    for (const status of [
        "created",
        "accepted",
        "reserved",
        "on_the_way_to_A",
        "arrived_at_A",
        "waiting_at_A",
        "picked_up",
        "completed",
        "cancelled",
    ]) {
        const input = makeInput();

        input.sourceOrder.status = status;

        const result =
            checkExpressReservationEligibility(
                input
            );

        assert.equal(
            result.allowed,
            false,
            status
        );
    }
});

test("нельзя использовать текущий заказ другого исполнителя", () => {
    const result =
        checkExpressReservationEligibility(
            makeInput({
                executorId: 99,
            })
        );

    assert.equal(result.allowed, false);

    assert.equal(
        result.reason,
        "SOURCE_ORDER_NOT_FOUND"
    );
});

test("обычный активный заказ блокирует бронирование", () => {
    const result =
        checkExpressReservationEligibility(
            makeInput({
                hasRegularOrder: true,
            })
        );

    assert.equal(result.allowed, false);

    assert.equal(
        result.reason,
        "REGULAR_ORDER_EXISTS"
    );
});

test("нельзя забронировать третий заказ", () => {
    const result =
        checkExpressReservationEligibility(
            makeInput({
                hasReservation: true,
            })
        );

    assert.equal(result.allowed, false);

    assert.equal(
        result.reason,
        "RESERVATION_EXISTS"
    );
});

test("задолженность блокирует новый запрос", () => {
    const result =
        checkExpressReservationEligibility(
            makeInput({
                debtKopecks: 20000,
            })
        );

    assert.equal(result.allowed, false);

    assert.equal(
        result.reason,
        "DEBT_EXISTS"
    );
});

test("при неизвестном состоянии занятости запрос запрещён", () => {
    const result =
        checkExpressReservationEligibility(
            makeInput({
                hasReservation: undefined,
            })
        );

    assert.equal(result.allowed, false);
});

test("некорректные координаты не разрешают бронирование", () => {
    const result =
        checkExpressReservationEligibility(
            makeInput({
                latitude: "",
            })
        );

    assert.equal(result.allowed, false);

    assert.equal(
        result.reason,
        "INVALID_COORDINATES"
    );
});