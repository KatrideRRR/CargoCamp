
import React, { useRef, useState } from "react";
import axiosInstance from "../utils/axiosInstance";
import PaymentProviderSelect from "./PaymentProviderSelect";
import "../styles/PromotionRetryPayment.css";

function safePaymentUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === "https:" ? url.href : null;
    } catch {
        return null;
    }
}

export default function PromotionRetryPayment({
                                                  order,
                                                  profile,
                                                  onUpdated,
                                                  onNotice,
                                              }) {
    const [open, setOpen] = useState(false);
    const [provider, setProvider] = useState("yookassa");
    const [paymentMode, setPaymentMode] = useState("redirect");
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState("");
    const [previousUrl, setPreviousUrl] = useState(null);
    const lockRef = useRef(false);

    const hasSavedCard = Boolean(
        profile?.yookassaPaymentMethodId
    );

    const updateOrders = async () => {
        if (typeof onUpdated === "function") {
            await onUpdated();
        }
    };

    const handlePayment = async () => {
        if (lockRef.current) return;

        lockRef.current = true;
        setBusy(true);
        setMessage("");
        setPreviousUrl(null);

        try {
            // Сначала проверяем предыдущий платёж.
            // Новое списание здесь не создаётся.
            const preparation = await axiosInstance.post(
                "/payments/order/promotion/retry/prepare",
                { orderId: order.id }
            );

            const previous = preparation.data;

            if (!previous?.success) {
                throw new Error(
                    previous?.error || "Не удалось проверить платёж"
                );
            }

            if (previous.ready !== true) {
                const previousStatus = String(
                    previous.status || "unknown"
                );

                if (
                    previousStatus === "succeeded" ||
                    previousStatus === "CONFIRMED"
                ) {
                    const result = await axiosInstance.get(
                        "/payments/promotion/status",
                        { params: { orderId: order.id } }
                    );

                    if (result.data?.status === "succeeded") {
                        setMessage("Продвижение оплачено.");
                    } else {
                        setMessage(
                            "Платёж подтверждается. " +
                            "Новая операция не создавалась."
                        );
                    }

                    await updateOrders();
                    return;
                }

                setPreviousUrl(
                    safePaymentUrl(previous.confirmationUrl)
                );

                setMessage(
                    `Предыдущий платёж (${previousStatus}) ` +
                    "ещё не подтверждён как отменённый. " +
                    "Создание нового платежа заблокировано."
                );

                return;
            }

            const endpoint =
                provider === "tbank"
                    ? "/tbank-payments/order/promotion/create"
                    : "/payments/order/promotion/create";

            const payload = {
                orderId: order.id,
            };

            if (provider === "yookassa") {
                payload.paymentMode = paymentMode;
            }

            const response = await axiosInstance.post(
                endpoint,
                payload
            );

            const payment = response.data;

            if (!payment?.success) {
                throw new Error(
                    payment?.error ||
                    "Не удалось создать платёж"
                );
            }

            if (payment.paidBySavedCard) {
                if (payment.paid) {
                    onNotice?.(
                        `Продвижение оплачено с привязанной карты. Заказ №${order.id}.`
                    );

                    await updateOrders();
                } else {
                    setMessage(
                        "Платёж с привязанной карты обрабатывается. " +
                        "Повторное списание не создаётся."
                    );
                }

                return;
            }

            const paymentUrl = safePaymentUrl(
                payment.confirmationUrl
            );

            if (!paymentUrl) {
                setMessage(
                    "Платёж создан, но ссылка для оплаты недоступна. " +
                    "Не запускайте новую оплату без проверки статуса."
                );
                return;
            }

            window.location.assign(paymentUrl);
        } catch (error) {
            setMessage(
                error.response?.data?.error ||
                error.message ||
                "Не удалось проверить или создать платёж"
            );

            // После сетевой ошибки нельзя автоматически
            // повторять запрос на списание.
        } finally {
            lockRef.current = false;
            setBusy(false);
        }
    };

    return (
        <div className="cc-promo-retry">
            <div className="cc-promo-retry-heading">
                Продвижение не оплачено
            </div>

            {!open ? (
                <button
                    type="button"
                    className="cc-promo-retry-primary"
                    onClick={() => setOpen(true)}
                >
                    Оплатить
                </button>
            ) : (
                <div className="cc-promo-retry-panel">
                    <PaymentProviderSelect
                        title="Выберите банк"
                        selectedProvider={provider}
                        onSelect={(value) => {
                            setProvider(value);
                            setMessage("");
                            setPreviousUrl(null);
                        }}
                        disabled={busy}
                    />

                    {provider === "yookassa" && (
                        <fieldset
                            className="cc-promo-retry-modes"
                            disabled={busy}
                        >
                            <legend>Способ оплаты ЮKassa</legend>

                            <label>
                                <input
                                    type="radio"
                                    name={`promo-mode-${order.id}`}
                                    checked={paymentMode === "redirect"}
                                    onChange={() =>
                                        setPaymentMode("redirect")
                                    }
                                />
                                Новая оплата / СБП
                            </label>

                            {hasSavedCard && (
                                <label>
                                    <input
                                        type="radio"
                                        name={`promo-mode-${order.id}`}
                                        checked={paymentMode === "saved"}
                                        onChange={() =>
                                            setPaymentMode("saved")
                                        }
                                    />
                                    Привязанная карта
                                    {profile?.cardLastFour
                                        ? ` •••• ${profile.cardLastFour}`
                                        : ""}
                                </label>
                            )}
                        </fieldset>
                    )}

                    <div className="cc-promo-retry-actions">
                        <button
                            type="button"
                            className="cc-promo-retry-primary"
                            disabled={busy}
                            onClick={handlePayment}
                        >
                            {busy
                                ? "Проверяем платёж…"
                                : "Продолжить оплату"}
                        </button>

                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => setOpen(false)}
                        >
                            Закрыть
                        </button>
                    </div>

                    {message && (
                        <p
                            role="status"
                            className="cc-promo-retry-message"
                        >
                            {message}
                        </p>
                    )}

                    {previousUrl && (
                        <a
                            href={previousUrl}
                            className="cc-promo-retry-existing"
                        >
                            Продолжить предыдущую оплату
                        </a>
                    )}
                </div>
            )}
        </div>
    );
}
