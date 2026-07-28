import React, {
    useCallback,
    useEffect,
    useMemo,
    useState,
} from "react";

import {
    Link,
    useNavigate,
    useParams,
} from "react-router-dom";

import Modal from "react-modal";

import {
    FaCreditCard,
    FaMoneyBillWave,
    FaQuestionCircle,
    FaUniversity,
} from "react-icons/fa";

import { FiAlertTriangle } from "react-icons/fi";

import axiosInstance from "../utils/axiosInstance";
import OrderServiceDetails from "../components/OrderServiceDetails";
import { socket } from "../socketClient";

import "../styles/OrdersPage.css";

const apiUrl =
    process.env.REACT_APP_API_URL || "";

const UserOrdersPage = () => {
    const navigate = useNavigate();

    const {
        userId: paramUserId,
    } = useParams();

    const [orders, setOrders] =
        useState([]);

    const [pageUser, setPageUser] =
        useState(null);

    const [currentUserId, setCurrentUserId] =
        useState(null);

    const [loading, setLoading] =
        useState(true);

    const [error, setError] =
        useState(null);

    const [isModalOpen, setIsModalOpen] =
        useState(false);

    const [currentImages, setCurrentImages] =
        useState([]);

    const [
        currentImageIndex,
        setCurrentImageIndex,
    ] = useState(0);

    /*
     * Все заказы на этой странице принадлежат
     * одному пользователю, поэтому нет необходимости
     * загружать автора отдельно для каждого заказа.
     */
    const fetchPageData = useCallback(
        async () => {
            if (!paramUserId) {
                setOrders([]);
                setPageUser(null);
                setError(
                    "Не указан ID пользователя"
                );
                setLoading(false);
                return;
            }

            try {
                setLoading(true);
                setError(null);

                const [
                    ordersResult,
                    userResult,
                ] = await Promise.allSettled([
                    axiosInstance.get(
                        `/orders/creator/${paramUserId}`
                    ),

                    axiosInstance.get(
                        `/auth/${paramUserId}`
                    ),
                ]);

                if (
                    ordersResult.status ===
                    "fulfilled"
                ) {
                    setOrders(
                        Array.isArray(
                            ordersResult.value.data
                        )
                            ? ordersResult.value.data
                            : []
                    );
                } else {
                    throw ordersResult.reason;
                }

                if (
                    userResult.status ===
                    "fulfilled"
                ) {
                    setPageUser(
                        userResult.value.data ||
                        null
                    );
                } else {
                    console.error(
                        "Ошибка загрузки пользователя страницы:",
                        userResult.reason
                    );

                    setPageUser(null);
                }
            } catch (requestError) {
                console.error(
                    "Ошибка загрузки заказов пользователя:",
                    requestError
                );

                setOrders([]);

                setError(
                    requestError.response?.data
                        ?.message ||
                    "Не удалось загрузить заказы пользователя"
                );
            } finally {
                setLoading(false);
            }
        },
        [paramUserId]
    );

    /*
     * Профиль текущего авторизованного пользователя.
     * Ошибка здесь не должна ломать публичную страницу.
     */
    useEffect(() => {
        let cancelled = false;

        const fetchCurrentUser = async () => {
            const token =
                localStorage.getItem(
                    "authToken"
                );

            if (!token) {
                setCurrentUserId(null);
                return;
            }

            try {
                const response =
                    await axiosInstance.get(
                        "/auth/profile"
                    );

                if (!cancelled) {
                    setCurrentUserId(
                        response.data?.id ??
                        null
                    );
                }
            } catch (profileError) {
                console.error(
                    "Ошибка получения текущего профиля:",
                    profileError
                );

                if (!cancelled) {
                    setCurrentUserId(null);
                }
            }
        };

        fetchCurrentUser();

        return () => {
            cancelled = true;
        };
    }, []);

    /*
     * Первичная загрузка страницы.
     */
    useEffect(() => {
        fetchPageData();
    }, [fetchPageData]);

    /*
     * Обновление списка по Socket.
     */
    useEffect(() => {
        const handleOrderUpdated = () => {
            fetchPageData();
        };

        const handleOrderRequested = (
            data
        ) => {
            console.log(
                "Получен запрос на заказ:",
                data
            );
        };

        socket.on(
            "orderUpdated",
            handleOrderUpdated
        );

        socket.on(
            "orderRequested",
            handleOrderRequested
        );

        return () => {
            socket.off(
                "orderUpdated",
                handleOrderUpdated
            );

            socket.off(
                "orderRequested",
                handleOrderRequested
            );
        };
    }, [fetchPageData]);

    const handleRequestOrder = async (
        orderId
    ) => {
        const token =
            localStorage.getItem(
                "authToken"
            );

        if (!token) {
            alert(
                "Вы не авторизованы. Пожалуйста, войдите в систему."
            );

            navigate("/login");
            return;
        }

        try {
            await axiosInstance.post(
                `/orders/${orderId}/request`
            );

            alert(
                "Запрос отправлен заказчику."
            );

            await fetchPageData();
        } catch (requestError) {
            console.error(
                "Ошибка запроса на выполнение заказа:",
                requestError
            );

            alert(
                requestError.response?.data
                    ?.message ||
                "Не удалось отправить запрос"
            );
        }
    };

    const openModal = (images) => {
        const normalizedImages =
            Array.isArray(images)
                ? images.filter(Boolean)
                : [];

        if (
            normalizedImages.length === 0
        ) {
            return;
        }

        setCurrentImages(
            normalizedImages
        );

        setCurrentImageIndex(0);
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setCurrentImageIndex(0);
        setCurrentImages([]);
    };

    const nextImage = () => {
        if (
            currentImages.length <= 1
        ) {
            return;
        }

        setCurrentImageIndex(
            (previousIndex) =>
                (
                    previousIndex + 1
                ) %
                currentImages.length
        );
    };

    const prevImage = () => {
        if (
            currentImages.length <= 1
        ) {
            return;
        }

        setCurrentImageIndex(
            (previousIndex) =>
                (
                    previousIndex -
                    1 +
                    currentImages.length
                ) %
                currentImages.length
        );
    };

    const getPaymentIcon = (
        paymentType
    ) => {
        switch (paymentType) {
            case "guarantee":
                return (
                    <FaUniversity
                        title="Безопасная оплата"
                    />
                );

            case "cash":
                return (
                    <FaMoneyBillWave
                        title="Наличные"
                    />
                );

            case "installments":
                return (
                    <FaCreditCard
                        title="Оплата картой"
                    />
                );

            default:
                return (
                    <FaQuestionCircle
                        title="Способ оплаты не указан"
                    />
                );
        }
    };

    const getPaymentLabel = (
        paymentType
    ) => {
        switch (paymentType) {
            case "guarantee":
                return "Безопасная оплата";

            case "cash":
                return "Наличные";

            case "installments":
                return "Оплата картой";

            default:
                return "Не указано";
        }
    };

    const formatDate = (
        dateValue
    ) => {
        if (!dateValue) {
            return "Дата не указана";
        }

        const parsedDate =
            new Date(dateValue);

        if (
            Number.isNaN(
                parsedDate.getTime()
            )
        ) {
            return "Дата не указана";
        }

        return parsedDate.toLocaleString(
            "ru-RU"
        );
    };

    const pageUsername =
        pageUser?.username ||
        "Без имени";

    const pageRating =
        Number(pageUser?.rating);

    const complaintsCount =
        Number(
            pageUser?.complaintsCount
        ) || 0;

    const pageSubtitle = useMemo(
        () => {
            if (loading) {
                return "Загружаем опубликованные заказы";
            }

            if (orders.length === 0) {
                return "У пользователя пока нет доступных заказов";
            }

            return `Найдено заказов: ${orders.length}`;
        },
        [loading, orders.length]
    );

    if (loading) {
        return (
            <div className="loading">
                Загрузка заказов...
            </div>
        );
    }

    if (error) {
        return (
            <div className="error-message">
                {error}
            </div>
        );
    }

    return (
        <div className="orders-page">
            <div className="orders-shell">
                <header className="orders-top">
                    <div className="orders-top-left">
                        <h1 className="orders-title">
                            Заказы пользователя
                        </h1>

                        <p className="orders-subtitle">
                            <b>
                                {pageUsername}
                            </b>

                            {" · "}

                            ID: {paramUserId}
                        </p>

                        <p className="orders-subtitle">
                            {pageSubtitle}
                        </p>
                    </div>
                </header>

                {orders.length > 0 ? (
                    <div className="orders-list-wrap">
                        <ul className="orders-list">
                            {orders.map(
                                (order) => {
                                    const description =
                                        typeof order.description ===
                                        "string"
                                            ? order.description.trim()
                                            : "";

                                    const hasDescription =
                                        description.length > 0;

                                    const orderImages =
                                        Array.isArray(
                                            order.images
                                        )
                                            ? order.images.filter(
                                                Boolean
                                            )
                                            : [];

                                    const isOwnOrder =
                                        Number(
                                            currentUserId
                                        ) ===
                                        Number(
                                            order.creatorId
                                        );

                                    const canRequest =
                                        !isOwnOrder &&
                                        !order.executorId &&
                                        order.status ===
                                        "pending";

                                    const cardClasses = [
                                        "order-card",

                                        isOwnOrder
                                            ? "my-order"
                                            : "",

                                        canRequest
                                            ? "can-take"
                                            : "",

                                        order.is_highlighted
                                            ? "highlighted"
                                            : "",

                                        order.is_recommended
                                            ? "recommended"
                                            : "",
                                    ]
                                        .filter(Boolean)
                                        .join(" ");

                                    return (
                                        <li
                                            key={
                                                order.id
                                            }
                                            className={
                                                cardClasses
                                            }
                                        >
                                            <div className="order-head">
                                                <div className="order-head-left">
                                                    <div className="order-title-row">
                                                        <span className="order-number">
                                                            Заказ №
                                                            {
                                                                order.id
                                                            }
                                                        </span>

                                                        {isOwnOrder && (
                                                            <span className="badge badge-my-order">
                                                                Ваш заказ
                                                            </span>
                                                        )}

                                                        {canRequest && (
                                                            <span className="badge badge-can-take">
                                                                Можно откликнуться
                                                            </span>
                                                        )}

                                                        {order.is_highlighted && (
                                                            <span className="badge badge-priority">
                                                                Выделенный
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="order-meta">
                                                        <span className="muted">
                                                            Создан{" "}
                                                            {formatDate(
                                                                order.createdAt
                                                            )}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="order-head-right">
                                                    <div className="pay-box">
                                                        <span className="pay-icon">
                                                            {getPaymentIcon(
                                                                order.paymentType
                                                            )}
                                                        </span>

                                                        <div>
                                                            <div className="pay-price">
                                                                {order.proposedSum ??
                                                                    0}{" "}
                                                                ₽
                                                            </div>

                                                            <div className="pay-type">
                                                                {getPaymentLabel(
                                                                    order.paymentType
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="order-grid">
                                                <div className="order-col">
                                                    <div className="kv">
                                                        <span className="k">
                                                            Заказчик
                                                        </span>

                                                        <span className="v">
                                                            {pageUsername}
                                                        </span>
                                                    </div>

                                                    <div className="kv">
                                                        <span className="k">
                                                            Рейтинг заказчика
                                                        </span>

                                                        <span className="v">
                                                            {Number.isFinite(
                                                                pageRating
                                                            )
                                                                ? pageRating.toFixed(
                                                                    1
                                                                )
                                                                : "Нет данных"}
                                                        </span>
                                                    </div>

                                                    <div className="kv">
                                                        <span className="k">
                                                            Категория
                                                        </span>

                                                        <span className="v">
                                                            {order.category
                                                                    ?.name ||
                                                                "Не указано"}
                                                        </span>
                                                    </div>
                                                </div>

                                                <div className="order-col">
                                                    <div className="kv">
                                                        <span className="k">
                                                            Подкатегория
                                                        </span>

                                                        <span className="v">
                                                            {order.subcategory
                                                                    ?.name ||
                                                                "Не указано"}
                                                        </span>
                                                    </div>

                                                    <div className="kv">
                                                        <span className="k">
                                                            Услуга
                                                        </span>

                                                        <span className="v">
                                                            {order.service
                                                                    ?.name ||
                                                                "Не указано"}
                                                        </span>
                                                    </div>

                                                    <div className="kv">
                                                        <span className="k">
                                                            Адрес
                                                        </span>

                                                        <span className="v v-line">
                                                            {order.address ||
                                                                "Не указан"}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            {orderImages.length >
                                                0 && (
                                                    <div
                                                        className="thumbs"
                                                        role="button"
                                                        tabIndex={0}
                                                        onClick={() =>
                                                            openModal(
                                                                orderImages
                                                            )
                                                        }
                                                        onKeyDown={(
                                                            event
                                                        ) => {
                                                            if (
                                                                event.key ===
                                                                "Enter" ||
                                                                event.key ===
                                                                " "
                                                            ) {
                                                                openModal(
                                                                    orderImages
                                                                );
                                                            }
                                                        }}
                                                    >
                                                        {orderImages
                                                            .slice(
                                                                0,
                                                                3
                                                            )
                                                            .map(
                                                                (
                                                                    image,
                                                                    index
                                                                ) => (
                                                                    <img
                                                                        key={`${image}-${index}`}
                                                                        src={`${apiUrl}${image}`}
                                                                        alt={`Фото заказа ${
                                                                            index +
                                                                            1
                                                                        }`}
                                                                        className="thumb"
                                                                    />
                                                                )
                                                            )}

                                                        {orderImages.length >
                                                            3 && (
                                                                <div className="thumb-more">
                                                                    +
                                                                    {orderImages.length -
                                                                        3}
                                                                </div>
                                                            )}
                                                    </div>
                                                )}

                                            {hasDescription && (
                                                <div className="order-desc">
                                                    <span className="k">
                                                        Описание
                                                    </span>

                                                    <span className="v">
                                                        {description}
                                                    </span>
                                                </div>
                                            )}

                                            <OrderServiceDetails
                                                order={
                                                    order
                                                }
                                                compact
                                            />

                                            <div className="order-actions">
                                                <Link
                                                    to={`/complaints/${order.creatorId}`}
                                                    className="btn btn-ghost-danger complaint-btn"
                                                    aria-label={`Жалобы: ${complaintsCount}`}
                                                    title="Жалобы на пользователя"
                                                >
                                                    <FiAlertTriangle className="complaint-btn-icon" />

                                                    <span className="complaint-btn-count">
                                                        {
                                                            complaintsCount
                                                        }
                                                    </span>
                                                </Link>

                                                <div className="order-main-actions">
                                                    <Link
                                                        to={`/orders/${order.id}`}
                                                        className="btn btn-ghost"
                                                    >
                                                        Открыть
                                                    </Link>

                                                    {canRequest && (
                                                        <button
                                                            type="button"
                                                            className="btn btn-primary"
                                                            onClick={() =>
                                                                handleRequestOrder(
                                                                    order.id
                                                                )
                                                            }
                                                        >
                                                            Запросить выполнение
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </li>
                                    );
                                }
                            )}
                        </ul>
                    </div>
                ) : (
                    <div className="empty">
                        <h2 className="empty-title">
                            Заказов пока нет
                        </h2>

                        <p className="empty-sub">
                            Пользователь ещё не
                            опубликовал доступные
                            заказы.
                        </p>
                    </div>
                )}
            </div>

            <Modal
                appElement={
                    document.getElementById(
                        "root"
                    ) || undefined
                }
                isOpen={isModalOpen}
                onRequestClose={closeModal}
                contentLabel="Просмотр фотографий заказа"
                className="custom-modal"
                overlayClassName="custom-modal-overlay"
            >
                <div className="custom-modal-content">
                    <button
                        type="button"
                        onClick={closeModal}
                        className="custom-close-button"
                        aria-label="Закрыть фотографии"
                    >
                        ×
                    </button>

                    {currentImages.length >
                        0 && (
                            <img
                                src={`${apiUrl}${currentImages[currentImageIndex]}`}
                                alt={`Фотография ${
                                    currentImageIndex +
                                    1
                                } из ${
                                    currentImages.length
                                }`}
                                className="custom-modal-image"
                            />
                        )}

                    {currentImages.length >
                        1 && (
                            <div className="custom-image-navigation">
                                <button
                                    type="button"
                                    onClick={
                                        prevImage
                                    }
                                    className="custom-nav-button"
                                    aria-label="Предыдущее изображение"
                                >
                                    ◀
                                </button>

                                <button
                                    type="button"
                                    onClick={
                                        nextImage
                                    }
                                    className="custom-nav-button"
                                    aria-label="Следующее изображение"
                                >
                                    ▶
                                </button>
                            </div>
                        )}
                </div>
            </Modal>
        </div>
    );
};

export default UserOrdersPage;