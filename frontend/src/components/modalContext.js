import { toast } from "react-toastify";
import React, { createContext, useState, useEffect } from "react";
import { socket } from "../socketClient";
import axiosInstance from "../utils/axiosInstance";
import "../styles/modalContext.css";
import axios from "axios";
import ReviewModal from "../components/ReviewModal";
import PaymentProviderSelect from "../components/PaymentProviderSelect";
import {
    shouldRemindReview,
    markReminded,
    hasSubmittedReview,
    markReviewSubmitted,
} from "../utils/reviewReminder";

export const ModalContext = createContext(null);

const formatRub = (value) => {
    const n = Number(value || 0);
    return `${n.toLocaleString("ru-RU")} ₽`;
};

const formatDuration = (start, end) => {
    if (!start || !end) return "—";

    const startDate = new Date(start);
    const endDate = new Date(end);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return "—";

    const diffMs = endDate - startDate;
    if (diffMs <= 0) return "—";

    const totalMin = Math.floor(diffMs / 60000);
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;

    if (hours > 0 && mins > 0) return `${hours} ч ${mins} мин`;
    if (hours > 0) return `${hours} ч`;
    return `${mins} мин`;
};

// ✅ кто может оставлять отзыв
const canReviewOrder = ({ orderType, userId, creatorId, executorId }) => {
    if (!userId) return false;

    // для экспресс-заказа отзыв первым оставляет заказчик
    if (orderType === "express") {
        return Number(userId) === Number(creatorId);
    }

    // для обычного заказа оставляем текущую логику — участник заказа
    return (
        Number(userId) === Number(creatorId) ||
        Number(userId) === Number(executorId)
    );
};

export const ModalProvider = ({ children }) => {
    const [modalData, setModalData] = useState(null);
    const [userId, setUserId] = useState(null);
    const [notificationData, setNotificationData] = useState(null);
    const [completionNotificationData, setCompletionNotificationData] = useState(null);
    const [expressAcceptedData, setExpressAcceptedData] = useState(null);
    const [expressCancelledData, setExpressCancelledData] = useState(null);

    const [showRatingModal, setShowRatingModal] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState(null);
    const [rating, setRating] = useState(0);
    const [currUser, setCurrUser] = useState(null);
    const [reviewLoading, setReviewLoading] = useState(false);

    const [debtModalData, setDebtModalData] = useState(null);
    const [debtPayLoading, setDebtPayLoading] = useState(false);

    const [completionSuccessData, setCompletionSuccessData] = useState(null);

    const [selectedDebtProvider, setSelectedDebtProvider] = useState("yookassa");
    const [selectedNotificationDebtProvider, setSelectedNotificationDebtProvider] = useState("yookassa");


    useEffect(() => {
        const fetchUserData = async () => {
            try {
                const response = await axiosInstance.get("/auth/profile");
                setCurrUser(response.data);
                setUserId(response.data.id);
            } catch (error) {
                console.log("⛔️ Ошибка поймана:", error);

                if (axios.isAxiosError(error)) {
                    if (error.response?.status === 401) {
                        console.info("ℹ️ Пользователь не авторизован");
                        return;
                    }

                    console.warn(
                        "⚠️ Ответ сервера с ошибкой:",
                        error.response?.status,
                        error.response?.data
                    );
                } else {
                    console.error("❌ Неизвестная ошибка:", error);
                }
            }
        };

        fetchUserData();
    }, []);

    const getExpressAcceptedModalKey = (orderId) => {
        return `express_accepted_modal_shown_${orderId}`;
    };

    const openExpressAcceptedModal = (data) => {
        if (!data?.orderId) return;

        const orderId = data.orderId || data?.data?.orderId;
        const creatorId = data.creatorId || data?.data?.creatorId;
        const executorId = data.executorId || data?.data?.executorId;
        const status = data.status || data?.data?.status;
        const expressType =
            data.type ||
            data.expressType ||
            data?.data?.type ||
            data?.data?.expressType;

        if (!orderId) return;
        if (status && status !== "accepted") return;
        if (Number(creatorId) !== Number(userId)) return;

        const shownKey = getExpressAcceptedModalKey(orderId);

        // ✅ защита от повторного открытия при каждом new_notification/status update
        if (localStorage.getItem(shownKey) === "1") {
            return;
        }

        localStorage.setItem(shownKey, "1");

        setExpressAcceptedData({
            title: data.title || "Экспресс-заказ принят",
            description:
                data.message ||
                data.body ||
                `Исполнитель принял ваш экспресс-заказ №${orderId}`,
            orderId,
            creatorId,
            executorId,
            orderType: "express",
            expressType,
            status: "accepted",
        });
    };

    const handleExpressOrderAccepted = (data) => {
        console.log("🔔 Экспресс-заказ принят:", data, "current userId:", userId);

        if (!data?.orderId) return;

        const creatorId = data.creatorId || data?.data?.creatorId;

        if (Number(creatorId) === Number(userId)) {
            openExpressAcceptedModal(data);
        }
    };

    const handleExpressOrderStatusChanged = (data) => {
        if (!data?.status) return;
    };

    const openReviewFromCompletion = (
        orderId,
        creatorId,
        executorId,
        orderType = "regular"
    ) => {
        if (!orderId) return;

        // ✅ если отзыв уже отправлен локально — не открываем модалку
        if (hasSubmittedReview(orderId, orderType)) {
            toast.info("Вы уже оставили отзыв по этому заказу");
            return;
        }

        setSelectedOrder({
            id: orderId,
            creatorId,
            executorId,
            orderType,
            isExpress: orderType === "express",
        });

        setCompletionNotificationData(null);
        setCompletionSuccessData(null);

        setRating(0);
        setShowRatingModal(true);
    };

    const openReviewFromPushPayload = (payload) => {
        if (!payload?.orderId) return false;

        const orderId = payload.orderId;
        const orderType = payload.orderType || "regular";

        // ВАЖНО:
        // При клике по пушу НЕ используем shouldRemindReview.
        // shouldRemindReview может заблокировать открытие на 24 часа,
        // если напоминание уже показывалось.
        // Но если пользователь сам нажал пуш — модалку надо открыть.
        if (hasSubmittedReview(orderId, orderType)) {
            toast.info("Вы уже оставили отзыв по этому заказу");
            return false;
        }

        const creatorId = payload.creatorId;
        const executorId = payload.executorId;

        if (!creatorId || !executorId) {
            console.warn("review push payload without creatorId/executorId:", payload);
            return false;
        }

        openReviewFromCompletion(
            orderId,
            creatorId,
            executorId,
            orderType
        );

        markReminded(orderId, orderType);

        return true;
    };

    useEffect(() => {
        if (!userId) return;

        const openPendingReview = () => {
            const raw = localStorage.getItem("pendingReviewFromPush");
            if (!raw) return;

            try {
                const payload = JSON.parse(raw);

                const opened = openReviewFromPushPayload(payload);

                // Удаляем только если реально открыли модалку
                // или если отзыв уже был отправлен.
                // Иначе не теряем payload раньше времени.
                if (opened || hasSubmittedReview(payload?.orderId, payload?.orderType || "regular")) {
                    localStorage.removeItem("pendingReviewFromPush");
                }
            } catch (e) {
                console.error("openReviewFromPush error:", e);
                localStorage.removeItem("pendingReviewFromPush");
            }
        };

        window.addEventListener("openReviewFromPush", openPendingReview);

        // на случай холодного запуска приложения по пушу
        setTimeout(openPendingReview, 500);

        return () => {
            window.removeEventListener("openReviewFromPush", openPendingReview);
        };
    }, [userId]);

    const openCompletionSuccessModal = (payload) => {
        setCompletionSuccessData(payload);
    };

    const closeCompletionSuccessModal = () => {
        setCompletionSuccessData(null);
    };

    const handleExpressAcceptedClose = () => {
        setExpressAcceptedData(null);
    };

    const getExpressCancelledModalKey = (orderId, cancelledBy) => {
        return `express_cancelled_modal_shown_${orderId}_${cancelledBy || "unknown"}`;
    };

    const openExpressCancelledModal = (data) => {
        const orderId = data?.orderId || data?.id || data?.data?.orderId;
        if (!orderId) return;

        const orderType = data?.orderType || data?.data?.orderType;
        if (orderType !== "express") return;

        const status = data?.status || data?.data?.status;
        if (status !== "cancelled") return;

        const creatorId = data?.creatorId || data?.data?.creatorId;
        const executorId = data?.executorId || data?.data?.executorId;

        const isParticipant =
            Number(userId) === Number(creatorId) ||
            Number(userId) === Number(executorId);

        if (!isParticipant) return;

        const cancelledBy = data?.cancelledBy || data?.data?.cancelledBy;
        const cancelledByRole = data?.cancelledByRole || data?.data?.cancelledByRole;

        // ✅ если нет cancelledBy — не открываем,
        // чтобы модалка не всплывала от старых/общих событий
        if (!cancelledBy) return;

        const cancelledByMe = Number(cancelledBy) === Number(userId);

        const shownKey = getExpressCancelledModalKey(orderId, cancelledBy);

        if (localStorage.getItem(shownKey) === "1") {
            return;
        }

        localStorage.setItem(shownKey, "1");

        let cancelledText = "Экспресс-заказ был отменён.";

        if (cancelledByMe) {
            cancelledText = "Вы отменили экспресс-заказ.";
        } else if (cancelledByRole === "creator") {
            cancelledText = "Заказчик отменил экспресс-заказ.";
        } else if (cancelledByRole === "executor") {
            cancelledText = "Исполнитель отменил экспресс-заказ.";
        }

        setCompletionNotificationData(null);
        setCompletionSuccessData(null);
        setExpressAcceptedData(null);

        setExpressCancelledData({
            title: data?.title || "Экспресс-заказ отменён",
            description:
                data?.message ||
                data?.body ||
                `${cancelledText} Заказ №${orderId}`,
            orderId,
            creatorId,
            executorId,
            cancelledBy,
            cancelledByRole,
            cancelledByMe,
            orderType: "express",
        });
    };

    const handleExpressCancelledClose = () => {
        setExpressCancelledData(null);
    };

    const openReviewFromCancellation = () => {
        if (!expressCancelledData?.orderId) return;

        const {
            orderId,
            creatorId,
            executorId,
            cancelledBy,
            cancelledByMe,
        } = expressCancelledData;

        if (cancelledByMe) {
            toast.info("Вы отменили заказ сами");
            return;
        }

        if (!cancelledBy) {
            toast.error("Не удалось определить, кого оценивать");
            return;
        }

        const orderType = "express";

        if (hasSubmittedReview(orderId, orderType)) {
            toast.info("Вы уже оставили отзыв по этому заказу");
            return;
        }

        setSelectedOrder({
            id: orderId,
            creatorId,
            executorId,
            toUserId: cancelledBy, // ✅ оцениваем того, кто отменил
            orderType,
            isExpress: true,
            isCancellationReview: true,
        });

        setExpressCancelledData(null);
        setCompletionNotificationData(null);
        setCompletionSuccessData(null);

        setRating(0);
        setShowRatingModal(true);
    };

    const handleSubmitReview = async ({ rating, text }) => {
        if (!selectedOrder?.id) {
            toast.error("Заказ не выбран");
            return false;
        }

        try {
            setReviewLoading(true);

            const orderType =
                selectedOrder.orderType ||
                (selectedOrder.isExpress ? "express" : "regular");

            await axiosInstance.post("/auth/review", {
                orderId: selectedOrder.id,
                rating,
                text,
                isExpress: !!selectedOrder.isExpress,
                orderType,
                toUserId: selectedOrder.toUserId || null,
                isCancellationReview: !!selectedOrder.isCancellationReview,
            });

            // ✅ больше не показываем напоминание по этому заказу
            markReviewSubmitted(selectedOrder.id, orderType);

            toast.success("Отзыв отправлен");

            setShowRatingModal(false);
            setSelectedOrder(null);
            setRating(0);

            setCompletionNotificationData(null);
            setCompletionSuccessData(null);
            setExpressCancelledData(null);

            return true;
        } catch (e) {
            console.error("Ошибка отправки отзыва:", e);

            // ✅ если сервер говорит, что отзыв уже есть — тоже помечаем локально
            if (
                e.response?.status === 409 ||
                String(e.response?.data?.message || "").toLowerCase().includes("уже")
            ) {
                const orderType =
                    selectedOrder.orderType ||
                    (selectedOrder.isExpress ? "express" : "regular");

                markReviewSubmitted(selectedOrder.id, orderType);

                setShowRatingModal(false);
                setSelectedOrder(null);
                setCompletionNotificationData(null);
                setCompletionSuccessData(null);

                toast.info("Вы уже оставляли отзыв по этому заказу");
                return true;
            }

            toast.error(e.response?.data?.message || "Не удалось отправить отзыв");
            return false;
        } finally {
            setReviewLoading(false);
        }
    };

    const payDebtFromModal = async () => {
        if (!debtModalData) return;

        await payDebt({
            returnPath: debtModalData.returnPath,
            provider: selectedDebtProvider,
        });
    };

    const handleNotificationClose = () => {
        setNotificationData(null);
    };

    const handleCompletionNotificationClose = () => {
        setCompletionNotificationData(null);
    };

    useEffect(() => {
        if (!userId) return;

        socket.emit("register", userId);

        const handleOrderApproved = (data) => {
            console.log("🔔 Заказ одобрен:", data);

            if (typeof data.debt === "number") {
                setCurrUser((prev) => (prev ? { ...prev, debt: data.debt } : prev));
            }

            if (data.message?.includes("Ваш запрос")) {
                const isPremiumUser = !!data.isPremium;

                setNotificationData({
                    title: "Ваш запрос одобрен!",
                    description: `Заказ номер ${data.orderId}: ${data.message}`,
                    isPremium: isPremiumUser,
                    orderId: data.orderId,

                    debt: Number(data.debt || 0),
                    needPay: !!data.needPay,
                    paid: !!data.paid,

                    commissionKopecks: Number(data.commissionKopecks || 0),

                    autoPaymentTried: !!data.autoPaymentTried,
                    autoPaymentPaid: !!data.autoPaymentPaid,
                    autoPaymentProcessing: !!data.autoPaymentProcessing,
                    autoPaymentStatus: data.autoPaymentStatus || null,
                });
            }
        };

        const handleExpressOrderCompleted = (data) => {
            console.log("🔔 Экспресс-заказ завершён:", data);

            if (!data?.orderId) return;

            const orderId = data.orderId;
            const orderType = "express";

            if (hasSubmittedReview(orderId, orderType)) {
                return;
            }

            if (!shouldRemindReview(orderId, orderType)) {
                return;
            }

            markReminded(orderId, orderType);

            setCompletionNotificationData({
                title: "Экспресс-заказ завершён",
                description: `Заказ номер ${orderId}: ${data.message || "Оцените исполнителя и оставьте отзыв"}`,
                orderId,
                creatorId: data.creatorId,
                executorId: data.executorId,
                orderType,
            });
        };

        const handleOrderCompleted = (data) => {
            console.log("🔔 Уведомление о завершении заказа:", data);

            if (data.message) {
                setCompletionNotificationData({
                    title: "Ожидание завершения заказа",
                    description: `Заказ номер ${data.orderId}: ${data.message}`,
                    orderId: data.orderId,
                    creatorId: data.creatorId,
                    executorId: data.executorId,
                    orderType: data.orderType || "regular",
                });
            }
        };

        const handleNewNotification = (notifications) => {

            const list = Array.isArray(notifications) ? notifications : [notifications];

            // ✅ Не обрабатываем order_push здесь,

            // потому что он уже обрабатывается в App через new_notification / push_notification

            const hasOrderPush = list.some((n) => {

                return n.type === "order_push" || n?.data?.type === "order_push";

            });

            if (hasOrderPush) {

                return;

            }

            const cancelledNotification = list.find((n) => {

                const orderType = n.orderType || n?.data?.orderType;

                const status = n?.data?.status;

                return (

                    orderType === "express" &&

                    n.type === "express_cancelled" &&

                    status === "cancelled" &&

                    (n.orderId || n?.data?.orderId) &&

                    n?.data?.cancelledBy

                );

            });

            const isNotificationFresh = (n, maxAgeMs = 2 * 60 * 1000) => {
                const raw =
                    n?.createdAt ||
                    n?.created_at ||
                    n?.data?.createdAt ||
                    n?.data?.created_at;

                if (!raw) return false;

                const ts = new Date(raw).getTime();

                if (!Number.isFinite(ts)) return false;

                return Date.now() - ts <= maxAgeMs;
            };

            if (cancelledNotification && isNotificationFresh(cancelledNotification)) {
                openExpressCancelledModal({
                    orderId: cancelledNotification.orderId || cancelledNotification?.data?.orderId,
                    title: cancelledNotification.title || "Экспресс-заказ отменён",
                    body: cancelledNotification.body,
                    message: cancelledNotification.body,
                    creatorId: cancelledNotification?.data?.creatorId,
                    executorId: cancelledNotification?.data?.executorId,
                    cancelledBy: cancelledNotification?.data?.cancelledBy,
                    cancelledByRole: cancelledNotification?.data?.cancelledByRole,
                    status: cancelledNotification?.data?.status || "cancelled",
                    orderType: "express",
                    data: cancelledNotification.data,
                });

                return;
            }

            const reviewNotification = list.find((n) => {
                const orderType = n.orderType || n?.data?.orderType;
                return (
                    orderType === "express" &&
                    n.type === "review_needed" &&
                    n.orderId
                );
            });

            if (!reviewNotification) return;

            const orderId = reviewNotification.orderId || reviewNotification?.data?.orderId;
            const orderType = "express";

            if (hasSubmittedReview(orderId, orderType)) {
                return;
            }

            if (!shouldRemindReview(orderId, orderType)) {
                return;
            }

            markReminded(orderId, orderType);

            setCompletionNotificationData({
                title: reviewNotification.title || "Экспресс-заказ завершён",
                description:
                    reviewNotification.body ||
                    `Заказ номер ${reviewNotification.orderId}: Оставьте отзыв`,
                orderId: reviewNotification.orderId || reviewNotification?.data?.orderId,
                creatorId: reviewNotification?.data?.creatorId,
                executorId: reviewNotification?.data?.executorId,
                orderType: "express",
            });
        };

        const handleExpressOrderCancelled = (data) => {

            openExpressCancelledModal(data);
        };

        const handleReviewNeeded = (data) => {
            setCompletionNotificationData({
                title: "Заказ завершён",
                description: `Заказ номер ${data.orderId}: ${data.message || "Оставьте отзыв"}`,
                orderId: data.orderId,
                creatorId: data.creatorId,
                executorId: data.executorId,
                orderType: data.orderType || "regular",
            });
        };

        socket.on("orderApproved", handleOrderApproved);
        socket.on("orderCompleted", handleOrderCompleted);
        socket.on("expressOrderCompleted", handleExpressOrderCompleted);
        socket.on("reviewNeeded", handleReviewNeeded);
        socket.on("expressOrderAccepted", handleExpressOrderAccepted);
        socket.on("expressOrderStatusChanged", handleExpressOrderStatusChanged);
        socket.on("new_notification", handleNewNotification);
        socket.on("expressOrderCancelled", handleExpressOrderCancelled);

        return () => {
            socket.off("orderApproved", handleOrderApproved);
            socket.off("orderCompleted", handleOrderCompleted);
            socket.off("expressOrderCompleted", handleExpressOrderCompleted);
            socket.off("reviewNeeded", handleReviewNeeded);
            socket.off("expressOrderAccepted", handleExpressOrderAccepted);
            socket.off("expressOrderStatusChanged", handleExpressOrderStatusChanged);
            socket.off("new_notification", handleNewNotification);
            socket.off("expressOrderCancelled", handleExpressOrderCancelled);
        };
    }, [userId]);

    const openDebtModal = ({ title, description, amount, returnPath }) => {
        setDebtModalData({
            title: title || "Нужно погасить задолженность",
            description:
                description ||
                "У вас есть задолженность по комиссии. Чтобы взять заказ в работу, сначала оплатите её.",
            amount: Number(amount || 0),
            returnPath: returnPath || "/profile?debtReturn=1",
        });
    };

    const closeDebtModal = () => {
        if (debtPayLoading) return;
        setDebtModalData(null);
    };

    const payDebt = async ({ returnPath, provider }) => {
        try {
            setDebtPayLoading(true);

            const endpoint =
                provider === "tbank"
                    ? "/tbank-payments/debt/create"
                    : "/payments/debt/create";

            const res = await axiosInstance.post(endpoint, {
                returnPath: returnPath || "/profile?debtReturn=1",
            });

            if (!res.data?.success) {
                toast.error(res.data?.error || "Ошибка оплаты");
                setDebtPayLoading(false);
                return;
            }

            if (res.data.noDebt) {
                toast.info("Долгов нет");
                setDebtModalData(null);
                setNotificationData(null);
                setDebtPayLoading(false);
                return;
            }

            /**
             * Это актуально для ЮKassa, если есть сохранённая карта.
             * Для Т-Банка сейчас будет обычный редирект.
             */
            if (res.data.paidBySavedCard) {
                toast.info("Пробуем списать с привязанной карты...");

                setTimeout(async () => {
                    try {
                        const refreshed = await axiosInstance.get("/auth/profile");
                        setCurrUser(refreshed.data);

                        const freshDebt = Number(refreshed.data.debt || 0);

                        if (freshDebt === 0) {
                            setDebtModalData(null);
                            setNotificationData(null);
                            toast.success("Комиссия оплачена ✅");
                        } else {
                            toast.warning(
                                "Платёж не завершён или не прошёл. Задолженность осталась."
                            );

                            setNotificationData((prev) =>
                                prev
                                    ? {
                                        ...prev,
                                        debt: freshDebt,
                                        needPay: true,
                                        paid: false,
                                        autoPaymentProcessing: false,
                                        autoPaymentPaid: false,
                                    }
                                    : prev
                            );
                        }
                    } catch (e) {
                        console.error(e);
                        toast.error("Не удалось обновить профиль после оплаты");
                    } finally {
                        setDebtPayLoading(false);
                    }
                }, 3000);

                return;
            }

            if (!res.data.confirmationUrl) {
                toast.error("Ссылка на оплату не получена");
                setDebtPayLoading(false);
                return;
            }

            window.location.href = res.data.confirmationUrl;
        } catch (e) {
            console.error(e);
            toast.error(e.response?.data?.error || "Ошибка оплаты комиссии");
            setDebtPayLoading(false);
        }
    };

    const handleCompleteOrder = async (orderId, creatorId, executorId, orderType = "regular") => {
        try {
            setCompletionNotificationData(null);

            if (orderType === "express") {
                // Если для express у тебя отдельный endpoint завершения,
                // лучше сюда потом поставить его.
                openReviewFromCompletion(orderId, creatorId, executorId, orderType);
                return;
            }

            const res = await axiosInstance.post(`/orders/complete/${orderId}`, {});

            const completedOrder = res.data;

            openReviewFromCompletion(
                completedOrder?.id || orderId,
                completedOrder?.creatorId || creatorId,
                completedOrder?.executorId || executorId,
                orderType
            );

            toast.success("Завершение подтверждено");
        } catch (e) {
            console.error("Ошибка подтверждения завершения:", e);
            toast.error(e.response?.data?.message || "Не удалось завершить заказ");
        }
    };

    const canReviewFromCompletionNotification = completionNotificationData
        ? canReviewOrder({
            orderType: completionNotificationData.orderType,
            userId,
            creatorId: completionNotificationData.creatorId,
            executorId: completionNotificationData.executorId,
        })
        : false;

    const canReviewFromSuccessModal = completionSuccessData
        ? canReviewOrder({
            orderType: completionSuccessData.orderType,
            userId,
            creatorId: completionSuccessData.creatorId,
            executorId: completionSuccessData.executorId,
        })
        : false;

    return (
        <ModalContext.Provider
            value={{
                openModal: setModalData,
                closeModal: () => setModalData(null),

                showRatingModal,
                setShowRatingModal,
                selectedOrder,
                setSelectedOrder,
                rating,
                setRating,

                currUser,
                setCurrUser,

                openCompletionSuccessModal,
                closeCompletionSuccessModal,
                openReviewFromCompletion,

                openDebtModal,
                closeDebtModal,
            }}
        >
            {children}


            {expressAcceptedData && (
                <div className="modal-overlay">
                    <div className="modal modal-compact">
                        <button
                            className="modal-close"
                            onClick={handleExpressAcceptedClose}
                            aria-label="Закрыть"
                            type="button"
                        >
                            ×
                        </button>

                        <div className="modal-icon">🚀</div>
                        <h2 className="modal-title">{expressAcceptedData.title}</h2>
                        <p className="modal-text">{expressAcceptedData.description}</p>

                        <div className="modal-note modal-note-success">
                            Исполнитель уже видит заказ в активных и может менять статус выполнения.
                        </div>

                        <div className="modal-actions">
                            <button
                                className="modal-btn modal-btn-primary"
                                onClick={() => {
                                    setExpressAcceptedData(null);
                                    window.location.href = "/active-orders?view=created";
                                }}
                            >
                                Открыть активный заказ
                            </button>

                            <button
                                className="modal-btn modal-btn-ghost"
                                onClick={handleExpressAcceptedClose}
                            >
                                Понятно
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {notificationData && (
                <div className="modal-overlay">
                    <div className="modal modal-compact">
                        <button
                            className="modal-close"
                            onClick={handleNotificationClose}
                            aria-label="Закрыть"
                            type="button"
                        >
                            ×
                        </button>

                        <div className="modal-icon">✓</div>
                        <h2 className="modal-title">{notificationData.title}</h2>
                        <p className="modal-text">{notificationData.description}</p>

                        {notificationData.isPremium ? (
                            <>
                                <div className="modal-note modal-note-success">
                                    У вас активен Premium — комиссия не требуется.
                                </div>

                                <div className="modal-actions">
                                    <button className="modal-btn modal-btn-primary" onClick={handleNotificationClose}>
                                        Понятно
                                    </button>
                                </div>
                            </>
                        ) : notificationData.autoPaymentPaid ? (
                            <>
                                <div className="modal-note modal-note-success">
                                    Комиссия списана с привязанной карты ✅
                                </div>

                                <div className="modal-actions">
                                    <button className="modal-btn modal-btn-primary" onClick={handleNotificationClose}>
                                        Понятно
                                    </button>
                                </div>
                            </>
                        ) : notificationData.autoPaymentProcessing ? (
                            <>
                                <div className="modal-note">
                                    Комиссия списывается с привязанной карты. Если платёж не пройдёт, задолженность останется в профиле.
                                </div>

                                <div className="modal-actions">
                                    <button className="modal-btn modal-btn-primary" onClick={handleNotificationClose}>
                                        Понятно
                                    </button>
                                </div>
                            </>
                        ) : notificationData.debt > 0 ? (
                            <>
                                <PaymentProviderSelect
                                    selectedProvider={selectedNotificationDebtProvider}
                                    onSelect={setSelectedNotificationDebtProvider}
                                    disabled={debtPayLoading}
                                />

                                <div className="modal-note">
                                    Комиссия к оплате: <b>{Math.round(notificationData.debt / 100)} ₽</b>
                                </div>

                                <div className="modal-actions">
                                    <button
                                        className="modal-btn modal-btn-primary"
                                        onClick={() =>
                                            payDebt({
                                                returnPath: "/profile?debtReturn=1",
                                                provider: selectedNotificationDebtProvider,
                                            })
                                        }
                                        disabled={debtPayLoading}
                                    >
                                        {debtPayLoading ? "Переходим к оплате..." : "Оплатить сейчас"}
                                    </button>

                                    <button
                                        className="modal-btn modal-btn-ghost"
                                        onClick={handleNotificationClose}
                                        disabled={debtPayLoading}
                                    >
                                        Позже
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div className="modal-actions">
                                <button className="modal-btn modal-btn-primary" onClick={handleNotificationClose}>
                                    Понятно
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {expressCancelledData && (
                <div className="modal-overlay">
                    <div className="modal modal-compact">
                        <button
                            className="modal-close"
                            onClick={handleExpressCancelledClose}
                            aria-label="Закрыть"
                            type="button"
                        >
                            ×
                        </button>

                        <div className="modal-icon">🚫</div>

                        <h2 className="modal-title">
                            {expressCancelledData.title || "Экспресс-заказ отменён"}
                        </h2>

                        <p className="modal-text">
                            {expressCancelledData.description ||
                                `Экспресс-заказ №${expressCancelledData.orderId} отменён.`}
                        </p>

                        <div className="modal-note">
                            Заказ больше не активен. Вы можете перейти ко всем заказам и выбрать другой.
                        </div>

                        <div className="modal-actions">
                            {!expressCancelledData.cancelledByMe && expressCancelledData.cancelledBy && (
                                <button
                                    className="modal-btn modal-btn-primary"
                                    onClick={openReviewFromCancellation}
                                >
                                    Оценить участника
                                </button>
                            )}

                            <button
                                className="modal-btn modal-btn-primary"
                                onClick={() => {
                                    setExpressCancelledData(null);
                                    window.location.href = "/orders";
                                }}
                            >
                                Ко всем заказам
                            </button>

                            <button
                                className="modal-btn modal-btn-ghost"
                                onClick={handleExpressCancelledClose}
                            >
                                Понятно
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {completionNotificationData && (
                <div className="modal-overlay">
                    <div className="modal modal-compact">
                        <button
                            className="modal-close"
                            onClick={handleCompletionNotificationClose}
                            aria-label="Закрыть"
                            type="button"
                        >
                            ×
                        </button>

                        <div className="modal-icon">
                            {completionNotificationData.orderType === "express" ? "⭐" : "⏳"}
                        </div>

                        <h2 className="modal-title">
                            {completionNotificationData.orderType === "express"
                                ? "Экспресс-заказ завершён"
                                : completionNotificationData.title}
                        </h2>

                        <p className="modal-text">
                            {completionNotificationData.orderType === "express"
                                ? `Заказ номер ${completionNotificationData.orderId}: оцените исполнителя и оставьте отзыв`
                                : completionNotificationData.description}
                        </p>

                        <div className="modal-actions">
                            {canReviewFromCompletionNotification && (
                                <button
                                    className="modal-btn modal-btn-primary"
                                    onClick={() =>
                                        handleCompleteOrder(
                                            completionNotificationData.orderId,
                                            completionNotificationData.creatorId,
                                            completionNotificationData.executorId,
                                            completionNotificationData.orderType
                                        )
                                    }
                                >
                                    {completionNotificationData.orderType === "express"
                                        ? "Оставить отзыв"
                                        : "Завершить"}
                                </button>
                            )}

                            <button
                                className="modal-btn modal-btn-ghost"
                                onClick={handleCompletionNotificationClose}
                            >
                                {canReviewFromCompletionNotification ? "Позже" : "Закрыть"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {completionSuccessData && (
                <div className="modal-overlay">
                    <div className="modal modal-compact modal-success">
                        <button
                            className="modal-close"
                            onClick={closeCompletionSuccessModal}
                            aria-label="Закрыть"
                            type="button"
                        >
                            ×
                        </button>

                        <div className="modal-icon modal-icon-party">🎉</div>
                        <h2 className="modal-title">Заказ успешно завершён</h2>
                        <p className="modal-text">{completionSuccessData.title}</p>

                        <div className="modal-summary">
                            <div className="modal-summary-row">
                                <span>Ваш доход</span>
                                <b>{formatRub(completionSuccessData.amount)}</b>
                            </div>

                            <div className="modal-summary-row">
                                <span>Время выполнения</span>
                                <b>{formatDuration(completionSuccessData.startedAt, completionSuccessData.completedAt)}</b>
                            </div>
                        </div>

                        <div className="modal-actions">
                            {canReviewFromSuccessModal && (
                                <button
                                    className="modal-btn modal-btn-primary"
                                    onClick={() =>
                                        openReviewFromCompletion(
                                            completionSuccessData.orderId,
                                            completionSuccessData.creatorId,
                                            completionSuccessData.executorId,
                                            completionSuccessData.orderType || "regular"
                                        )
                                    }
                                >
                                    Оставить отзыв
                                </button>
                            )}

                            <button
                                className="modal-btn modal-btn-ghost"
                                onClick={closeCompletionSuccessModal}
                            >
                                Закрыть
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {debtModalData && (
                <div className="modal-overlay">
                    <div className="modal modal-compact">
                        <button
                            className="modal-close"
                            onClick={closeDebtModal}
                            aria-label="Закрыть"
                            type="button"
                        >
                            ×
                        </button>

                        <div className="modal-icon">⚠️</div>
                        <h2 className="modal-title">{debtModalData.title}</h2>
                        <p className="modal-text">{debtModalData.description}</p>

                        <div className="modal-note">
                            К оплате: <b>{Math.round(debtModalData.amount / 100)} ₽</b>
                        </div>

                        <PaymentProviderSelect
                            selectedProvider={selectedDebtProvider}
                            onSelect={setSelectedDebtProvider}
                            disabled={debtPayLoading}
                        />

                        <div className="modal-actions">
                            <button
                                className="modal-btn modal-btn-primary"
                                onClick={payDebtFromModal}
                                disabled={debtPayLoading}
                            >
                                {debtPayLoading ? "Переходим к оплате..." : "Оплатить сейчас"}
                            </button>

                            <button
                                className="modal-btn modal-btn-ghost"
                                onClick={closeDebtModal}
                                disabled={debtPayLoading}
                            >
                                Позже
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ReviewModal
                isOpen={showRatingModal}
                onClose={() => {
                    if (reviewLoading) return;
                    setShowRatingModal(false);
                    setSelectedOrder(null);
                }}
                onSubmit={handleSubmitReview}
                loading={reviewLoading}
                title="Оставить отзыв"
                subtitle="Оцените участника и при желании добавьте комментарий"
            />
        </ModalContext.Provider>
    );
};