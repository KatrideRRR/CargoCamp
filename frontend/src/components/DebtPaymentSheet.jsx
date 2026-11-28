import React, {
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";

import {
    CreditCard,
    CheckCircle2,
    AlertCircle,
    Clock3,
    Circle,
    Wallet,
    ShieldCheck,
} from "lucide-react";

import BottomSheet from "./ui/BottomSheet";
import SheetScreen from "./ui/SheetScreen";
import Button from "./ui/Button";

import axiosInstance from "../utils/axiosInstance";

import "../styles/debtPaymentSheet.css";

const formatAmount = (kopecks) =>
    new Intl.NumberFormat("ru-RU", {
        style: "currency",
        currency: "RUB",
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    }).format(Number(kopecks || 0) / 100);

const getSavedCards = (profile) => {
    const cards = [];

    if (profile?.yookassaPaymentMethodId) {
        cards.push({
            id: "yookassa",
            provider: "yookassa",

            title: [
                profile.cardType ||
                "Банковская карта",

                profile.cardLastFour
                    ? `•••• ${profile.cardLastFour}`
                    : "",
            ]
                .filter(Boolean)
                .join(" "),

            paymentMode: "saved_card",
        });
    }

    if (profile?.tbankCardBound) {
        cards.push({
            id: "tbank",
            provider: "tbank",

            title:
                profile.tbankCardMask ||
                "Сохранённая карта",

            paymentMode: "saved_card",
        });
    }

    return cards;
};

const getErrorMessage = (error) =>
    error?.response?.data?.error ||
    "Не удалось проверить состояние оплаты. " +
    "Не повторяйте платёж до получения результата.";

const DebtPaymentSheet = ({
                              open = false,
                              onClose,
                              onResolved,
                              amount = 0,
                              title,
                              description,
                              request = null,
                              returnPath = "/orders",
                              initialIntentId = null,
                              userId,
                          }) => {
    const [screen, setScreen] =
        useState("debt");

    const [direction, setDirection] =
        useState(1);

    const [profile, setProfile] =
        useState(null);

    const [selectedMethod, setSelectedMethod] =
        useState(null);

    const [busy, setBusy] =
        useState(false);

    const [error, setError] =
        useState("");

    const [payment, setPayment] =
        useState(null);

    const [displayAmount, setDisplayAmount] =
        useState(Number(amount || 0));

    const operationRef = useRef(false);

    const sessionRef = useRef(0);

    const onResolvedRef =
        useRef(onResolved);

    const resolvedIntentRef =
        useRef(null);

    useEffect(() => {
        onResolvedRef.current =
            onResolved;
    }, [onResolved]);

    const goTo = useCallback((
        nextScreen,
        nextDirection = 1
    ) => {
        setDirection(nextDirection);
        setScreen(nextScreen);
    }, []);

    const applyPaymentState = useCallback(
        (result) => {
            if (!result) return;

            setPayment(result);
            setError("");

            if (
                Number.isSafeInteger(
                    Number(result.amountKopecks)
                )
            ) {
                setDisplayAmount(
                    Number(result.amountKopecks)
                );
            }

            if (result.noDebt) {
                goTo("noDebt");

                window.dispatchEvent(
                    new Event(
                        "cargocamp:debt-updated"
                    )
                );

                return;
            }

            if (
                result.paymentStatus ===
                "failed"
            ) {
                setError(
                    result.error ||
                    "Платёж не прошёл. " +
                    "Вы можете выбрать другой способ оплаты."
                );

                goTo("failed");
                return;
            }

            if (
                result.paymentStatus ===
                "succeeded"
            ) {
                window.dispatchEvent(
                    new Event(
                        "cargocamp:debt-updated"
                    )
                );

                if (
                    result.requestStatus ===
                    "pending"
                ) {
                    goTo("processing");
                    return;
                }

                if (
                    result.requestStatus ===
                    "sent"
                ) {
                    goTo("success");
                } else if (
                    [
                        "failed",
                        "expired",
                    ].includes(
                        result.requestStatus
                    )
                ) {
                    goTo("requestFailed");
                } else {
                    goTo("paid");
                }

                if (
                    result.intentId &&
                    resolvedIntentRef.current !==
                    result.intentId
                ) {
                    resolvedIntentRef.current =
                        result.intentId;

                    onResolvedRef.current?.(
                        result
                    );

                    if (
                        result.requestStatus === "sent"
                    ) {
                        window.dispatchEvent(
                            new CustomEvent(
                                "cargocamp:order-request-sent",
                                {
                                    detail: {
                                        orderId:
                                        result.orderId,

                                        intentId:
                                        result.intentId,
                                    },
                                }
                            )
                        );
                    }
                }

                return;
            }

            goTo("processing");
        },
        [goTo]
    );

    useEffect(() => {
        if (!open) {
            return undefined;
        }

        const session =
            ++sessionRef.current;

        let cancelled = false;

        operationRef.current = true;

        resolvedIntentRef.current =
            null;

        setProfile(null);
        setPayment(null);
        setError("");
        setBusy(true);
        setDirection(1);
        setScreen("debt");

        setDisplayAmount(
            Number(amount || 0)
        );

        setSelectedMethod(null);

        const load = async () => {
            try {
                const [
                    profileResponse,
                    intentResponse,
                ] = await Promise.all([
                    axiosInstance.get(
                        "/auth/profile"
                    ),

                    axiosInstance.get(
                        initialIntentId
                            ? `/payments/debt/intent/${initialIntentId}`
                            : "/payments/debt/intent/active"
                    ),
                ]);

                if (
                    cancelled ||
                    session !==
                    sessionRef.current
                ) {
                    return;
                }

                const freshProfile =
                    profileResponse.data;

                if (
                    userId &&
                    Number(freshProfile?.id) !==
                    Number(userId)
                ) {
                    throw new Error(
                        "Пользователь изменился"
                    );
                }

                setProfile(freshProfile);

                const freshDebt =
                    Number(freshProfile.debt);

                if (
                    !Number.isSafeInteger(
                        freshDebt
                    ) ||
                    freshDebt < 0
                ) {
                    throw new Error(
                        "Некорректная задолженность"
                    );
                }

                setDisplayAmount(
                    freshDebt
                );

                const cards =
                    getSavedCards(
                        freshProfile
                    );

                const preferredCard =
                    cards.find(
                        (card) =>
                            card.provider ===
                            freshProfile
                                .autoCommissionProvider
                    ) || cards[0];

                setSelectedMethod(
                    preferredCard?.id ||
                    "other"
                );

                const restoredIntent =
                    initialIntentId
                        ? intentResponse.data
                        : intentResponse.data?.intent;

                if (restoredIntent?.intentId) {
                    applyPaymentState(
                        restoredIntent
                    );
                } else if (initialIntentId) {
                    setError(
                        "Не удалось восстановить состояние платежа"
                    );

                    goTo("unavailable");

                } else if (freshDebt === 0) {
                    goTo("noDebt");
                }

            } catch (loadError) {
                if (!cancelled) {
                    setError(
                        getErrorMessage(
                            loadError
                        )
                    );

                    goTo("unavailable");
                }

            } finally {
                if (
                    !cancelled &&
                    session ===
                    sessionRef.current
                ) {
                    operationRef.current =
                        false;

                    setBusy(false);
                }
            }
        };

        void load();

        return () => {
            cancelled = true;
            sessionRef.current = session + 1;
            operationRef.current = false;
        };

    }, [
        open,
        userId,
        amount,
        initialIntentId,
        applyPaymentState,
        goTo,
    ]);

    const savedCards =
        getSavedCards(profile);

    const hasAutoCharge =
        savedCards.some(
            (card) =>
                card.provider ===
                profile?.autoCommissionProvider
        );

    const checkPayment = useCallback(
        async () => {
            if (
                operationRef.current
            ) {
                return;
            }

            const session =
                sessionRef.current;

            operationRef.current = true;

            setBusy(true);
            setError("");

            try {
                let intentId =
                    payment?.intentId;

                if (!intentId) {
                    const response =
                        await axiosInstance.get(
                            "/payments/debt/intent/active"
                        );

                    intentId =
                        response.data?.intent
                            ?.intentId;
                }

                if (!intentId) {
                    if (
                        session ===
                        sessionRef.current
                    ) {
                        setError(
                            "Активный платёж пока не найден. " +
                            "Проверьте задолженность в профиле."
                        );
                    }

                    return;
                }

                const response =
                    await axiosInstance.post(
                        `/payments/debt/intent/${intentId}/reconcile`
                    );

                if (
                    session !==
                    sessionRef.current
                ) {
                    return;
                }

                applyPaymentState(
                    response.data
                );

            } catch (checkError) {
                if (
                    session ===
                    sessionRef.current
                ) {
                    setError(
                        getErrorMessage(
                            checkError
                        )
                    );
                }

            } finally {
                if (
                    session ===
                    sessionRef.current
                ) {
                    operationRef.current =
                        false;

                    setBusy(false);
                }
            }
        },
        [
            payment?.intentId,
            applyPaymentState,
        ]
    );

    useEffect(() => {
        if (
            !open ||
            screen !== "processing" ||
            !payment?.intentId
        ) {
            return undefined;
        }

        let attempts = 0;

        const timer = setInterval(
            () => {
                if (
                    operationRef.current
                ) {
                    return;
                }

                attempts++;

                if (attempts > 6) {
                    clearInterval(timer);
                    return;
                }

                void checkPayment();

            },
            3000
        );

        return () =>
            clearInterval(timer);

    }, [
        open,
        screen,
        payment?.intentId,
        checkPayment,
    ]);

    const startPayment = async () => {
        if (
            operationRef.current ||
            !profile ||
            displayAmount <= 0 ||
            !selectedMethod
        ) {
            return;
        }

        const session =
            sessionRef.current;

        const selectedCard =
            savedCards.find(
                (card) =>
                    card.id ===
                    selectedMethod
            );

        if (
            selectedMethod !== "other" &&
            !selectedCard
        ) {
            setError(
                "Выбранная карта недоступна"
            );

            return;
        }

        const provider =
            selectedCard?.provider ||
            "yookassa";

        const paymentMode =
            selectedCard
                ? "saved_card"
                : "redirect";

        operationRef.current = true;

        setBusy(true);
        setError("");

        goTo("processing");

        try {
            const endpoint =
                provider === "tbank"
                    ? "/tbank-payments/debt/intent/create"
                    : "/payments/debt/intent/create";

            const response =
                await axiosInstance.post(
                    endpoint,
                    {
                        paymentMode,

                        expectedAmountKopecks:
                        displayAmount,

                        request,
                        returnPath,
                    }
                );

            if (
                session !==
                sessionRef.current
            ) {
                return;
            }

            const result =
                response.data;

            applyPaymentState(result);

            if (
                result.success &&
                result.paymentProcessing &&
                !result.paidBySavedCard &&
                result.confirmationUrl
            ) {
                window.location.href =
                    result.confirmationUrl;
            }

        } catch (paymentError) {
            if (
                session !==
                sessionRef.current
            ) {
                return;
            }

            setError(
                getErrorMessage(
                    paymentError
                )
            );

            // Ошибка сети не означает,
            // что деньги не были списаны.

            goTo("processing");

        } finally {
            if (
                session ===
                sessionRef.current
            ) {
                operationRef.current =
                    false;

                setBusy(false);
            }
        }
    };

    const resumeRedirect = () => {
        if (
            payment?.confirmationUrl &&
            payment.paymentProcessing &&
            !payment.paidBySavedCard
        ) {
            window.location.href =
                payment.confirmationUrl;
        }
    };

    const handleClose = () => {
        if (
            operationRef.current
        ) {
            return;
        }

        onClose?.();
    };

    const renderError = () =>
        error ? (
            <div
                className="cc-debt-sheet__error"
                role="alert"
            >
                <AlertCircle
                    size={18}
                    aria-hidden="true"
                />

                <span>{error}</span>
            </div>
        ) : null;

    const renderHint = () =>
        profile && !hasAutoCharge ? (
            <p className="cc-debt-sheet__hint">
                {savedCards.length
                    ? "Включите автосписание комиссии в профиле, чтобы не отвлекаться на оплату задолженности."
                    : "Привяжите карту в профиле и включите автосписание комиссии, чтобы не отвлекаться на оплату задолженности."}
            </p>
        ) : null;

    const renderMethod = ({
                              id,
                              label,
                              subtitle,
                          }) => (
        <button
            key={id}
            type="button"

            className={[
                "cc-debt-sheet__method",

                selectedMethod === id &&
                "cc-debt-sheet__method--selected",
            ]
                .filter(Boolean)
                .join(" ")}

            aria-pressed={
                selectedMethod === id
            }

            disabled={busy}

            onClick={() =>
                setSelectedMethod(id)
            }
        >
            <span className="cc-debt-sheet__card-icon">
                <CreditCard
                    size={23}
                    aria-hidden="true"
                />
            </span>

            <span className="cc-debt-sheet__method-text">
                <strong>
                    {label}
                </strong>

                <small>
                    {subtitle}
                </small>
            </span>

            {selectedMethod === id ? (
                <CheckCircle2
                    size={22}
                    className="cc-debt-sheet__selected-icon"
                    aria-hidden="true"
                />
            ) : (
                <Circle
                    size={22}
                    className="cc-debt-sheet__unselected-icon"
                    aria-hidden="true"
                />
            )}
        </button>
    );

    const renderResult = ({
                              success = true,
                              heading,
                              text,
                          }) => (
        <div
            className="cc-debt-sheet__result"
            role="status"
        >
            <span
                className={[
                    "cc-debt-sheet__result-icon",

                    success
                        ? "cc-debt-sheet__result-icon--success"
                        : "cc-debt-sheet__result-icon--warning",
                ].join(" ")}
            >
                {success ? (
                    <CheckCircle2
                        size={36}
                        aria-hidden="true"
                    />
                ) : (
                    <AlertCircle
                        size={36}
                        aria-hidden="true"
                    />
                )}
            </span>

            <h3>{heading}</h3>

            {payment?.orderId &&
                payment.paymentStatus ===
                "succeeded" && (

                    <small className="cc-debt-sheet__order-number">
                        Заказ №{payment.orderId}
                    </small>
                )}

            <p>{text}</p>

            <Button
                fullWidth
                onClick={handleClose}
            >
                Понятно
            </Button>
        </div>
    );

    return (
        <BottomSheet
            open={open}

            onClose={handleClose}

            busy={busy}

            className="cc-debt-sheet"

            ariaLabel="Оплата задолженности"
        >
            <SheetScreen
                screen={screen}

                direction={direction}

                busy={busy}

                onBack={
                    screen === "method" &&
                    !busy
                        ? () =>
                            goTo("debt", -1)
                        : undefined
                }
            >
                {screen === "debt" && (
                    <div className="cc-debt-sheet__content">

                        <div className="cc-debt-sheet__heading">

                            <h3>
                                {title ||
                                    "Задолженность"}
                            </h3>

                            <Wallet
                                size={23}
                                aria-hidden="true"
                            />

                        </div>

                        <div className="cc-debt-sheet__amount">
                            {formatAmount(
                                displayAmount
                            )}
                        </div>

                        <p className="cc-debt-sheet__description">
                            {description ||
                                (
                                    request
                                        ? "Погасите задолженность. После подтверждения оплаты отклик отправится автоматически."
                                        : "Погасите задолженность по комиссии."
                                )}
                        </p>

                        <Button
                            fullWidth

                            loading={busy}

                            disabled={
                                !profile
                            }

                            onClick={() =>
                                goTo("method")
                            }
                        >
                            {request
                                ? "Оплатить и запросить"
                                : "Оплатить"}
                        </Button>

                        {renderHint()}

                    </div>
                )}

                {screen === "method" && (
                    <div className="cc-debt-sheet__content">

                        <h3>
                            Способ оплаты
                        </h3>

                        <div className="cc-debt-sheet__amount">
                            {formatAmount(
                                displayAmount
                            )}
                        </div>

                        <div className="cc-debt-sheet__methods">

                            {savedCards.map(
                                (card) =>
                                    renderMethod({
                                        id: card.id,

                                        label:
                                        card.title,

                                        subtitle:
                                            "Сохранённая карта",
                                    })
                            )}

                            {renderMethod({
                                id: "other",

                                label:
                                    savedCards.length
                                        ? "Другая карта"
                                        : "Банковская карта",

                                subtitle:
                                    "Разовая оплата",
                            })}

                        </div>

                        {renderError()}

                        <Button
                            fullWidth

                            loading={busy}

                            disabled={
                                !selectedMethod
                            }

                            onClick={
                                startPayment
                            }
                        >
                            Оплатить{" "}
                            {formatAmount(
                                displayAmount
                            )}
                        </Button>

                        <div className="cc-debt-sheet__secure">
                            <ShieldCheck
                                size={15}
                                aria-hidden="true"
                            />

                            Безопасная оплата
                        </div>

                    </div>
                )}

                {screen === "processing" && (
                    <div className="cc-debt-sheet__result">

                        <span className="cc-debt-sheet__result-icon cc-debt-sheet__result-icon--neutral">
                            <Clock3
                                size={34}
                                aria-hidden="true"
                            />
                        </span>

                        <h3>
                            Проверяем оплату
                        </h3>

                        <p>
                            {payment?.orderId
                                ? "После подтверждения платежа сервер обработает отклик. Вы можете закрыть приложение."
                                : "Ожидаем подтверждения платежа от банка."}
                        </p>

                        {renderError()}

                        {payment?.confirmationUrl &&
                            payment.paymentProcessing &&
                            !payment.paidBySavedCard && (

                                <Button
                                    fullWidth
                                    onClick={
                                        resumeRedirect
                                    }
                                    disabled={busy}
                                >
                                    Перейти к оплате
                                </Button>
                            )}

                        <Button
                            fullWidth

                            variant="secondary"

                            loading={busy}

                            onClick={
                                checkPayment
                            }
                        >
                            Проверить оплату
                        </Button>

                        <Button
                            fullWidth

                            variant="ghost"

                            disabled={busy}

                            onClick={
                                handleClose
                            }
                        >
                            Закрыть
                        </Button>

                    </div>
                )}

                {screen === "success" &&
                    renderResult({
                        heading:
                            "Отклик отправлен",

                        text:
                            "Задолженность погашена. " +
                            "Ожидайте решения заказчика.",
                    })
                }

                {screen === "paid" &&
                    renderResult({
                        heading:
                            "Платёж подтверждён",

                        text:
                            "Оплата задолженности учтена.",
                    })
                }

                {screen === "noDebt" &&
                    renderResult({
                        heading:
                            "Задолженности нет",

                        text:
                            "Вы можете продолжить работу с заказами.",
                    })
                }

                {screen === "requestFailed" &&
                    renderResult({
                        success: false,

                        heading:
                            "Платёж подтверждён",

                        text:
                            payment?.requestError ||
                            "Оплата учтена, но отклик не отправлен.",
                    })
                }

                {screen === "failed" && (
                    <div className="cc-debt-sheet__content">

                        <h3>
                            Оплата не прошла
                        </h3>

                        {renderError()}

                        {(!payment?.orderId ||
                            (
                                request &&
                                Number(request.orderId) ===
                                Number(payment.orderId)
                            )
                        ) ? (
                            <Button
                                fullWidth
                                onClick={() => {
                                    setPayment(null);
                                    setError("");

                                    goTo("method", -1);
                                }}
                            >
                                Выбрать способ оплаты
                            </Button>
                        ) : (
                            <p className="cc-debt-sheet__description">
                                Вернитесь к заказу и отправьте
                                отклик повторно, чтобы восстановить
                                параметры запроса.
                            </p>
                        )}

                        <Button
                            fullWidth

                            variant="ghost"

                            onClick={
                                handleClose
                            }
                        >
                            Закрыть
                        </Button>

                    </div>
                )}

                {screen === "unavailable" && (
                    <div className="cc-debt-sheet__content">

                        <h3>
                            Оплата недоступна
                        </h3>

                        {renderError()}

                        <Button
                            fullWidth

                            onClick={
                                handleClose
                            }
                        >
                            Закрыть
                        </Button>

                    </div>
                )}

            </SheetScreen>
        </BottomSheet>
    );
};

export default DebtPaymentSheet;