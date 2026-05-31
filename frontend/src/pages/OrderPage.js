import React, { useEffect, useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useParams, Link, useNavigate, useLocation } from "react-router-dom";
import axiosInstance from "../utils/axiosInstance";
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

const OrderPage = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { id } = useParams();

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
    const [requestLoading, setRequestLoading] = useState(false);

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

    const handleRequestOrder = async (orderId) => {
        const token = localStorage.getItem("authToken");

        if (!token) {
            toast.info("Войдите, чтобы запросить выполнение");
            navigate("/login");
            return;
        }

        try {
            setRequestLoading(true);

            await axiosInstance.post(`/orders/${orderId}/request`);

            toast.success("Запрос отправлен заказчику!");
            await fetchOrderData();
        } catch (error) {
            console.error("Ошибка при запросе на выполнение заказа:", error);
            toast.error(error.response?.data?.message || "Ошибка при запросе на выполнение заказа");
        } finally {
            setRequestLoading(false);
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

                        <div className="order-desc">
                            <span className="k">Описание</span>
                            <div className="v">{order.description || "—"}</div>
                        </div>

                        <div className="order-actions">
                            <Link
                                to={`/complaints/${order.creatorId}`}
                                className="btn btn-ghost-danger btn-inline"
                                aria-label={`Жалобы (${creator.complaintsCount || 0})`}
                            >
                                <FiAlertTriangle style={{ marginRight: 8 }} />
                                {creator.complaintsCount || 0}
                            </Link>

                            {isExpress && (
                                <ExpressRouteButtons
                                    orderId={order.expressId}
                                    canToA={true}
                                    canAToB={true}
                                    className="express-nav"
                                    buttonClassName="btn btn-ghost express-nav-btn"
                                />
                            )}

                            {canRequestRegular && (
                                <button
                                    className="btn btn-primary"
                                    onClick={() => handleRequestOrder(order.id)}
                                    disabled={requestLoading}
                                >
                                    {requestLoading ? "Отправляем..." : "Запросить выполнение"}
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