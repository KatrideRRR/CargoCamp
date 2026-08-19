import React, { useContext, useEffect, useMemo, useState } from "react";
import { Capacitor } from "@capacitor/core";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import OrderServiceDetails from "../components/OrderServiceDetails";
import "../styles/ActiveOrdersPage.css";
import { useAuth } from "../utils/authContext";
import { socket, connectSocket } from "../socketClient";
import { useMediaQuery } from "react-responsive";
import { FaPhone, FaComments, FaRoute, FaCheck, FaExclamationTriangle, FaPlay } from "react-icons/fa";
import Modal from "react-modal";
import axiosInstance from "../utils/axiosInstance";
import { FaUniversity, FaMoneyBillWave, FaCreditCard, FaQuestionCircle } from "react-icons/fa";
import ExpressOrderCard from "../components/ExpressOrderCard";
import { ModalContext } from "../components/modalContext";
import { openOrderRoute } from "../utils/orderNavigation";
import OrderWorkTimer from "../components/OrderWorkTimer";

const apiUrl = process.env.REACT_APP_API_URL;

const hasDescription = (value) =>
    typeof value === "string" && value.trim().length > 0;

const makeDisputeKey = (
    orderType,
    orderId
) => {
    return `${orderType}:${orderId}`;
};

const parseServiceDetails = (value) => {
    if (!value) {
        return {};
    }

    if (
        typeof value === "object" &&
        !Array.isArray(value)
    ) {
        return value;
    }

    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);

            return parsed &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
                ? parsed
                : {};
        } catch {
            return {};
        }
    }

    return {};
};

const isHourlyOrder = (order) => {
    const details =
        parseServiceDetails(
            order?.serviceDetails
        );

    const calculator =
        String(
            details?.pricingCalculator ||
            ""
        );

    /*
     * Только эти типы действительно
     * рассчитываются по фактическому
     * времени выполнения.
     */
    return [
        "cargo_hourly",
        "loaders",
    ].includes(calculator);
};

const getWorkEndTime = (order) => {
    return (
        order?.workEndedAt ||
        (
            order?.status === "completed"
                ? order?.completedAt
                : null
        ) ||
        null
    );
};

const getWorkDurationMs = (
    startedAt,
    endedAt = null
) => {
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
        !Number.isFinite(endTime) ||
        endTime <= startTime
    ) {
        return 0;
    }

    return endTime - startTime;
};

const formatWorkTimer = (durationMs) => {
    const totalSeconds = Math.max(
        0,
        Math.floor(durationMs / 1000)
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
};

const formatWorkDurationText = (
    durationMs
) => {
    const totalMinutes = Math.max(
        0,
        Math.ceil(durationMs / 60000)
    );

    const hours = Math.floor(
        totalMinutes / 60
    );

    const minutes =
        totalMinutes % 60;

    if (hours > 0 && minutes > 0) {
        return `${hours} ч ${minutes} мин`;
    }

    if (hours > 0) {
        return `${hours} ч`;
    }

    return `${minutes} мин`;
};

const calculateHourlyCompletionPrice = ({
                                            durationMs,
                                            firstHourPrice,
                                            nextHourPrice,
                                            minimumHours = 1,
                                        }) => {
    const safeDurationMs = Math.max(
        0,
        Number(durationMs) || 0
    );

    const safeFirstHourPrice = Math.max(
        0,
        Number(firstHourPrice) || 0
    );

    const safeNextHourPrice = Math.max(
        0,
        Number(nextHourPrice) || 0
    );

    const safeMinimumHours = Math.max(
        1,
        Number(minimumHours) || 1
    );

    if (
        safeFirstHourPrice <= 0 ||
        safeNextHourPrice <= 0
    ) {
        return null;
    }

    const actualMinutes =
        safeDurationMs / 60000;

    /*
     * Один расчётный блок = 30 минут.
     */
    const minimumHalfHourBlocks =
        Math.ceil(
            safeMinimumHours * 2
        );

    /*
     * Фактическое время округляем вверх
     * до 30 минут, но не ниже минимального
     * оплачиваемого периода.
     */
    const billedHalfHourBlocks =
        Math.max(
            minimumHalfHourBlocks,
            Math.ceil(
                actualMinutes / 30
            )
        );

    const billedHours =
        billedHalfHourBlocks / 2;

    /*
     * firstHourPrice содержит стоимость
     * первого часа + все одноразовые
     * начисления.
     */
    const extraHours =
        Math.max(
            0,
            billedHours - 1
        );

    const extraTimePrice =
        extraHours *
        safeNextHourPrice;

    const totalPrice =
        safeFirstHourPrice +
        extraTimePrice;

    return {
        actualMinutes:
            Math.max(
                0,
                Math.ceil(
                    actualMinutes
                )
            ),

        billedHours,

        minimumHours:
        safeMinimumHours,

        extraHours,

        firstHourPrice:
        safeFirstHourPrice,

        nextHourPrice:
        safeNextHourPrice,

        extraTimePrice:
            Math.round(
                extraTimePrice
            ),

        totalPrice:
            Math.round(
                totalPrice
            ),
    };
};

function getContractUrl(contractPath) {
    if (!contractPath) {
        return null;
    }

    if (/^https?:\/\//i.test(contractPath)) {
        return contractPath;
    }

    const normalizedPath =
        String(contractPath).startsWith("/")
            ? String(contractPath)
            : `/${contractPath}`;

    return `${apiUrl}${normalizedPath}`;
}

const REGULAR_DISPUTE_REASONS = [
    {
        value: "work_not_done",
        label: "Работа не выполнена",
    },
    {
        value: "poor_quality",
        label: "Низкое качество работы",
    },
    {
        value: "missed_deadline",
        label: "Нарушены сроки",
    },
    {
        value: "wrong_price",
        label: "Спор по стоимости",
    },
    {
        value: "rude_behavior",
        label: "Некорректное поведение",
    },
    {
        value: "other",
        label: "Другое",
    },
];

const EXPRESS_CREATOR_DISPUTE_REASONS = [
    {
        value: "executor_no_show",
        label: "Исполнитель не приехал",
    },
    {
        value: "executor_late",
        label: "Исполнитель сильно опоздал",
    },
    {
        value: "poor_quality",
        label: "Низкое качество услуги",
    },
    {
        value: "wrong_price",
        label: "Проблема со стоимостью",
    },
    {
        value: "rude_behavior",
        label: "Некорректное поведение исполнителя",
    },
    {
        value: "damaged_property",
        label: "Повреждение имущества или груза",
    },
    {
        value: "service_problem",
        label: "Проблема с поездкой или доставкой",
    },
    {
        value: "other",
        label: "Другое",
    },
];

const EXPRESS_EXECUTOR_DISPUTE_REASONS = [
    {
        value: "customer_no_show",
        label: "Заказчик не появился",
    },
    {
        value: "customer_unreachable",
        label: "Не удаётся связаться с заказчиком",
    },
    {
        value: "wrong_address",
        label: "Неверный адрес или маршрут",
    },
    {
        value: "order_mismatch",
        label: "Условия заказа не соответствуют описанию",
    },
    {
        value: "payment_problem",
        label: "Проблема с оплатой",
    },
    {
        value: "unsafe_situation",
        label: "Небезопасная ситуация",
    },
    {
        value: "rude_behavior",
        label: "Некорректное поведение заказчика",
    },
    {
        value: "other",
        label: "Другое",
    },
];

const ActiveOrdersPage = () => {
    const navigate = useNavigate();
    const { user } = useAuth();

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

    const {
        openCompletionSuccessModal,
        openReviewFromCompletion,
    } = useContext(ModalContext);
    const isMobile = useMediaQuery({ maxWidth: 768 });

    const [orders, setOrders] = useState([]);
    const [expressOrders, setExpressOrders] = useState([]);

    const [activeView, setActiveView] = useState(() => {
        const params = new URLSearchParams(window.location.search);
        const view = params.get("view");

        if (view === "created") return "created";
        if (view === "performing") return "performing";

        return "performing";
    });

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const view = params.get("view");

        if (view === "created") {
            setActiveView("created");
        }

        if (view === "performing") {
            setActiveView("performing");
        }
    }, []);

    const [error, setError] = useState(null);

    // модалка картинок обычных заказов
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const [currentImages, setCurrentImages] = useState([]);

    // инфо о пользователях (для обычных заказов)
    const [creatorsInfo, setCreatorsInfo] = useState({});
    const [executorsInfo, setExecutorsInfo] = useState({});

    //споры
    const [isDisputeModalOpen, setIsDisputeModalOpen] = useState(false);
    const [selectedOrderForDispute, setSelectedOrderForDispute] = useState(null);
    const [disputeReasonCode, setDisputeReasonCode] = useState("poor_quality");
    const [disputeReason, setDisputeReason] = useState("");
    const [disputeDescription, setDisputeDescription] = useState("");
    const [disputeLoading, setDisputeLoading] = useState(false);
    const [orderDisputes, setOrderDisputes] = useState({});

    const [selectedDisputeOrderType, setSelectedDisputeOrderType] =
        useState("regular");

    // “удаленные” обычные заказы
    const [removedOrders, setRemovedOrders] = useState(() => {
        const saved = localStorage.getItem("removedOrders");
        return saved ? JSON.parse(saved) : [];
    });

    const [
        completionModalOrder,
        setCompletionModalOrder,
    ] = useState(null);

    const [
        completionSubmitting,
        setCompletionSubmitting,
    ] = useState(false);

    const [photoUploading, setPhotoUploading] = useState({});
    const [startingWork, setStartingWork] = useState({});

    // непрочитанные сообщения (обычные заказы)
    const [unreadOrders, setUnreadOrders] = useState({});

    // сохраняем removedOrders
    useEffect(() => {
        localStorage.setItem("removedOrders", JSON.stringify(removedOrders));
    }, [removedOrders]);

    const token = useMemo(() => localStorage.getItem("authToken"), []);

    // --- helpers ---
    const getPaymentIcon = (type) => {
        switch (type) {
            case "guarantee":
                return <FaUniversity title="Tinkoff" />;
            case "cash":
                return <FaMoneyBillWave title="Наличные" />;
            case "installments":
                return <FaCreditCard title="Карта" />;
            default:
                return <FaQuestionCircle title="Неизвестно" />;
        }
    };

    const disputeIsCreator =
        Number(selectedOrderForDispute?.creatorId) ===
        Number(user?.id);

    const disputeReasonOptions = useMemo(() => {
        if (selectedDisputeOrderType === "regular") {
            return REGULAR_DISPUTE_REASONS;
        }

        if (disputeIsCreator) {
            return EXPRESS_CREATOR_DISPUTE_REASONS;
        }

        return EXPRESS_EXECUTOR_DISPUTE_REASONS;
    }, [
        selectedDisputeOrderType,
        disputeIsCreator,
    ]);

    const normalizePhoneForTel = (rawPhone) => {
        let digits = String(rawPhone || "").replace(/\D/g, "");

        if (!digits) return null;

        // 8 978 003-29-78 -> 79780032978
        if (digits.length === 11 && digits.startsWith("8")) {
            digits = `7${digits.slice(1)}`;
        }

        // 9780032978 -> 79780032978
        if (digits.length === 10) {
            digits = `7${digits}`;
        }

        // Российский номер должен быть 11 цифр и начинаться с 7
        if (digits.length === 11 && digits.startsWith("7")) {
            return `+${digits}`;
        }

        return null;
    };

    const callPhone = (rawPhone) => {
        const phoneForTel = normalizePhoneForTel(rawPhone);

        if (!phoneForTel) {
            alert("Некорректный номер телефона");
            return;
        }

        window.location.href = `tel:${encodeURIComponent(phoneForTel)}`;
    };

    const buildCompletionPayload = ({ order, orderType }) => {
        if (!order) return null;

        if (orderType === "express") {
            return {
                orderId: order.id,
                orderType: "express",
                title: `Экспресс-заказ №${order.id} выполнен.`,
                amount: Number(order.totalPrice || 0),
                startedAt: order.startedAt || null,
                completedAt: order.completedAt || null,
                creatorId: order.creatorId,
                executorId: order.executorId,
            };
        }

        return {
            orderId: order.id,
            orderType: "regular",
            title:
                `Заказ №${order.id} выполнен.`,

            amount:
                Number(
                    order.proposedSum || 0
                ),

            startedAt:
                order.workStartedAt ||
                null,

            /*
             * Для длительности используем
             * фактическое окончание работы.
             *
             * completedAt — только запасной вариант
             * для старых заказов.
             */
            completedAt:
                order.workEndedAt ||
                order.completedAt ||
                null,

            creatorId:
            order.creatorId,

            executorId:
            order.executorId,
        };
    };

    const openDisputeModal = (order, orderType = "regular") => {
        if (!order?.id) {
            return;
        }

        const isCreator =
            Number(order.creatorId) ===
            Number(user?.id);

        let reasons;

        if (orderType === "express") {
            reasons = isCreator
                ? EXPRESS_CREATOR_DISPUTE_REASONS
                : EXPRESS_EXECUTOR_DISPUTE_REASONS;
        } else {
            reasons = REGULAR_DISPUTE_REASONS;
        }

        setSelectedOrderForDispute(order);
        setSelectedDisputeOrderType(orderType);

        setDisputeReasonCode(
            reasons[0]?.value || "other"
        );

        setDisputeReason("");
        setDisputeDescription("");

        setIsDisputeModalOpen(true);
    };

    const closeDisputeModal = () => {
        setIsDisputeModalOpen(false);

        setSelectedOrderForDispute(null);
        setSelectedDisputeOrderType("regular");

        setDisputeReasonCode("work_not_done");
        setDisputeReason("");
        setDisputeDescription("");

        setDisputeLoading(false);
    };



    const fetchOrderDispute = async (
        orderId,
        orderType = "regular"
    ) => {
        try {
            const t =
                localStorage.getItem("authToken");

            if (!t) {
                return null;
            }

            const res = await axios.get(
                `${apiUrl}/api/disputes/order/${orderType}/${orderId}`,
                {
                    headers: {
                        Authorization: `Bearer ${t}`,
                    },
                }
            );

            const dispute =
                res.data?.dispute || null;

            if (!dispute) {
                return null;
            }

            const disputeKey =
                `${orderType}:${orderId}`;

            setOrderDisputes((prev) => ({
                ...prev,
                [disputeKey]: dispute,
            }));

            return dispute;

        } catch (e) {
            if (e?.response?.status !== 404) {
                console.error(
                    `Ошибка получения спора ${orderType} #${orderId}:`,
                    e
                );
            }

            return null;
        }
    };

    const submitDispute = async () => {
        try {
            const t = localStorage.getItem("authToken");

            if (!t) {
                alert("Вы не авторизованы");
                navigate("/login");
                return;
            }

            if (!selectedOrderForDispute?.id) {
                alert("Заказ не выбран");
                return;
            }

            if (!disputeReason.trim()) {
                alert("Укажите краткую причину проблемы");
                return;
            }

            if (!disputeReasonCode) {
                alert("Выберите причину");
                return;
            }

            setDisputeLoading(true);

            const res = await axios.post(
                `${apiUrl}/api/disputes/open`,
                {
                    orderId: selectedOrderForDispute.id,

                    // ✅ ВАЖНО
                    orderType: selectedDisputeOrderType,

                    reasonCode: disputeReasonCode,
                    reason: disputeReason.trim(),
                    description: disputeDescription.trim(),
                },
                {
                    headers: {
                        Authorization: `Bearer ${t}`,
                    },
                }
            );

            if (res.data?.dispute) {
                const disputeKey =
                    `${selectedDisputeOrderType}:${selectedOrderForDispute.id}`;

                setOrderDisputes((prev) => ({
                    ...prev,
                    [disputeKey]: res.data.dispute,
                }));
            }

            alert("Обращение успешно отправлено");
            closeDisputeModal();
        } catch (e) {
            console.error("Ошибка открытия спора:", e);

            alert(
                e?.response?.data?.message ||
                "Не удалось отправить обращение"
            );
        } finally {
            setDisputeLoading(false);
        }
    };

    const buildServiceLine = (o) => {
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

    const normalizePhotoArray = (value) => {
        if (Array.isArray(value)) {
            return value.filter(Boolean);
        }

        if (typeof value === "string") {
            try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
            } catch {
                return [];
            }
        }

        return [];
    };

    const openModal = (images, startIndex = 0) => {
        const normalizedImages = normalizePhotoArray(images);

        if (normalizedImages.length === 0) {
            return;
        }

        const safeIndex =
            startIndex >= 0 && startIndex < normalizedImages.length
                ? startIndex
                : 0;

        setCurrentImages(normalizedImages);
        setCurrentImageIndex(safeIndex);
        setIsModalOpen(true);
    };

    const closeModal = () => {
        setIsModalOpen(false);
        setCurrentImageIndex(0);
        setCurrentImages([]);
    };

    const nextImage = () => {
        if (!currentImages.length) return;
        setCurrentImageIndex((prev) => (prev + 1) % currentImages.length);
    };

    const prevImage = () => {
        if (!currentImages.length) return;
        setCurrentImageIndex((prev) => (prev - 1 + currentImages.length) % currentImages.length);
    };

    const makeRemovedOrderKey = (orderId, view = activeView) => {
        return `${user.id}_${view}_${orderId}`;
    };

    const handleRemoveOrder = (orderId) => {
        const key = makeRemovedOrderKey(orderId);

        setRemovedOrders((prev) => {
            const updated = prev.includes(key) ? prev : [...prev, key];
            localStorage.setItem("removedOrders", JSON.stringify(updated));
            return updated;
        });

        setOrders((prev) =>
            prev.filter((o) => makeRemovedOrderKey(o.id) !== key)
        );
    };

    const handleRouteClick = async (order) => {
        try {
            await openOrderRoute(order, {
                orderType: "regular",
                target: "auto",
            });
        } catch (error) {
            console.error(
                "Ошибка открытия маршрута обычного заказа:",
                error
            );

            alert("Не удалось открыть маршрут");
        }
    };

    const getUserPhone = async (userIdToGet) => {
        try {
            const t = localStorage.getItem("authToken");
            const res = await axios.get(`${apiUrl}/api/auth/user/${userIdToGet}`, {
                headers: { Authorization: `Bearer ${t}` },
            });
            return res.data?.phone;
        } catch (e) {
            console.error("Ошибка при получении телефона:", e);
            return null;
        }
    };

    const uploadOrderPhotos = async (orderId, type, filesLike) => {
        const uploadKey = `${orderId}_${type}`;

        try {
            const t = localStorage.getItem("authToken");

            if (!t) {
                alert("Вы не авторизованы");
                navigate("/login");
                return;
            }

            const files = Array.from(filesLike || []);

            if (files.length === 0) {
                alert("Выберите хотя бы одно фото");
                return;
            }

            setPhotoUploading((prev) => ({
                ...prev,
                [uploadKey]: true,
            }));

            const formData = new FormData();

            files.forEach((file, index) => {

                const fileName =
                    file?.name ||
                    `photo_${Date.now()}_${index}.jpg`;

                formData.append("images", file, fileName);
            });

            const endpointMap = {
                executorBefore:
                    `/orders/${orderId}/executor-before-photos`,
                executorAfter:
                    `/orders/${orderId}/executor-after-photos`,
                customerBefore:
                    `/orders/${orderId}/customer-before-photos`,
                customerAfter:
                    `/orders/${orderId}/customer-after-photos`,
            };

            const endpoint = endpointMap[type];

            if (!endpoint) {
                alert("Неизвестный тип загрузки");
                return;
            }

            const response = await axios.post(
                `${apiUrl}/api${endpoint}`,
                formData,
                {
                    headers: {
                        Authorization: `Bearer ${t}`,
                    },
                    timeout: 120000,
                }
            );


            if (!response.data?.success) {
                throw new Error("Сервер не сохранил фотографии");
            }

            await fetchActiveOrders();

            alert(
                files.length === 1
                    ? "Фотография успешно загружена ✅"
                    : `Фотографии успешно загружены: ${files.length} ✅`
            );
        } catch (e) {
            console.error("Ошибка загрузки фото:", {
                message: e?.message,
                status: e?.response?.status,
                data: e?.response?.data,
            });

            alert(
                e?.response?.data?.message ||
                e?.message ||
                "Ошибка при загрузке фото"
            );
        } finally {
            setPhotoUploading((prev) => ({
                ...prev,
                [uploadKey]: false,
            }));
        }
    };

    const startWork = async (orderId) => {
        try {
            const t = localStorage.getItem("authToken");
            if (!t) {
                alert("Вы не авторизованы");
                navigate("/login");
                return;
            }

            setStartingWork((prev) => ({ ...prev, [orderId]: true }));

            await axiosInstance.post(`/orders/${orderId}/start-work`, {}, {
                headers: { Authorization: `Bearer ${t}` },
            });

            await fetchActiveOrders();
            alert(
                "Работа начата. Таймер запущен у обеих сторон ✅"
            );
        } catch (e) {
            console.error("Ошибка начала работы:", e);
            alert(e.response?.data?.message || "Ошибка при начале работы");
        } finally {
            setStartingWork((prev) => ({ ...prev, [orderId]: false }));
        }
    };

    const renderPhotoList = (photosValue = []) => {
        const photos = normalizePhotoArray(photosValue);

        if (photos.length === 0) {
            return <p className="photo-empty">Фото пока нет</p>;
        }

        return (
            <div className="protocol-photo-grid">
                {photos.map((photo, index) => (
                    <button
                        type="button"
                        key={`${photo}-${index}`}
                        className="protocol-photo-button"
                        onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openModal(photos, index);
                        }}
                        aria-label={`Открыть фотографию ${index + 1}`}
                    >
                        <img
                            src={`${apiUrl}${photo}`}
                            alt={`Фото протокола ${index + 1}`}
                            className="protocol-photo"
                        />
                    </button>
                ))}
            </div>
        );
    };

    const openCompletionModal = (order) => {
        if (!order?.id) {
            return;
        }

        setCompletionModalOrder(order);
    };

    const completeOrderRequest =
        async () => {
            const order =
                completionModalOrder;

            if (!order?.id) {
                return;
            }

            const orderId = order.id;

            try {
                const t =
                    localStorage.getItem(
                        "authToken"
                    );

                if (!t) {
                    alert(
                        "Вы не авторизованы"
                    );

                    navigate("/login");
                    return;
                }

                setCompletionSubmitting(true);

                const res =
                    await axiosInstance.post(
                        `/orders/complete/${orderId}`,
                        {},
                        {
                            headers: {
                                Authorization:
                                    `Bearer ${t}`,
                            },
                        }
                    );

                const updatedOrder =
                    res.data;

                setCompletionModalOrder(null);

                setOrders((previous) =>
                    previous.map((item) =>
                        Number(item.id) ===
                        Number(orderId)
                            ? updatedOrder
                            : item
                    )
                );

                await fetchActiveOrders();

                const creatorId =
                    updatedOrder?.creatorId;

                const executorId =
                    updatedOrder?.executorId;

                if (
                    updatedOrder?.status ===
                    "completed"
                ) {
                    openCompletionSuccessModal(
                        buildCompletionPayload({
                            order:
                            updatedOrder,
                            orderType:
                                "regular",
                        })
                    );
                } else {
                    alert(
                        "Вы подтвердили завершение. Ожидаем подтверждение второй стороны."
                    );
                }
            } catch (error) {
                console.error(error);

                alert(
                    error.response?.data
                        ?.message ||
                    "Ошибка при завершении заказа"
                );
            } finally {
                setCompletionSubmitting(false);
            }
        };

    const remindCompleteOrder = async (orderId) => {
        try {
            const t = localStorage.getItem("authToken");

            if (!t) {
                alert("Вы не авторизованы");
                navigate("/login");
                return;
            }

            await axiosInstance.post(
                `/orders/${orderId}/remind-complete`,
                {},
                {
                    headers: {
                        Authorization: `Bearer ${t}`,
                    },
                }
            );

            alert("Напоминание отправлено");
        } catch (e) {
            console.error("Ошибка отправки напоминания:", e);
            alert(e.response?.data?.message || "Не удалось отправить напоминание");
        }
    };

    const handleOpenChat = (orderId, orderType = "regular") => {
        socket.emit("markAsRead", {
            userId: user.id,
            orderId,
            orderType,
        });

        setUnreadOrders((prev) => {
            const updated = { ...prev };
            delete updated[`${orderType}_${orderId}`];
            return updated;
        });

        navigate(`/messages/${orderType}/${orderId}`);
    };

    // --- fetchers ---
    const fetchExpressOrders = async () => {
        try {
            const token = localStorage.getItem("authToken");
            if (!token) return;

            const r = await axios.get(`${apiUrl}/api/express/express-orders/me`, {
                headers: { Authorization: `Bearer ${token}` },
                params: { mode: "active" },
            });

            if (!r.data?.success) {

                console.error("express/me not success:", r.data);
                return;
            }

            setExpressOrders(Array.isArray(r.data.orders) ? r.data.orders : []);
        } catch (e) {
            console.error("Ошибка при загрузке express orders:", e?.response?.data || e.message);
        }
    };

    const fetchActiveOrders = async () => {
        try {
            const t = localStorage.getItem("authToken");
            if (!t) return;

            const response = await axios.get(`${apiUrl}/api/orders/active-orders`, {
                headers: { Authorization: `Bearer ${t}` },
            });

            if (!Array.isArray(response.data?.orders)) {
                console.error("❌ Ошибка: `orders` не массив!", response.data);
                return;
            }

            const serverOrders = response.data.orders;

            // creators
            const creatorIds = [...new Set(serverOrders.map((o) => o.creatorId).filter(Boolean))];
            const creatorsData = {};
            if (creatorIds.length > 0) {
                const creatorResults = await Promise.allSettled(
                    creatorIds.map((id) => axiosInstance.get(`/auth/${id}`).then((res) => ({ id, data: res.data })))
                );
                creatorResults.forEach((r) => {
                    if (r.status === "fulfilled" && r.value) creatorsData[r.value.id] = r.value.data;
                });
            }
            setCreatorsInfo(creatorsData);

            // executors
            const executorIds = [...new Set(serverOrders.map((o) => o.executorId).filter(Boolean))];
            const executorsData = {};
            if (executorIds.length > 0) {
                const executorResults = await Promise.allSettled(
                    executorIds.map((id) => axiosInstance.get(`/auth/user/${id}`).then((res) => ({ id, data: res.data })))
                );
                executorResults.forEach((r) => {
                    if (r.status === "fulfilled" && r.value) executorsData[r.value.id] = r.value.data;
                });
            }
            setExecutorsInfo(executorsData);

            // removed filter
            const filteredOrders = serverOrders.filter((o) => {
                const isExecutor = Number(o.executorId) === Number(user.id);
                const isCreator = Number(o.creatorId) === Number(user.id);

                const performingKey = `${user.id}_performing_${o.id}`;
                const createdKey = `${user.id}_created_${o.id}`;

                if (isExecutor && removedOrders.includes(performingKey)) {
                    return false;
                }

                if (isCreator && removedOrders.includes(createdKey)) {
                    return false;
                }

                return true;
            });

            setOrders(filteredOrders);

            // подгрузим данные по спорам
            const disputeEntries =
                await Promise.allSettled(
                    filteredOrders.map(
                        async (order) => {
                            try {
                                const res =
                                    await axios.get(
                                        `${apiUrl}/api/disputes/order/regular/${order.id}`,
                                        {
                                            headers: {
                                                Authorization:
                                                    `Bearer ${t}`,
                                            },
                                        }
                                    );

                                const dispute =
                                    res.data?.dispute ||
                                    null;

                                if (!dispute) {
                                    return null;
                                }

                                return {
                                    disputeKey:
                                        `regular:${order.id}`,
                                    dispute,
                                };

                            } catch (e) {
                                console.error(
                                    `Ошибка загрузки спора для заказа ${order.id}:`,
                                    e
                                );

                                return null;
                            }
                        }
                    )
                );

            const disputesMap = {};

            disputeEntries.forEach(
                (entry) => {
                    if (
                        entry.status === "fulfilled" &&
                        entry.value?.disputeKey &&
                        entry.value?.dispute
                    ) {
                        disputesMap[
                            entry.value.disputeKey
                            ] =
                            entry.value.dispute;
                    }
                }
            );

            setOrderDisputes((prev) => ({
                ...prev,
                ...disputesMap,
            }));

            // unread counts
            const notifs = Array.isArray(response.data?.notifications) ? response.data.notifications : [];
            const counts = {};
            notifs.forEach((n) => {
                if (n.type === "new_message" && n.userId === user?.id && !n.isRead) {
                    const orderId = n.orderId;
                    counts[orderId] = (counts[orderId] || 0) + 1;
                }
            });
            setUnreadOrders(counts);

            setError(null);
        } catch (err) {
            console.error("Ошибка при загрузке активных заказов:", err);
            setError("Не удалось загрузить заказы.");
        }
    };

    // --- main effect ---
    useEffect(() => {
        if (!token) {
            alert("Вы не авторизованы! Пожалуйста, войдите в систему.");
            navigate("/login");
            return;
        }

        if (!user?.id) return;

        connectSocket(user.id);

        const reloadAll = async () => {
            await Promise.allSettled([
                fetchActiveOrders(),
                fetchExpressOrders(),
            ]);
        };

        const patchExpressOrderFromPayload = (payload) => {
            if (!payload?.orderId || payload.orderType !== "express") return;

            setExpressOrders((prev) =>
                prev.map((item) =>
                    Number(item.id) === Number(payload.orderId)
                        ? {
                            ...item,
                            status: payload.status ?? item.status,
                            executorId: payload.executorId ?? item.executorId,
                            creatorId: payload.creatorId ?? item.creatorId,
                            type: payload.type ?? payload.expressType ?? item.type,
                            updatedAt: new Date().toISOString(),
                        }
                        : item
                )
            );
        };

        const onAnyOrderUpdate = (payload) => {
            patchExpressOrderFromPayload(payload);
            reloadAll();
        };

        const onConnect = () => {
            socket.emit("register", user.id);
            socket.emit("subscribeToNotifications", user.id);
            reloadAll();
        };

        socket.on("connect", onConnect);
        socket.on("reconnect", onConnect);

        socket.on("activeOrdersUpdated", onAnyOrderUpdate);
        socket.on("new_notification", onAnyOrderUpdate);

        socket.on("expressOrdersUpdated", onAnyOrderUpdate);
        socket.on("expressOrderAccepted", onAnyOrderUpdate);
        socket.on("expressOrderStatusChanged", onAnyOrderUpdate);
        socket.on("expressStatusChanged", onAnyOrderUpdate);
        socket.on("expressOrderCompleted", onAnyOrderUpdate);
        socket.on("expressOrderCompletedForExecutor", onAnyOrderUpdate);
        socket.on("expressOrderCancelled", onAnyOrderUpdate);

        reloadAll();

        return () => {
            socket.off("connect", onConnect);
            socket.off("reconnect", onConnect);

            socket.off("activeOrdersUpdated", onAnyOrderUpdate);
            socket.off("new_notification", onAnyOrderUpdate);

            socket.off("expressOrdersUpdated", onAnyOrderUpdate);
            socket.off("expressOrderAccepted", onAnyOrderUpdate);
            socket.off("expressOrderStatusChanged", onAnyOrderUpdate);
            socket.off("expressStatusChanged", onAnyOrderUpdate);
            socket.off("expressOrderCompleted", onAnyOrderUpdate);
            socket.off("expressOrderCompletedForExecutor", onAnyOrderUpdate);
            socket.off("expressOrderCancelled", onAnyOrderUpdate);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [navigate, user?.id, token]);

    // --- pull to refresh ---
    useEffect(() => {
        const onPullToRefresh = async (e) => {
            try {
                await Promise.allSettled([
                    fetchActiveOrders(),
                    fetchExpressOrders(),
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
    }, [user?.id, removedOrders]);

    if (!user || !user.id) return <p>Загрузка...</p>;
    if (error) return <div className="error-message">{error}</div>;

    const performingOrders = orders.filter((order) => Number(order.executorId) === Number(user.id));
    const createdOrders = orders.filter((order) => Number(order.creatorId) === Number(user.id));

    const performingExpressOrders = expressOrders.filter(
        (order) => Number(order.executorId) === Number(user.id)
    );

    const createdExpressOrders = expressOrders.filter(
        (order) => Number(order.creatorId) === Number(user.id)
    );

    const targetOrderId = new URLSearchParams(window.location.search).get("orderId");

    const sortTargetOrderFirst = (list) => {
        if (!targetOrderId) return list;

        return [...list].sort((a, b) => {
            if (String(a.id) === String(targetOrderId)) return -1;
            if (String(b.id) === String(targetOrderId)) return 1;
            return 0;
        });
    };

    const visibleRegularOrders =
        activeView === "performing"
            ? sortTargetOrderFirst(performingOrders).slice(0, 1)
            : sortTargetOrderFirst(createdOrders);

    const visibleExpressOrders =
        activeView === "performing"
            ? (performingOrders.length > 0 ? [] : performingExpressOrders.slice(0, 1))
            : createdExpressOrders;

    const hasAnyVisible =
        visibleRegularOrders.length > 0 || visibleExpressOrders.length > 0;

    const hasAny = hasAnyVisible;

    return (
        <div className={`active-orders active-orders--${platform}`}>
            <div className="pageContainer">
                <div className="active-orders-page">
                    <div className="active-orders-container">
                        <div className="contentWrapper">

                            <div className="active-orders-topbar">
                                <div className="active-orders-title-wrap">
                                    <div className="active-orders-title">Активные заказы</div>
                                    <div className="active-orders-subtitle">
                                        {activeView === "performing"
                                            ? "Заказы, которые вы сейчас выполняете"
                                            : "Ваши заказы, которые сейчас выполняются"}
                                    </div>
                                </div>

                                <div className="active-orders-switch">
                                    <button
                                        className={`active-switch-btn ${activeView === "performing" ? "active" : ""}`}
                                        onClick={() => setActiveView("performing")}
                                    >
                                        Я выполняю
                                    </button>

                                    <button
                                        className={`active-switch-btn ${activeView === "created" ? "active" : ""}`}
                                        onClick={() => setActiveView("created")}
                                    >
                                        Мои заказы выполняют
                                    </button>
                                </div>
                            </div>

                            {hasAny ? (
                                <ul className="orders-list">
                                    {/* обычные активные заказы */}
                                    {visibleRegularOrders.map((order) => {
                                        const completedBy = Array.isArray(order.completedBy)
                                            ? order.completedBy.map((id) => Number(id)).filter(Number.isFinite)
                                            : [];

                                        const isCompletedByUser = completedBy.includes(Number(user.id));

                                        const isWaitingForOther =
                                            order.status !== "completed" &&
                                            completedBy.length === 1 &&
                                            isCompletedByUser;

                                        const isWaitingForMe =
                                            order.status !== "completed" &&
                                            completedBy.length === 1 &&
                                            !isCompletedByUser;

                                        const isExecutor = order.executorId === user.id;
                                        const isCreator = order.creatorId === user.id;

                                        const disputeKey =
                                            `regular:${order.id}`;

                                        const dispute =
                                            orderDisputes[disputeKey];

                                        const hourly =
                                            isHourlyOrder(order);

                                        const workEndedAt =
                                            getWorkEndTime(order);

                                        const creator = creatorsInfo[order.creatorId] || {};
                                        const executor = executorsInfo[order.executorId] || {};

                                        const contractUrl =
                                            getContractUrl(order.contractPath);

                                        return (
                                            <li key={order.id} className="order-card">
                                                <div className="order-header">
                                                    <div className="order-top">
                                                        <div className="order-title-wrap">
                                                            <div className="order-title">
                                                                <strong>Заказ №{order.id}</strong>
                                                            </div>

                                                            <div className="role-badge-row">
    <span className={`role-badge ${isCreator ? "creator-role" : "executor-role"}`}>
        {isCreator ? "Вы заказчик" : "Вы исполнитель"}
    </span>

                                                                {dispute && (
                                                                    <div className={`dispute-status-badge dispute-status-${dispute.status}`}>
                                                                        Спор: {orderDisputes[order.id].status}
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {isWaitingForOther && (
                                                                <div className="completion-waiting-box">
                                                                    <strong>Вы подтвердили завершение.</strong>
                                                                    <span>
            Заказ завершится полностью, когда вторая сторона тоже подтвердит выполнение.
        </span>
                                                                </div>
                                                            )}

                                                            {isWaitingForMe && (
                                                                <div className="completion-waiting-box completion-waiting-box-warning">
                                                                    <strong>Вторая сторона уже подтвердила завершение.</strong>
                                                                    <span>
            Проверьте результат и нажмите «Подтвердить завершение», если всё в порядке.
        </span>
                                                                </div>
                                                            )}

                                                        </div>

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

                                                    <div className="order-subline">Создан {new Date(order.createdAt).toLocaleString()}</div>

                                                    {hourly && order.workStartedAt && (
                                                        <OrderWorkTimer
                                                            startedAt={
                                                                order.workStartedAt
                                                            }
                                                            endedAt={workEndedAt}
                                                        />
                                                    )}

                                                    {isExecutor ? (
                                                        <>
                                                            <p>
                                                                <strong>ID заказчика:</strong> {order.creatorId || "Неизвестно"}
                                                            </p>
                                                            <p>
                                                                <strong>Имя заказчика:</strong> {creator.username || "Неизвестно"}
                                                            </p>
                                                            <p>
                                                                <strong>Рейтинг заказчика:</strong>{" "}
                                                                {creator.rating ? creator.rating.toFixed(1) : "Нет данных"}
                                                            </p>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <p>
                                                                <strong>ID исполнителя:</strong> {order.executorId || "Неизвестно"}
                                                            </p>
                                                            <p>
                                                                <strong>Имя исполнителя:</strong> {executor?.username || "Неизвестно"}
                                                            </p>
                                                            <p>
                                                                <strong>Рейтинг исполнителя:</strong>{" "}
                                                                {executor?.rating ? executor.rating.toFixed(1) : "Нет данных"}
                                                            </p>
                                                        </>
                                                    )}

                                                    <div className="active-buttons">
                                                        <button
                                                            className="call-button"
                                                            onClick={async (e) => {
                                                                e.stopPropagation();
                                                                const phone = isCreator
                                                                    ? await getUserPhone(order.executorId)
                                                                    : await getUserPhone(order.creatorId);
                                                                if (!phone) return alert("Телефон не найден");
                                                                callPhone(phone);
                                                            }}
                                                        >
                                                            {isMobile ? <FaPhone /> : "Позвонить"}
                                                        </button>

                                                        <button
                                                            className="message-button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleOpenChat(order.id, "regular");
                                                            }}
                                                        >
                                                            <span className="message-button-content">{isMobile ? <FaComments /> : "Сообщение"}</span>

                                                            {typeof unreadOrders[order.id] === "number" && unreadOrders[order.id] > 0 && (
                                                                <span className="notification-badge-ios">
                                  {unreadOrders[order.id] > 99 ? "99+" : unreadOrders[order.id]}
                                </span>
                                                            )}
                                                        </button>

                                                        <button
                                                            className="route-button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleRouteClick(order);
                                                            }}
                                                        >
                                                            {isMobile ? <FaRoute /> : "Маршрут"}
                                                        </button>

                                                        {dispute ? (
                                                            <button
                                                                className="dispute-opened-button"
                                                                onClick={async (e) => {
                                                                    e.stopPropagation();
                                                                    const currentDispute =
                                                                        dispute ||
                                                                        (
                                                                            await fetchOrderDispute(
                                                                                order.id,
                                                                                "regular"
                                                                            )
                                                                        );
                                                                    if (!currentDispute) {
                                                                        return alert("Спор не найден");
                                                                    }

                                                                    alert(
                                                                        `Спор уже открыт.\n\nСтатус: ${currentDispute.status}\nПричина: ${currentDispute.reason}${
                                                                            currentDispute.description
                                                                                ? `\nОписание: ${currentDispute.description}`
                                                                                : ""
                                                                        }`
                                                                    );
                                                                }}
                                                            >
                                                                {isMobile ? <FaExclamationTriangle /> : "Спор открыт"}
                                                            </button>
                                                        ) : (
                                                            <button
                                                                className="dispute-button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    openDisputeModal(order, "regular");
                                                                }}
                                                            >
                                                                {isMobile ? <FaExclamationTriangle /> : "Открыть спор"}
                                                            </button>
                                                        )}

                                                        {isWaitingForOther ? (
                                                            <>
                                                                <button
                                                                    className="waiting-complete-button"
                                                                    disabled
                                                                    title="Ожидаем подтверждение второй стороны"
                                                                >
                                                                    {isMobile ? <FaCheck /> : "Ждём подтверждения"}
                                                                </button>

                                                                <button
                                                                    className="remind-complete-button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        remindCompleteOrder(order.id);
                                                                    }}
                                                                >
                                                                    Напомнить
                                                                </button>
                                                            </>
                                                        ) : !order.workStartedAt &&
                                                        (
                                                            hourly
                                                                ? isCreator || isExecutor
                                                                : isExecutor
                                                        ) ? (
                                                            <button
                                                                className="start-main-button"
                                                                onClick={(event) => {
                                                                    event.stopPropagation();

                                                                    const message = hourly
                                                                        ? "Начать отсчёт рабочего времени? Таймер запустится у обеих сторон."
                                                                        : "Отметить работу как начатую?";

                                                                    if (!window.confirm(message)) {
                                                                        return;
                                                                    }

                                                                    startWork(order.id);
                                                                }}
                                                                disabled={
                                                                    startingWork[order.id]
                                                                }
                                                            >
                                                                {startingWork[order.id]
                                                                    ? isMobile
                                                                        ? <FaPlay />
                                                                        : "Запуск..."
                                                                    : isMobile
                                                                        ? <FaPlay />
                                                                        : "Начать работу"}
                                                            </button>
                                                        ) : (
                                                            <button
                                                                className="complete-button"
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    openCompletionModal(order);
                                                                }}
                                                            >
                                                                {isMobile ? <FaCheck /> : isWaitingForMe ? "Подтвердить завершение" : "Завершить"}
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* details */}
                                                    <div className="order-details">
                                                        <div className="order-left">
                                                            <p>
                                                                <strong>Категория / услуга:</strong>{" "}
                                                                <span className="v-line">{buildServiceLine(order)}</span>
                                                            </p>
                                                        </div>

                                                        {Array.isArray(order.images) && order.images.length > 0 && (
                                                            <div className="image-stack-container">
                                                                <div
                                                                    className="image-stack"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        openModal(order.images);
                                                                    }}
                                                                >
                                                                    {order.images.map((image, index) => (
                                                                        <img
                                                                            key={index}
                                                                            src={`${apiUrl}${image}`}
                                                                            alt={`Order pic ${index + 1}`}
                                                                            className="order-image"
                                                                            style={{ transform: `translateX(${index * 10}px)` }}
                                                                        />
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        <p>
                                                            <strong>Адрес:</strong> {order.address}
                                                        </p>
                                                        {hasDescription(order.description) && (
                                                            <p>
                                                                <strong>Описание:</strong> {order.description.trim()}
                                                            </p>
                                                        )}

                                                        <OrderServiceDetails
                                                            order={order}
                                                        />

                                                        {contractUrl && (
                                                            <div className="contract-download-row">
                                                                <a
                                                                    href={contractUrl}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="contract-download-button"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                    }}
                                                                >
            <span className="contract-download-icon">
                📄
            </span>

                                                                    <span className="contract-download-text">
                Скачать договор
            </span>

                                                                    <span className="contract-download-format">
                PDF
            </span>
                                                                </a>
                                                            </div>
                                                        )}

                                                        <div className="photo-protocol-section">
                                                            <h4 className="photo-protocol-title">
                                                                Фото-протокол заказа
                                                            </h4>

                                                            <div className="photo-protocol-alert">
                                                                Фото ДО и ПОСЛЕ необязательны, но помогают зафиксировать
                                                                состояние объекта и результат работы. Фотографии доступны
                                                                обеим сторонам заказа.
                                                            </div>

                                                            {/* ================= Фото ДО ================= */}

                                                            <div className="photo-protocol-stage">
                                                                <h5 className="photo-protocol-stage-title">
                                                                    Фото ДО начала работы
                                                                </h5>

                                                                <div className="photo-protocol-card">
                                                                    <div className="photo-protocol-head">
                                                                        <strong>Фото заказчика</strong>

                                                                        <span className="photo-protocol-optional">
                    До начала работ
                </span>
                                                                    </div>

                                                                    <p className="photo-protocol-hint">
                                                                        Состояние объекта, зафиксированное заказчиком.
                                                                    </p>

                                                                    {renderPhotoList(order.customerBeforePhotos)}

                                                                    {isCreator && (
                                                                        <label
                                                                            className="photo-upload-button"
                                                                            onClick={(e) => e.stopPropagation()}
                                                                        >
                                                                            {photoUploading[`${order.id}_customerBefore`]
                                                                                ? "Загрузка..."
                                                                                : "Добавить фото заказчика ДО"}

                                                                            <input
                                                                                type="file"
                                                                                accept="image/*"
                                                                                multiple
                                                                                hidden
                                                                                disabled={
                                                                                    photoUploading[`${order.id}_customerBefore`]
                                                                                }
                                                                                onChange={async (e) => {
                                                                                    const selectedFiles = e.target.files;

                                                                                    await uploadOrderPhotos(
                                                                                        order.id,
                                                                                        "customerBefore",
                                                                                        selectedFiles
                                                                                    );

                                                                                    e.target.value = "";
                                                                                }}
                                                                            />
                                                                        </label>
                                                                    )}
                                                                </div>

                                                                <div className="photo-protocol-card">
                                                                    <div className="photo-protocol-head">
                                                                        <strong>Фото исполнителя</strong>

                                                                        <span className="photo-protocol-warning">
                    Рекомендуется
                </span>
                                                                    </div>

                                                                    <p className="photo-protocol-hint">
                                                                        Состояние объекта, зафиксированное исполнителем до
                                                                        начала работы.
                                                                    </p>

                                                                    {renderPhotoList(order.executorBeforePhotos)}

                                                                    {isExecutor && (
                                                                        <label
                                                                            className="photo-upload-button"
                                                                            onClick={(e) => e.stopPropagation()}
                                                                        >
                                                                            {photoUploading[`${order.id}_executorBefore`]
                                                                                ? "Загрузка..."
                                                                                : "Добавить фото исполнителя ДО"}

                                                                            <input
                                                                                type="file"
                                                                                accept="image/*"
                                                                                multiple
                                                                                hidden
                                                                                disabled={
                                                                                    photoUploading[`${order.id}_executorBefore`]
                                                                                }
                                                                                onChange={async (e) => {
                                                                                    const selectedFiles = e.target.files;

                                                                                    await uploadOrderPhotos(
                                                                                        order.id,
                                                                                        "executorBefore",
                                                                                        selectedFiles
                                                                                    );

                                                                                    e.target.value = "";
                                                                                }}
                                                                            />
                                                                        </label>
                                                                    )}
                                                                </div>
                                                            </div>

                                                            {/* ================= Фото ПОСЛЕ ================= */}

                                                            <div className="photo-protocol-stage">
                                                                <h5 className="photo-protocol-stage-title">
                                                                    Фото ПОСЛЕ выполнения работы
                                                                </h5>

                                                                <div className="photo-protocol-card optional">
                                                                    <div className="photo-protocol-head">
                                                                        <strong>Фото заказчика</strong>

                                                                        <span className="photo-protocol-optional">
                    После выполнения
                </span>
                                                                    </div>

                                                                    <p className="photo-protocol-hint">
                                                                        Результат работы, зафиксированный заказчиком.
                                                                    </p>

                                                                    {renderPhotoList(order.customerAfterPhotos)}

                                                                    {isCreator && (
                                                                        <label
                                                                            className="photo-upload-button"
                                                                            onClick={(e) => e.stopPropagation()}
                                                                        >
                                                                            {photoUploading[`${order.id}_customerAfter`]
                                                                                ? "Загрузка..."
                                                                                : "Добавить фото заказчика ПОСЛЕ"}

                                                                            <input
                                                                                type="file"
                                                                                accept="image/*"
                                                                                multiple
                                                                                hidden
                                                                                disabled={
                                                                                    photoUploading[`${order.id}_customerAfter`]
                                                                                }
                                                                                onChange={async (e) => {
                                                                                    const selectedFiles = e.target.files;

                                                                                    await uploadOrderPhotos(
                                                                                        order.id,
                                                                                        "customerAfter",
                                                                                        selectedFiles
                                                                                    );

                                                                                    e.target.value = "";
                                                                                }}
                                                                            />
                                                                        </label>
                                                                    )}
                                                                </div>

                                                                <div className="photo-protocol-card">
                                                                    <div className="photo-protocol-head">
                                                                        <strong>Фото исполнителя</strong>

                                                                        <span className="photo-protocol-warning">
                    Рекомендуется
                </span>
                                                                    </div>

                                                                    <p className="photo-protocol-hint">
                                                                        Итоговый результат, зафиксированный исполнителем.
                                                                    </p>

                                                                    {renderPhotoList(order.executorAfterPhotos)}

                                                                    {isExecutor && (
                                                                        <label
                                                                            className="photo-upload-button"
                                                                            onClick={(e) => e.stopPropagation()}
                                                                        >
                                                                            {photoUploading[`${order.id}_executorAfter`]
                                                                                ? "Загрузка..."
                                                                                : "Добавить фото исполнителя ПОСЛЕ"}

                                                                            <input
                                                                                type="file"
                                                                                accept="image/*"
                                                                                multiple
                                                                                hidden
                                                                                disabled={
                                                                                    photoUploading[`${order.id}_executorAfter`]
                                                                                }
                                                                                onChange={async (e) => {
                                                                                    const selectedFiles = e.target.files;

                                                                                    await uploadOrderPhotos(
                                                                                        order.id,
                                                                                        "executorAfter",
                                                                                        selectedFiles
                                                                                    );

                                                                                    e.target.value = "";
                                                                                }}
                                                                            />
                                                                        </label>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                            </li>
                                        );
                                    })}

                                    {/* express активные заказы */}
                                    {visibleExpressOrders.map((eo) => (
                                        <ExpressOrderCard
                                            key={`express-${eo.id}-${eo.status}-${eo.updatedAt || eo.completedAt || ""}`}
                                            order={eo}
                                            userId={user.id}
                                            onOrderUpdated={(updatedOrder) => {
                                                if (!updatedOrder?.id) return;

                                                setExpressOrders((prev) => {
                                                    const exists = prev.some(
                                                        (item) => Number(item.id) === Number(updatedOrder.id)
                                                    );

                                                    if (!exists) {
                                                        return [updatedOrder, ...prev];
                                                    }

                                                    return prev.map((item) =>
                                                        Number(item.id) === Number(updatedOrder.id)
                                                            ? {
                                                                ...item,
                                                                ...updatedOrder,
                                                                status: updatedOrder.status ?? item.status,
                                                                executorId: updatedOrder.executorId ?? item.executorId,
                                                                creatorId: updatedOrder.creatorId ?? item.creatorId,
                                                                updatedAt: updatedOrder.updatedAt || new Date().toISOString(),
                                                            }
                                                            : item
                                                    );
                                                });
                                            }}
                                            onReload={async () => {
                                                const r = await axiosInstance.get(`/express/express-orders/me`, {
                                                    params: { mode: "active" },
                                                });

                                                if (r.data?.success) {
                                                    setExpressOrders(Array.isArray(r.data.orders) ? r.data.orders : []);
                                                }

                                                return r;
                                            }}
                                            onCompletedSuccessfully={(completedOrder) => {
                                                openCompletionSuccessModal(
                                                    buildCompletionPayload({
                                                        order: completedOrder,
                                                        orderType: "express",
                                                    })
                                                );
                                            }}
                                            onOpenChat={(orderId) => handleOpenChat(orderId, "express")}
                                            onOpenDispute={(order) =>

                                                openDisputeModal(order, "express")

                                            }                                            onCallUser={async (order) => {
                                                const phone = Number(order.creatorId) === Number(user.id)
                                                    ? await getUserPhone(order.executorId)
                                                    : await getUserPhone(order.creatorId);

                                                if (!phone) {
                                                    alert("Телефон не найден");
                                                    return;
                                                }

                                                callPhone(phone);
                                            }}
                                        />
                                    ))}
                                </ul>
                            ) : (
                                <p className="no-orders">Нет активных заказов.</p>
                            )}
                        </div>
                    </div>

                    <Modal
                        appElement={document.getElementById("root")}
                        isOpen={isDisputeModalOpen}
                        onRequestClose={closeDisputeModal}
                        contentLabel="Открытие спора"
                        className="custom-modal dispute-modal"
                        overlayClassName="custom-modal-overlay"
                    >
                        <div className="custom-modal-content dispute-modal-content">
                            <button onClick={closeDisputeModal} className="custom-close-button">
                                ✖
                            </button>

                            <h2 className="dispute-modal-title">
                                {selectedDisputeOrderType === "express"
                                    ? disputeIsCreator
                                        ? "Проблема с экспресс-заказом"
                                        : "Проблема при выполнении заказа"
                                    : "Открыть спор"}
                            </h2>

                            {selectedOrderForDispute && (
                                <p className="dispute-order-info">
                                    {selectedDisputeOrderType === "express"
                                        ? "Экспресс-заказ"
                                        : "Заказ"}{" "}
                                    №{selectedOrderForDispute.id}
                                </p>
                            )}

                            <div className="dispute-form-group">
                                <label>Что произошло?</label>
                                <select
                                    value={disputeReasonCode}
                                    onChange={(e) => setDisputeReasonCode(e.target.value)}
                                    className="dispute-input"
                                >
                                    {disputeReasonOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="dispute-form-group">
                                <label>Краткая причина</label>
                                <input
                                    type="text"
                                    value={disputeReason}
                                    onChange={(e) => setDisputeReason(e.target.value)}
                                    className="dispute-input"
                                    placeholder={
                                        selectedDisputeOrderType === "express"
                                            ? disputeIsCreator
                                                ? "Например: исполнитель приехал с большим опозданием"
                                                : "Например: заказчик не отвечает на звонки"
                                            : "Например: работа выполнена не полностью"
                                    }
                                    maxLength={255}
                                />
                            </div>

                            <div className="dispute-form-group">
                                <label>Подробное описание</label>
                                <textarea
                                    value={disputeDescription}
                                    onChange={(e) => setDisputeDescription(e.target.value)}
                                    className="dispute-textarea"
                                    placeholder="Опишите подробно, в чём проблема, что произошло, что именно не устраивает"
                                    rows={6}
                                />
                            </div>

                            <div className="dispute-modal-actions">
                                <button
                                    className="dispute-cancel-button"
                                    onClick={closeDisputeModal}
                                    disabled={disputeLoading}
                                >
                                    Отмена
                                </button>

                                <button
                                    className="dispute-submit-button"
                                    onClick={submitDispute}
                                    disabled={disputeLoading}
                                >
                                    {disputeLoading
                                        ? "Отправляем..."
                                        : selectedDisputeOrderType === "express"
                                            ? "Сообщить о проблеме"
                                            : "Открыть спор"}
                                </button>
                            </div>
                        </div>
                    </Modal>

                    <Modal
                        appElement={document.getElementById("root")}
                        isOpen={Boolean(completionModalOrder)}
                        onRequestClose={() => {
                            if (completionSubmitting) {
                                return;
                            }

                            setCompletionModalOrder(null);
                        }}
                        contentLabel="Завершение заказа"
                        className="completion-work-modal"
                        overlayClassName="completion-work-modal-overlay"
                    >

                        {completionModalOrder && (() => {
                            const hourly =
                                isHourlyOrder(
                                    completionModalOrder
                                );

                            const endTime =
                                getWorkEndTime(
                                    completionModalOrder
                                ) || new Date().toISOString();

                            const durationMs =
                                getWorkDurationMs(
                                    completionModalOrder
                                        .workStartedAt,
                                    endTime
                                );

                            const details =
                                parseServiceDetails(
                                    completionModalOrder
                                        .serviceDetails
                                );

                            const firstHourPrice =
                                Number(
                                    details
                                        ?.pricingFirstHourPrice
                                );

                            const nextHourPrice =
                                Number(
                                    details
                                        ?.pricingNextHourPrice
                                );

                            const minimumHours =
                                Number(
                                    details
                                        ?.pricingMinimumHours
                                );

                            const hourlyPriceCalculation =
                                hourly &&
                                completionModalOrder.workStartedAt
                                    ? calculateHourlyCompletionPrice({
                                        durationMs,
                                        firstHourPrice,
                                        nextHourPrice,

                                        minimumHours:
                                            Number.isFinite(
                                                minimumHours
                                            ) &&
                                            minimumHours > 0
                                                ? minimumHours
                                                : 1,
                                    })
                                    : null;

                            return (
                                <div className="completion-work-modal__content">
                                    <button
                                        type="button"
                                        className="completion-work-modal__close"
                                        disabled={
                                            completionSubmitting
                                        }
                                        onClick={() =>
                                            setCompletionModalOrder(
                                                null
                                            )
                                        }
                                    >
                                        ✖
                                    </button>

                                    <div className="completion-work-modal__icon">
                                        ⏱
                                    </div>

                                    <h2 className="completion-work-modal__title">
                                        Завершить заказ?
                                    </h2>

                                    <p className="completion-work-modal__order">
                                        Заказ №
                                        {
                                            completionModalOrder.id
                                        }
                                    </p>

                                    {hourly &&
                                    completionModalOrder
                                        .workStartedAt ? (
                                        <div className="completion-work-summary">
                                            <div className="completion-work-summary__row">
                            <span>
                                Работа начата
                            </span>

                                                <strong>
                                                    {new Date(
                                                        completionModalOrder
                                                            .workStartedAt
                                                    ).toLocaleString(
                                                        "ru-RU"
                                                    )}
                                                </strong>
                                            </div>

                                            <div className="completion-work-summary__row completion-work-summary__row--main">
                            <span>
                                Продолжительность
                            </span>

                                                <strong>
                                                    {formatWorkDurationText(
                                                        durationMs
                                                    )}
                                                </strong>
                                            </div>

                                            {Number.isFinite(
                                                firstHourPrice
                                            ) && (
                                                <div className="completion-work-summary__row">
                                <span>
                                    Первый час
                                </span>

                                                    <strong>
                                                        {firstHourPrice
                                                            .toLocaleString(
                                                                "ru-RU"
                                                            )}{" "}
                                                        ₽
                                                    </strong>
                                                </div>
                                            )}

                                            {Number.isFinite(
                                                nextHourPrice
                                            ) && (
                                                <div className="completion-work-summary__row">
                                <span>
                                    Следующий час
                                </span>

                                                    <strong>
                                                        {nextHourPrice
                                                            .toLocaleString(
                                                                "ru-RU"
                                                            )}{" "}
                                                        ₽/ч
                                                    </strong>
                                                </div>
                                            )}

                                            {hourlyPriceCalculation && (
                                                <>
                                                    <div className="completion-work-summary__row">
            <span>
                Оплачиваемое время
            </span>

                                                        <strong>
                                                            {hourlyPriceCalculation
                                                                .billedHours
                                                                .toLocaleString(
                                                                    "ru-RU",
                                                                    {
                                                                        minimumFractionDigits:
                                                                            hourlyPriceCalculation
                                                                                .billedHours %
                                                                            1 ===
                                                                            0
                                                                                ? 0
                                                                                : 1,

                                                                        maximumFractionDigits:
                                                                            1,
                                                                    }
                                                                )}{" "}
                                                            ч
                                                        </strong>
                                                    </div>

                                                    {hourlyPriceCalculation.extraHours >
                                                        0 && (
                                                            <div className="completion-work-summary__row">
                <span>
                    Время после первого часа
                </span>

                                                                <strong>
                                                                    {hourlyPriceCalculation
                                                                        .extraHours
                                                                        .toLocaleString(
                                                                            "ru-RU",
                                                                            {
                                                                                minimumFractionDigits:
                                                                                    hourlyPriceCalculation
                                                                                        .extraHours %
                                                                                    1 ===
                                                                                    0
                                                                                        ? 0
                                                                                        : 1,

                                                                                maximumFractionDigits:
                                                                                    1,
                                                                            }
                                                                        )}{" "}
                                                                    ч ×{" "}
                                                                    {hourlyPriceCalculation
                                                                        .nextHourPrice
                                                                        .toLocaleString(
                                                                            "ru-RU"
                                                                        )}{" "}
                                                                    ₽
                                                                </strong>
                                                            </div>
                                                        )}

                                                    {hourlyPriceCalculation.extraHours >
                                                        0 && (
                                                            <div className="completion-work-summary__row">
                <span>
                    Дополнительное время
                </span>

                                                                <strong>
                                                                    {hourlyPriceCalculation
                                                                        .extraTimePrice
                                                                        .toLocaleString(
                                                                            "ru-RU"
                                                                        )}{" "}
                                                                    ₽
                                                                </strong>
                                                            </div>
                                                        )}

                                                    <div className="completion-work-summary__row completion-work-summary__row--price-total">
            <span>
                Общая сумма
            </span>

                                                        <strong>
                                                            {hourlyPriceCalculation
                                                                .totalPrice
                                                                .toLocaleString(
                                                                    "ru-RU"
                                                                )}{" "}
                                                            ₽
                                                        </strong>
                                                    </div>
                                                </>
                                            )}

                                            <div className="completion-work-summary__notice">
                                                Проверьте фактическое время
                                                и согласуйте итоговую сумму
                                                со второй стороной перед
                                                подтверждением.
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="completion-work-modal__text">
                                            Подтвердите, что работа
                                            выполнена. Заказ полностью
                                            завершится после подтверждения
                                            обеих сторон.
                                        </p>
                                    )}

                                    <div className="completion-work-modal__actions">
                                        <button
                                            type="button"
                                            className="completion-work-modal__cancel"
                                            disabled={
                                                completionSubmitting
                                            }
                                            onClick={() =>
                                                setCompletionModalOrder(
                                                    null
                                                )
                                            }
                                        >
                                            Отмена
                                        </button>

                                        <button
                                            type="button"
                                            className="completion-work-modal__submit"
                                            disabled={
                                                completionSubmitting
                                            }
                                            onClick={
                                                completeOrderRequest
                                            }
                                        >
                                            {completionSubmitting
                                                ? "Завершаем..."
                                                : "Подтвердить завершение"}
                                        </button>
                                    </div>
                                </div>
                            );
                        })()}
                    </Modal>

                    {/* Images Modal */}
                    <Modal
                        appElement={document.getElementById("root")}
                        isOpen={isModalOpen}
                        onRequestClose={closeModal}
                        contentLabel="Full Image Modal"
                        className="custom-modal"
                        overlayClassName="custom-modal-overlay"
                    >
                        <div className="custom-modal-content">
                            <button onClick={closeModal} className="custom-close-button">
                                ✖
                            </button>

                            {currentImages.length > 0 && (
                                <img
                                    src={`${apiUrl}${currentImages[currentImageIndex]}`}
                                    alt="Full-size view"
                                    className="custom-modal-image"
                                />
                            )}

                            {currentImages.length > 1 && (
                                <div className="custom-image-navigation">
                                    <button onClick={prevImage} className="custom-nav-button">
                                        ◀
                                    </button>
                                    <button onClick={nextImage} className="custom-nav-button">
                                        ▶
                                    </button>
                                </div>
                            )}
                        </div>
                    </Modal>
                </div>
            </div>
        </div>
    );
};

export default ActiveOrdersPage;