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
import RegularReservedOrderCard from "../components/RegularReservedOrderCard";
import { ModalContext } from "../components/modalContext";
import { openOrderRoute } from "../utils/orderNavigation";
import OrderWorkTimer from "../components/OrderWorkTimer";
import {downloadLegacyContract,} from "../utils/downloadLegacyContract";
import useVerifiedAssignments from "../hooks/useVerifiedAssignments";
import VerifiedAssignmentCard from "../components/VerifiedAssignmentCard";
import OrderWorkPhotos from "../components/OrderWorkPhotos";
import DisputeEvidenceInput from "../components/DisputeEvidenceInput";
import OrderChangePanel from "../components/OrderChangePanel";
import ContractSigningPanel
    from "../components/ContractSigningPanel";

import SignatureAgreementPanel
    from "../components/SignatureAgreementPanel";

import {
    downloadVerifiedContract,
} from "../utils/downloadVerifiedContract";

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

    const [collapsedRegular, setCollapsedRegular] = useState({});

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
    const [disputeEvidenceFiles, setDisputeEvidenceFiles] = useState([]);
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

    const [completionQuality, setCompletionQuality] = useState("");
    const [completionRemarks, setCompletionRemarks] = useState("");
    const [completionCashStatus, setCompletionCashStatus] = useState("");
    const [completionCashAmount, setCompletionCashAmount] = useState("");
    const [completionPayoutAuthorized, setCompletionPayoutAuthorized] =
        useState(false);

    const [correctionOrder, setCorrectionOrder] = useState(null);
    const [correctionComment, setCorrectionComment] = useState("");
    const [correctionDecision, setCorrectionDecision] = useState("");
    const [correctionSubmitting, setCorrectionSubmitting] =
        useState(false);

    const [pendingSigningActs, setPendingSigningActs] = useState([]);
    const [missingCompletionActs, setMissingCompletionActs] =
        useState([]);
    const [signingAct, setSigningAct] = useState(null);

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
        setDisputeEvidenceFiles([]);

        setIsDisputeModalOpen(true);
    };

    const closeDisputeModal = () => {
        setIsDisputeModalOpen(false);

        setSelectedOrderForDispute(null);
        setSelectedDisputeOrderType("regular");

        setDisputeReasonCode("work_not_done");
        setDisputeReason("");
        setDisputeDescription("");
        setDisputeEvidenceFiles([]);

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

            const formData = new FormData();

            formData.append("orderId", String(selectedOrderForDispute.id));
            formData.append("orderType", selectedDisputeOrderType);
            formData.append("reasonCode", disputeReasonCode);
            formData.append("reason", disputeReason.trim());
            formData.append("description", disputeDescription.trim());

            disputeEvidenceFiles.forEach((file) => {
                formData.append("evidence", file);
            });

            const res = await axios.post(
                `${apiUrl}/api/disputes/open`,
                formData,
                {
                    headers: {
                        Authorization: `Bearer ${t}`,
                    },
                    timeout: 120000,
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
        if (!order?.id) return;

        setCompletionQuality("");
        setCompletionRemarks("");
        setCompletionCashStatus("");
        setCompletionCashAmount("");
        setCompletionPayoutAuthorized(false);

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


                const isCreator =
                    Number(order.creatorId) === Number(user?.id);

                const isCash = order.paymentType === "cash";
                const isGuarantee = order.paymentType === "guarantee";

                const completion = {
                    workConfirmed: true,
                    qualityDecision: isCreator
                        ? completionQuality
                        : null,
                    remarks: isCreator &&
                    completionQuality === "remarks"
                        ? completionRemarks.trim()
                        : null,
                    payoutAuthorized: false,
                    cashStatus: isCash
                        ? completionCashStatus
                        : null,
                    cashAmountKopecks: null,
                };

                if (
                    isCreator &&
                    !["accepted", "remarks"].includes(completionQuality)
                ) {
                    throw new Error("Укажите результат приёмки");
                }

                if (
                    isCreator &&
                    completionQuality === "remarks" &&
                    completionRemarks.trim().length < 10
                ) {
                    throw new Error("Опишите замечания: минимум 10 символов");
                }

                if (
                    isCash &&
                    !["full", "partial", "none"].includes(completionCashStatus)
                ) {
                    throw new Error("Укажите состояние оплаты");
                }

                if (
                    isCash &&
                    completionCashStatus === "partial"
                ) {
                    const amount = completionCashAmount
                        .trim()
                        .replace(",", ".");

                    if (!/^\d+(?:\.\d{1,2})?$/.test(amount)) {
                        throw new Error("Укажите сумму с точностью до копеек");
                    }

                    completion.cashAmountKopecks =
                        Math.round(Number(amount) * 100);
                }


                const res =
                    await axiosInstance.post(
                        `/orders/complete/${orderId}`,
                        { completion },
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



                if (updatedOrder?.status === "completed") {
                    if (updatedOrder.completionAct) {
                        setSigningAct(updatedOrder.completionAct);
                    } else if (updatedOrder.documentPending) {
                        alert(
                            "Заказ завершён, но формирование PDF " +
                            "потребует повторного запроса."
                        );
                    } else {
                        openCompletionSuccessModal(
                            buildCompletionPayload({
                                order: updatedOrder,
                                orderType: "regular",
                            })
                        );
                    }
                } else if (
                    updatedOrder?.completionPhase === "needs_correction"
                ) {
                    alert(
                        "Обе стороны отметили завершение работы, " +
                        "но заказчик указал замечания. " +
                        "Заказ остаётся в работе до их устранения."
                    );
                } else {
                    alert(
                        "Ваше подтверждение сохранено. " +
                        "Ожидаем вторую сторону."
                    );
                }


            } catch (error) {
                console.error(error);

                alert(
                    error.response?.data?.message ||
                    error.message ||
                    "Ошибка при завершении заказа"
                );
            } finally {
                setCompletionSubmitting(false);
            }
        };


    const openCorrectionModal = (order, mode) => {
        setCorrectionOrder({ order, mode });
        setCorrectionComment("");
        setCorrectionDecision("");
    };

    const submitCorrectionModal = async () => {
        if (!correctionOrder || correctionSubmitting) return;

        const { order, mode } = correctionOrder;

        try {
            setCorrectionSubmitting(true);

            let response;

            if (mode === "submit") {
                response = await axiosInstance.post(
                    `/orders/${order.id}/corrections/submit`,
                    {
                        comment: correctionComment.trim(),
                    }
                );
            } else {
                response = await axiosInstance.post(
                    `/orders/${order.id}/corrections/review`,
                    {
                        decision: correctionDecision,
                        comment: correctionComment.trim(),
                    }
                );
            }

            setCorrectionOrder(null);

            await fetchActiveOrders();

            if (
                response.data?.status === "completed" &&
                response.data?.completionAct
            ) {
                setSigningAct(response.data.completionAct);
            } else if (response.data?.documentPending) {
                alert(
                    "Работы приняты, но PDF пока не сформирован. " +
                    "Повторите формирование документа."
                );
            } else if (response.data?.completionPhase === "completed") {
                openCompletionSuccessModal(
                    buildCompletionPayload({
                        order: response.data,
                        orderType: "regular",
                    })
                );
            } else {
                alert(
                    mode === "submit"
                        ? "Исправления переданы заказчику."
                        : "Ваше решение по исправлениям сохранено."
                );
            }
        } catch (error) {
            alert(
                error.response?.data?.message ||
                error.message ||
                "Не удалось сохранить решение"
            );
        } finally {
            setCorrectionSubmitting(false);
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


    const fetchPendingSigningActs = async () => {
        try {
            const response = await axiosInstance.get(
                "/orders/pending-act-signatures"
            );

            setPendingSigningActs(
                Array.isArray(response.data?.acts)
                    ? response.data.acts
                    : []
            );

            setMissingCompletionActs(
                Array.isArray(response.data?.missingOrderIds)
                    ? response.data.missingOrderIds
                    : []
            );
        } catch (error) {
            console.error(
                "Не удалось загрузить неподписанные акты:",
                error
            );
        }
    };

    const retryCompletionAct = async (orderId) => {
        try {
            const response = await axiosInstance.post(
                `/orders/${orderId}/ensure-completion-act`,
                {}
            );

            await fetchPendingSigningActs();

            if (response.data?.act) {
                setSigningAct(response.data.act);
            }
        } catch (error) {
            alert(
                error.response?.data?.message ||
                "Не удалось сформировать акт"
            );
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

            await fetchPendingSigningActs();

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

    const currentUserId = Number(user?.id);

    const performingOrders = orders.filter(
        (order) =>
            Number(order.executorId) === currentUserId
    );

    const createdOrders = orders.filter(
        (order) =>
            Number(order.creatorId) === currentUserId
    );

// Экспресс-заказы, которые выполняет текущий пользователь
    const performingExpressOrders = expressOrders.filter((order) => {
        const isExecutor =
            Number(order.executorId) === currentUserId

        const hasExecutor =
            Number(order.executorId) > 0;

        const isActive =
            !["created", "completed", "cancelled"].includes(order.status);

        const isVisible =
            !order.creatorHidden && !order.adminDeleted;

        return isExecutor && hasExecutor && isActive && isVisible;
    });

// Экспресс-заказы клиента, которые уже выполняются
    const createdExpressOrders = expressOrders.filter((order) => {
        const isCreator =
            Number(order.creatorId) === currentUserId

        const hasExecutor =
            Number(order.executorId) > 0;

        const isActive =
            !["created", "completed", "cancelled"].includes(order.status);

        const isVisible =
            !order.creatorHidden && !order.adminDeleted;

        return isCreator && hasExecutor && isActive && isVisible;
    });

    const targetOrderId = new URLSearchParams(window.location.search).get("orderId");

    const sortTargetOrderFirst = (list) => {
        return [...list].sort((a, b) => {
            if (a.status !== b.status) {
                if (a.status === "active") return -1;
                if (b.status === "active") return 1;
            }

            if (targetOrderId) {
                if (String(a.id) === String(targetOrderId)) return -1;
                if (String(b.id) === String(targetOrderId)) return 1;
            }

            return 0;
        });
    };

    const visibleRegularOrders =
        activeView === "performing"
            ? sortTargetOrderFirst(performingOrders)
            : sortTargetOrderFirst(createdOrders);

    const {
        byOrderId: verifiedAssignments,
        error: assignmentsError,
        refresh: refreshAssignments,
        loading: assignmentsLoading,
    } = useVerifiedAssignments(
        visibleRegularOrders.filter(
            (order) => order.status === "active"
        )
    );

    const visibleExpressOrders =
        activeView === "performing"
            ? (performingOrders.length > 0 ? [] : performingExpressOrders.slice(0, 1))
            : createdExpressOrders;

    const hasAnyVisible =
        visibleRegularOrders.length > 0 || visibleExpressOrders.length > 0;

    const hasAny = hasAnyVisible;

    /*
     * Все React Hooks уже вызваны.
     * Теперь можно выполнять ранний return.
     */
    if (!user?.id) {
        return <p>Загрузка...</p>;
    }

    if (error) {
        return (
            <div className="error-message">
                {error}
            </div>
        );
    }

    return (
        <div className={`active-orders active-orders--${platform}`}>
            <div className="pageContainer">
                <div className="active-orders-page">
                    <div className="active-orders-container">
                        <div className="contentWrapper">

                            {assignmentsError && (
                                <div
                                    className="cc-verified-contracts-alert"
                                    role="alert"
                                >
        <span>
            Не удалось проверить наличие
            подтверждённых договоров.
        </span>

                                    <button
                                        type="button"
                                        onClick={refreshAssignments}
                                    >
                                        Повторить
                                    </button>
                                </div>
                            )}


                            {(pendingSigningActs.length > 0 ||
                                missingCompletionActs.length > 0) && (
                                <section className="completion-signing-queue">
                                    <h3>Оформление завершённых заказов</h3>

                                    <p>
                                        Эти действия доступны здесь.
                                        Переходить в историю заказов не требуется.
                                    </p>

                                    {pendingSigningActs.map((act) => (
                                        <div
                                            key={act.id}
                                            className="completion-signing-queue__item"
                                        >
                                            <div>
                                                <strong>
                                                    Акт по заказу №{act.orderId}
                                                </strong>

                                                <small>
                                                    {act.documentNumber}
                                                </small>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => setSigningAct(act)}
                                            >
                                                Открыть акт
                                            </button>
                                        </div>
                                    ))}

                                    {missingCompletionActs.map((orderId) => (
                                        <div
                                            key={`missing-${orderId}`}
                                            className="completion-signing-queue__item"
                                        >
                <span>
                    Документ по заказу №{orderId}
                    ещё не сформирован
                </span>

                                            <button
                                                type="button"
                                                onClick={() => retryCompletionAct(orderId)}
                                            >
                                                Сформировать акт
                                            </button>
                                        </div>
                                    ))}
                                </section>
                            )}


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
                                    {visibleRegularOrders
                                        .filter((order) => order.status === "active")
                                        .map((order) => {
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

                                        const isExecutor = Number(order.executorId) === Number(user.id);
                                        const isCreator = Number(order.creatorId) === Number(user.id);

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

                                        const hasContract =
                                            Boolean(order.contractPath);

                                        const verifiedAssignment =
                                            verifiedAssignments[
                                                String(order.id)
                                                ] || null;

                                            return (
                                                <li key={order.id} className="order-card">
                                                    <button
                                                        type="button"
                                                        className="cc-collapse-toggle"
                                                        onClick={() =>
                                                            setCollapsedRegular((prev) => ({
                                                                ...prev,
                                                                [order.id]: !prev[order.id],
                                                            }))
                                                        }
                                                    >
                                                        <span>Заказ №{order.id} · В работе</span>
                                                        <span>
                {collapsedRegular[order.id]
                    ? "Развернуть"
                    : "Свернуть"}
            </span>
                                                    </button>

                                                    {!collapsedRegular[order.id] && (
                                                        <>
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
                                                                    {(
                                                                        Number(order.finalPriceKopecks) > 0
                                                                            ? Number(order.finalPriceKopecks) / 100
                                                                            : Number(order.proposedSum ?? 0)
                                                                    ).toLocaleString("ru-RU", {
                                                                        maximumFractionDigits: 2,
                                                                    })} ₽                                                                </div>
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

                                                        {isExecutor && (
                                                            <button
                                                                className="route-button"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleRouteClick(order);
                                                                }}
                                                            >
                                                                {isMobile ? <FaRoute /> : "Маршрут"}
                                                            </button>
                                                        )}

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



                                                        ) : order.completionPhase === "needs_correction" ? (
                                                            isExecutor ? (
                                                                <button
                                                                    type="button"
                                                                    className="complete-button"
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        openCorrectionModal(order, "submit");
                                                                    }}
                                                                >
                                                                    Исправления выполнены
                                                                </button>
                                                            ) : (
                                                                <span className="completion-stage-note">
            Ожидаем исправления от исполнителя
        </span>
                                                            )
                                                        ) : order.completionPhase === "awaiting_review" ? (
                                                            isCreator ? (
                                                                <button
                                                                    type="button"
                                                                    className="complete-button"
                                                                    onClick={(event) => {
                                                                        event.stopPropagation();
                                                                        openCorrectionModal(order, "review");
                                                                    }}
                                                                >
                                                                    Проверить исправления
                                                                </button>
                                                            ) : (
                                                                <span className="completion-stage-note">
            Ожидаем решения заказчика
        </span>
                                                            )
                                                        ) : !order.workStartedAt && isExecutor ? (

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
                                                        ) : (order.workStartedAt || !hourly) ? (
                                                            <button
                                                                className="complete-button"
                                                                onClick={(event) => {
                                                                    event.stopPropagation();
                                                                    openCompletionModal(order);
                                                                }}
                                                            >
                                                                {isMobile ? <FaCheck /> : isWaitingForMe ? "Подтвердить завершение" : "Завершить"}
                                                            </button>
                                                        ) : null}
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

                                                        {hasContract && !verifiedAssignment && !assignmentsLoading && (
                                                            <div className="contract-download-row">
                                                                <button
                                                                    type="button"
                                                                    className="contract-download-button"
                                                                    onClick={async (event) => {
                                                                        event.stopPropagation();

                                                                        try {
                                                                            await downloadLegacyContract(
                                                                                order.id
                                                                            );
                                                                        } catch (error) {
                                                                            window.alert(
                                                                                error.message ||
                                                                                "Не удалось скачать договор"
                                                                            );
                                                                        }
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
                                                                </button>
                                                            </div>
                                                        )}

                                                        <VerifiedAssignmentCard
                                                            assignment={verifiedAssignment}
                                                            onSigned={refreshAssignments}
                                                        />

                                                        <OrderChangePanel
                                                            order={order}
                                                            userId={user.id}
                                                        />

                                                        <OrderWorkPhotos
                                                            order={order}
                                                            userId={user.id}
                                                            uploading={photoUploading}
                                                            onUpload={uploadOrderPhotos}
                                                            renderPhotos={renderPhotoList}
                                                        />
                                                    </div>
                                                        </>
                                                    )}
                                                </li>
                                            );
                                        })}

                                    {/* Забронированные обычные заказы */}
                                    {visibleRegularOrders
                                        .filter((order) => order.status === "reserved")
                                        .map((order) => (
                                            <RegularReservedOrderCard
                                                key={`reserved-${order.id}`}
                                                order={order}
                                                isBusy={orders.some(
                                                    (current) =>
                                                        Number(current.executorId) ===
                                                        Number(order.executorId) &&
                                                        current.status === "active"
                                                )}
                                                onOpenChat={(orderId) =>
                                                    handleOpenChat(orderId, "regular")
                                                }

                                                onCancel={async () => {
                                                    const confirmed = window.confirm(
                                                        `Отменить бронирование заказа №${order.id}?`
                                                    );

                                                    if (!confirmed) return;

                                                    try {
                                                        await axiosInstance.post(
                                                            `/orders/${order.id}/cancel-reservation`,
                                                            {}
                                                        );

                                                        await fetchActiveOrders();
                                                    } catch (error) {
                                                        alert(
                                                            error.response?.data?.message ||
                                                            "Не удалось отменить бронирование"
                                                        );
                                                    }
                                                }}
                                            />
                                        ))}

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

                            <DisputeEvidenceInput
                                files={disputeEvidenceFiles}
                                onChange={setDisputeEvidenceFiles}
                                disabled={disputeLoading}
                            />

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


                                    <div className="completion-confirmation-fields">
                                        {Number(completionModalOrder.creatorId) === Number(user?.id) && (
                                            <fieldset>
                                                <legend>Результат приёмки работ</legend>

                                                <label>
                                                    <input
                                                        type="radio"
                                                        name="completion-quality"
                                                        checked={completionQuality === "accepted"}
                                                        onChange={() => {
                                                            setCompletionQuality("accepted");
                                                            setCompletionPayoutAuthorized(false);
                                                        }}
                                                    />
                                                    Работа выполнена, претензий на момент приёмки нет
                                                </label>

                                                <label>
                                                    <input
                                                        type="radio"
                                                        name="completion-quality"
                                                        checked={completionQuality === "remarks"}
                                                        onChange={() => {
                                                            setCompletionQuality("remarks");
                                                            setCompletionPayoutAuthorized(false);
                                                        }}
                                                    />
                                                    Работа завершена, но есть замечания
                                                </label>

                                                {completionQuality === "remarks" && (
                                                    <textarea
                                                        value={completionRemarks}
                                                        onChange={(e) =>
                                                            setCompletionRemarks(e.target.value)
                                                        }
                                                        maxLength={1500}
                                                        rows={3}
                                                        placeholder="Опишите замечания"
                                                    />
                                                )}
                                            </fieldset>
                                        )}

                                        {completionModalOrder.paymentType === "cash" && (
                                            <fieldset>
                                                <legend>
                                                    {Number(completionModalOrder.creatorId) === Number(user?.id)
                                                        ? "Вы оплатили работу?"
                                                        : "Вы получили оплату за работу?"}
                                                </legend>

                                                {[
                                                    ["full", "Да, полностью"],
                                                    ["partial", "Частично"],
                                                    ["none", "Нет"],
                                                ].map(([value, label]) => (
                                                    <label key={value}>
                                                        <input
                                                            type="radio"
                                                            name="completion-cash"
                                                            checked={completionCashStatus === value}
                                                            onChange={() => setCompletionCashStatus(value)}
                                                        />
                                                        {label}
                                                    </label>
                                                ))}

                                                {completionCashStatus === "partial" && (
                                                    <input
                                                        type="text"
                                                        inputMode="decimal"
                                                        placeholder="Полученная или оплаченная сумма, ₽"
                                                        value={completionCashAmount}
                                                        onChange={(e) =>
                                                            setCompletionCashAmount(e.target.value)
                                                        }
                                                    />
                                                )}
                                            </fieldset>
                                        )}

                                        {completionModalOrder.paymentType === "guarantee" && (
                                            <div className="completion-guarantee-info">
                                                <strong>Гарантийная оплата</strong>

                                                <p>
                                                    Выплаты через гарантийную сделку временно
                                                    недоступны. Завершение заказа и приёмка
                                                    работ не инициируют списание или перевод денег.
                                                </p>
                                            </div>
                                        )}
                                        <div className="completion-guarantee-info">
                                                <strong>Гарантийная оплата</strong>

                                                <p>
                                                    Завершение работ не означает автоматическую
                                                    выплату исполнителю.
                                                </p>

                                                {Number(completionModalOrder.creatorId) ===
                                                Number(user?.id) ? (
                                                    completionQuality === "accepted" && (
                                                        <label>
                                                            <input
                                                                type="checkbox"
                                                                checked={completionPayoutAuthorized}
                                                                onChange={(e) =>
                                                                    setCompletionPayoutAuthorized(
                                                                        e.target.checked
                                                                    )
                                                                }
                                                            />
                                                            Подтверждаю приёмку результата работ
                                                            и разрешаю выплату исполнителю
                                                            в рамках гарантийной сделки.
                                                        </label>
                                                    )
                                                ) : (
                                                    <p>
                                                        После подтверждения заказчиком приёмки
                                                        и разрешения выплаты CargoCamp сможет
                                                        инициировать расчёт с исполнителем.
                                                    </p>
                                                )}
                                            </div>
                                        )}

                                        {completionModalOrder.paymentType === "installment" && (
                                            <p>
                                                Подтверждение завершения работ не означает
                                                полного погашения рассрочки.
                                            </p>
                                        )}
                                    </div>


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


                    <Modal
                        appElement={document.getElementById("root")}
                        isOpen={Boolean(correctionOrder)}
                        onRequestClose={() => {
                            if (!correctionSubmitting) {
                                setCorrectionOrder(null);
                            }
                        }}
                        contentLabel="Исправление замечаний"
                        className="completion-work-modal"
                        overlayClassName="completion-work-modal-overlay"
                    >
                        {correctionOrder && (
                            <div className="completion-work-modal__content">
                                <h2 className="completion-work-modal__title">
                                    {correctionOrder.mode === "submit"
                                        ? "Устранение замечаний"
                                        : "Проверка исправлений"}
                                </h2>

                                <p>
                                    Заказ №{correctionOrder.order.id}
                                </p>

                                {correctionOrder.order.completionRemarks && (
                                    <div className="completion-remarks-box">
                                        <strong>Замечания заказчика</strong>
                                        <p>
                                            {correctionOrder.order.completionRemarks}
                                        </p>
                                    </div>
                                )}

                                {correctionOrder.mode === "review" && (
                                    <fieldset className="completion-correction-choices">
                                        <legend>Ваше решение</legend>

                                        <label>
                                            <input
                                                type="radio"
                                                name="correction-review"
                                                checked={correctionDecision === "accepted"}
                                                onChange={() =>
                                                    setCorrectionDecision("accepted")
                                                }
                                            />
                                            Исправления приняты, замечаний больше нет
                                        </label>

                                        <label>
                                            <input
                                                type="radio"
                                                name="correction-review"
                                                checked={correctionDecision === "rejected"}
                                                onChange={() =>
                                                    setCorrectionDecision("rejected")
                                                }
                                            />
                                            Остались недостатки
                                        </label>
                                    </fieldset>
                                )}

                                <textarea
                                    rows={4}
                                    maxLength={1500}
                                    value={correctionComment}
                                    onChange={(event) =>
                                        setCorrectionComment(event.target.value)
                                    }
                                    placeholder={
                                        correctionOrder.mode === "submit"
                                            ? "Расскажите, что исправлено"
                                            : correctionDecision === "rejected"
                                                ? "Какие замечания остались?"
                                                : "Комментарий (необязательно)"
                                    }
                                />

                                <div className="completion-work-modal__actions">
                                    <button
                                        type="button"
                                        className="completion-work-modal__cancel"
                                        disabled={correctionSubmitting}
                                        onClick={() => setCorrectionOrder(null)}
                                    >
                                        Отмена
                                    </button>

                                    <button
                                        type="button"
                                        className="completion-work-modal__submit"
                                        disabled={
                                            correctionSubmitting ||
                                            (
                                                correctionOrder.mode === "review" &&
                                                !correctionDecision
                                            ) ||
                                            (
                                                (
                                                    correctionOrder.mode === "submit" ||
                                                    correctionDecision === "rejected"
                                                ) &&
                                                correctionComment.trim().length < 10
                                            )
                                        }
                                        onClick={submitCorrectionModal}
                                    >
                                        {correctionSubmitting
                                            ? "Сохраняем..."
                                            : "Подтвердить"}
                                    </button>
                                </div>
                            </div>
                        )}
                    </Modal>



                    <Modal
                        appElement={document.getElementById("root")}
                        isOpen={Boolean(signingAct)}
                        onRequestClose={() => setSigningAct(null)}
                        contentLabel="Подписание акта завершения"
                        className="completion-work-modal"
                        overlayClassName="completion-work-modal-overlay"
                    >
                        {signingAct && (
                            <div className="completion-work-modal__content">
                                <button
                                    type="button"
                                    className="completion-work-modal__close"
                                    onClick={() => setSigningAct(null)}
                                >
                                    ✖
                                </button>

                                <h2 className="completion-work-modal__title">
                                    Акт завершения заказа
                                </h2>

                                <p>
                                    {signingAct.documentNumber}
                                </p>

                                <div className="completion-signing-details">
                                    <strong>Документ сформирован</strong>

                                    <p>
                                        Ознакомьтесь с PDF перед подписанием.
                                    </p>

                                    <small>
                                        SHA-256: {signingAct.documentHash}
                                    </small>
                                </div>

                                <button
                                    type="button"
                                    className="completion-work-modal__submit"
                                    onClick={async () => {
                                        try {
                                            await downloadVerifiedContract(
                                                signingAct.id,
                                                signingAct.version,
                                                "act"
                                            );
                                        } catch (error) {
                                            alert(
                                                error.message ||
                                                "Не удалось открыть PDF"
                                            );
                                        }
                                    }}
                                >
                                    Скачать и прочитать акт PDF
                                </button>

                                <SignatureAgreementPanel />

                                <ContractSigningPanel
                                    key={signingAct.id}
                                    assignment={signingAct}
                                    defaultOpened
                                    onSigned={fetchPendingSigningActs}
                                />

                                <button
                                    type="button"
                                    className="completion-work-modal__cancel"
                                    onClick={() => setSigningAct(null)}
                                >
                                    Закрыть
                                </button>
                            </div>
                        )}
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