import React, { useMemo } from "react";
import "../styles/OrderServiceDetails.css";
import {
    getOrderServiceDetails,
} from "../utils/orderServiceDetails";

function formatMoney(value) {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "—";
    }

    return (
        number.toLocaleString("ru-RU", {
            maximumFractionDigits: 0,
        }) + " ₽"
    );
}

function OrderServiceDetails({
                                 order,
                                 compact = false,
                             }) {
    const parsed = useMemo(
        () => getOrderServiceDetails(order),
        [order]
    );

    const {
        rows,
        pricingBreakdown,
        recommendedPrice,
        recommendedPriceMin,
        recommendedPriceMax,
        hasRecommendedRange,
    } = parsed;

    const visibleRows = compact
        ? rows.slice(0, 4)
        : rows;

    const hiddenRowsCount =
        Math.max(
            0,
            rows.length -
            visibleRows.length
        );

    const hasAnything =
        rows.length > 0 ||
        recommendedPrice !== null ||
        pricingBreakdown.length > 0;

    if (
        order?.express ||
        !hasAnything
    ) {
        return null;
    }

    return (
        <div
            className={[
                "order-service-details",
                compact
                    ? "order-service-details--compact"
                    : "order-service-details--full",
            ].join(" ")}
        >
            <div className="order-service-details__head">
                <div>
                    <div className="order-service-details__title">
                        Детали услуги
                    </div>

                    {!compact && (
                        <div className="order-service-details__subtitle">
                            Параметры, указанные заказчиком
                        </div>
                    )}
                </div>

                {hasRecommendedRange && (
                    <div className="order-service-details__range">
                        <span>
                            Рекомендованный бюджет
                        </span>

                        <strong>
                            {formatMoney(
                                recommendedPriceMin
                            )}
                            {" – "}
                            {formatMoney(
                                recommendedPriceMax
                            )}
                        </strong>
                    </div>
                )}
            </div>

            {visibleRows.length > 0 && (
                <div className="order-service-details__grid">
                    {visibleRows.map((row) => (
                        <div
                            key={row.key}
                            className="order-service-detail"
                        >
                            <span className="order-service-detail__label">
                                {row.label}
                            </span>

                            <span className="order-service-detail__value">
                                {row.value}
                            </span>
                        </div>
                    ))}
                </div>
            )}

            {compact && hiddenRowsCount > 0 && (
                <div className="order-service-details__more">
                    Ещё параметров:{" "}
                    <b>{hiddenRowsCount}</b>
                </div>
            )}

            {!compact &&
                pricingBreakdown.length > 0 && (
                    <div className="order-pricing-details">
                        <div className="order-pricing-details__title">
                            Из чего сложилась рекомендация
                        </div>

                        <div className="order-pricing-details__rows">
                            {pricingBreakdown.map(
                                (item) => (
                                    <div
                                        key={item.key}
                                        className="order-pricing-details__row"
                                    >
                                        <span>
                                            {item.label}
                                        </span>

                                        <strong>
                                            {formatMoney(
                                                item.amount
                                            )}
                                        </strong>
                                    </div>
                                )
                            )}
                        </div>

                        {recommendedPrice !== null && (
                            <div className="order-pricing-details__total">
                                <span>
                                    Ориентировочная сумма
                                </span>

                                <strong>
                                    {formatMoney(
                                        recommendedPrice
                                    )}
                                </strong>
                            </div>
                        )}

                        <div className="order-pricing-details__notice">
                            Это ориентировочный расчёт.
                            Итоговая стоимость согласовывается
                            заказчиком и исполнителем.
                        </div>
                    </div>
                )}
        </div>
    );
}

export default OrderServiceDetails;