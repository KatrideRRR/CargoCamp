import React from "react";

import {
    MapPin,
    Clock3,
    Zap,
    ChevronRight,
    Camera,
    Star,
    Banknote,
    ShieldCheck,
    CreditCard,
} from "lucide-react";

import {
    orderHasSocialDiscount,
    getSocialCommissionPreview,
} from "../utils/socialCommissionPreview";

const formatMoney = (value) => {
    const number = Number(value);

    if (!Number.isFinite(number)) {
        return "—";
    }

    return `${number.toLocaleString("ru-RU")} ₽`;
};

export default function AvailableOrderCard({
                                               order,
                                               creator = {},
                                               userId,
                                               serviceName,
                                               timing,
                                               onOpen,
                                           }) {
    const isExpress = Boolean(order.express);

    const isCreator =
        Number(order.creatorId) === Number(userId);

    const displayId = isExpress
        ? order.expressId
        : order.id;

    const commission =
        getSocialCommissionPreview(order);

    const hasSocialDiscount =
        commission !== null &&
        orderHasSocialDiscount(order, creator);

    const commissionAmount = commission
        ? hasSocialDiscount
            ? commission.discountedRubles
            : commission.baseRubles
        : null;

    const payment = {
        cash: {
            title: "Наличными",
            Icon: Banknote,
        },
        guarantee: {
            title: "Гарантийная оплата",
            Icon: ShieldCheck,
        },
        installments: {
            title: "Рассрочка",
            Icon: CreditCard,
        },
    }[order.paymentType];

    const PaymentIcon = payment?.Icon;

    const hasImages =
        Array.isArray(order.images) &&
        order.images.length > 0;

    const description =
        typeof order.description === "string"
            ? order.description.trim()
            : "";

    const classes = [
        "order-card",
        "cc-available-order",
        order.is_recommended && "recommended",
        order.is_highlighted && "highlighted",
        isCreator && "my-order",
        isExpress && "express-order-card",
    ].filter(Boolean).join(" ");

    return (
        <li className={classes}>

            <button
                type="button"
                className="cc-available-order__button"
                aria-label={
                    `Открыть ${
                        isExpress ? "экспресс" : "заказ"
                    } №${displayId}`
                }
                onClick={() => onOpen(order)}
            >

                <div className="cc-available-order__top">

                    <span className="order-number">
                        {isExpress
                            ? `Экспресс №${displayId}`
                            : `Заказ №${displayId}`}
                    </span>

                    {order.is_recommended && (
                        <span className="cc-available-order__priority">
                            <Star size={14} />
                            В приоритете
                        </span>
                    )}

                    {isCreator && (
                        <span className="badge badge-my-order">
                            Мой заказ
                        </span>
                    )}

                </div>

                <div className="cc-available-order__service">
                    {serviceName}
                </div>

                <div className="cc-available-order__money">

                    <strong className="pay-price">
                        {formatMoney(order.proposedSum)}
                    </strong>

                    {!isCreator &&
                        commissionAmount !== null && (
                            <span className="cc-available-order__commission">

                                Комиссия{" "}
                                {formatMoney(
                                    commissionAmount
                                )}

                            </span>
                        )}

                </div>

                {hasSocialDiscount && (
                    <span
                        className="badge badge-pensioner-order"
                        title={
                            `Комиссия исполнителя ` +
                            `${commission.discountedRubles} ₽ ` +
                            `вместо ${commission.baseRubles} ₽`
                        }
                    >
                        Льготный · −50% комиссии
                    </span>
                )}

                {description && (
                    <p className="cc-available-order__description">
                        {description}
                    </p>
                )}

                <div className="cc-available-order__address">

                    <MapPin
                        size={16}
                        aria-hidden="true"
                    />

                    <span>
                        {order.address || "Адрес не указан"}
                    </span>

                </div>

                <div className="cc-available-order__metadata">

                    {Number.isFinite(order._distance) && (
                        <span className="badge-distance">
                            {order._distance.toFixed(1)} км
                        </span>
                    )}

                    <span>

                        {isExpress ||
                        timing?.type === "asap" ? (
                            <Zap size={14} />
                        ) : (
                            <Clock3 size={14} />
                        )}

                        {isExpress
                            ? "Экспресс"
                            : timing?.value ||
                            "Время не указано"}

                    </span>

                    {hasImages && (
                        <span>

                            <Camera size={15} />

                            {order.images.length}

                        </span>
                    )}

                </div>

                <div className="cc-available-order__bottom">

                    <span className="cc-available-order__payment">

                        {PaymentIcon && (
                            <PaymentIcon
                                size={16}
                                aria-hidden="true"
                            />
                        )}

                        {payment?.title ||
                            "Способ оплаты не указан"}

                    </span>

                    <ChevronRight
                        size={20}
                        aria-hidden="true"
                    />

                </div>

            </button>

        </li>
    );
}