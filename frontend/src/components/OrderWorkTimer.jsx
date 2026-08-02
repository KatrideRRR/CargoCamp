import React, {
    useEffect,
    useMemo,
    useState,
} from "react";

function getDurationMs(
    startedAt,
    endedAt
) {
    if (!startedAt) {
        return 0;
    }

    const startTime =
        new Date(startedAt).getTime();

    const endTime = endedAt
        ? new Date(endedAt).getTime()
        : Date.now();

    if (
        !Number.isFinite(startTime) ||
        !Number.isFinite(endTime)
    ) {
        return 0;
    }

    return Math.max(
        0,
        endTime - startTime
    );
}

function formatTimer(durationMs) {
    const totalSeconds = Math.floor(
        durationMs / 1000
    );

    const hours = Math.floor(
        totalSeconds / 3600
    );

    const minutes = Math.floor(
        (totalSeconds % 3600) / 60
    );

    const seconds =
        totalSeconds % 60;

    return [
        String(hours).padStart(2, "0"),
        String(minutes).padStart(2, "0"),
        String(seconds).padStart(2, "0"),
    ].join(":");
}

function OrderWorkTimer({
                            startedAt,
                            endedAt,
                        }) {
    const isRunning =
        Boolean(startedAt) &&
        !endedAt;

    const initialDuration = useMemo(
        () =>
            getDurationMs(
                startedAt,
                endedAt
            ),
        [startedAt, endedAt]
    );

    const [durationMs, setDurationMs] =
        useState(initialDuration);

    useEffect(() => {
        setDurationMs(
            getDurationMs(
                startedAt,
                endedAt
            )
        );

        if (!isRunning) {
            return undefined;
        }

        const intervalId =
            window.setInterval(() => {
                setDurationMs(
                    getDurationMs(
                        startedAt,
                        null
                    )
                );
            }, 1000);

        return () => {
            window.clearInterval(
                intervalId
            );
        };
    }, [
        startedAt,
        endedAt,
        isRunning,
    ]);

    if (!startedAt) {
        return null;
    }

    return (
        <div
            className={`order-work-timer ${
                isRunning
                    ? "order-work-timer--running"
                    : "order-work-timer--stopped"
            }`}
        >
            <div className="order-work-timer__icon">
                {isRunning ? "⏱" : "✓"}
            </div>

            <div className="order-work-timer__content">
                <div className="order-work-timer__label">
                    {isRunning
                        ? "Работа идёт"
                        : "Работа остановлена"}
                </div>

                <div className="order-work-timer__value">
                    {formatTimer(durationMs)}
                </div>

                <div className="order-work-timer__started">
                    Начало:{" "}
                    {new Date(
                        startedAt
                    ).toLocaleString(
                        "ru-RU"
                    )}
                </div>
            </div>
        </div>
    );
}

export default OrderWorkTimer;