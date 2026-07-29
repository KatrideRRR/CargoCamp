import React, { useEffect, useMemo, useState, useContext, useCallback } from "react";
import { ModalContext } from "../components/modalContext";
import { Capacitor } from "@capacitor/core";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import axiosInstance from "../utils/axiosInstance";
import OrderServiceDetails from "../components/OrderServiceDetails";
import { getOrderServiceDetails } from "../utils/orderServiceDetails";
import "../styles/OrdersPage.css";
import Modal from "react-modal";
import {
    FaCreditCard,
    FaMoneyBillWave,
    FaQuestionCircle,
    FaUniversity,
} from "react-icons/fa";
import { FiAlertTriangle } from "react-icons/fi";
import { toast } from "react-toastify";
import ExpressRouteButtons from "../components/ExpressRouteButtons";

const apiUrl = process.env.REACT_APP_API_URL;

function isPensionerUser(user) {
    return (
        String(user?.userStatus || "")
            .trim()
            .toLowerCase() === "pensioner"
    );
}

function normalizeBoolean(value) {
    if (
        value === true ||
        value === 1 ||
        value === "1" ||
        value === "true"
    ) {
        return true;
    }

    if (
        value === false ||
        value === 0 ||
        value === "0" ||
        value === "false"
    ) {
        return false;
    }

    return null;
}

function getOrderTiming(order) {
    const isAsap = normalizeBoolean(
        order?.isAsap ?? order?.is_asap
    );

    if (isAsap === true) {
        return {
            type: "asap",
            label: "Срок выполнения",
            value: "Как можно скорее",
        };
    }

    const rawWorkTime =
        order?.workTime ??
        order?.work_time ??
        null;

    if (!rawWorkTime) {
        return null;
    }

    const date = new Date(rawWorkTime);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return {
        type: "scheduled",
        label: "Выполнить к",
        value: date.toLocaleString("ru-RU", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        }),
    };
}

const OrderPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { id } = useParams();

    const { openDebtModal } = useContext(ModalContext);

    const isExpressPage = location.pathname.startsWith("/express-order");

    const platform = useMemo(() => {
        const params = new URLSearchParams(window.location.search);
        const forcedPlatform = params.get("platform");

        if (forcedPlatform === "ios") return "ios";
        if (forcedPlatform === "android") return "android";
        if (forcedPlatform === "web") return "web";

        const currentPlatform = Capacitor.getPlatform();

        if (currentPlatform === "ios") return "ios";
        if (currentPlatform === "android") return "android";

        return "web";
    }, []);

    const [order, setOrder] = useState(null);
    const [creator, setCreator] = useState(null);
    const [profile, setProfile] = useState(null);
    const [error, setError] = useState(null);

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [currentImages, setCurrentImages] = useState([]);

    const [acceptLoading, setAcceptLoading] = useState(false);

    const [requestModalOpen, setRequestModalOpen] = useState(false);
    const [requestSum, setRequestSum] = useState("");
    const [requestComment, setRequestComment] = useState("");
    const [requestSubmitting, setRequestSubmitting] = useState(false);
    const userId = profile?.id || null;

    const normalizeExpressOrder = (e) => {
        if (!e) return null;

        return {
            ...e,

            id: e.id,
            express: true,
            expressId: e.id,

            creatorId: e.creatorId,
            executorId: e.executorId,

            createdAt: e.createdAt || e.created_at,
            status: e.status,

            expressType: e.type,
            taxi_courier: true,

            fromAddress: e.fromAddress,
            toAddress: e.toAddress,
            fromLat: e.fromLat,
            fromLng: e.fromLng,
            toLat: e.toLat,
            toLng: e.toLng,

            address: `${e.fromAddress || "Точка А"} → ${e.toAddress || "Точка Б"}`,

            description: e.description || "",
            proposedSum: Number(e.totalPrice ?? e.price ?? 0),
            paymentType: e.paymentType || "cash",

            images: Array.isArray(e.images) ? e.images : [],

            category: {
                name: e.type === "taxi" ? "Такси" : "Курьер",
            },

            subcategory: e.subcategory ? { name: e.subcategory } : null,
            service: null,

            is_highlighted: false,
            is_recommended: false,
        };
    };

    const fetchProfile = async () => {
        try {
            const response = await axiosInstance.get("/auth/profile");
            setProfile(response.data);
        } catch (err) {
            console.error("❌ Ошибка получения профиля:", err);
            setProfile(null);
        }
    };

    const fetchOrderData = async () => {
        try {
            setError(null);
            setOrder(null);
            setCreator(null);

            let loadedOrder;

            if (isExpressPage) {
                const token = localStorage.getItem("authToken");

                const response = await axiosInstance.get(`/express/express-orders/${id}`, {
                    headers: token ? { Authorization: `Bearer ${token}` } : {},
                });

                loadedOrder = normalizeExpressOrder(response.data?.order || response.data);
            } else {
                const response = await axiosInstance.get(`/orders/${id}`);
                loadedOrder = response.data;
            }

            if (!loadedOrder) {
                setError("Заказ не найден");
                return;
            }

            setOrder(loadedOrder);

            if (loadedOrder.creatorId) {
                const userResponse = await axiosInstance.get(`/auth/${loadedOrder.creatorId}`);
                setCreator(userResponse.data);
            } else {
                setCreator({});
            }
        } catch (err) {
            console.error("Ошибка загрузки заказа:", err);
            setError(err.response?.data?.message || "Ошибка загрузки заказа");
        }
    };

    useEffect(() => {
        fetchOrderData();
        fetchProfile();

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, isExpressPage]);

    useEffect(() => {
        const onPullToRefresh = async (e) => {
            try {
                await Promise.allSettled([
                    fetchOrderData(),
                    fetchProfile(),
                ]);
            } finally {
                e.detail?.done?.();
            }
        };

        window.addEventListener("appPullToRefresh", onPullToRefresh);

        return () => {
            window.removeEventListener("appPullToRefresh", onPullToRefresh);
        };

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, isExpressPage]);

    const openModal = (images) => {
        setCurrentImages(images || []);
        setCurrentImageIndex(0);
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setCurrentImageIndex(0);
        setCurrentImages([]);
    };

    const nextImage = () => {
        setCurrentImageIndex((prevIndex) => (prevIndex + 1) % currentImages.length);
    };

    const prevImage = () => {
        setCurrentImageIndex((prevIndex) => (prevIndex - 1 + currentImages.length) % currentImages.length);
    };

    const savePendingOrderRequest = ({ orderId, proposedSum, comment }) => {
        sessionStorage.setItem(
            "pendingOrderRequestAfterDebtPayment",
            JSON.stringify({
                orderId,
                proposedSum,
                comment: comment || "",
                returnTo: `/order/${orderId}`,
                createdAt: Date.now(),
            })
        );
    };

    const getPendingOrderRequest = () => {
        try {
            const raw = sessionStorage.getItem("pendingOrderRequestAfterDebtPayment");
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    };

    const clearPendingOrderRequest = () => {
        sessionStorage.removeItem("pendingOrderRequestAfterDebtPayment");
    };

    const openRequestModal = () => {
        if (!order?.id) return;

        const token =
            localStorage.getItem(
                "authToken"
            );

        if (!token) {
            toast.info(
                "Войдите, чтобы запросить выполнение"
            );

            navigate("/login");
            return;
        }

        const pricing =
            getOrderServiceDetails(order);

        const suggestedSum =
            pricing.recommendedPrice ??
            Number(order.proposedSum);

        setRequestSum(
            Number.isFinite(
                Number(suggestedSum)
            ) &&
            Number(suggestedSum) > 0
                ? String(
                    Math.round(
                        Number(suggestedSum)
                    )
                )
                : ""
        );

        setRequestComment("");
        setRequestModalOpen(true);
    };

    const closeRequestModal = () => {
        if (requestSubmitting) return;

        setRequestModalOpen(false);
        setRequestSum("");
        setRequestComment("");
    };

    const handleRequestSumChange = (e) => {
        const onlyDigits = e.target.value.replace(/\D/g, "");
        setRequestSum(onlyDigits);
    };

    const submitRegularOrderRequest = useCallback(
        async ({ orderId, proposedSum, comment }) => {
            const token = localStorage.getItem("authToken");

            if (!token) {
                toast.info("Войдите, чтобы запросить выполнение");
                navigate("/login");
                return false;
            }

            await axiosInstance.post(
                `/orders/${orderId}/request`,
                {
                    proposedSum,
                    comment,
                },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }
            );

            toast.success("Запрос отправлен заказчику!");
            await fetchOrderData();

            return true;
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [navigate, id, isExpressPage]
    );

    useEffect(() => {
        if (isExpressPage) return;

        const params = new URLSearchParams(window.location.search);
        const debtReturn = params.get("debtReturn") === "1";
        const resumeRequest = params.get("resumeRequest") === "1";

        if (!debtReturn || !resumeRequest) return;

        const pendingRequest = getPendingOrderRequest();

        if (!pendingRequest?.orderId || !pendingRequest?.proposedSum) {
            params.delete("debtReturn");
            params.delete("resumeRequest");

            const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
            window.history.replaceState({}, "", newUrl);

            return;
        }

        if (Number(pendingRequest.orderId) !== Number(id)) {
            return;
        }

        let cancelled = false;

        const resume = async () => {
            try {
                for (let attempt = 0; attempt < 10; attempt++) {
                    if (cancelled) return;

                    const profileRes = await axiosInstance.get("/auth/profile");
                    const debt = Number(profileRes.data?.debt || 0);

                    if (debt <= 0) {
                        await submitRegularOrderRequest({
                            orderId: pendingRequest.orderId,
                            proposedSum: pendingRequest.proposedSum,
                            comment: pendingRequest.comment || "",
                        });

                        clearPendingOrderRequest();

                        params.delete("debtReturn");
                        params.delete("resumeRequest");

                        const newUrl = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
                        window.history.replaceState({}, "", newUrl);

                        return;
                    }

                    await new Promise((resolve) => setTimeout(resolve, 1500));
                }

                toast.info("Оплата ещё обрабатывается. Попробуйте отправить запрос ещё раз через пару секунд.");
            } catch (e) {
                console.error("resume request after debt payment error:", e);
                toast.error("Не удалось автоматически отправить запрос после оплаты");
            }
        };

        resume();

        return () => {
            cancelled = true;
        };
    }, [id, isExpressPage, submitRegularOrderRequest]);

    const submitRequestFromModal = async () => {
        if (!order?.id) {
            toast.error("Заказ не выбран");
            return;
        }

        const token = localStorage.getItem("authToken");

        if (!token) {
            toast.info("Войдите, чтобы запросить выполнение");
            navigate("/login");
            return;
        }

        const normalizedSum = Number(requestSum);

        if (!Number.isFinite(normalizedSum) || normalizedSum <= 0) {
            toast.error("Введите сумму цифрами");
            return;
        }

        try {
            setRequestSubmitting(true);

            const statusRes = await axiosInstance.get("/orders/me/status", {
                headers: {
                    Authorization: `Bearer ${token}`,
                },
            });

            const debt = Number(statusRes.data?.debt || 0);

            if (debt > 0) {
                savePendingOrderRequest({
                    orderId: order.id,
                    proposedSum: normalizedSum,
                    comment: requestComment.trim(),
                });

                closeRequestModal();

                openDebtModal({
                    title: "Есть задолженность по комиссии",
                    description:
                        "Чтобы отправить запрос на этот заказ, сначала оплатите задолженность. После оплаты запрос отправится автоматически.",
                    amount: debt,
                    returnPath: `/order/${order.id}?debtReturn=1&resumeRequest=1`,
                });

                return;
            }

            await submitRegularOrderRequest({
                orderId: order.id,
                proposedSum: normalizedSum,
                comment: requestComment.trim(),
            });

            closeRequestModal();
        } catch (e) {
            console.error(e);
            toast.error(e.response?.data?.message || "Ошибка. Попробуйте позже.");
        } finally {
            setRequestSubmitting(false);
        }
    };



    const handleAcceptExpress = async () => {
        if (!order?.expressId) return;

        const token = localStorage.getItem("authToken");

        if (!token) {
            toast.info("Войдите, чтобы принять заказ");
            navigate("/login");
            return;
        }

        const confirmed = window.confirm(
            `Вы уверены, что хотите взять в работу экспресс-заказ №${order.expressId}?`
        );

        if (!confirmed) return;

        try {
            setAcceptLoading(true);

            await axiosInstance.post(`/express/express-orders/${order.expressId}/accept`);

            toast.success("Экспресс-заказ принят!");
            navigate("/active-orders");
        } catch (e) {
            console.error("Ошибка принятия express-заказа:", e);
            toast.error(e.response?.data?.message || "Ошибка принятия заказа");
        } finally {
            setAcceptLoading(false);
        }
    };

    const getPaymentIcon = (type) => {
        switch (type) {
            case "guarantee":
                return <FaUniversity title="Гарантия" />;
            case "cash":
                return <FaMoneyBillWave title="Наличные" />;
            case "installment":
            case "installments":
                return <FaCreditCard title="Рассрочка" />;
            default:
                return <FaQuestionCircle title="Неизвестно" />;
        }
    };

    const buildServiceLine = (o) => {
        if (o?.express) {
            if (o.expressType === "taxi") return "Такси";
            if (o.expressType === "courier") return "Курьер";
            return "Экспресс-заказ";
        }

        const parts = [
            o?.category?.name,
            o?.subcategory?.name,
            o?.service?.name,
        ].filter(Boolean);

        return parts.length ? parts.join(" • ") : "Не указано";
    };

    const getPaymentLabel = (type) => {
        switch (type) {
            case "guarantee":
                return "Гарантия";
            case "cash":
                return "Наличные";
            case "installment":
            case "installments":
                return "Рассрочка";
            default:
                return "Неизвестно";
        }
    };

    const getStatusLabel = (status) => {
        const map = {
            created: "Ожидает исполнителя",
            pending: "Ожидает исполнителя",
            accepted: "Принят",
            on_the_way_to_A: "В пути к точке А",
            arrived_at_A: "На месте",
            waiting_at_A: "Ожидание",
            picked_up: "Посылка забрана",
            in_progress: "Выполняется",
            completed: "Завершён",
            cancelled: "Отменён",
        };

        return map[status] || status || "—";
    };

    if (error) {
        return <div className="error-message">Ошибка: {error}</div>;
    }

    if (!order || !creator) {
        return <div className="loading">Загрузка...</div>;
    }

    const isExpress = !!order.express;
    const displayId = isExpress ? order.expressId : order.id;

    const isPensionerOrder =
        !isExpress &&
        isPensionerUser(creator);

    const baseCommissionRub =
        order.is_recommended
            ? 100
            : 200;

    const discountedCommissionRub =
        baseCommissionRub / 2;

    const orderTiming = isExpress
        ? null
        : getOrderTiming(order);

    const description =
        typeof order.description === "string"
            ? order.description.trim()
            : "";

    const hasDescription = description.length > 0;

    const titleText = isExpress ? `Экспресс №${displayId}` : `Заказ №${displayId}`;
    const routeLabel = isExpress ? "Маршрут" : "Адрес";

    const canRequestRegular =
        !isExpress &&
        Number(userId) !== Number(order.creatorId) &&
        !order.executorId &&
        order.status === "pending";

    const canAcceptExpress =
        isExpress &&
        Number(userId) !== Number(order.creatorId) &&
        !order.executorId &&
        ["pending", "created"].includes(String(order.status || "pending"));

    const canTakeOrder = canRequestRegular || canAcceptExpress;

    return (
        <div className={`orders-page orders-page--${platform} order-detail-page`}>
            <div className="orders-shell">

                <div className="orders-top glass">
                    <div className="orders-top-left">
                        <div className="orders-title">{titleText}</div>

                        <div className="orders-subtitle">
                            от <b>{creator.username || "пользователя"}</b> •{" "}
                            {new Date(order.createdAt).toLocaleString()}
                        </div>
                    </div>

                    <div className="orders-top-right">
                        <button className="btn btn-ghost" onClick={() => navigate(-1)}>
                            Назад
                        </button>
                    </div>
                </div>

                <ul className="orders-list">
                    <li
                        key={order.id}
                        className={[
                            "order-card",
                            "glass",

                            // обычный чужой заказ, который можно запросить — синий
                            !isExpress && canRequestRegular ? "can-take" : "",

                            // express-заказ, который можно принять — зелёный
                            isExpress && canAcceptExpress ? "express-can-take" : "",

                            // свой заказ не подсвечиваем, только можно бейджом отметить
                            Number(order.creatorId) === Number(userId) ? "my-order" : "",

                            order.is_highlighted ? "highlighted" : "",
                            order.is_recommended ? "recommended" : "",

                            // courier оставляем только если это express/detail, но зелёный can-take будет главнее
                            order.taxi_courier ? "courier" : "",

                            isExpress ? "express-detail-card" : "",
                        ].filter(Boolean).join(" ")}
                    >
                        <div className="order-head">
                            <div className="order-head-left">
                                <div className="order-title-row">
                                    <span className="order-number">{titleText}</span>

                                    {Number(order.creatorId) === Number(userId) && (
                                        <span className="badge badge-my-order">Мой заказ</span>
                                    )}

                                    {!isExpress && canRequestRegular && (
                                        <span className="badge badge-can-take">Можно взять</span>
                                    )}

                                    {isPensionerOrder && (
                                        <span
                                            className="badge badge-pensioner-order"
                                            title={`Комиссия исполнителя снижена с ${baseCommissionRub} ₽ до ${discountedCommissionRub} ₽`}
                                        >
        Льготный заказ · комиссия −50%
    </span>
                                    )}

                                    {isExpress && canAcceptExpress && (
                                        <span className="badge badge-express-can-take">Можно принять</span>
                                    )}

                                    <span className="v">
                                        {creator.username || "—"} • рейтинг{" "}
                                        {creator.rating ? Number(creator.rating).toFixed(1) : "нет"}
                                    </span>

                                    {isExpress && (
                                        <span className="badge badge-courier">
                                            {order.expressType === "taxi" ? "Такси" : "Курьер"}
                                        </span>
                                    )}

                                    {isExpress && (
                                        <span className="badge badge-distance">
                                            {getStatusLabel(order.status)}
                                        </span>
                                    )}

                                    {order.is_recommended && (
                                        <span className="badge badge-priority">В приоритете</span>
                                    )}

                                    {!isExpress && order.taxi_courier && (
                                        <span className="badge badge-courier">Курьер / Такси</span>
                                    )}
                                </div>

                                <div className="order-meta">
                                    <span className="muted">
                                        {creator.username ? `от ${creator.username}` : "от пользователя"} •{" "}
                                        {new Date(order.createdAt).toLocaleString()}
                                    </span>
                                </div>
                            </div>

                            <div className="order-head-right">
                                <div className="pay-box">
                                    <span className="pay-icon">{getPaymentIcon(order.paymentType)}</span>

                                    <div className="pay-right">
                                        <div className="pay-price">
                                            {Number(order.proposedSum ?? 0).toLocaleString("ru-RU")} ₽
                                        </div>

                                        <div className="pay-type">{getPaymentLabel(order.paymentType)}</div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="order-grid">
                            <div className="order-col">
                                <div className="kv">
                                    <span className="k">Категория / Услуга</span>
                                    <span className="v v-line">{buildServiceLine(order)}</span>
                                </div>
                            </div>

                            <div className="order-col">
                                <div className="kv">
                                    <span className="k">{routeLabel}</span>
                                    <span className={`v ${isExpress ? "route-line" : ""}`}>
                                        {order.address || "—"}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {orderTiming && (
                            <div
                                className={`order-time-box ${
                                    orderTiming.type === "asap"
                                        ? "order-time-box--asap"
                                        : "order-time-box--scheduled"
                                }`}
                            >
        <span className="order-time-icon">
            {orderTiming.type === "asap" ? "⚡" : "🕒"}
        </span>

                                <div className="order-time-content">
            <span className="order-time-label">
                {orderTiming.label}
            </span>

                                    <span className="order-time-value">
                {orderTiming.value}
            </span>
                                </div>
                            </div>
                        )}

                        {isExpress && (
                            <div className="express-detail-route">
                                <div className="kv">
                                    <span className="k">Точка А</span>
                                    <span className="v">{order.fromAddress || "—"}</span>
                                </div>

                                <div className="kv">
                                    <span className="k">Точка Б</span>
                                    <span className="v">{order.toAddress || "—"}</span>
                                </div>
                            </div>
                        )}

                        {Array.isArray(order.images) && order.images.length > 0 && (
                            <div className="thumbs" onClick={() => openModal(order.images)}>
                                {order.images.slice(0, 4).map((img, idx) => (
                                    <img
                                        key={idx}
                                        className="thumb"
                                        src={`${apiUrl}${img}`}
                                        alt={`img-${idx}`}
                                    />
                                ))}

                                {order.images.length > 4 && (
                                    <div className="thumb-more">+{order.images.length - 4}</div>
                                )}
                            </div>
                        )}

                        {hasDescription && (
                            <div className="order-desc">
                                <span className="k">Описание</span>
                                <div className="v">{description}</div>
                            </div>
                        )}

                        {!isExpress && (
                            <OrderServiceDetails
                                order={order}
                            />
                        )}

                        {isPensionerOrder && (
                            <div className="pensioner-order-notice">
        <span className="pensioner-order-notice__icon">
            %
        </span>

                                <div className="pensioner-order-notice__content">
            <span className="pensioner-order-notice__title">
                Льготный заказ
            </span>

                                    <span className="pensioner-order-notice__text">
                Заказ создан пользователем со статусом пенсионера.
                Комиссия исполнителя снижена вдвое:{" "}
                                        <strong>
                    {discountedCommissionRub} ₽ вместо {baseCommissionRub} ₽
                </strong>.
            </span>
                                </div>
                            </div>
                        )}

                        <div className="order-actions">
                            <Link
                                to={`/complaints/${order.creatorId}`}
                                className="btn btn-ghost-danger btn-inline complaint-btn"
                                aria-label={`Жалобы (${creator.complaintsCount || 0})`}
                            >
                                <FiAlertTriangle
                                    className="complaint-btn-icon"
                                    aria-hidden="true"
                                />

                                <span className="complaint-btn-count">
        {creator.complaintsCount || 0}
    </span>
                            </Link>

                            {isExpress && (
                                <ExpressRouteButtons
                                    order={order}
                                    navMode="toA"
                                    className="express-nav--detail"
                                    buttonClassName="btn btn-ghost express-nav-btn"
                                />
                            )}

                            {canRequestRegular && (
                                <button
                                    className="btn btn-primary"
                                    onClick={openRequestModal}
                                    disabled={requestSubmitting}
                                >
                                    Запросить выполнение
                                </button>
                            )}

                            {canAcceptExpress && (
                                <button
                                    className="btn btn-primary"
                                    onClick={handleAcceptExpress}
                                    disabled={acceptLoading}
                                >
                                    {acceptLoading ? "Принимаем..." : "Принять"}
                                </button>
                            )}

                            {isExpress && Number(userId) === Number(order.creatorId) && (
                                <button
                                    className="btn btn-ghost"
                                    onClick={() => navigate("/active-orders?view=created")}
                                >
                                    Мои активные
                                </button>
                            )}
                        </div>
                    </li>
                </ul>

                <Modal
                    appElement={document.getElementById("root")}
                    isOpen={requestModalOpen}
                    onRequestClose={closeRequestModal}
                    contentLabel="Запросить выполнение"
                    className="request-order-modal"
                    overlayClassName="request-order-overlay"
                    parentSelector={() => document.body}
                >
                    <div className="request-order-content">
                        <button
                            type="button"
                            className="request-order-close"
                            onClick={closeRequestModal}
                            disabled={requestSubmitting}
                            aria-label="Закрыть"
                        >
                            ×
                        </button>

                        <h2 className="request-order-title">Запросить выполнение</h2>

                        <p className="request-order-subtitle">
                            Укажите сумму, за которую готовы выполнить заказ, и при желании добавьте комментарий заказчику.
                        </p>

                        <div className="request-order-field">
                            <label>Ваша сумма, ₽</label>

                            <input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                value={requestSum}
                                onChange={handleRequestSumChange}
                                placeholder="Например: 2500"
                                className="request-order-input"
                                autoFocus
                            />
                        </div>

                        <div className="request-order-field">
                            <label>Комментарий</label>

                            <textarea
                                value={requestComment}
                                onChange={(e) => setRequestComment(e.target.value)}
                                placeholder="Например: могу приехать сегодня после 18:00"
                                className="request-order-textarea"
                                rows={4}
                                maxLength={500}
                            />
                        </div>

                        <div className="request-order-actions">
                            <button
                                type="button"
                                className="request-order-btn ghost"
                                onClick={closeRequestModal}
                                disabled={requestSubmitting}
                            >
                                Отмена
                            </button>

                            <button
                                type="button"
                                className="request-order-btn primary"
                                onClick={submitRequestFromModal}
                                disabled={requestSubmitting || !requestSum}
                            >
                                {requestSubmitting ? "Отправляем..." : "Отправить запрос"}
                            </button>
                        </div>
                    </div>
                </Modal>

                <Modal
                    appElement={document.getElementById("root")}
                    isOpen={isModalOpen}
                    onRequestClose={closeModal}
                    contentLabel="Full Image Modal"
                    className="custom-modal"
                    overlayClassName="custom-modal-overlay"
                    parentSelector={() => document.body}
                >
                    <div className="custom-modal-content">
                        <button onClick={closeModal} className="custom-close-button">✖</button>

                        {currentImages.length > 0 && (
                            <img
                                src={`${apiUrl}${currentImages[currentImageIndex]}`}
                                alt="Full-size view"
                                className="custom-modal-image"
                            />
                        )}

                        {currentImages.length > 1 && (
                            <div className="custom-image-navigation">
                                <button onClick={prevImage} className="custom-nav-button">◀</button>
                                <button onClick={nextImage} className="custom-nav-button">▶</button>
                            </div>
                        )}
                    </div>
                </Modal>
            </div>
        </div>
    );
};

export default OrderPage;