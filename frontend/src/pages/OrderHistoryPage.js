import React, {
    useCallback,
    useEffect,
    useMemo,
    useState,
} from "react";

import { Capacitor } from "@capacitor/core";
import { useParams } from "react-router-dom";

import axiosInstance from "../utils/axiosInstance";
import OrderServiceDetails from "../components/OrderServiceDetails";

import "../styles/OrderHistotyPage.css";

import {
    FiCheckCircle,
    FiFileText,
    FiMapPin,
    FiNavigation,
    FiPackage,
    FiStar,
} from "react-icons/fi";

import {
    FaCarSide,
    FaRegMoneyBillAlt,
} from "react-icons/fa";

const apiUrl =
    process.env.REACT_APP_API_URL ||
    "http://localhost:5001";

function formatCompletedDate(value) {
    if (!value) {
        return "Не указана";
    }

    const parsedDate =
        new Date(value);

    if (
        Number.isNaN(
            parsedDate.getTime()
        )
    ) {
        return "Не указана";
    }

    return parsedDate.toLocaleDateString(
        "ru-RU"
    );
}

function getCompletedTimestamp(order) {
    const timestamp =
        new Date(
            order.completedAt ||
            order.updatedAt ||
            order.createdAt ||
            0
        ).getTime();

    return Number.isFinite(timestamp)
        ? timestamp
        : 0;
}

function getContractUrl(contractPath) {
    if (!contractPath) {
        return null;
    }

    if (
        /^https?:\/\//i.test(
            contractPath
        )
    ) {
        return contractPath;
    }

    const normalizedPath =
        contractPath.startsWith("/")
            ? contractPath
            : `/${contractPath}`;

    return `${apiUrl}${normalizedPath}`;
}

function getReviewKey(order) {
    return `${order.orderType}:${order.id}`;
}

const OrderHistoryPage = () => {
    const { userId } = useParams();

    const platform = useMemo(() => {
        const params =
            new URLSearchParams(
                window.location.search
            );

        const forcedPlatform =
            params.get("platform");

        if (
            forcedPlatform === "ios"
        ) {
            return "ios";
        }

        if (
            forcedPlatform === "android"
        ) {
            return "android";
        }

        if (
            forcedPlatform === "web"
        ) {
            return "web";
        }

        const currentPlatform =
            Capacitor.getPlatform();

        if (
            currentPlatform === "ios"
        ) {
            return "ios";
        }

        if (
            currentPlatform === "android"
        ) {
            return "android";
        }

        return "web";
    }, []);

    const [regularOrders, setRegularOrders] =
        useState([]);

    const [expressOrders, setExpressOrders] =
        useState([]);

    const [
        myReviewedOrderKeys,
        setMyReviewedOrderKeys,
    ] = useState(
        () => new Set()
    );

    const [loading, setLoading] =
        useState(true);

    const [error, setError] =
        useState(null);

    const [
        reviewModalOpen,
        setReviewModalOpen,
    ] = useState(false);

    const [
        reviewOrder,
        setReviewOrder,
    ] = useState(null);

    const [
        reviewRating,
        setReviewRating,
    ] = useState(0);

    const [
        reviewText,
        setReviewText,
    ] = useState("");

    const [
        reviewSending,
        setReviewSending,
    ] = useState(false);

    const [
        expandedDesc,
        setExpandedDesc,
    ] = useState(() => ({}));

    const fetchCompletedOrders =
        useCallback(async () => {
            const [
                regularResult,
                expressResult,
            ] = await Promise.allSettled([
                axiosInstance.get(
                    `/orders/completed/${userId}`
                ),

                axiosInstance.get(
                    "/express-orders/me",
                    {
                        params: {
                            mode: "history",
                        },
                    }
                ),
            ]);

            let regularError = null;
            let expressError = null;

            if (
                regularResult.status ===
                "fulfilled"
            ) {
                const loadedRegularOrders =
                    Array.isArray(
                        regularResult.value.data
                    )
                        ? regularResult.value.data
                        : [];

                setRegularOrders(
                    loadedRegularOrders.map(
                        (order) => ({
                            ...order,

                            orderType:
                                "regular",

                            completedAtRaw:
                            order.completedAt,

                            completedAtFormatted:
                                formatCompletedDate(
                                    order.completedAt
                                ),
                        })
                    )
                );
            } else {
                console.error(
                    "Ошибка загрузки обычной истории:",
                    regularResult.reason
                );

                regularError =
                    regularResult.reason;

                setRegularOrders([]);
            }

            if (
                expressResult.status ===
                "fulfilled"
            ) {
                const responseData =
                    expressResult.value.data;

                const loadedExpressOrders =
                    Array.isArray(
                        responseData?.orders
                    )
                        ? responseData.orders
                        : [];

                setExpressOrders(
                    loadedExpressOrders
                        .filter(
                            (order) =>
                                order.status ===
                                "completed"
                        )
                        .map(
                            (order) => ({
                                ...order,

                                orderType:
                                    "express",

                                completedAtRaw:
                                order.completedAt,

                                completedAtFormatted:
                                    formatCompletedDate(
                                        order.completedAt
                                    ),
                            })
                        )
                );
            } else {
                console.error(
                    "Ошибка загрузки истории экспресс-заказов:",
                    expressResult.reason
                );

                expressError =
                    expressResult.reason;

                setExpressOrders([]);
            }

            /*
             * Показываем общую ошибку только тогда,
             * когда не загрузился ни один тип заказов.
             */
            if (
                regularError &&
                expressError
            ) {
                throw (
                    regularError ||
                    expressError
                );
            }
        }, [userId]);

    const fetchMyReviews =
        useCallback(async () => {
            try {
                const response =
                    await axiosInstance.get(
                        "/auth/reviews/my"
                    );

                const reviews =
                    Array.isArray(
                        response.data?.reviews
                    )
                        ? response.data.reviews
                        : [];

                const reviewKeys =
                    new Set(
                        reviews.map(
                            (review) => {
                                const reviewOrderType =
                                    review.orderType ===
                                    "express"
                                        ? "express"
                                        : "regular";

                                return `${reviewOrderType}:${review.orderId}`;
                            }
                        )
                    );

                setMyReviewedOrderKeys(
                    reviewKeys
                );
            } catch (reviewError) {
                console.error(
                    "fetchMyReviews error:",
                    reviewError
                );
            }
        }, []);

    const loadHistory =
        useCallback(async () => {
            try {
                setLoading(true);
                setError(null);

                await Promise.all([
                    fetchCompletedOrders(),
                    fetchMyReviews(),
                ]);
            } catch (loadError) {
                console.error(
                    "Ошибка загрузки истории:",
                    loadError
                );

                setError(
                    loadError.response?.data
                        ?.message ||
                    "Не удалось загрузить историю заказов"
                );
            } finally {
                setLoading(false);
            }
        }, [
            fetchCompletedOrders,
            fetchMyReviews,
        ]);

    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    useEffect(() => {
        const onPullToRefresh =
            async (event) => {
                try {
                    setError(null);

                    await Promise.allSettled([
                        fetchCompletedOrders(),
                        fetchMyReviews(),
                    ]);
                } finally {
                    event.detail?.done?.();
                }
            };

        window.addEventListener(
            "appPullToRefresh",
            onPullToRefresh
        );

        return () => {
            window.removeEventListener(
                "appPullToRefresh",
                onPullToRefresh
            );
        };
    }, [
        fetchCompletedOrders,
        fetchMyReviews,
    ]);

    const sortedOrders =
        useMemo(() => {
            return [
                ...regularOrders,
                ...expressOrders,
            ].sort(
                (firstOrder, secondOrder) =>
                    getCompletedTimestamp(
                        secondOrder
                    ) -
                    getCompletedTimestamp(
                        firstOrder
                    )
            );
        }, [
            regularOrders,
            expressOrders,
        ]);

    const regularCount =
        regularOrders.length;

    const expressCount =
        expressOrders.length;

    const canReview = (order) => {
        /*
         * Пока используем существующий review endpoint
         * только для обычных заказов.
         *
         * Для express понадобится убедиться, что
         * POST /auth/review принимает orderType:
         * "express" и ищет ExpressOrder.
         */
        if (
            order.orderType !== "regular"
        ) {
            return false;
        }

        return (
            order.status === "completed" &&
            Boolean(order.executorId) &&
            !myReviewedOrderKeys.has(
                getReviewKey(order)
            )
        );
    };

    const toggleDesc = (
        orderKey
    ) => {
        setExpandedDesc(
            (previousState) => ({
                ...previousState,

                [orderKey]:
                    !previousState[
                        orderKey
                        ],
            })
        );
    };

    const submitReview =
        async () => {
            if (!reviewOrder) {
                return;
            }

            if (
                reviewRating < 1 ||
                reviewRating > 5
            ) {
                alert(
                    "Поставьте оценку от 1 до 5"
                );

                return;
            }

            try {
                setReviewSending(true);

                await axiosInstance.post(
                    "/auth/review",
                    {
                        orderId:
                        reviewOrder.id,

                        rating:
                        reviewRating,

                        text:
                        reviewText,

                        orderType:
                        reviewOrder.orderType,
                    }
                );

                setMyReviewedOrderKeys(
                    (previousKeys) => {
                        const nextKeys =
                            new Set(
                                previousKeys
                            );

                        nextKeys.add(
                            getReviewKey(
                                reviewOrder
                            )
                        );

                        return nextKeys;
                    }
                );

                setReviewModalOpen(false);
                setReviewOrder(null);
                setReviewRating(0);
                setReviewText("");

                alert(
                    "Отзыв сохранён ✅"
                );
            } catch (submitError) {
                console.error(
                    "submitReview error:",
                    submitError
                );

                alert(
                    submitError.response
                        ?.data?.message ||
                    "Не удалось отправить отзыв"
                );
            } finally {
                setReviewSending(false);
            }
        };

    if (loading) {
        return (
            <div className="oh-state">
                Загрузка истории заказов…
            </div>
        );
    }

    if (error) {
        return (
            <div className="oh-state oh-state--error">
                Ошибка: {error}
            </div>
        );
    }

    return (
        <div
            className={[
                "oh-page",
                `oh-page--${platform}`,
                "order-history-page",
                `order-history-page--${platform}`,
            ].join(" ")}
        >
            <div className="oh-shell">
                <div className="oh-header glass">
                    <div className="oh-title-row">
                        <div className="oh-title">
                            История заказов
                        </div>

                        <span className="oh-count">
                            {sortedOrders.length}
                        </span>
                    </div>

                    <div className="oh-subtitle">
                        Здесь отображаются завершённые
                        обычные и экспресс-заказы
                    </div>

                    <div className="oh-history-summary">
                        <span className="oh-history-summary__item">
                            Обычные:{" "}
                            <strong>
                                {regularCount}
                            </strong>
                        </span>

                        <span className="oh-history-summary__item oh-history-summary__item--express">
                            Экспресс:{" "}
                            <strong>
                                {expressCount}
                            </strong>
                        </span>
                    </div>
                </div>

                {sortedOrders.length >
                0 ? (
                    <ul className="oh-list">
                        {sortedOrders.map(
                            (order) => {
                                const isExpress =
                                    order.orderType ===
                                    "express";

                                const orderKey =
                                    `${order.orderType}-${order.id}`;

                                const isDescExpanded =
                                    Boolean(
                                        expandedDesc[
                                            orderKey
                                            ]
                                    );

                                const description =
                                    typeof order.description ===
                                    "string"
                                        ? order.description.trim()
                                        : "";

                                const hasDescription =
                                    description.length >
                                    0;

                                const shouldClamp =
                                    description.length >
                                    140;

                                const contractUrl =
                                    getContractUrl(
                                        order.contractPath
                                    );

                                const expressTitle =
                                    order.type ===
                                    "taxi"
                                        ? "Такси"
                                        : "Курьер";

                                const expressPrice =
                                    Number(
                                        order.totalPrice ||
                                        0
                                    );

                                const regularPrice =
                                    Number(
                                        order.proposedSum ||
                                        0
                                    );

                                const displayedPrice =
                                    isExpress
                                        ? expressPrice
                                        : regularPrice;

                                return (
                                    <li
                                        key={
                                            orderKey
                                        }
                                        className={[
                                            "oh-card",
                                            "glass",

                                            isExpress
                                                ? "oh-card--express"
                                                : "oh-card--regular",
                                        ].join(
                                            " "
                                        )}
                                    >
                                        <div className="oh-card-head">
                                            <div className="oh-card-head-left">
                                                <div className="oh-order-title-line">
                                                    <div className="oh-order-num">
                                                        {isExpress
                                                            ? "Экспресс-заказ"
                                                            : "Заказ"}{" "}
                                                        №
                                                        {
                                                            order.id
                                                        }
                                                    </div>

                                                    <span
                                                        className={[
                                                            "oh-order-type-badge",

                                                            isExpress
                                                                ? "oh-order-type-badge--express"
                                                                : "oh-order-type-badge--regular",
                                                        ].join(
                                                            " "
                                                        )}
                                                    >
                                                        {isExpress ? (
                                                            order.type ===
                                                            "taxi" ? (
                                                                <FaCarSide />
                                                            ) : (
                                                                <FiPackage />
                                                            )
                                                        ) : (
                                                            <FiFileText />
                                                        )}

                                                        {isExpress
                                                            ? expressTitle
                                                            : "Обычный"}
                                                    </span>
                                                </div>

                                                <div className="oh-meta">
                                                    <span className="oh-pill oh-pill--done">
                                                        <FiCheckCircle />

                                                        Завершён
                                                    </span>

                                                    <span className="oh-dot">
                                                        •
                                                    </span>

                                                    <span className="oh-muted">
                                                        Дата:{" "}
                                                        {
                                                            order.completedAtFormatted
                                                        }
                                                    </span>
                                                </div>
                                            </div>

                                            <div className="oh-price">
                                                <FaRegMoneyBillAlt />

                                                <span className="oh-price-val">
                                                    {
                                                        displayedPrice
                                                    }{" "}
                                                    ₽
                                                </span>
                                            </div>
                                        </div>

                                        {isExpress ? (
                                            <div className="oh-express-route">
                                                <div className="oh-route-point">
                                                    <div className="oh-route-point__icon oh-route-point__icon--from">
                                                        A
                                                    </div>

                                                    <div className="oh-route-point__content">
                                                        <span className="oh-k">
                                                            Откуда
                                                        </span>

                                                        <span className="oh-v">
                                                            {order.fromAddress ||
                                                                "—"}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="oh-route-divider">
                                                    <FiNavigation />
                                                </div>

                                                <div className="oh-route-point">
                                                    <div className="oh-route-point__icon oh-route-point__icon--to">
                                                        B
                                                    </div>

                                                    <div className="oh-route-point__content">
                                                        <span className="oh-k">
                                                            Куда
                                                        </span>

                                                        <span className="oh-v">
                                                            {order.toAddress ||
                                                                "—"}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="oh-grid">
                                                <div className="oh-kv">
                                                    <span className="oh-k">
                                                        Категория
                                                        /
                                                        услуга
                                                    </span>

                                                    <span className="oh-v">
                                                        {[
                                                                order
                                                                    .category
                                                                    ?.name,

                                                                order
                                                                    .subcategory
                                                                    ?.name,

                                                                order
                                                                    .service
                                                                    ?.name,
                                                            ]
                                                                .filter(
                                                                    Boolean
                                                                )
                                                                .join(
                                                                    " • "
                                                                ) ||
                                                            "—"}
                                                    </span>
                                                </div>

                                                <div className="oh-kv">
                                                    <span className="oh-k">
                                                        Адрес
                                                    </span>

                                                    <span className="oh-v">
                                                        {order.address ||
                                                            "—"}
                                                    </span>
                                                </div>
                                            </div>
                                        )}

                                        {isExpress && (
                                            <div className="oh-grid oh-grid--express-meta">
                                                <div className="oh-kv">
                                                    <span className="oh-k">
                                                        Тип
                                                        заказа
                                                    </span>

                                                    <span className="oh-v">
                                                        {expressTitle}
                                                    </span>
                                                </div>

                                                <div className="oh-kv">
                                                    <span className="oh-k">
                                                        Способ
                                                        оплаты
                                                    </span>

                                                    <span className="oh-v">
                                                        {order.paymentType ===
                                                        "cash"
                                                            ? "Наличные"
                                                            : order.paymentType ===
                                                            "guarantee"
                                                                ? "Безопасная оплата"
                                                                : "—"}
                                                    </span>
                                                </div>

                                                {order.distanceKm !=
                                                    null && (
                                                        <div className="oh-kv">
                                                        <span className="oh-k">
                                                            Расстояние
                                                        </span>

                                                            <span className="oh-v">
                                                            {
                                                                order.distanceKm
                                                            }{" "}
                                                                км
                                                        </span>
                                                        </div>
                                                    )}

                                                {order.estimatedTimeMin !=
                                                    null && (
                                                        <div className="oh-kv">
                                                        <span className="oh-k">
                                                            Время
                                                            в
                                                            пути
                                                        </span>

                                                            <span className="oh-v">
                                                            {
                                                                order.estimatedTimeMin
                                                            }{" "}
                                                                мин.
                                                        </span>
                                                        </div>
                                                    )}
                                            </div>
                                        )}

                                        {hasDescription && (
                                            <div className="oh-kv oh-kv--wide oh-description-box">
                                                <div className="oh-desc-head">
                                                    <span className="oh-k">
                                                        Описание
                                                    </span>

                                                    {shouldClamp && (
                                                        <button
                                                            type="button"
                                                            className="oh-link-btn"
                                                            onClick={() =>
                                                                toggleDesc(
                                                                    orderKey
                                                                )
                                                            }
                                                        >
                                                            {isDescExpanded
                                                                ? "Свернуть"
                                                                : "Подробнее"}
                                                        </button>
                                                    )}
                                                </div>

                                                <span
                                                    className={[
                                                        "oh-v",
                                                        "oh-desc",

                                                        shouldClamp
                                                            ? "clampable"
                                                            : "",

                                                        isDescExpanded
                                                            ? "expanded"
                                                            : "collapsed",
                                                    ]
                                                        .filter(
                                                            Boolean
                                                        )
                                                        .join(
                                                            " "
                                                        )}
                                                >
                                                    {
                                                        description
                                                    }
                                                </span>
                                            </div>
                                        )}

                                        <div className="oh-grid oh-participants-grid">
                                            <div className="oh-kv">
                                                <span className="oh-k">
                                                    ID
                                                    заказчика
                                                </span>

                                                <span className="oh-v">
                                                    {order.creatorId ||
                                                        "—"}
                                                </span>
                                            </div>

                                            <div className="oh-kv">
                                                <span className="oh-k">
                                                    ID
                                                    исполнителя
                                                </span>

                                                <span className="oh-v">
                                                    {order.executorId ||
                                                        "—"}
                                                </span>
                                            </div>
                                        </div>

                                        {!isExpress && (
                                            <OrderServiceDetails
                                                order={
                                                    order
                                                }
                                            />
                                        )}

                                        <div className="oh-actions">
                                            {!isExpress &&
                                                contractUrl && (
                                                    <a
                                                        className="btn btn-ghost"
                                                        href={
                                                            contractUrl
                                                        }
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                    >
                                                        <FiFileText />

                                                        Скачать
                                                        договор
                                                        (PDF)
                                                    </a>
                                                )}

                                            {canReview(
                                                order
                                            ) ? (
                                                <button
                                                    type="button"
                                                    className="btn btn-primary"
                                                    onClick={() => {
                                                        setReviewOrder(
                                                            order
                                                        );

                                                        setReviewRating(
                                                            0
                                                        );

                                                        setReviewText(
                                                            ""
                                                        );

                                                        setReviewModalOpen(
                                                            true
                                                        );
                                                    }}
                                                >
                                                    <FiStar />

                                                    Оставить
                                                    отзыв
                                                </button>
                                            ) : (
                                                <span className="oh-pill oh-pill--muted">
                                                    <FiCheckCircle />

                                                    {isExpress
                                                        ? "Экспресс-заказ завершён"
                                                        : "Отзыв сохранён"}
                                                </span>
                                            )}
                                        </div>
                                    </li>
                                );
                            }
                        )}
                    </ul>
                ) : (
                    <div className="oh-empty glass">
                        <div className="oh-empty-title">
                            Пока пусто
                        </div>

                        <div className="oh-empty-sub">
                            Завершённых обычных и
                            экспресс-заказов ещё нет.
                        </div>
                    </div>
                )}
            </div>

            {reviewModalOpen &&
                reviewOrder && (
                    <div
                        className="oh-modal-overlay"
                        onClick={() => {
                            if (
                                !reviewSending
                            ) {
                                setReviewModalOpen(
                                    false
                                );
                            }
                        }}
                    >
                        <div
                            className="oh-modal glass"
                            onClick={(event) =>
                                event.stopPropagation()
                            }
                        >
                            <div className="oh-modal-head">
                                <div className="oh-modal-title">
                                    Отзыв по заказу №
                                    {
                                        reviewOrder.id
                                    }
                                </div>

                                <button
                                    type="button"
                                    className="btn btn-ghost"
                                    onClick={() => {
                                        if (
                                            !reviewSending
                                        ) {
                                            setReviewModalOpen(
                                                false
                                            );
                                        }
                                    }}
                                >
                                    Закрыть
                                </button>
                            </div>

                            <div className="oh-stars">
                                {[
                                    1,
                                    2,
                                    3,
                                    4,
                                    5,
                                ].map(
                                    (star) => (
                                        <button
                                            key={
                                                star
                                            }
                                            type="button"
                                            className={[
                                                "oh-star",

                                                star <=
                                                reviewRating
                                                    ? "selected"
                                                    : "",
                                            ]
                                                .filter(
                                                    Boolean
                                                )
                                                .join(
                                                    " "
                                                )}
                                            onClick={() => {
                                                if (
                                                    !reviewSending
                                                ) {
                                                    setReviewRating(
                                                        star
                                                    );
                                                }
                                            }}
                                            aria-label={`Поставить ${star}`}
                                        >
                                            ★
                                        </button>
                                    )
                                )}
                            </div>

                            <textarea
                                className="oh-textarea"
                                value={reviewText}
                                onChange={(
                                    event
                                ) =>
                                    setReviewText(
                                        event.target
                                            .value
                                    )
                                }
                                rows="4"
                                placeholder="Комментарий (необязательно)"
                                disabled={
                                    reviewSending
                                }
                            />

                            <div className="oh-modal-actions">
                                <button
                                    type="button"
                                    className="btn btn-ghost"
                                    onClick={() =>
                                        setReviewText(
                                            ""
                                        )
                                    }
                                    disabled={
                                        reviewSending
                                    }
                                >
                                    Очистить
                                </button>

                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={
                                        submitReview
                                    }
                                    disabled={
                                        reviewSending ||
                                        reviewRating ===
                                        0
                                    }
                                >
                                    {reviewSending
                                        ? "Отправляем…"
                                        : "Отправить отзыв"}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
        </div>
    );
};

export default OrderHistoryPage;