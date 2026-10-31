import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Capacitor } from "@capacitor/core";
import axios from "axios";
import DisputeEvidenceInput from "../components/DisputeEvidenceInput";
import axiosInstance from "../utils/axiosInstance";
import { useParams, useNavigate } from "react-router-dom";
import "../styles/ChatPage.css";
import "../styles/ChatPageDark.css";
import "../styles/ChatMessageSync.css";
import { useUser } from "../utils/userContext";
import useOrderChatSync from "../hooks/useOrderChatSync";
import Modal from "react-modal";
import { openOrderRoute } from "../utils/orderNavigation";
import ReliableChatComposer from "../components/ReliableChatComposer";
import ChatReadTracker from "../components/ChatReadTracker";

const apiUrl = process.env.REACT_APP_API_URL;

function getAvatarUrl(user) {
    if (!user?.avatar) return null;
    return user.avatar.startsWith("http") ? user.avatar : `${apiUrl}${user.avatar}`;
}

function getOrderStatusLabel(status) {
    const map = {
        pending: "Ожидает",
        active: "В процессе",
        completed: "Завершён",
        expired: "Истёк",
        pending_payment: "Ожидает оплату",
    };

    return map[status] || status || "—";
}

function formatMessageTime(value) {
    if (!value) return "";

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";

    return d.toLocaleTimeString("ru-RU", {
        hour: "2-digit",
        minute: "2-digit",
    });
}

function formatDatePill(value) {
    if (!value) return "Сегодня";

    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "Сегодня";

    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();

    if (isToday) return "Сегодня";

    return d.toLocaleDateString("ru-RU", {
        day: "numeric",
        month: "long",
    });
}

function normalizePhoneForTel(rawPhone) {
    let digits = String(rawPhone || "").replace(/\D/g, "");

    if (!digits) return null;

    if (digits.length === 11 && digits.startsWith("8")) {
        digits = `7${digits.slice(1)}`;
    }

    if (digits.length === 10) {
        digits = `7${digits}`;
    }

    if (digits.length === 11 && digits.startsWith("7")) {
        return `+${digits}`;
    }

    return null;
}

const ChatPage = () => {
    const params = useParams();
    const orderId = params.orderId;
    const orderType = params.orderType || "regular";
    const navigate = useNavigate();
    const { currentUser } = useUser();

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

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [selectedUser, setSelectedUser] = useState(null);
    const [order, setOrder] = useState(null);

    const [isDisputeModalOpen, setIsDisputeModalOpen] = useState(false);
    const [selectedOrderForDispute, setSelectedOrderForDispute] = useState(null);
    const [disputeReasonCode, setDisputeReasonCode] = useState("poor_quality");
    const [disputeReason, setDisputeReason] = useState("");
    const [disputeDescription, setDisputeDescription] = useState("");
    const [disputeEvidenceFiles, setDisputeEvidenceFiles] = useState([]);
    const [disputeLoading, setDisputeLoading] = useState(false);
    const [orderDispute, setOrderDispute] = useState(null);

    const messagesContainerRef = useRef(null);
    const shouldAutoScrollRef = useRef(true);

    const {
        messages,
        addMessage,
        refreshMessages,
        loadingMessages,
        syncError: messageSyncError,
    } = useOrderChatSync({
        userId: currentUser?.id,
        orderId,
        orderType,
    });

    const selectedUserAvatar = getAvatarUrl(selectedUser);

    const scrollToBottom = useCallback((behavior = "smooth") => {
        if (messagesContainerRef.current) {
            messagesContainerRef.current.scrollTo({
                top: messagesContainerRef.current.scrollHeight,
                behavior,
            });
        }
    }, []);

    const handleMessagesScroll = useCallback((event) => {
        const element = event.currentTarget;

        const distanceFromBottom =
            element.scrollHeight -
            element.scrollTop -
            element.clientHeight;

        shouldAutoScrollRef.current =
            distanceFromBottom < 100;
    }, []);

    useEffect(() => {
        if (!shouldAutoScrollRef.current) {
            return;
        }

        scrollToBottom("auto");
    }, [messages, scrollToBottom]);

    const fetchChatData = useCallback(
        async ({ silent = false } = {}) => {
            try {
                if (!silent) {
                    setLoading(true);
                    setError("");
                }

                const orderEndpoint =
                    orderType === "express"
                        ? `/express/express-orders/${orderId}`
                        : `/orders/${orderId}`;

                const { data: orderResponse } = await axiosInstance.get(orderEndpoint);

                const orderData =
                    orderType === "express"
                        ? orderResponse.order || orderResponse
                        : orderResponse;

                setOrder(orderData);

                try {
                    const { data: disputeResponse } = await axiosInstance.get(
                        `/disputes/order/${orderType}/${orderData.id}`
                    );

                    const dispute =
                        disputeResponse?.dispute ||
                        null;

                    setOrderDispute(dispute);
                } catch (e) {
                    if (e?.response?.status !== 404) {
                        console.error(
                            `Ошибка загрузки спора для заказа ${orderData.id}:`,
                            e
                        );
                    }

                    setOrderDispute(null);
                }

                const otherUserId =
                    String(orderData.creatorId) === String(currentUser.id)
                        ? orderData.executorId
                        : orderData.creatorId;

                const { data: user } = await axiosInstance.get(`/auth/${otherUserId}`);

                setSelectedUser(user);
                setError("");
                requestAnimationFrame(() => scrollToBottom("auto"));
            } catch (err) {
                console.error(err);

                if (silent) {
                    return;
                }

                if (err?.response?.status === 401) {
                    setError("Сессия устарела. Выполните вход заново.");
                    return;
                }

                setError("Не удалось загрузить данные чата.");
            } finally {
                if (!silent) {
                    setLoading(false);
                }
            }
        },
        [orderId, orderType, currentUser?.id, scrollToBottom]
    );

    useEffect(() => {
        if (!currentUser?.id || !orderId) {
            return;
        }

        const restoreOrderData = () => {
            if (
                error ||
                !order ||
                !selectedUser
            ) {
                fetchChatData({
                    silent: true,
                });
            }
        };

        window.addEventListener(
            "online",
            restoreOrderData
        );

        return () => {
            window.removeEventListener(
                "online",
                restoreOrderData
            );
        };
    }, [
        currentUser?.id,
        orderId,
        error,
        order,
        selectedUser,
        fetchChatData,
    ]);

    useEffect(() => {
        if (orderId && currentUser?.id) {
            fetchChatData();
        }
    }, [orderId, currentUser?.id, fetchChatData]);

    const handleBack = () => {
        navigate(-1);
    };

    const handleRouteClick = async () => {
        if (!order) {
            alert("Заказ ещё не загружен");
            return;
        }

        try {
            await openOrderRoute(order, {
                orderType,
                target: "auto",
            });
        } catch (error) {
            console.error(
                "Ошибка открытия маршрута из чата:",
                error
            );

            alert("Не удалось открыть маршрут");
        }
    };

    const disputeReasonOptions = [
        { value: "work_not_done", label: "Работа не выполнена" },
        { value: "poor_quality", label: "Низкое качество работы" },
        { value: "missed_deadline", label: "Нарушены сроки" },
        { value: "wrong_price", label: "Спор по стоимости" },
        { value: "rude_behavior", label: "Некорректное поведение" },
        { value: "other", label: "Другое" },
    ];

    const openDisputeModal = (orderToDispute) => {
        setSelectedOrderForDispute(orderToDispute);
        setDisputeReasonCode("poor_quality");
        setDisputeReason("");
        setDisputeDescription("");
        setDisputeEvidenceFiles([]);
        setIsDisputeModalOpen(true);
    };

    const closeDisputeModal = () => {
        setIsDisputeModalOpen(false);
        setSelectedOrderForDispute(null);
        setDisputeReasonCode("poor_quality");
        setDisputeReason("");
        setDisputeDescription("");
        setDisputeEvidenceFiles([]);
        setDisputeLoading(false);
    };

    const fetchOrderDispute = async (targetOrderId) => {
        try {
            const res = await axiosInstance.get(
                `/disputes/order/${orderType}/${targetOrderId}`
            );

            const dispute =
                res.data?.dispute ||
                null;

            setOrderDispute(dispute);

            return dispute;
        } catch (e) {
            if (e?.response?.status !== 404) {
                console.error(
                    `Ошибка получения спора по заказу ${targetOrderId}:`,
                    e
                );
            }

            setOrderDispute(null);

            return null;
        }
    };

    const submitDispute = async () => {
        try {
            if (!currentUser?.id) {
                alert("Вы не авторизованы");
                navigate("/login");
                return;
            }

            if (!selectedOrderForDispute?.id) {
                alert("Заказ не выбран");
                return;
            }

            if (!disputeReason.trim()) {
                alert("Укажите краткую причину спора");
                return;
            }

            setDisputeLoading(true);

            const formData = new FormData();

            formData.append("orderId", String(selectedOrderForDispute.id));
            formData.append("orderType", orderType);
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
                    timeout: 120000,
                }
            );

            if (res.data?.dispute) {
                setOrderDispute(res.data.dispute);
            }

            alert("Спор успешно открыт");
            closeDisputeModal();
        } catch (e) {
            console.error("Ошибка открытия спора:", e);
            alert(e?.response?.data?.message || "Не удалось открыть спор");
        } finally {
            setDisputeLoading(false);
        }
    };

    const handleDisputeClick = async () => {
        if (!order?.id) {
            alert("Заказ не найден");
            return;
        }

        const existingDispute = orderDispute || (await fetchOrderDispute(order.id));

        if (existingDispute) {
            alert(
                `Спор уже открыт.\n\nСтатус: ${existingDispute.status}\nПричина: ${existingDispute.reason}${
                    existingDispute.description ? `\nОписание: ${existingDispute.description}` : ""
                }`
            );
            return;
        }

        openDisputeModal(order);
    };

    const groupedMessages = useMemo(() => {
        let lastDate = null;

        return messages.map((msg) => {
            const d = msg.createdAt || msg.created_at || msg.timestamp;
            const currentDate = d ? new Date(d).toDateString() : "unknown";
            const showDate = currentDate !== lastDate;
            lastDate = currentDate;

            return {
                ...msg,
                showDate,
                dateLabel: formatDatePill(d),
                timeLabel: formatMessageTime(d),
            };
        });
    }, [messages]);

    const phoneForTel = normalizePhoneForTel(selectedUser?.phone);

    useEffect(() => {
        const onPullToRefresh = async (e) => {
            try {
                if (messagesContainerRef.current && messagesContainerRef.current.scrollTop > 20) {
                    return;
                }

                await Promise.allSettled([
                    fetchChatData({ silent: true }),
                    refreshMessages(),
                ]);
            } finally {
                e.detail?.done?.();
            }
        };

        window.addEventListener("appPullToRefresh", onPullToRefresh);

        return () => {
            window.removeEventListener("appPullToRefresh", onPullToRefresh);
        };
    }, [fetchChatData, refreshMessages]);

    if (loading && messages.length === 0) {
        return (
            <div className="chat-page">
                <div className="chat-loading">Загрузка чата...</div>
            </div>
        );
    }

    if (error && messages.length === 0) {
        return (
            <div className="chat-page">
                <div className="chat-error">Ошибка: {error}</div>
            </div>
        );
    }

    return (
        <div className={`chat-page chat-page--no-bottom-menu chat-page--${platform}`}>
            <div className="chat-container">
                <header className="chat-header">
                    <button
                        type="button"
                        className="chat-back-button"
                        onClick={handleBack}
                        aria-label="Назад"
                    >
                        ‹
                    </button>

                    <div className="chat-user">
                        <div className="chat-avatar-wrap">
                            {selectedUserAvatar ? (
                                <img
                                    src={selectedUserAvatar}
                                    alt={selectedUser?.username || "Пользователь"}
                                    className="chat-avatar"
                                />
                            ) : (
                                <div className="chat-avatar chat-avatar-placeholder">
                                    {(selectedUser?.username || "U").charAt(0).toUpperCase()}
                                </div>
                            )}
                        </div>

                        <div className="chat-header-text">
                            <div className="chat-header-title">
                                {selectedUser?.username || "Собеседник"}
                            </div>
                            <div className="chat-header-subtitle">
                                Заказ #{order?.id || orderId}
                            </div>
                        </div>
                    </div>
                </header>

                <section className="chat-order-card compact">
                    <div className="chat-order-main compact">
                        <div className="chat-order-info">
                            <div className="chat-order-top">
                                <span className="chat-order-title">Заказ #{order?.id || orderId}</span>
                                <span className={`chat-order-status status-${order?.status || "unknown"}`}>
                                {getOrderStatusLabel(order?.status)}
                            </span>
                            </div>
                        </div>

                        <div className="chat-order-actions compact">
                            <button
                                type="button"
                                className="chat-order-btn route"
                                onClick={handleRouteClick}
                            >
                                Маршрут
                            </button>

                            {phoneForTel ? (
                                <a
                                    className="chat-order-btn call"
                                    href={`tel:${phoneForTel}`}
                                    aria-label="Позвонить"
                                >
                                    Позвонить
                                </a>
                            ) : (
                                <button
                                    type="button"
                                    className="chat-order-btn call"
                                    onClick={() => alert("Некорректный номер телефона")}
                                    aria-label="Позвонить"
                                >
                                    Позвонить
                                </button>
                            )}

                            {orderType === "regular" && (
                                <button
                                    type="button"
                                    className={`chat-order-btn dispute ${orderDispute ? "opened" : ""}`}
                                    onClick={handleDisputeClick}
                                >
                                    {orderDispute ? "Спор открыт" : "Спор"}
                                </button>
                            )}
                        </div>
                    </div>
                </section>

                {messageSyncError && (
                    <div
                        className="chat-sync-notice"
                        role="alert"
                    >
                        <span>{messageSyncError}</span>

                        <button
                            type="button"
                            onClick={refreshMessages}
                        >
                            Повторить
                        </button>
                    </div>
                )}

                {error && messages.length > 0 && (
                    <div
                        className="chat-sync-notice"
                        role="alert"
                    >
        <span>
            Нет связи с сервером.
            Показана сохранённая переписка.
        </span>

                        <button
                            type="button"
                            onClick={() => fetchChatData()}
                        >
                            Повторить
                        </button>
                    </div>
                )}

                <div
                    className="chat-messages"
                    ref={messagesContainerRef}
                    onScroll={handleMessagesScroll}
                >
                    {groupedMessages.length > 0 ? (
                        groupedMessages.map((msg) => {
                            const isMine = String(msg.senderId) === String(currentUser.id);

                            return (
                                <React.Fragment key={msg.id}>
                                    {msg.showDate && (
                                        <div className="chat-date-pill">
                                            {msg.dateLabel}
                                        </div>
                                    )}

                                    <div className={`chat-message-row ${isMine ? "mine" : "theirs"}`}>
                                        {!isMine && (
                                            <div className="chat-message-avatar-space">
                                                {selectedUserAvatar ? (
                                                    <img
                                                        src={selectedUserAvatar}
                                                        alt=""
                                                        className="chat-message-avatar"
                                                    />
                                                ) : (
                                                    <div className="chat-message-avatar chat-avatar-placeholder small">
                                                        {(selectedUser?.username || "U").charAt(0).toUpperCase()}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        <div
                                            className={`chat-message ${
                                                isMine ? "chat-message-sent" : "chat-message-received"
                                            }`}
                                        >
                                            <p>{msg.content}</p>
                                            <span className="chat-message-time">
                                            {msg.timeLabel}
                                                {isMine && (
                                                    <span
                                                        className="chat-checks"
                                                        title={
                                                            msg.readAt
                                                                ? "Прочитано собеседником"
                                                                : "Сохранено на сервере"
                                                        }
                                                    >
        {msg.readAt ? " ✓✓" : " ✓"}
    </span>
                                                )}
                                            </span>
                                        </div>
                                    </div>
                                </React.Fragment>
                            );
                        })
                    ) : loadingMessages ? (
                        <div className="chat-loading">
                            Загрузка переписки...
                        </div>
                    ) : messageSyncError ? (
                        <div className="chat-error">
                            Пока не удалось загрузить историю.
                        </div>
                    ) : (
                        <div className="chat-empty">
                            <div className="chat-empty-icon">💬</div>
                            <div>Сообщений пока нет</div>
                            <small>Напишите первым по этому заказу</small>
                        </div>
                    )}
                </div>

                <ChatReadTracker
                    key={`${currentUser.id}:${orderType}:${orderId}`}

                    userId={currentUser.id}
                    orderId={orderId}
                    orderType={orderType}

                    messages={messages}

                    containerRef={messagesContainerRef}
                />

                <ReliableChatComposer
                    key={`${currentUser.id}:${orderType}:${orderId}`}

                    userId={currentUser.id}
                    receiverId={selectedUser?.id}
                    orderId={orderId}
                    orderType={orderType}

                    messages={messages}
                    onConfirmed={addMessage}
                />

                <Modal
                    appElement={document.getElementById("root")}
                    isOpen={isDisputeModalOpen}
                    onRequestClose={closeDisputeModal}
                    contentLabel="Открытие спора"
                    className="chat-dispute-modal"
                    overlayClassName="chat-dispute-overlay"
                >
                    <div className="chat-dispute-content">
                        <button
                            type="button"
                            onClick={closeDisputeModal}
                            className="chat-dispute-close"
                        >
                            ✖
                        </button>

                        <h2 className="chat-dispute-title">Открыть спор</h2>

                        {selectedOrderForDispute && (
                            <p className="chat-dispute-order">
                                Заказ №{selectedOrderForDispute.id}
                            </p>
                        )}

                        <div className="chat-dispute-group">
                            <label>Категория причины</label>
                            <select
                                value={disputeReasonCode}
                                onChange={(e) => setDisputeReasonCode(e.target.value)}
                                className="chat-dispute-input"
                            >
                                {disputeReasonOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                        {option.label}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="chat-dispute-group">
                            <label>Краткая причина</label>
                            <input
                                type="text"
                                value={disputeReason}
                                onChange={(e) => setDisputeReason(e.target.value)}
                                className="chat-dispute-input"
                                placeholder="Например: работа выполнена не полностью"
                                maxLength={255}
                            />
                        </div>

                        <div className="chat-dispute-group">
                            <label>Подробное описание</label>
                            <textarea
                                value={disputeDescription}
                                onChange={(e) => setDisputeDescription(e.target.value)}
                                className="chat-dispute-textarea"
                                placeholder="Опишите подробно, в чём проблема"
                                rows={5}
                            />
                        </div>

                        <DisputeEvidenceInput
                            files={disputeEvidenceFiles}
                            onChange={setDisputeEvidenceFiles}
                            disabled={disputeLoading}
                        />

                        <div className="chat-dispute-actions">
                            <button
                                type="button"
                                className="chat-dispute-cancel"
                                onClick={closeDisputeModal}
                                disabled={disputeLoading}
                            >
                                Отмена
                            </button>

                            <button
                                type="button"
                                className="chat-dispute-submit"
                                onClick={submitDispute}
                                disabled={disputeLoading}
                            >
                                {disputeLoading ? "Открываем..." : "Открыть спор"}
                            </button>
                        </div>
                    </div>
                </Modal>

            </div>
        </div>
    );
};

export default ChatPage;